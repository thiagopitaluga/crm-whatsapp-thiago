import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { DEFAULT_CURRENCY } from '@/lib/currency';

export interface IngestLeadInput {
  phone: string;
  name?: string | null;
  /** Most recent inbound WhatsApp text preview from the QR connector. */
  lastMessagePreview?: string | null;
}

export interface IngestLeadResult {
  contactId: string;
  contactCreated: boolean;
  conversationId: string;
  dealId: string | null;
}

/**
 * Create the minimum CRM footprint for an incoming lead.
 *
 * QR mode intentionally does not write a message body. It is a
 * capture-only connector: the WhatsApp conversation remains in the
 * user's WhatsApp client while the CRM receives the contact and a card
 * in the first stage of the account's first pipeline.
 */
export async function ingestLead(
  db: SupabaseClient,
  accountId: string,
  input: IngestLeadInput
): Promise<IngestLeadResult> {
  const auditUserId = await resolveAuditUserId(db, accountId);
  const contact = await findOrCreateContact(db, accountId, auditUserId, input);
  const conversationId = await findOrCreateConversation(
    db,
    accountId,
    auditUserId,
    contact.id,
    input.lastMessagePreview
  );

  const dealId = contact.created
    ? await createDefaultDeal(db, accountId, auditUserId, contact.id, input.name)
    : null;

  return {
    contactId: contact.id,
    contactCreated: contact.created,
    conversationId,
    dealId,
  };
}

async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  lastMessagePreview?: string | null
): Promise<string> {
  const lastMessageText = normalizeMessagePreview(lastMessagePreview);
  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (lookupError) throw new Error('Failed to find the lead conversation');
  if (existing?.[0]?.id) {
    if (lastMessageText) {
      const { error: updateError } = await db
        .from('conversations')
        .update({
          last_message_text: lastMessageText,
          last_message_at: now,
          updated_at: now,
        })
        .eq('id', existing[0].id)
        .eq('account_id', accountId);
      if (updateError) throw new Error('Failed to update the lead conversation');
    }
    return existing[0].id as string;
  }

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      ...(lastMessageText
        ? { last_message_text: lastMessageText, last_message_at: now }
        : {}),
    })
    .select('id')
    .single();

  if (created?.id) return created.id as string;
  if (isUniqueViolation(createError)) {
    const { data: raced } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (raced?.[0]?.id) return raced[0].id as string;
  }

  throw new Error('Failed to create the lead conversation');
}

function normalizeMessagePreview(value?: string | null): string | null {
  const preview = value?.replace(/\s+/g, ' ').trim().slice(0, 500);
  return preview || null;
}

async function createDefaultDeal(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  name?: string | null
): Promise<string | null> {
  const { data: pipeline } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pipeline?.id) return null;

  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipeline.id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage?.id) return null;

  const { data: account } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', accountId)
    .maybeSingle();

  const { data: deal, error } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: userId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      contact_id: contactId,
      title: name?.trim() || 'Lead do WhatsApp',
      value: 0,
      currency: account?.default_currency ?? DEFAULT_CURRENCY,
      status: 'open',
    })
    .select('id')
    .single();

  if (error || !deal?.id) {
    console.error('[lead-ingest] failed to create default deal:', error);
    return null;
  }
  return deal.id as string;
}
