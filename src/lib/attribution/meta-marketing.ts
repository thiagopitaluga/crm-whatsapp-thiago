import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side enrichment for Click-to-WhatsApp referrals.
 *
 * Meta's WhatsApp webhook supplies a source id, but not always the friendly
 * campaign hierarchy.  This module resolves that id only after finding the
 * current CRM tenant's explicitly connected ad account.  It intentionally
 * never accepts an ad-account id from a webhook or browser request.
 */
const META_GRAPH_VERSION = 'v21.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_ID_RE = /^\d{5,32}$/;
const MAX_META_TEXT_LENGTH = 1_000;

type FetchResponse = Pick<Response, 'ok' | 'status' | 'json'>;
export type MetaMarketingFetch = (
  input: string,
  init?: RequestInit
) => Promise<FetchResponse>;

export interface MetaMarketingResolutionInput {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  /** WhatsApp's signed CTWA `referral.source_id` (normally the Meta ad id). */
  sourceId: string | null;
  fetchFn?: MetaMarketingFetch;
}

export type MetaMarketingResolution =
  | {
      status: 'skipped';
      reason:
        | 'missing_source_id'
        | 'invalid_source_id'
        | 'missing_token'
        | 'no_active_integration';
    }
  | { status: 'not_found' }
  | { status: 'source_account_mismatch' }
  | { status: 'api_error'; httpStatus: number }
  | {
      status: 'resolved';
      adAccountId: string;
      campaignId: string | null;
      campaignName: string | null;
      adsetId: string | null;
      adsetName: string | null;
      adId: string;
      adName: string | null;
    };

interface ActiveAdAccountIntegration {
  meta_ad_account_id: string;
}

function boundedString(value: unknown, maxLength = MAX_META_TEXT_LENGTH) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function metaId(value: unknown) {
  const normalized = boundedString(value, 32);
  return normalized && META_ID_RE.test(normalized) ? normalized : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Kept separate to make the token boundary straightforward to test/audit. */
export function getMetaMarketingAccessToken(
  env: NodeJS.ProcessEnv = process.env
) {
  const token = env.META_MARKETING_ACCESS_TOKEN?.trim();
  return token || null;
}

/**
 * Resolve the campaign hierarchy for one persisted CTWA attribution.
 *
 * The integration lookup is account-scoped and active-only.  The returned
 * Meta object must also report the same ad account before any tenant data is
 * written, providing a second boundary even when a token is misconfigured.
 */
export async function resolveMetaMarketingAttribution(
  input: MetaMarketingResolutionInput
): Promise<MetaMarketingResolution> {
  if (!input.sourceId)
    return { status: 'skipped', reason: 'missing_source_id' };
  const sourceId = metaId(input.sourceId);
  if (!sourceId) return { status: 'skipped', reason: 'invalid_source_id' };

  const accessToken = getMetaMarketingAccessToken();
  if (!accessToken) return { status: 'skipped', reason: 'missing_token' };

  const { data: integration, error: integrationError } = await input.db
    .from('meta_ad_account_integrations')
    .select('meta_ad_account_id')
    .eq('account_id', input.accountId)
    .eq('provider', 'meta')
    .eq('is_active', true)
    .maybeSingle();

  if (integrationError) {
    console.error(
      '[attribution] failed to load Meta ad-account integration:',
      integrationError.message
    );
    return { status: 'skipped', reason: 'no_active_integration' };
  }
  const expectedAdAccountId = metaId(
    (integration as ActiveAdAccountIntegration | null)?.meta_ad_account_id
  );
  if (!expectedAdAccountId) {
    return { status: 'skipped', reason: 'no_active_integration' };
  }

  const fields = 'id,name,account_id,adset{id,name,campaign{id,name}}';
  const response = await (input.fetchFn ?? fetch)(
    `${META_GRAPH_BASE}/${encodeURIComponent(sourceId)}?fields=${encodeURIComponent(fields)}`,
    {
      // The token is deliberately sent in a request header, never in the URL
      // (URLs often end up in server/proxy logs).
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }
  );
  if (!response.ok) {
    console.warn(
      '[attribution] Meta Marketing lookup failed:',
      response.status
    );
    return response.status === 404
      ? { status: 'not_found' }
      : { status: 'api_error', httpStatus: response.status };
  }

  const payload = record(await response.json());
  const adId = metaId(payload?.id);
  const actualAdAccountId = metaId(payload?.account_id);
  if (!adId) return { status: 'not_found' };
  if (actualAdAccountId !== expectedAdAccountId) {
    console.warn('[attribution] rejected Meta ad from a different ad account');
    return { status: 'source_account_mismatch' };
  }

  const adset = record(payload?.adset);
  const campaign = record(adset?.campaign);
  const resolution = {
    status: 'resolved' as const,
    adAccountId: actualAdAccountId,
    campaignId: metaId(campaign?.id),
    campaignName: boundedString(campaign?.name),
    adsetId: metaId(adset?.id),
    adsetName: boundedString(adset?.name),
    adId,
    adName: boundedString(payload?.name),
  };

  const { error: updateError } = await input.db
    .from('conversation_attributions')
    .update({
      meta_ad_account_id: resolution.adAccountId,
      meta_campaign_id: resolution.campaignId,
      meta_campaign_name: resolution.campaignName,
      meta_adset_id: resolution.adsetId,
      meta_adset_name: resolution.adsetName,
      meta_ad_id: resolution.adId,
      meta_ad_name: resolution.adName,
      meta_marketing_resolved_at: new Date().toISOString(),
      meta_marketing_metadata: {
        graph_version: META_GRAPH_VERSION,
        resolution_source: 'ctwa_referral_source_id',
      },
    })
    .eq('account_id', input.accountId)
    .eq('conversation_id', input.conversationId)
    .eq('provider', 'meta');

  if (updateError) {
    // This is best-effort enrichment; the raw referral remains durable and a
    // failed reporting lookup must never make the WhatsApp webhook retry.
    console.error(
      '[attribution] failed to persist Meta Marketing resolution:',
      updateError.message
    );
  }

  return resolution;
}
