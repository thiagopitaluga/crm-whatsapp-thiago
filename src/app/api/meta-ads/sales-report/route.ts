import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseMetaDateRange } from '@/lib/meta-ads/dashboard';
import { aggregateTrafficSales, type Attribution, type AdEntity, type SalesDeal } from '@/lib/meta-ads/traffic-sales';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const range = parseMetaDateRange(params);
    const adAccountId = params.get('ad_account_id') ?? '';
    const source = params.get('source');
    if (!range || !/^\d{5,32}$/.test(adAccountId)) return NextResponse.json({ error: 'Conta ou período inválido.' }, { status: 400 });
    const { supabase, accountId } = await requireRole('viewer');
    const { data: integration, error: integrationError } = await supabase.from('meta_ad_account_integrations').select('id').eq('account_id', accountId).eq('provider', 'meta').eq('meta_ad_account_id', adAccountId).maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration) return NextResponse.json({ error: 'Conta de anúncios não encontrada.' }, { status: 404 });
    const start = `${range.from}T03:00:00.000Z`;
    const endDate = new Date(`${range.to}T03:00:00.000Z`); endDate.setUTCDate(endDate.getUTCDate() + 1);
    const end = endDate.toISOString();
    const touches: Attribution[] = [], entities: AdEntity[] = [], deals: SalesDeal[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('attribution_touchpoints').select('contact_id,occurred_at,provider,ad_account_id,campaign_id,campaign_name,ad_group_id,ad_group_name,ad_id,ad_name,method').eq('account_id', accountId).eq('provider', 'meta').gte('occurred_at', start).lt('occurred_at', end).order('id').range(offset, offset + 999);
      if (error) throw error; touches.push(...(data ?? []) as Attribution[]);
      if (!data || data.length < 1000) break;
      if (offset >= 50000) return NextResponse.json({ error: 'Muitos registros. Escolha um período menor.' }, { status: 422 });
    }
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('meta_lead_receipts').select('contact_id,submitted_at,ad_id,meta_ad_account_id').eq('account_id', accountId).eq('meta_ad_account_id', adAccountId).eq('status', 'imported').gte('submitted_at', start).lt('submitted_at', end).order('id').range(offset, offset + 999);
      if (error) throw error;
      for (const row of data ?? []) if (row.contact_id && row.submitted_at) touches.push({ contact_id: row.contact_id, occurred_at: row.submitted_at, provider: 'meta', ad_account_id: adAccountId, ad_id: row.ad_id, campaign_id: null, campaign_name: null, ad_group_id: null, ad_group_name: null, ad_name: null, method: 'lead_form' });
      if (!data || data.length < 1000) break;
      if (offset >= 50000) return NextResponse.json({ error: 'Muitos registros. Escolha um período menor.' }, { status: 422 });
    }
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('meta_ads_entities').select('meta_entity_id,entity_type,name,campaign_id,adset_id').eq('account_id', accountId).eq('meta_ad_account_id', adAccountId).order('id').range(offset, offset + 999);
      if (error) throw error; entities.push(...(data ?? []) as AdEntity[]);
      if (!data || data.length < 1000) break;
      if (offset >= 50000) return NextResponse.json({ error: 'Há anúncios demais para o relatório.' }, { status: 422 });
    }
    const contactIds = [...new Set(touches.map((touch) => touch.contact_id).filter(Boolean))];
    for (let index = 0; index < contactIds.length; index += 100) {
      const batch = contactIds.slice(index, index + 100);
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from('deals').select('id,contact_id,status,value,currency,created_at').eq('account_id', accountId).in('contact_id', batch).order('id').range(offset, offset + 999);
        if (error) throw error; deals.push(...(data ?? []) as SalesDeal[]);
        if (!data || data.length < 1000) break;
        if (offset >= 50000) return NextResponse.json({ error: 'Há negociações demais para o relatório.' }, { status: 422 });
      }
    }
    const { data: account, error: accountError } = await supabase.from('accounts').select('default_currency').eq('id', accountId).maybeSingle();
    if (accountError) throw accountError;
    const currency = account?.default_currency ?? null;
    const recognizedAds = new Set(entities.filter((e) => e.entity_type === 'ad').map((e) => e.meta_entity_id));
    const unidentified = new Set(touches.filter((t) => !t.ad_account_id && (!t.ad_id || !recognizedAds.has(t.ad_id))).map((t) => t.contact_id)).size;
    const selectedTouches = source === 'lead_form' || source === 'ctwa_referral' || source === 'tracking_link'
      ? touches.filter((touch) => touch.method === source)
      : touches;
    return NextResponse.json({ range, currency, unidentified, report: aggregateTrafficSales(selectedTouches, deals, entities, adAccountId, currency) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return toErrorResponse(error); }
}
