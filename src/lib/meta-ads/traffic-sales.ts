export type Attribution = { contact_id: string; occurred_at: string; provider: string; ad_account_id: string | null; campaign_id: string | null; campaign_name: string | null; ad_group_id: string | null; ad_group_name: string | null; ad_id: string | null; ad_name: string | null; method: string };
export type SalesDeal = { id: string; contact_id: string; status: string; value: number | string | null; currency: string | null; created_at: string };
export type AdEntity = { meta_entity_id: string; entity_type: string; name: string; campaign_id: string | null; adset_id: string | null };
export type SalesGroup = { id: string; name: string; leads: number; opportunities: number; wonDeals: number; wonLeads: number; openDeals: number; lostDeals: number; revenue: number; otherCurrencyDeals: number; conversion: number | null };

/** Last recorded Meta attribution in the selected cohort, at most one per contact. */
export function aggregateTrafficSales(touches: Attribution[], deals: SalesDeal[], entities: AdEntity[], adAccountId: string, currency: string | null) {
  const ads = new Map(entities.filter((e) => e.entity_type === 'ad').map((e) => [e.meta_entity_id, e]));
  const names = new Map(entities.map((e) => [`${e.entity_type}:${e.meta_entity_id}`, e.name]));
  const latest = new Map<string, Attribution>();
  for (const touch of touches) {
    if (touch.provider !== 'meta' || !touch.contact_id || !touch.occurred_at) continue;
    if (touch.ad_account_id && touch.ad_account_id !== adAccountId) continue;
    if (!touch.ad_account_id && (!touch.ad_id || !ads.has(touch.ad_id))) continue;
    const old = latest.get(touch.contact_id);
    if (!old || touch.occurred_at > old.occurred_at) latest.set(touch.contact_id, touch);
  }
  const groups = { campaigns: new Map<string, SalesGroup>(), adsets: new Map<string, SalesGroup>(), ads: new Map<string, SalesGroup>() };
  const totals: SalesGroup = { id: 'total', name: 'Total', leads: 0, opportunities: 0, wonDeals: 0, wonLeads: 0, openDeals: 0, lostDeals: 0, revenue: 0, otherCurrencyDeals: 0, conversion: null };
  const dealsByContact = new Map<string, SalesDeal[]>();
  for (const deal of deals) {
    if (!latest.has(deal.contact_id)) continue;
    const list = dealsByContact.get(deal.contact_id) ?? [];
    list.push(deal); dealsByContact.set(deal.contact_id, list);
  }
  for (const touch of latest.values()) {
    const entity = touch.ad_id ? ads.get(touch.ad_id) : undefined;
    const campaignId = touch.campaign_id || entity?.campaign_id || null;
    const adsetId = touch.ad_group_id || entity?.adset_id || null;
    const dimensions: [keyof typeof groups, string | null, string | null][] = [
      ['campaigns', campaignId, touch.campaign_name || (campaignId && names.get(`campaign:${campaignId}`)) || null],
      ['adsets', adsetId, touch.ad_group_name || (adsetId && names.get(`adset:${adsetId}`)) || null],
      ['ads', touch.ad_id, touch.ad_name || entity?.name || null],
    ];
    const linkedDeals = (dealsByContact.get(touch.contact_id) ?? []).filter((deal) => Date.parse(deal.created_at) >= Date.parse(touch.occurred_at) - 300_000);
    const update = (group: SalesGroup) => {
      group.leads++;
      group.opportunities += linkedDeals.length;
      if (linkedDeals.some((deal) => deal.status === 'won')) group.wonLeads++;
      for (const deal of linkedDeals) {
        if (deal.status === 'open') group.openDeals++;
        if (deal.status === 'lost') group.lostDeals++;
        if (deal.status === 'won') {
          group.wonDeals++;
          const value = Number(deal.value ?? 0);
          if (deal.currency && currency && deal.currency === currency && Number.isFinite(value) && value >= 0) group.revenue += value;
          else if (Number.isFinite(value) && value > 0) group.otherCurrencyDeals++;
        }
      }
    };
    update(totals);
    for (const [level, id, name] of dimensions) {
      const key = id ?? '__unidentified__';
      if (!groups[level].has(key)) groups[level].set(key, { id: key, name: name || (id ? `ID ${id}` : 'Não identificado'), leads: 0, opportunities: 0, wonDeals: 0, wonLeads: 0, openDeals: 0, lostDeals: 0, revenue: 0, otherCurrencyDeals: 0, conversion: null });
      update(groups[level].get(key)!);
    }
  }
  const finish = (g: SalesGroup) => ({ ...g, conversion: g.leads ? 100 * g.wonLeads / g.leads : null });
  const rank = (m: Map<string, SalesGroup>) => [...m.values()].map(finish).sort((a,b) => b.leads - a.leads || a.name.localeCompare(b.name));
  return { totals: finish(totals), campaigns: rank(groups.campaigns), adsets: rank(groups.adsets), ads: rank(groups.ads) };
}
