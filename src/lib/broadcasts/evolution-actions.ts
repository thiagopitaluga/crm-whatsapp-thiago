import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignAction } from './evolution-campaign';

/** Apply only after a confirmed send or a newly ingested inbound reply. */
export async function applyEvolutionCampaignAction(
  db: SupabaseClient, accountId: string, createdBy: string,
  contactId: string | null, phone: string, name: string | null, action: CampaignAction,
): Promise<string> {
  if (!action.pipelineId && !action.tagId && !action.assigneeId) return contactId ?? '';
  let id = contactId;
  if (!id) {
    const { data: match } = await db.from('contacts').select('id').eq('account_id', accountId)
      .in('phone', [phone, `+${phone}`]).limit(1).maybeSingle();
    id = match?.id ?? null;
  }
  if (!id) {
    const { data, error } = await db.from('contacts').insert({
      account_id: accountId, user_id: createdBy, phone: `+${phone}`, name: name || null,
    }).select('id').single();
    if (error || !data) throw error ?? new Error('Não foi possível criar o contato.');
    id = data.id;
  }
  if (action.assigneeId) {
    const { error } = await db.from('contacts').update({ assigned_to: action.assigneeId })
      .eq('account_id', accountId).eq('id', id);
    if (error) throw error;
  }
  if (action.tagId) {
    const { error } = await db.from('contact_tags').upsert({ contact_id: id, tag_id: action.tagId },
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  if (action.pipelineId) {
    let stageId = action.stageId;
    if (!stageId) {
      const { data: first, error } = await db.from('pipeline_stages').select('id')
        .eq('pipeline_id', action.pipelineId).order('position').limit(1).maybeSingle();
      if (error || !first) throw error ?? new Error('Funil sem etapas.');
      stageId = first.id;
    }
    const { data: existing, error: lookupError } = await db.from('deals').select('id')
      .eq('account_id', accountId).eq('contact_id', id).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      const { error } = await db.from('deals').update({ pipeline_id: action.pipelineId, stage_id: stageId })
        .eq('account_id', accountId).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('deals').insert({
        account_id: accountId, user_id: createdBy, contact_id: id,
        title: name || phone, pipeline_id: action.pipelineId, stage_id: stageId,
        assigned_to: action.assigneeId || null,
      });
      if (error) throw error;
    }
  }
  return id ?? '';
}

export async function applyEvolutionCampaignReply(
  db: SupabaseClient, accountId: string, contactId: string | null,
  phone: string, name: string | null, occurredAt: string,
) {
  const normalized = phone.replace(/\D/g, '');
  const { data: recipient, error } = await db.from('evolution_campaign_recipients')
    .select('id,campaign_id,contact_id,sent_at,evolution_campaigns!inner(created_by,on_reply,status)')
    .eq('account_id', accountId).eq('phone', normalized).eq('status', 'sent')
    .is('replied_at', null).lte('sent_at', occurredAt)
    .order('sent_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !recipient) return;
  const campaign = recipient.evolution_campaigns as unknown as {
    created_by: string; on_reply: CampaignAction; status: string;
  };
  const { data: claimed } = await db.from('evolution_campaign_recipients')
    .update({ replied_at: occurredAt }).eq('id', recipient.id)
    .is('replied_at', null).select('id').maybeSingle();
  if (!claimed) return;
  try {
    await applyEvolutionCampaignAction(db, accountId, campaign.created_by,
      contactId ?? recipient.contact_id, normalized, name, campaign.on_reply);
    await db.from('evolution_campaign_recipients')
      .update({ on_reply_applied_at: new Date().toISOString() }).eq('id', recipient.id);
  } catch (actionError) {
    console.error('[evolution-campaign] reply action failed', actionError);
  }
}
