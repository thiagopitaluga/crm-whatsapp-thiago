import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { MetaGraphReadClient } from '@/lib/meta-ads/graph-client';

const idPattern = /^\d{5,32}$/;
type Resolution = { adAccountId: string; adId: string; adName: string | null; adsetId: string | null; adsetName: string | null; campaignId: string | null; campaignName: string | null };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : null;
const metaId = (value: unknown): string | null => typeof value === 'string' && idPattern.test(value) ? value : null;

/** Resolve only inside active advertising accounts belonging to this CRM account. */
export async function enrichConnectedMetaAttribution(db: SupabaseClient, accountId: string, conversationId: string, sourceId: string): Promise<boolean> {
  if (!idPattern.test(sourceId)) return false;
  const { data: integrations, error } = await db.from('meta_ad_account_integrations').select('id, meta_ad_account_id')
    .eq('account_id', accountId).eq('provider', 'meta').eq('is_active', true);
  if (error) throw error;
  let resolved: Resolution | null = null;
  for (const integration of integrations ?? []) {
    const adAccountId = metaId(integration.meta_ad_account_id);
    if (!adAccountId) continue;
    const { data: ad, error: adError } = await db.from('meta_ads_entities').select('name, campaign_id, adset_id')
      .eq('account_id', accountId).eq('meta_ad_account_id', adAccountId).eq('entity_type', 'ad').eq('meta_entity_id', sourceId).maybeSingle();
    if (adError) throw adError;
    if (ad) {
      const adsetId = metaId(ad.adset_id), campaignId = metaId(ad.campaign_id);
      const parentIds = [adsetId, campaignId].filter((id): id is string => !!id);
      const { data: parents, error: parentError } = parentIds.length ? await db.from('meta_ads_entities').select('meta_entity_id, entity_type, name')
        .eq('account_id', accountId).eq('meta_ad_account_id', adAccountId).in('meta_entity_id', parentIds) : { data: [], error: null };
      if (parentError) throw parentError;
      resolved = { adAccountId, adId: sourceId, adName: text(ad.name), adsetId, campaignId,
        adsetName: text(parents?.find((item) => item.entity_type === 'adset' && item.meta_entity_id === adsetId)?.name),
        campaignName: text(parents?.find((item) => item.entity_type === 'campaign' && item.meta_entity_id === campaignId)?.name) };
      break;
    }
    const { data: credential, error: credentialError } = await db.from('meta_ads_credentials').select('access_token_encrypted, token_expires_at')
      .eq('account_id', accountId).eq('integration_id', integration.id).maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential || new Date(credential.token_expires_at).getTime() <= Date.now()) continue;
    try {
      const graph = new MetaGraphReadClient({ accessToken: decrypt(credential.access_token_encrypted), version: process.env.META_ADS_GRAPH_VERSION?.trim() || 'v26.0' });
      const result = await graph.object(sourceId, 'id,name,account_id,adset{id,name,campaign{id,name}}');
      if (metaId(result.id) !== sourceId || metaId(result.account_id) !== adAccountId) continue;
      const adset = record(result.adset), campaign = record(adset.campaign);
      resolved = { adAccountId, adId: sourceId, adName: text(result.name), adsetId: metaId(adset.id), adsetName: text(adset.name), campaignId: metaId(campaign.id), campaignName: text(campaign.name) };
      break;
    } catch { /* Try the next connected advertising account. */ }
  }
  if (!resolved) return false;
  const r = resolved;
  const { error: updateError } = await db.from('conversation_attributions').update({
    meta_ad_account_id: r.adAccountId, meta_campaign_id: r.campaignId, meta_campaign_name: r.campaignName,
    meta_adset_id: r.adsetId, meta_adset_name: r.adsetName, meta_ad_id: r.adId, meta_ad_name: r.adName,
    meta_marketing_resolved_at: new Date().toISOString(), meta_marketing_metadata: { resolution_source: 'connected_meta_ads' },
  }).eq('account_id', accountId).eq('conversation_id', conversationId).eq('provider', 'meta').eq('source_id', sourceId);
  if (updateError) throw updateError;
  const { error: touchpointError } = await db.from('attribution_touchpoints').update({ ad_account_id: r.adAccountId,
    campaign_id: r.campaignId, campaign_name: r.campaignName, ad_group_id: r.adsetId, ad_group_name: r.adsetName,
    ad_id: r.adId, ad_name: r.adName, confidence: 'matched',
  }).eq('account_id', accountId).eq('conversation_id', conversationId).eq('provider', 'meta').eq('method', 'ctwa_referral').eq('ad_id', sourceId);
  if (touchpointError) throw touchpointError;
  return true;
}
