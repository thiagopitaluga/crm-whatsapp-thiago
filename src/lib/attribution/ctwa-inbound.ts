import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MetaCtwaReferral } from '@/lib/whatsapp/ctwa-referral';
import { enrichConnectedMetaAttribution } from './connected-meta';

export async function recordEvolutionCtwaAttribution(args: {
  db: SupabaseClient; accountId: string; conversationId: string; contactId: string;
  messageId: string; referral: MetaCtwaReferral; occurredAt: string;
}) {
  const { db, accountId, conversationId, contactId, messageId, referral } = args;
  const { error } = await db.from('conversation_attributions').upsert({
    account_id: accountId, conversation_id: conversationId, contact_id: contactId,
    provider: 'meta', attribution_type: 'click_to_whatsapp', first_message_id: messageId,
    source_url: referral.sourceUrl, source_type: referral.sourceType, source_id: referral.sourceId,
    ctwa_clid: referral.ctwaClid, headline: referral.headline, body: referral.body,
    media_type: referral.mediaType, image_url: referral.imageUrl, video_url: referral.videoUrl,
    thumbnail_url: referral.thumbnailUrl, referral_metadata: referral.metadata,
  }, { onConflict: 'account_id,conversation_id,provider', ignoreDuplicates: true });
  if (error) throw error;
  const { data: saved, error: savedError } = await db.from('conversation_attributions')
    .select('first_message_id, source_id').eq('account_id', accountId).eq('conversation_id', conversationId).eq('provider', 'meta').maybeSingle();
  if (savedError) throw savedError;
  if (saved?.first_message_id !== messageId) return;
  const { error: touchpointError } = await db.from('attribution_touchpoints').upsert({
    account_id: accountId, contact_id: contactId, conversation_id: conversationId,
    provider: 'meta', method: 'ctwa_referral', source_platform: 'meta', source_channel: 'click_to_whatsapp',
    ctwa_clid: referral.ctwaClid, ad_id: referral.sourceId, ad_name: referral.headline,
    landing_url: referral.sourceUrl, confidence: 'observed', occurred_at: args.occurredAt,
    raw_metadata: { ...referral.metadata, received_via: 'evolution' },
  }, { onConflict: 'account_id,conversation_id,provider,method', ignoreDuplicates: true });
  if (touchpointError) throw touchpointError;
  if (saved.source_id) await enrichConnectedMetaAttribution(db, accountId, conversationId, saved.source_id);
}
