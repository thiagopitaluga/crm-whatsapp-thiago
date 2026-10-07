import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  aggregateMetaInsights,
  parseMetaDateRange,
  textField,
  type MetaInsightRow,
} from '@/lib/meta-ads/dashboard';

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const range = parseMetaDateRange(searchParams);
    if (!range)
      return NextResponse.json(
        { error: 'Escolha um período entre 1 e 90 dias.' },
        { status: 400 }
      );
    const { supabase, accountId } = await requireRole('viewer');
    const { data: connections, error: connectionError } = await supabase
      .from('meta_ad_account_integrations')
      .select(
        'meta_ad_account_id, meta_page_ids, is_active, ads_read_granted, leads_retrieval_granted, ads_last_synced_at, leads_last_synced_at, sync_error'
      )
      .eq('account_id', accountId)
      .eq('provider', 'meta')
      .order('created_at');
    if (connectionError) throw connectionError;

    const requestedAccount = searchParams.get('ad_account_id');
    const selected = requestedAccount
      ? connections?.find(
          (item) => item.meta_ad_account_id === requestedAccount
        )
      : (connections?.find((item) => item.is_active) ?? connections?.[0]);
    if (requestedAccount && !selected)
      return NextResponse.json(
        { error: 'Conta de anúncios não encontrada neste CRM.' },
        { status: 404 }
      );

    const insights: MetaInsightRow[] = [];
    if (selected) {
      // Bounded report; reject instead of silently truncating a large result.
      for (let offset = 0; offset <= 50_000; offset += 1_000) {
        const { data, error } = await supabase
          .from('meta_ads_daily_insights')
          .select(
            'report_date, meta_ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, currency, spend, impressions, clicks, link_clicks, reported_leads'
          )
          .eq('account_id', accountId)
          .eq('meta_ad_account_id', selected.meta_ad_account_id)
          .gte('report_date', range.from)
          .lte('report_date', range.to)
          .order('report_date')
          .order('ad_id')
          .range(offset, offset + 999);
        if (error) throw error;
        insights.push(...((data ?? []) as MetaInsightRow[]));
        if (!data || data.length < 1_000) break;
        if (offset === 50_000)
          return NextResponse.json(
            { error: 'Relatório muito grande. Escolha um período menor.' },
            { status: 422 }
          );
      }
    }

    const {
      data: submissions,
      error: leadsError,
      count: leadCount,
    } = await supabase
      .from('lead_form_submissions')
      .select(
        'id, contact_id, source_type, source_external_id, submitted_at, fields',
        { count: 'exact' }
      )
      .eq('account_id', accountId)
      .in('source_type', ['google_sheets', 'meta_api'])
      .gte('submitted_at', `${range.from}T00:00:00.000Z`)
      .lte('submitted_at', `${range.to}T23:59:59.999Z`)
      .order('submitted_at', { ascending: false })
      .limit(100);
    if (leadsError) throw leadsError;
    const failedQuery = supabase
      .from('meta_lead_receipts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'failed');
    if (selected)
      failedQuery.eq('meta_ad_account_id', selected.meta_ad_account_id);
    const { count: failedMetaLeads, error: failedError } = await failedQuery;
    if (failedError) throw failedError;
    const recentLeads = (submissions ?? []).map((row) => {
      const fields =
        row.fields &&
        typeof row.fields === 'object' &&
        !Array.isArray(row.fields)
          ? (row.fields as Record<string, unknown>)
          : {};
      return {
        id: row.id,
        contactId: row.contact_id,
        source: row.source_type,
        submittedAt: row.submitted_at,
        name:
          textField(fields, 'nome_completo', 'full_name', 'name') ??
          'Contato sem nome',
        campaignId: textField(fields, 'campaign_id'),
        campaignName: textField(fields, 'campaign_name'),
        adsetId: textField(fields, 'adset_id'),
        adsetName: textField(fields, 'adset_name'),
        adId: textField(fields, 'ad_id'),
        adName: textField(fields, 'ad_name'),
        formId: textField(fields, 'form_id'),
        formName: textField(fields, 'form_name'),
      };
    });

    const currencies = [...new Set(insights.map((row) => row.currency))];
    return NextResponse.json(
      {
        range,
        connections: connections ?? [],
        selectedAdAccountId: selected?.meta_ad_account_id ?? null,
        currency: currencies.length === 1 ? currencies[0] : null,
        mixedCurrencies: currencies.length > 1,
        hasAdsData: insights.length > 0,
        ads: aggregateMetaInsights(insights),
        crmFormLeads: { count: leadCount ?? 0, recent: recentLeads },
        failedMetaLeads: failedMetaLeads ?? 0,
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

