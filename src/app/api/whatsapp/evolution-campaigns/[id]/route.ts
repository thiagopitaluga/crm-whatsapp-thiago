import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { personalizeCampaignMessage, uuidPattern, type CampaignDelivery, type CampaignMessage } from '@/lib/broadcasts/evolution-campaign';
import { parseEvolutionEdit } from '@/lib/broadcasts/evolution-edit';

type Context = { params: Promise<{ id: string }> };
export const runtime = 'nodejs';

export async function GET(_request: Request, context: Context) {
  try {
    const { accountId } = await requireRole('agent');
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    const db = supabaseAdmin();
    const { data: campaign, error } = await db.from('evolution_campaigns').select('*')
      .eq('account_id', accountId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!campaign) return NextResponse.json({ error: 'Disparo não encontrado.' }, { status: 404 });
    const { data: recipients, error: recipientError } = await db.from('evolution_campaign_recipients')
      .select('id,phone,contact_name,sequence_no,status,sent_at,replied_at,error_message,sender_channel_id,message_variant_index,sent_text')
      .eq('account_id', accountId).eq('campaign_id', id).order('sequence_no').limit(5000);
    if (recipientError) throw recipientError;
    return NextResponse.json({ campaign, recipients: recipients ?? [] }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return toErrorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { accountId } = await requireRole('admin');
    const { id } = await context.params;
    const input = await request.json().catch(() => null) as {
      status?: string; edit?: unknown; onSentTagId?: string; onReplyTagId?: string;
    } | null;
    if (!uuidPattern.test(id) || !input ||
        (!input.edit && !['paused','scheduled'].includes(input.status ?? '')))
      return NextResponse.json({ error: 'Operação inválida.' }, { status: 400 });
    const db = supabaseAdmin();
    const { data: campaign, error: lookupError } = await db.from('evolution_campaigns').select('*')
      .eq('account_id', accountId).eq('id', id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!campaign) return NextResponse.json({ error: 'Disparo não encontrado.' }, { status: 404 });

    if (input.edit) {
      if (!['draft','paused'].includes(campaign.status))
        return NextResponse.json({ error: 'Pause o disparo antes de editar.' }, { status: 409 });
      const parsed = parseEvolutionEdit(input.edit, campaign as {
        message_variants: CampaignMessage[]; delivery_config: CampaignDelivery;
      });
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const { name, messages, delivery } = parsed.value;
      const { data: channels, error: channelError } = await db.from('whatsapp_channels')
        .select('id').eq('account_id', accountId).eq('provider', 'evolution').in('id', delivery.senderIds);
      if (channelError) throw channelError;
      if (channels?.length !== delivery.senderIds.length)
        return NextResponse.json({ error: 'Escolha apenas números Evolution desta conta.' }, { status: 400 });
      const tagIds = [input.onSentTagId, input.onReplyTagId].filter((tag): tag is string => Boolean(tag));
      if (tagIds.some((tag) => !uuidPattern.test(tag)))
        return NextResponse.json({ error: 'Etiqueta inválida.' }, { status: 400 });
      if (tagIds.length) {
        const { data: tags, error: tagError } = await db.from('tags').select('id')
          .eq('account_id', accountId).in('id', tagIds);
        if (tagError) throw tagError;
        if (tags?.length !== new Set(tagIds).size)
          return NextResponse.json({ error: 'Etiqueta não pertence a esta conta.' }, { status: 400 });
      }
      const { data: historical, error: historyError } = await db.from('evolution_campaign_recipients')
        .select('id,phone,contact_name,sequence_no,message_variant_index')
        .eq('account_id', accountId).eq('campaign_id', id).eq('status', 'sent').is('sent_text', null).limit(5000);
      if (historyError) throw historyError;
      for (let offset = 0; offset < (historical?.length ?? 0); offset += 20) {
        await Promise.all((historical ?? []).slice(offset, offset + 20).map(async (recipient) => {
          const variantIndex = recipient.message_variant_index ?? recipient.sequence_no % campaign.message_variants.length;
          const variant = campaign.message_variants[variantIndex];
          if (!variant) throw new Error('Não foi possível preservar uma mensagem já enviada.');
          const seed = recipient.sequence_no + recipient.phone.split('').reduce((sum: number, digit: string) => sum + Number(digit), 0);
          const text = personalizeCampaignMessage(variant.text, {
            phone: recipient.phone, name: recipient.contact_name ?? '',
          }, seed);
          const { error: saveError } = await db.from('evolution_campaign_recipients').update({ sent_text: text })
            .eq('account_id', accountId).eq('id', recipient.id).eq('status', 'sent').is('sent_text', null);
          if (saveError) throw saveError;
        }));
      }
      const variants = messages.map((text, index) => ({ ...campaign.message_variants[index], text }));
      const { data: updated, error } = await db.from('evolution_campaigns').update({
        name, message_variants: variants, delivery_config: delivery,
        sender_channel_ids: delivery.senderIds,
        on_sent: { ...campaign.on_sent, tagId: input.onSentTagId ?? campaign.on_sent?.tagId ?? '' },
        on_reply: { ...campaign.on_reply, tagId: input.onReplyTagId ?? campaign.on_reply?.tagId ?? '' },
      }).eq('account_id', accountId).eq('id', id).eq('status', campaign.status).select('id').maybeSingle();
      if (error) throw error;
      if (!updated) return NextResponse.json({ error: 'O estado do disparo mudou. Atualize a página.' }, { status: 409 });
      return NextResponse.json({ status: campaign.status });
    }

    if (!['draft','paused','scheduled','sending'].includes(campaign.status))
      return NextResponse.json({ error: 'Disparo não pode ser alterado.' }, { status: 409 });
    const next = input?.status === 'paused' ? 'paused' : 'scheduled';
    if (next === 'paused' && !['scheduled','sending'].includes(campaign.status))
      return NextResponse.json({ error: 'O disparo já está pausado.' }, { status: 409 });
    if (next === 'scheduled' && !['paused','draft'].includes(campaign.status))
      return NextResponse.json({ error: 'O disparo já está ativo.' }, { status: 409 });
    const cutoff = (campaign.delivery_config as CampaignDelivery).endAt;
    if (next === 'scheduled' && cutoff && Date.parse(cutoff) <= Date.now())
      return NextResponse.json({ error: 'A data de encerramento já passou. Edite o disparo antes de iniciar.' }, { status: 409 });
    const { data: updated, error } = await db.from('evolution_campaigns').update({
      status: next, next_run_at: next === 'scheduled' ? new Date().toISOString() : undefined,
      locked_at: next === 'paused' ? null : undefined,
      last_error: next === 'scheduled' ? null : undefined,
      scheduled_at: next === 'scheduled' && campaign.status === 'draft' ? new Date().toISOString() : undefined,
    }).eq('account_id', accountId).eq('id', id).eq('status', campaign.status).select('id').maybeSingle();
    if (error) throw error;
    if (!updated) return NextResponse.json({ error: 'O estado do disparo mudou. Atualize a página.' }, { status: 409 });
    return NextResponse.json({ status: next });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(_request: Request, context: Context) {
  try {
    const { accountId, userId } = await requireRole('admin');
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    const db = supabaseAdmin();
    const { data: original, error: lookupError } = await db.from('evolution_campaigns').select('*')
      .eq('account_id', accountId).eq('id', id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!original) return NextResponse.json({ error: 'Disparo não encontrado.' }, { status: 404 });
    const { data: recipients, error: recipientError } = await db.from('evolution_campaign_recipients')
      .select('contact_id,phone,contact_name,sequence_no')
      .eq('account_id', accountId).eq('campaign_id', id).order('sequence_no').limit(5001);
    if (recipientError) throw recipientError;
    if (!recipients?.length || recipients.length > 5000)
      return NextResponse.json({ error: 'Público original inválido para duplicação.' }, { status: 400 });
    const { data: copy, error: insertError } = await db.from('evolution_campaigns').insert({
      account_id: accountId, created_by: userId, name: `${original.name} (cópia)`.slice(0, 120),
      message_variants: original.message_variants, audience_config: original.audience_config,
      delivery_config: original.delivery_config, on_sent: original.on_sent, on_reply: original.on_reply,
      sender_channel_ids: original.sender_channel_ids, status: 'draft',
      scheduled_at: null, next_run_at: null, total_recipients: recipients.length,
    }).select('id').single();
    if (insertError || !copy) throw insertError ?? new Error('Falha ao duplicar disparo.');
    for (let offset = 0; offset < recipients.length; offset += 200) {
      const { error } = await db.from('evolution_campaign_recipients').insert(recipients.slice(offset, offset + 200)
        .map((recipient) => ({ ...recipient, campaign_id: copy.id, account_id: accountId })));
      if (error) {
        await db.from('evolution_campaigns').delete().eq('id', copy.id).eq('account_id', accountId);
        throw error;
      }
    }
    return NextResponse.json({ campaign_id: copy.id, recipients: recipients.length }, { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
