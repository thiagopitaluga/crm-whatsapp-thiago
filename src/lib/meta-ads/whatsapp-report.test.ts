import { describe, expect, it } from 'vitest';
import {
  calculateMetaReportMetrics,
  latestMetaReportPeriod,
  renderMetaWhatsAppReport,
} from './whatsapp-report';
import type { MetaInsightRow } from './dashboard';

const base = {
  meta_ad_account_id: '12345',
  campaign_id: 'campaign-form',
  campaign_name: 'Formulário',
  adset_id: 'set-1',
  adset_name: 'Conjunto',
  ad_id: '98765',
  ad_name: 'Anúncio',
  currency: 'BRL',
  link_clicks: 0,
};

describe('Meta WhatsApp report', () => {
  it('calculates the latest completed weekly and monthly periods in Sao Paulo', () => {
    expect(
      latestMetaReportPeriod('weekly', new Date('2026-11-23T11:00:00Z'))
    ).toMatchObject({
      from: '2026-11-16',
      to: '2026-11-22',
      comparisonFrom: '2026-11-09',
      comparisonTo: '2026-11-15',
    });
    expect(
      latestMetaReportPeriod('monthly', new Date('2026-12-01T11:00:00Z'))
    ).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
      comparisonFrom: '2026-10-01',
      comparisonTo: '2026-10-31',
    });
  });

  it('uses form campaign spend and combines form leads with WhatsApp conversations', () => {
    const rows: MetaInsightRow[] = [
      {
        ...base,
        report_date: '2026-11-16',
        spend: 100,
        impressions: 1000,
        clicks: 50,
        reported_leads: 5,
        actions: [
          {
            action_type: 'onsite_conversion.messaging_conversation_started_7d',
            value: '2',
          },
        ],
      },
      {
        ...base,
        ad_id: '98766',
        report_date: '2026-11-16',
        spend: 20,
        impressions: 100,
        clicks: 5,
        reported_leads: 0,
        actions: [],
      },
      {
        ...base,
        campaign_id: 'campaign-whatsapp',
        campaign_name: 'WhatsApp',
        ad_id: '98767',
        report_date: '2026-11-16',
        spend: 30,
        impressions: 400,
        clicks: 10,
        reported_leads: 0,
        actions: [
          {
            action_type: 'onsite_conversion.messaging_conversation_started_7d',
            value: '3',
          },
        ],
      },
    ];
    const { current } = calculateMetaReportMetrics(
      rows,
      '2026-11-16',
      '2026-11-22',
      '2026-11-09',
      '2026-11-15'
    );
    expect(current).toMatchObject({
      spend: 150,
      formLeads: 5,
      formLeadSpend: 120,
      formCpl: 24,
      whatsappConversations: 5,
      whatsappConversationSpend: 150,
      whatsappConversationCpl: 30,
      opportunities: 10,
      costPerOpportunity: 15,
    });
  });

  it('renders the approved compact, human report format', () => {
    const period = latestMetaReportPeriod(
      'weekly',
      new Date('2026-11-23T11:00:00Z')
    );
    const metrics = {
      spend: 307.47,
      impressions: 4917,
      clicks: 129,
      ctr: 2.62,
      formLeads: 9,
      formLeadSpend: 145.57,
      formCpl: 16.17,
      whatsappConversations: 16,
      whatsappConversationSpend: 160,
      whatsappConversationCpl: 10,
      opportunities: 25,
      costPerOpportunity: 12.3,
    };
    const report = renderMetaWhatsAppReport({
      recipientName: 'Morgana',
      frequency: 'weekly',
      period,
      current: metrics,
      previous: { ...metrics, spend: 94.02, clicks: 66 },
    });
    expect(report).toContain('Bom dia, Morgana!');
    expect(report).toContain('• Cliques: 129\n• CTR:');
    expect(report).not.toContain('semana anterior');
    expect(report).not.toContain('mês anterior');
    expect(report).toContain('• Leads de formulário: 9');
    expect(report).toContain('• Custo por lead de formulário: R$ 16,17');
    expect(report).toContain('• Custo por conversa no WhatsApp: R$ 10,00');
    expect(report).not.toContain('automaticamente');
    expect(report).toContain(
      '*📸 Instagram (orgânico)*\nInstagram não conectado.'
    );
    const enriched = renderMetaWhatsAppReport({
      recipientName: 'Morgana',
      frequency: 'weekly',
      period,
      current: metrics,
      previous: metrics,
      service: {
        received: 10,
        replied: 9,
        unanswered: 1,
        averageSeconds: 90,
        withinFiveMinutes: 2,
        withinHour: 4,
      },
      organic: {
        connected: true,
        profiles: [
          {
            name: 'perfil',
            followers: 1136,
            growth: 12,
            engagementRate: 0.7,
            interactions: 16,
            posts: 2,
            reach: 12910,
            visits: 205,
          },
        ],
      },
    });
    expect(enriched).not.toContain('Instagram não conectado');
    expect(enriched).toContain('• Seguidores no período: +12');
    expect(enriched).toContain('• Publicações no período: 2');
    expect(enriched).toContain('• Respondidas: 9 de 10 (90,00%)');
    expect(enriched).toContain('• Sem resposta até o fim do período: 1');
  });
});
