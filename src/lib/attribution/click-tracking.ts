import { randomBytes } from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

const TOKEN_BYTES = 18;
const TOKEN_LENGTH = 24;
const MAX_ATTRIBUTION_VALUE_LENGTH = 500;
const MAX_URL_LENGTH = 2_048;
const MAX_MESSAGE_LENGTH = 3_500;
const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
const MARKER_RE = /(?:^|[\s([{])OZ-([A-Za-z0-9_-]{24})(?=$|[\s.,!?;:)\]}])/i;

export interface CampaignTrackingLink {
  id: string;
  account_id: string;
  slug: string;
  whatsapp_number: string;
  default_message: string | null;
  is_active: boolean;
}

export interface AttributionInput {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  gclid: string | null;
  fbclid: string | null;
  msclkid: string | null;
  landingUrl: string | null;
  referrer: string | null;
  userAgent: string | null;
}

export interface AttributionClick extends AttributionInput {
  id: string;
  accountId: string;
  trackingLinkId: string;
  token: string;
  capturedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolvedContactId: string | null;
  resolvedConversationId: string | null;
}

export interface AttributionResolutionContext {
  contactId?: string;
  conversationId?: string;
}

export class AttributionError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'AttributionError';
  }
}

/**
 * Public slugs are deliberately constrained to a predictable, URL-safe
 * alphabet. They identify an entry point, not an account or a person.
 */
export function normalizeTrackingSlug(value: string): string | null {
  const slug = value.trim().toLowerCase();
  return /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,78}[a-z0-9])$/.test(slug)
    ? slug
    : null;
}

export function normalizeWhatsAppNumber(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null;
}

export function generateAttributionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function attributionMarker(token: string): string {
  if (!TOKEN_RE.test(token)) {
    throw new AttributionError('Invalid attribution token', 500);
  }
  return `OZ-${token}`;
}

/** Pull the first OrganiZAP attribution marker from inbound WhatsApp text. */
export function extractAttributionToken(text: string | null | undefined) {
  if (!text) return null;
  return text.match(MARKER_RE)?.[1] ?? null;
}

export function buildAttributionMessage(
  defaultMessage: string | null | undefined,
  token: string
): string {
  const marker = `Ref: ${attributionMarker(token)}`;
  const message = defaultMessage?.trim().slice(0, MAX_MESSAGE_LENGTH);
  return message ? `${message}\n\n${marker}` : marker;
}

