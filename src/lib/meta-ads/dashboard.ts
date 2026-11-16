export interface MetaInsightRow {
  report_date: string;
  meta_ad_account_id: string;
  campaign_id: string | null;
  campaign_name: string;
  adset_id: string | null;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  currency: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  link_clicks: number | string;
  reported_leads: number | string;
  actions?: unknown;
}

export interface MetaMetricGroup {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  reportedLeads: number;
  cpl: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  linkCtr: number | null;
  costPerLinkClick: number | null;
  leadConversionRate: number | null;
  actions: Record<string, number>;
}

type Level = 'campaign' | 'adset' | 'ad';

function amount(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function calculated(
  group: Omit<MetaMetricGroup, 'cpl' | 'ctr' | 'cpc' | 'cpm' | 'linkCtr' | 'costPerLinkClick' | 'leadConversionRate'>
): MetaMetricGroup {
  return {
    ...group,
    cpl: group.reportedLeads > 0 ? group.spend / group.reportedLeads : null,
    ctr:
      group.impressions > 0 ? (group.clicks / group.impressions) * 100 : null,
    cpc: group.clicks > 0 ? group.spend / group.clicks : null,
    cpm: group.impressions > 0 ? group.spend * 1000 / group.impressions : null,
    linkCtr: group.impressions > 0 ? group.linkClicks * 100 / group.impressions : null,
    costPerLinkClick: group.linkClicks > 0 ? group.spend / group.linkClicks : null,
    leadConversionRate: group.linkClicks > 0 ? group.reportedLeads * 100 / group.linkClicks : null,
  };
}

export function aggregateMetaInsights(rows: MetaInsightRow[]) {
  const totals = {
    id: 'total',
    name: 'Total',
    spend: 0,
    impressions: 0,
    clicks: 0,
    linkClicks: 0,
    reportedLeads: 0,
    actions: {} as Record<string, number>,
  };
  const byDay = new Map<string, typeof totals>();
  const byLevel: Record<Level, Map<string, typeof totals>> = {
    campaign: new Map(),
    adset: new Map(),
    ad: new Map(),
  };
  for (const row of rows) {
    const metrics = {
      spend: amount(row.spend),
      impressions: amount(row.impressions),
      clicks: amount(row.clicks),
      linkClicks: amount(row.link_clicks),
      reportedLeads: amount(row.reported_leads),
    };
    const add = (item: typeof totals) => {
      item.spend += metrics.spend;
      item.impressions += metrics.impressions;
      item.clicks += metrics.clicks;
      item.linkClicks += metrics.linkClicks;
      item.reportedLeads += metrics.reportedLeads;
      if (Array.isArray(row.actions)) for (const value of row.actions) {
        if (!value || typeof value !== 'object') continue;
        const action = value as Record<string, unknown>;
        const actionValue = Number(action.value);
        if (typeof action.action_type !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(action.action_type) || !Number.isFinite(actionValue) || actionValue < 0) continue;
        item.actions[action.action_type] = (item.actions[action.action_type] ?? 0) + actionValue;
      }
    };
    add(totals);
    if (!byDay.has(row.report_date))
      byDay.set(row.report_date, {
        ...totals,
        id: row.report_date,
        name: row.report_date,
        spend: 0,
        impressions: 0,
        clicks: 0,
        linkClicks: 0,
        reportedLeads: 0,
        actions: {},
      });
    add(byDay.get(row.report_date)!);
    const dimensions: Array<[Level, string | null, string]> = [
      ['campaign', row.campaign_id, row.campaign_name],
      ['adset', row.adset_id, row.adset_name],
      ['ad', row.ad_id, row.ad_name],
    ];
    for (const [level, entityId, name] of dimensions) {
      if (!entityId) continue;
      const key = `${row.meta_ad_account_id}:${entityId}`;
      if (!byLevel[level].has(key))
        byLevel[level].set(key, {
          id: entityId,
          name: name || `ID ${entityId}`,
          spend: 0,
          impressions: 0,
          clicks: 0,
          linkClicks: 0,
          reportedLeads: 0,
          actions: {},
        });
      add(byLevel[level].get(key)!);
    }
  }
  const ranked = (items: Map<string, typeof totals>) =>
    [...items.values()].map(calculated).sort((a, b) => b.spend - a.spend);
  return {
    totals: calculated(totals),
    daily: [...byDay.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(calculated),
    campaigns: ranked(byLevel.campaign),
    adsets: ranked(byLevel.adset),
    ads: ranked(byLevel.ad),
  };
}

export function parseMetaDateRange(input: URLSearchParams, today = new Date()) {
  const day = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(today);
  const days = Number(input.get('days') ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) return null;
  const from = new Date(`${day}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - days + 1);
  return { from: from.toISOString().slice(0, 10), to: day, days };
}

export function textField(fields: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

