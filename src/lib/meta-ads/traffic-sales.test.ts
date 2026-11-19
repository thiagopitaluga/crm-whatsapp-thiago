import { describe, expect, it } from 'vitest';
import { aggregateTrafficSales, type Attribution, type AdEntity, type SalesDeal } from './traffic-sales';

const base: Attribution = { contact_id: 'c1', occurred_at: '2026-11-10T12:00:00Z', provider: 'meta', ad_account_id: '123456', campaign_id: null, campaign_name: null, ad_group_id: null, ad_group_name: null, ad_id: '444444', ad_name: null, method: 'ctwa_referral' };
const entities: AdEntity[] = [
  { meta_entity_id: '444444', entity_type: 'ad', name: 'Anúncio', campaign_id: '222222', adset_id: '333333' },
  { meta_entity_id: '222222', entity_type: 'campaign', name: 'Campanha', campaign_id: null, adset_id: null },
  { meta_entity_id: '333333', entity_type: 'adset', name: 'Conjunto', campaign_id: '222222', adset_id: null },
];
const deals: SalesDeal[] = [
  { id: 'd1', contact_id: 'c1', status: 'won', value: '1000', currency: 'BRL', created_at: '2026-11-10T12:01:00Z' },
  { id: 'd2', contact_id: 'c1', status: 'won', value: '100', currency: 'USD', created_at: '2026-11-11T12:01:00Z' },
  { id: 'd3', contact_id: 'c1', status: 'won', value: '9000', currency: 'BRL', created_at: '2026-11-01T12:00:00Z' },
];

describe('relatório de vendas atribuídas', () => {
  it('deduplica contatos, exclui vendas anteriores e separa moedas', () => {
    const result = aggregateTrafficSales([base, { ...base, occurred_at: '2026-11-10T11:59:00Z' }], deals, entities, '123456', 'BRL');
    expect(result.totals).toMatchObject({ leads: 1, opportunities: 2, wonDeals: 2, wonLeads: 1, revenue: 1000, otherCurrencyDeals: 1, conversion: 100 });
    expect(result.campaigns[0]).toMatchObject({ id: '222222', name: 'Campanha', leads: 1 });
    expect(result.adsets[0].name).toBe('Conjunto');
  });
  it('não atribui uma origem a uma conta de anúncios diferente ou desconhecida', () => {
    const result = aggregateTrafficSales([{ ...base, ad_account_id: '999999' }, { ...base, contact_id: 'c2', ad_account_id: null, ad_id: '555555' }], deals, entities, '123456', 'BRL');
    expect(result.totals.leads).toBe(0);
  });
  it('aceita uma origem sem conta explícita somente quando o anúncio está na conta selecionada', () => {
    expect(aggregateTrafficSales([{ ...base, ad_account_id: null }], [], entities, '123456', 'BRL').totals.leads).toBe(1);
  });
});
