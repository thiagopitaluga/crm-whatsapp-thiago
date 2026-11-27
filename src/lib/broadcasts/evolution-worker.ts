import { randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { serviceEnabled } from '@/lib/billing/server-access';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';
import { applyEvolutionCampaignAction } from './evolution-actions';
import { personalizeCampaignMessage, type CampaignAction, type CampaignDelivery, type CampaignMessage } from './evolution-campaign';

type Campaign = {
  id: string; account_id: string; created_by: string; name: string; status: string;
  message_variants: CampaignMessage[]; delivery_config: CampaignDelivery;
  on_sent: CampaignAction; sender_channel_ids: string[]; sent_count: number; failed_count: number;
};
type Recipient = { id: string; contact_id: string | null; phone: string; contact_name: string | null; sequence_no: number };

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${field('year')}-${field('month')}-${field('day')}`,
    time: `${field('hour')}:${field('minute')}`,
    weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(field('weekday')),
  };
}
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

async function defer(db: SupabaseClient, campaignId: string, seconds: number, reason?: string) {
  await db.from('evolution_campaigns').update({
    status: 'scheduled', locked_at: null, next_run_at: later(seconds), last_error: reason ?? null,
  }).eq('id', campaignId).in('status', ['scheduled','sending']);
}

export async function processDueEvolutionCampaign() {
  const db = supabaseAdmin();
  await reconcileCampaignAction(db);
  const staleBefore = new Date(Date.now() - 180_000).toISOString();
  const { data: stale } = await db.from('evolution_campaigns').select('id')
    .in('status', ['scheduled','sending']).lt('locked_at', staleBefore).limit(3);
  for (const row of stale ?? []) {
    const { data: uncertain } = await db.from('evolution_campaign_recipients')
      .update({ status: 'uncertain', error_message: 'Envio interrompido; confira no WhatsApp.' })
      .eq('campaign_id', row.id).eq('status', 'sending').select('id');
    await db.from('evolution_campaigns').update({
      status: uncertain?.length ? 'paused' : 'scheduled', locked_at: null,
      last_error: uncertain?.length ? 'Entrega incerta; confira antes de retomar.' : null,
    }).eq('id', row.id);
  }

  const { data: candidate, error } = await db.from('evolution_campaigns')
    .select('id,account_id,created_by,name,status,message_variants,delivery_config,on_sent,sender_channel_ids,sent_count,failed_count')
    .in('status', ['scheduled','sending']).is('locked_at', null)
    .lte('next_run_at', new Date().toISOString()).order('next_run_at').limit(1).maybeSingle();
  if (error) throw error;
  if (!candidate) return { processed: 0 };
  const campaign = candidate as Campaign;
  const { data: claimed } = await db.from('evolution_campaigns').update({
    status: 'sending', locked_at: new Date().toISOString(),
  }).eq('id', campaign.id).eq('status', campaign.status).is('locked_at', null)
    .select('id').maybeSingle();
  if (!claimed) return { processed: 0 };

  try {
    if (!await serviceEnabled(db, campaign.account_id, 'broadcasts')) {
      await db.from('evolution_campaigns').update({ status: 'paused', locked_at: null,
        last_error: 'Disparos desabilitados para esta conta.' }).eq('id', campaign.id);
      return { processed: 0, paused: 'plan' };
    }
    const config = campaign.delivery_config;
    if (config.endAt && Date.now() >= Date.parse(config.endAt)) {
      await expire(db, campaign);
      return { processed: 0, expired: true };
    }
    const local = localParts(new Date());
    if (!config.weekdays.includes(local.weekday) || local.time < config.windowStart || local.time >= config.windowEnd)
      { await defer(db, campaign.id, 60); return { processed: 0, deferred: 'window' }; }
    const { data: sentToday, error: countError } = await db.from('evolution_campaign_recipients')
      .select('sent_at').eq('campaign_id', campaign.id).eq('status', 'sent')
      .gte('sent_at', new Date(Date.now() - 36 * 3600_000).toISOString()).limit(5001);
    if (countError) throw countError;
    const todayRows = (sentToday ?? []).filter((row) => row.sent_at && localParts(new Date(row.sent_at)).date === local.date);
    if (todayRows.length >= config.dailyLimit) {
      await defer(db, campaign.id, 3600, 'Limite diário atingido; o disparo continuará no próximo dia permitido.');
      return { processed: 0, deferred: 'daily_limit' };
    }
    if (config.slots.length) {
      const active = config.slots.find((slot) => local.time >= slot.start && local.time < slot.end);
      if (!active || todayRows.filter((row) => {
        const time = localParts(new Date(row.sent_at)).time;
        return time >= active.start && time < active.end;
      }).length >= active.limit) {
        await defer(db, campaign.id, 60);
        return { processed: 0, deferred: 'slot' };
      }
    }
    const { data: recipient, error: recipientError } = await db.from('evolution_campaign_recipients')
      .select('id,contact_id,phone,contact_name,sequence_no').eq('campaign_id', campaign.id)
      .eq('status', 'pending').order('sequence_no').limit(1).maybeSingle();
    if (recipientError) throw recipientError;
    if (!recipient) {
      await finish(db, campaign);
      return { processed: 1, completed: true };
    }
    const target = recipient as Recipient;
    const senderId = campaign.sender_channel_ids[target.sequence_no % campaign.sender_channel_ids.length];
    const { data: channel } = await db.from('whatsapp_channels')
      .select('id,channel_key,evolution_instance_name').eq('id', senderId)
      .eq('account_id', campaign.account_id).eq('provider', 'evolution').maybeSingle();
    if (!channel) {
      await db.from('evolution_campaigns').update({ status: 'paused', locked_at: null,
        last_error: 'Número remetente removido. Atualize o disparo.' }).eq('id', campaign.id);
      return { processed: 0, paused: 'sender' };
    }
    const options = { instanceName: channel.evolution_instance_name, channelKey: channel.channel_key };
    const statusResponse = await fetchQrConnector(campaign.account_id, 'status', { signal: AbortSignal.timeout(8000) }, options);
    const status = await statusResponse.json().catch(() => null) as { status?: string } | null;
    if (!statusResponse.ok || status?.status !== 'connected') {
      await db.from('evolution_campaigns').update({ status: 'paused', locked_at: null,
        last_error: 'Número desconectado. Reconecte antes de retomar.' }).eq('id', campaign.id);
      return { processed: 0, paused: 'disconnected' };
    }
    const variantIndex = target.sequence_no % campaign.message_variants.length;
    const variant = campaign.message_variants[variantIndex];
    const text = personalizeCampaignMessage(variant.text, {
      phone: target.phone, name: target.contact_name ?? '',
    }, target.sequence_no + target.phone.split('').reduce((sum, digit) => sum + Number(digit), 0));
    const { data: locked } = await db.from('evolution_campaign_recipients').update({
      status: 'sending', attempted_at: new Date().toISOString(),
      sender_channel_id: channel.id, message_variant_index: variantIndex,
    }).eq('id', target.id).eq('status', 'pending').select('id').maybeSingle();
    if (!locked) { await defer(db, campaign.id, 60); return { processed: 0 }; }
    const { data: current } = await db.from('evolution_campaigns').select('status')
      .eq('id', campaign.id).maybeSingle();
    if (current?.status !== 'sending') {
      await db.from('evolution_campaign_recipients').update({
        status: 'pending', attempted_at: null, sender_channel_id: null,
        message_variant_index: null,
      }).eq('id', target.id).eq('status', 'sending');
      return { processed: 0, paused: 'user' };
    }
    if (config.endAt && Date.now() >= Date.parse(config.endAt)) {
      await db.from('evolution_campaign_recipients').update({
        status: 'pending', attempted_at: null, sender_channel_id: null,
        message_variant_index: null,
      }).eq('id', target.id).eq('status', 'sending');
      await expire(db, campaign);
      return { processed: 0, expired: true };
    }
    let result: 'sent' | 'failed' | 'uncertain' = 'uncertain';
    let providerId: string | null = null;
    let errorMessage: string | null = 'Resposta incerta do WhatsApp; confira antes de retomar.';
    try {
      const response = await fetchQrConnector(campaign.account_id,
        variant.mediaUrl ? 'messages/media' : 'messages/send', {
          method: 'POST', signal: AbortSignal.timeout(20_000),
          body: JSON.stringify(variant.mediaUrl
            ? { phone: target.phone, kind: variant.mediaKind, url: variant.mediaUrl,
                caption: text, filename: variant.mediaName }
            : { phone: target.phone, text }),
        }, options);
      const payload = await response.json().catch(() => null) as { messageId?: string; error?: string } | null;
      if (response.ok && payload?.messageId) { result = 'sent'; providerId = payload.messageId; errorMessage = null; }
      else if (response.status >= 400 && response.status < 500 && response.status !== 429)
        { result = 'failed'; errorMessage = payload?.error ?? `Falha ${response.status}.`; }
    } catch { /* A timeout cannot prove non-delivery. */ }
    const sentAt = result === 'sent' ? new Date().toISOString() : null;
    await db.from('evolution_campaign_recipients').update({
      status: result, provider_message_id: providerId, sent_at: sentAt, error_message: errorMessage,
    }).eq('id', target.id).eq('status', 'sending');
    if (result === 'sent') {
      await db.from('evolution_campaigns').update({ sent_count: campaign.sent_count + 1 }).eq('id', campaign.id);
      try {
        const contactId = await applyEvolutionCampaignAction(db, campaign.account_id,
          campaign.created_by, target.contact_id, target.phone, target.contact_name, campaign.on_sent);
        await db.from('evolution_campaign_recipients').update({
          contact_id: contactId || target.contact_id, on_sent_applied_at: new Date().toISOString(),
        }).eq('id', target.id);
      } catch (actionError) { console.error('[evolution-campaign] sent action failed', actionError); }
      const sentCount = campaign.sent_count + 1;
      const delay = randomInt(config.minDelaySeconds, config.maxDelaySeconds + 1) +
        (sentCount % config.batchSize === 0 ? config.batchPauseMinutes * 60 : 0);
      await defer(db, campaign.id, delay);
    } else if (result === 'failed') {
      await db.from('evolution_campaigns').update({ failed_count: campaign.failed_count + 1 }).eq('id', campaign.id);
      await defer(db, campaign.id, 60);
    } else {
      await db.from('evolution_campaigns').update({
        status: 'paused', locked_at: null, last_error: errorMessage,
      }).eq('id', campaign.id);
    }
    return { processed: 1, recipient: result };
  } catch (error) {
    await db.from('evolution_campaigns').update({ status: 'paused', locked_at: null,
      last_error: 'Falha no processamento. Revise o disparo.' }).eq('id', campaign.id);
    throw error;
  }
}

async function reconcileCampaignAction(db: SupabaseClient) {
  const { data: pending } = await db.from('evolution_campaign_recipients')
    .select('id,account_id,contact_id,phone,contact_name,replied_at,evolution_campaigns!inner(created_by,on_sent,on_reply)')
    .eq('status', 'sent').is('on_sent_applied_at', null).limit(1).maybeSingle();
  if (pending) {
    const campaign = pending.evolution_campaigns as unknown as {
      created_by: string; on_sent: CampaignAction; on_reply: CampaignAction;
    };
    try {
      const id = await applyEvolutionCampaignAction(db, pending.account_id,
        campaign.created_by, pending.contact_id, pending.phone, pending.contact_name, campaign.on_sent);
      await db.from('evolution_campaign_recipients').update({
        contact_id: id || pending.contact_id, on_sent_applied_at: new Date().toISOString(),
      }).eq('id', pending.id).is('on_sent_applied_at', null);
    } catch (error) { console.error('[evolution-campaign] action retry failed', error); }
  }
  const { data: replied } = await db.from('evolution_campaign_recipients')
    .select('id,account_id,contact_id,phone,contact_name,evolution_campaigns!inner(created_by,on_reply)')
    .eq('status', 'sent').not('replied_at', 'is', null)
    .is('on_reply_applied_at', null).limit(1).maybeSingle();
  if (replied) {
    const campaign = replied.evolution_campaigns as unknown as { created_by: string; on_reply: CampaignAction };
    try {
      await applyEvolutionCampaignAction(db, replied.account_id,
        campaign.created_by, replied.contact_id, replied.phone, replied.contact_name, campaign.on_reply);
      await db.from('evolution_campaign_recipients').update({ on_reply_applied_at: new Date().toISOString() })
        .eq('id', replied.id).is('on_reply_applied_at', null);
    } catch (error) { console.error('[evolution-campaign] reply action retry failed', error); }
  }
}

async function finish(db: SupabaseClient, campaign: Campaign) {
  const status = campaign.failed_count === 0 ? 'completed'
    : campaign.sent_count === 0 ? 'failed' : 'partial';
  await db.from('evolution_campaigns').update({ status, locked_at: null, next_run_at: null })
    .eq('id', campaign.id).in('status', ['scheduled','sending']);
  await db.from('notifications').insert({
    account_id: campaign.account_id, user_id: campaign.created_by, type: 'system',
    title: `Disparo finalizado: ${campaign.name}`,
    body: `${campaign.sent_count} enviados · ${campaign.failed_count} falharam.`,
  });
}

async function expire(db: SupabaseClient, campaign: Campaign) {
  const { count, error } = await db.from('evolution_campaign_recipients')
    .select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id).eq('status', 'pending');
  if (error) throw error;
  const remaining = count ?? 0;
  const { data: updated, error: updateError } = await db.from('evolution_campaigns').update({
    status: remaining ? 'partial' : 'completed', locked_at: null, next_run_at: null,
    last_error: remaining ? `Prazo encerrado; ${remaining} contato(s) ficaram sem envio.` : null,
  }).eq('id', campaign.id).eq('status', 'sending').select('id').maybeSingle();
  if (updateError) throw updateError;
  if (updated) await db.from('notifications').insert({
    account_id: campaign.account_id, user_id: campaign.created_by, type: 'system',
    title: `Prazo encerrado: ${campaign.name}`,
    body: remaining ? `${campaign.sent_count} enviados · ${remaining} não enviados.` : `${campaign.sent_count} enviados.`,
  });
}
