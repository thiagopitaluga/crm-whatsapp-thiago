import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { MetaGraphReadClient } from '@/lib/meta-ads/graph-client';
import { creativePreview, metaMediaUrl } from '@/lib/meta-ads/creative';

export const runtime = 'nodejs';
export const maxDuration = 60;
const idPattern = /^\d{5,32}$/;

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const params = new URL(request.url).searchParams;
    const adAccountId = params.get('ad_account_id') ?? '';
    const adId = params.get('ad_id');
    if (!idPattern.test(adAccountId) || (adId && !idPattern.test(adId))) return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
    const { data: integration, error } = await supabase.from('meta_ad_account_integrations')
      .select('id, is_active').eq('account_id', accountId).eq('provider', 'meta')
      .eq('meta_ad_account_id', adAccountId).maybeSingle();
    if (error) throw error;
    if (!integration?.is_active) return NextResponse.json({ error: 'Conta de anúncios não conectada.' }, { status: 404 });
    const admin = supabaseAdmin();
    const { data: credential, error: credentialError } = await admin.from('meta_ads_credentials')
      .select('access_token_encrypted, token_expires_at').eq('integration_id', integration.id)
      .eq('account_id', accountId).maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential || new Date(credential.token_expires_at).getTime() <= Date.now()) return NextResponse.json({ error: 'Reconecte a conta Meta para carregar os criativos.' }, { status: 401 });
    const graph = new MetaGraphReadClient({ accessToken: decrypt(credential.access_token_encrypted), version: process.env.META_ADS_GRAPH_VERSION?.trim() || 'v26.0' });
    if (adId) {
      const { data: ad, error: adError } = await supabase.from('meta_ads_entities').select('meta_entity_id')
        .eq('account_id', accountId).eq('meta_ad_account_id', adAccountId).eq('entity_type', 'ad').eq('meta_entity_id', adId).maybeSingle();
      if (adError) throw adError;
      if (!ad) return NextResponse.json({ error: 'Anúncio não encontrado nesta conta.' }, { status: 404 });
      const result = await graph.object(adId, 'creative{thumbnail_url,image_url,object_story_spec,asset_feed_spec}');
      const preview = creativePreview(result.creative);
      if (!preview.videoId) return NextResponse.json({ videoUrl: null });
      try {
        const video = await graph.object(preview.videoId, 'source');
        return NextResponse.json({ videoUrl: metaMediaUrl(video.source) }, { headers: { 'cache-control': 'no-store' } });
      } catch { return NextResponse.json({ videoUrl: null }, { headers: { 'cache-control': 'no-store' } }); }
    }
    const ads = await graph.adCreatives(adAccountId);
    const previews = Object.fromEntries(ads.filter((ad) => typeof ad.id === 'string' && idPattern.test(ad.id)).map((ad) => [ad.id as string, creativePreview(ad.creative)]));
    return NextResponse.json({ previews }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    console.error('[meta-ads creatives] Failed to load creative previews');
    return toErrorResponse(error);
  }
}