export function buildWhatsAppRedirectUrl(
  whatsappNumber: string,
  message: string
): string {
  const number = normalizeWhatsAppNumber(whatsappNumber);
  if (!number) throw new AttributionError('Invalid WhatsApp number', 500);
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function trimValue(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function safeHttpUrl(value: string | null | undefined) {
  const trimmed = trimValue(value, MAX_URL_LENGTH);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Normalize public query/header values before persisting.  We do not store
 * an IP address; source attribution only needs campaign identifiers and the
 * page that produced the click.
 */
export function attributionInputFromRequest(
  request: Request
): AttributionInput {
  const url = new URL(request.url);
  const query = url.searchParams;
  return {
    utmSource: trimValue(query.get('utm_source'), MAX_ATTRIBUTION_VALUE_LENGTH),
    utmMedium: trimValue(query.get('utm_medium'), MAX_ATTRIBUTION_VALUE_LENGTH),
    utmCampaign: trimValue(
      query.get('utm_campaign'),
      MAX_ATTRIBUTION_VALUE_LENGTH
    ),
    utmTerm: trimValue(query.get('utm_term'), MAX_ATTRIBUTION_VALUE_LENGTH),
    utmContent: trimValue(
      query.get('utm_content'),
      MAX_ATTRIBUTION_VALUE_LENGTH
    ),
    gclid: trimValue(query.get('gclid'), MAX_ATTRIBUTION_VALUE_LENGTH),
    fbclid: trimValue(query.get('fbclid'), MAX_ATTRIBUTION_VALUE_LENGTH),
    msclkid: trimValue(query.get('msclkid'), MAX_ATTRIBUTION_VALUE_LENGTH),
    landingUrl: safeHttpUrl(query.get('landing_url') ?? query.get('url')),
    referrer: safeHttpUrl(request.headers.get('referer')),
    userAgent: trimValue(request.headers.get('user-agent'), 1_000),
  };
}

function toClick(row: Record<string, unknown>): AttributionClick {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    trackingLinkId: row.tracking_link_id as string,
    token: row.token as string,
    utmSource: (row.utm_source as string | null) ?? null,
    utmMedium: (row.utm_medium as string | null) ?? null,
    utmCampaign: (row.utm_campaign as string | null) ?? null,
    utmTerm: (row.utm_term as string | null) ?? null,
    utmContent: (row.utm_content as string | null) ?? null,
    gclid: (row.gclid as string | null) ?? null,
    fbclid: (row.fbclid as string | null) ?? null,
    msclkid: (row.msclkid as string | null) ?? null,
    landingUrl: (row.landing_url as string | null) ?? null,
    referrer: (row.referrer as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    capturedAt: row.captured_at as string,
    expiresAt: row.expires_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    resolvedContactId: (row.resolved_contact_id as string | null) ?? null,
    resolvedConversationId:
      (row.resolved_conversation_id as string | null) ?? null,
  };
}

export async function findActiveTrackingLink(
  db: SupabaseClient,
  slug: string
): Promise<CampaignTrackingLink | null> {
  const normalizedSlug = normalizeTrackingSlug(slug);
  if (!normalizedSlug) return null;

  const { data, error } = await db
    .from('campaign_tracking_links')
    .select('id, account_id, slug, whatsapp_number, default_message, is_active')
    .eq('slug', normalizedSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[attribution] failed to resolve tracking link:', error);
    throw new AttributionError('Failed to resolve tracking link', 500);
  }
  return (data as CampaignTrackingLink | null) ?? null;
}

/**
 * Stores a first-party click before the visitor leaves for WhatsApp. The
 * retry loop only handles the astronomically unlikely random-token collision.
 */
export async function captureAttributionClick(
  db: SupabaseClient,
  link: CampaignTrackingLink,
  input: AttributionInput
): Promise<AttributionClick> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateAttributionToken();
    const { data, error } = await db
      .from('campaign_attribution_clicks')
      .insert({
        account_id: link.account_id,
        tracking_link_id: link.id,
        token,
        utm_source: input.utmSource,
        utm_medium: input.utmMedium,
        utm_campaign: input.utmCampaign,
        utm_term: input.utmTerm,
        utm_content: input.utmContent,
        gclid: input.gclid,
        fbclid: input.fbclid,
        msclkid: input.msclkid,
        landing_url: input.landingUrl,
        referrer: input.referrer,
        user_agent: input.userAgent,
      })
      .select(
        'id, account_id, tracking_link_id, token, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, msclkid, landing_url, referrer, user_agent, captured_at, expires_at, resolved_at, resolved_contact_id, resolved_conversation_id'
      )
      .single();

    if (data) return toClick(data as Record<string, unknown>);
    if (error?.code === '23505') continue;
    console.error('[attribution] failed to capture click:', error);
    throw new AttributionError('Failed to capture attribution click', 500);
  }
  throw new AttributionError('Could not allocate attribution token', 500);
}

/**
 * Helper for the inbound WhatsApp webhook. It is explicitly account-scoped,
 * so a marker created for one CRM can never resolve against another account.
 * Calling it is optional and deferred until the message integration consumes
 * the marker; this foundation intentionally does not alter webhook behavior.
 */
export async function resolveInboundAttribution(
  db: SupabaseClient,
  accountId: string,
  inboundText: string | null | undefined,
  context: AttributionResolutionContext = {}
): Promise<AttributionClick | null> {
  const token = extractAttributionToken(inboundText);
  if (!token) return null;

  const { data, error } = await db
    .from('campaign_attribution_clicks')
    .select(
      'id, account_id, tracking_link_id, token, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, msclkid, landing_url, referrer, user_agent, captured_at, expires_at, resolved_at, resolved_contact_id, resolved_conversation_id'
    )
    .eq('account_id', accountId)
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) {
    console.error('[attribution] failed to resolve inbound token:', error);
    throw new AttributionError('Failed to resolve attribution token', 500);
  }
  if (!data) return null;

  const click = toClick(data as Record<string, unknown>);
  const update: Record<string, string> = {};
  if (!click.resolvedAt) update.resolved_at = new Date().toISOString();
  if (context.contactId && !click.resolvedContactId) {
    update.resolved_contact_id = context.contactId;
  }
  if (context.conversationId && !click.resolvedConversationId) {
    update.resolved_conversation_id = context.conversationId;
  }
  if (Object.keys(update).length) {
    const { error: updateError } = await db
      .from('campaign_attribution_clicks')
      .update(update)
      .eq('id', click.id)
      .eq('account_id', accountId);
    if (updateError) {
      console.error('[attribution] failed to mark inbound token:', updateError);
      throw new AttributionError('Failed to apply attribution token', 500);
    }
    return {
      ...click,
      resolvedAt: update.resolved_at ?? click.resolvedAt,
      resolvedContactId: update.resolved_contact_id ?? click.resolvedContactId,
      resolvedConversationId:
        update.resolved_conversation_id ?? click.resolvedConversationId,
    };
  }
  return click;
}
