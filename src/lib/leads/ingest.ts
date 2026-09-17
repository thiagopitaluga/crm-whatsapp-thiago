import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

export interface IngestLeadInput {
  phone: string;
  name?: string | null;
  /** Most recent WhatsApp message preview from the QR connector. */
  lastMessagePreview?: string | null;
}

export interface IngestLeadResult {
  contactId: string;
  contactCreated: boolean;
  conversationId: string;
  dealId: string | null;
}

export type ExternalMessageContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'interactive';

export interface IngestExternalWhatsAppMessageInput extends IngestLeadInput {
  direction: 'inbound' | 'outbound';
  /** Stable provider id, used to make connector retries idempotent. */
  messageId: string;
  contentText: string;
  contentType: ExternalMessageContentType;
  /** Durable Storage URL supplied by the trusted QR connector for media. */
  mediaUrl?: string | null;
  /** MIME type supplied by the trusted QR connector for media. */
  mediaType?: string | null;
  createdAt?: string | null;
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
    ? await createDefaultDeal(
        db,
        accountId,
        auditUserId,
        contact.id,
        input.name
      )
    : null;

  return {
    contactId: contact.id,
    contactCreated: contact.created,
    conversationId,
    dealId,
  };
}

/**
 * Update the preview of an existing QR-mode conversation without creating
 * anything. This is used for messages sent by the connected WhatsApp account:
 * an outbound message must never create a contact or a deal on its own.
 */
export async function updateExistingLeadConversation(
  db: SupabaseClient,
  accountId: string,
  input: Pick<IngestLeadInput, 'phone' | 'lastMessagePreview'>
): Promise<boolean> {
  const sanitizedPhone = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new Error('Invalid phone number');
  }

  const lastMessageText = normalizeMessagePreview(input.lastMessagePreview);
  if (!lastMessageText) return false;

  const contact = await findExistingContact(db, accountId, sanitizedPhone);
  if (!contact) return false;

  const { data: conversation, error: lookupError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error('Failed to find the lead conversation');
  if (!conversation?.id) return false;

  const now = new Date().toISOString();
  const { error: updateError } = await db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversation.id)
    .eq('account_id', accountId);
  if (updateError) throw new Error('Failed to update the lead conversation');

  return true;
}

/**
 * Persist one event received from a trusted WhatsApp connector.
 *
 * The QR connector originally sent only the conversation preview.  Keeping
 * its provider message id here gives it the same durable, idempotent message
 * history as the official Cloud API webhook, without creating contacts from
 * outbound messages.
 */
export async function ingestExternalWhatsAppMessage(
  db: SupabaseClient,
  accountId: string,
  input: IngestExternalWhatsAppMessageInput
): Promise<IngestLeadResult | null> {
  const messageId = input.messageId.trim().slice(0, 500);
  const contentText = normalizeMessageContent(input.contentText);
  if (!messageId || !contentText) {
    throw new Error('messageId and contentText are required');
  }

  let result: IngestLeadResult;
  if (input.direction === 'inbound') {
    // The message row, rather than the lead creation helper, owns the latest
    // message state so the event timestamp and idempotency boundary stay in
    // one place.
    result = await ingestLead(db, accountId, {
      phone: input.phone,
      name: input.name,
    });
  } else {
    const sanitizedPhone = sanitizePhoneForMeta(input.phone);
    if (!isValidE164(sanitizedPhone)) {
      throw new Error('Invalid phone number');
    }
    const contact = await findExistingContact(db, accountId, sanitizedPhone);
    if (!contact) return null;
    const conversationId = await findExistingConversation(
      db,
      accountId,
      contact.id
    );
    if (!conversationId) return null;
    result = {
      contactId: contact.id,
      contactCreated: false,
      conversationId,
      dealId: null,
    };
  }

  const createdAt = normalizeMessageTimestamp(input.createdAt);
  const { data: insertedRows, error: insertError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: result.conversationId,
        sender_type: input.direction === 'inbound' ? 'customer' : 'agent',
        content_type: input.contentType,
        content_text: contentText,
        media_url: input.mediaUrl ?? null,
        media_type: input.mediaType ?? null,
        message_id: messageId,
        status: input.direction === 'inbound' ? 'delivered' : 'sent',
        created_at: createdAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id');
  if (insertError) throw new Error('Failed to store WhatsApp message');

  // A connector can replay events after reconnecting. Only a freshly stored
  // message may change the list preview or unread count.
  if (insertedRows?.length) {
    if (input.direction === 'inbound') {
      const { error } = await db.rpc('bump_conversation_on_inbound', {
        p_conversation_id: result.conversationId,
        p_last_message_text: contentText,
      });
      if (error) throw new Error('Failed to update inbound conversation');
    } else {
      const { error } = await db
        .from('conversations')
        .update({
          last_message_text: contentText,
          last_message_at: createdAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', result.conversationId)
        .eq('account_id', accountId);
      if (error) throw new Error('Failed to update outbound conversation');
    }
  }

  return result;
}

async function findExistingConversation(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Failed to find the lead conversation');
  return data?.id ?? null;
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
      if (updateError)
        throw new Error('Failed to update the lead conversation');
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

function normalizeMessageContent(value: string): string | null {
  const content = value.replace(/\0/g, '').trim().slice(0, 20_000);
  return content || null;
}

function normalizeMessageTimestamp(value?: string | null): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
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
