import { describe, expect, it } from 'vitest';
import { aggregateMetaInsights, parseMetaDateRange } from './dashboard';

describe('Meta Ads dashboard aggregation', () => {
  it('separates daily and campaign metrics without inventing leads', () => {
    const result = aggregateMetaInsights([
      {
        report_date: '2026-10-06',
        meta_ad_account_id: '12345',
        campaign_id: '10',
        campaign_name: 'Campanha A',
        adset_id: '20',
        adset_name: 'Conjunto',
        ad_id: '30',
        ad_name: 'Anúncio',
        currency: 'BRL',
        spend: '12.50',
        impressions: '1000',
        clicks: '40',
        link_clicks: '25',
        reported_leads: '2',
        actions: [{ action_type: 'landing_page_view', value: '4' }],
      },
      {
        report_date: '2026-10-07',
        meta_ad_account_id: '12345',
        campaign_id: '10',
        campaign_name: 'Campanha A',
        adset_id: '20',
        adset_name: 'Conjunto',
        ad_id: '30',
        ad_name: 'Anúncio',
        currency: 'BRL',
        spend: '7.50',
        impressions: '500',
        clicks: '10',
        link_clicks: '8',
        reported_leads: '0',
        actions: [{ action_type: 'landing_page_view', value: '3' }],
      },
    ]);
    expect(result.totals).toMatchObject({
      spend: 20,
      impressions: 1500,
      clicks: 50,
      reportedLeads: 2,
      cpl: 10,
      cpc: 0.4,
      costPerLinkClick: 20 / 33,
      cpm: 20 * 1000 / 1500,
      ctr: 50 * 100 / 1500,
      linkCtr: 33 * 100 / 1500,
      leadConversionRate: 2 * 100 / 33,
      actions: { landing_page_view: 7 },
    });
    expect(result.campaigns).toHaveLength(1);
    expect(result.daily.map((day) => day.spend)).toEqual([12.5, 7.5]);
    expect(result.daily.map((day) => day.actions.landing_page_view)).toEqual([4, 3]);
  });

  it('does not report a zero CPL when there are no Meta-reported leads', () => {
    expect(aggregateMetaInsights([]).totals.cpl).toBeNull();
    expect(aggregateMetaInsights([]).totals.cpc).toBeNull();
    expect(aggregateMetaInsights([]).totals.cpm).toBeNull();
  });
});

describe('Meta Ads date range', () => {
  it('bounds the report to at most 90 days', () => {
    expect(
      parseMetaDateRange(
        new URLSearchParams('days=7'),
        new Date('2026-10-07T12:00:00Z')
      )
    ).toEqual({ from: '2026-10-01', to: '2026-10-07', days: 7 });
    expect(parseMetaDateRange(new URLSearchParams('days=365'))).toBeNull();
    expect(
      parseMetaDateRange(
        new URLSearchParams('days=1'),
        new Date('2026-10-08T01:00:00Z')
      )
    ).toEqual({ from: '2026-10-07', to: '2026-10-07', days: 1 });
  });
});

