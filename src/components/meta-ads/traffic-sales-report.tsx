'use client';

import { useEffect, useState } from 'react';
import type { MetaMetricGroup } from '@/lib/meta-ads/dashboard';
import type { SalesGroup } from '@/lib/meta-ads/traffic-sales';

type Level = 'campaigns' | 'adsets' | 'ads';
type SalesResponse = { currency: string | null; unidentified: number; report: { totals: SalesGroup; campaigns: SalesGroup[]; adsets: SalesGroup[]; ads: SalesGroup[] } };
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const money = (value: number, currency: string | null) => currency ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value) : nf.format(value);

export function TrafficSalesReport({ accountId, days, adsCurrency, ads, refresh }: { accountId: string | null; days: number; adsCurrency: string | null; ads: { campaigns: MetaMetricGroup[]; adsets: MetaMetricGroup[]; ads: MetaMetricGroup[] }; refresh: number }) {
  const [level, setLevel] = useState<Level>('campaigns');
  const [data, setData] = useState<SalesResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setData(null); setError('');
    if (!accountId) return;
    const controller = new AbortController(); setLoading(true);
    const query = new URLSearchParams({ ad_account_id: accountId, days: String(days) });
    fetch(`/api/meta-ads/sales-report?${query}`, { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar o relatório.'); return body as SalesResponse;
    }).then(setData).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o relatório.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId, days, refresh]);
  const totals = data?.report.totals;
  const comparable = !!data?.currency && data.currency === adsCurrency;
  return <section className="space-y-4" aria-label="Vendas por origem de anúncio">
    <div><h2 className="text-lg font-semibold">Vendas por origem de anúncio</h2><p className="mt-1 text-sm text-muted-foreground">Leads com origem Meta identificada no período; negociações criadas após a origem e situação atual no CRM.</p></div>
    {!accountId ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">Conecte uma conta Meta para visualizar o relatório.</p> : loading ? <p role="status" className="text-sm text-muted-foreground">Carregando relatório de vendas…</p> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : data && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Leads atribuídos', nf.format(totals?.leads ?? 0)], ['Negociações', nf.format(totals?.opportunities ?? 0)], ['Vendas ganhas', nf.format(totals?.wonDeals ?? 0)], ['Valor ganho', money(totals?.revenue ?? 0, data.currency)],
      ].map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Última origem identificada para esta conta de anúncios no período. Um contato entra uma vez no relatório.</p><div className="inline-flex rounded-lg border p-1" role="group" aria-label="Detalhamento de vendas">{([['campaigns','Campanhas'], ['adsets','Conjuntos'], ['ads','Anúncios']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setLevel(key)} aria-pressed={level === key} className={`rounded-md px-3 py-1.5 text-sm ${level === key ? 'bg-amber-500 text-black' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>)}</div></div>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[950px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{['Origem','Investimento no período','Leads','Negociações','Em aberto','Perdidas','Vendas ganhas','Leads que compraram','Conversão','Valor ganho'].map((label, index) => <th key={label} className={`px-4 py-3 font-medium ${index ? 'text-right' : ''}`}>{label}</th>)}</tr></thead><tbody>{data.report[level].map((row) => { const insight = ads[level].find((item) => item.id === row.id); return <tr key={row.id} className="border-t"><td className="max-w-72 truncate px-4 py-3 font-medium" title={row.name}>{row.name}</td><td className="whitespace-nowrap px-4 py-3 text-right">{insight ? money(insight.spend, adsCurrency) : '—'}</td><td className="px-4 py-3 text-right">{nf.format(row.leads)}</td><td className="px-4 py-3 text-right">{nf.format(row.opportunities)}</td><td className="px-4 py-3 text-right">{nf.format(row.openDeals)}</td><td className="px-4 py-3 text-right">{nf.format(row.lostDeals)}</td><td className="px-4 py-3 text-right">{nf.format(row.wonDeals)}</td><td className="px-4 py-3 text-right">{nf.format(row.wonLeads)}</td><td className="px-4 py-3 text-right">{row.conversion === null ? '—' : `${nf.format(row.conversion)}%`}</td><td className="whitespace-nowrap px-4 py-3 text-right">{money(row.revenue, data.currency)}</td></tr>; })}</tbody></table>{!data.report[level].length && <p className="p-6 text-center text-sm text-muted-foreground">Nenhum lead com origem vinculada a esta conta de anúncios no período.</p>}</div>
      <p className="text-xs text-muted-foreground">Conversão = contatos com ao menos uma venda ganha ÷ contatos atribuídos. O investimento é o total da Meta no período, enquanto o valor considera negociações ganhas atualmente; períodos de ganho e de investimento podem ser diferentes.</p>
      {data.unidentified > 0 && <p className="text-xs text-muted-foreground">{nf.format(data.unidentified)} contato(s) com origem Meta ainda não puderam ser vinculados com segurança a esta conta de anúncios e não entram nos totais.</p>}
      {totals && totals.otherCurrencyDeals > 0 && <p className="text-xs text-muted-foreground">{nf.format(totals.otherCurrencyDeals)} venda(s) em outra moeda ou sem moeda foram excluídas do valor ganho.</p>}
      {!comparable && adsCurrency && data.currency && <p className="text-xs text-muted-foreground">Os anúncios e as vendas usam moedas diferentes. Os valores são exibidos nas respectivas moedas.</p>}
    </>}
  </section>;
}
