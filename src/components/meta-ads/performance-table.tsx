'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ImageOff, Play, SlidersHorizontal } from 'lucide-react';
import type { MetaMetricGroup } from '@/lib/meta-ads/dashboard';
import type { CreativePreview } from '@/lib/meta-ads/creative';

type MetricKey = 'spend' | 'impressions' | 'clicks' | 'linkClicks' | 'reportedLeads' | 'cpl' | 'ctr' | 'cpc' | 'cpm' | 'linkCtr' | 'costPerLinkClick' | 'leadConversionRate';
type Column = { key: string; label: string; format: 'money' | 'number' | 'percent' };
const METRICS: Column[] = [
  { key: 'spend', label: 'Investimento', format: 'money' },
  { key: 'impressions', label: 'Impressões', format: 'number' },
  { key: 'clicks', label: 'Cliques (todos)', format: 'number' },
  { key: 'linkClicks', label: 'Cliques no link', format: 'number' },
  { key: 'reportedLeads', label: 'Leads Meta', format: 'number' },
  { key: 'cpl', label: 'Custo/lead', format: 'money' },
  { key: 'ctr', label: 'CTR (todos)', format: 'percent' },
  { key: 'linkCtr', label: 'CTR do link', format: 'percent' },
  { key: 'cpc', label: 'CPC (todos)', format: 'money' },
  { key: 'costPerLinkClick', label: 'CPC do link', format: 'money' },
  { key: 'cpm', label: 'CPM', format: 'money' },
  { key: 'leadConversionRate', label: 'Leads / clique no link', format: 'percent' },
];
const DEFAULT_COLUMNS = ['creative', 'spend', 'impressions', 'clicks', 'reportedLeads', 'cpl'];
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function valueFor(row: MetaMetricGroup, key: string): string | number | null {
  if (key === 'name') return row.name;
  if (key.startsWith('action:')) return row.actions?.[key.slice(7)] ?? 0;
  const value = row[key as MetricKey];
  return typeof value === 'number' ? value : null;
}

export function PerformanceTable({ rows, currency, hasData, previews, showCreatives, onPreview, accountId }: {
  rows: MetaMetricGroup[]; currency: string | null; hasData: boolean;
  previews: Record<string, CreativePreview>; showCreatives: boolean; accountId: string | null;
  onPreview: (item: MetaMetricGroup, preview: CreativePreview) => void;
}) {
  const [visible, setVisible] = useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'spend', direction: 'desc' });
  const [loadedKey, setLoadedKey] = useState('');
  const storageKey = `organizap:meta-columns:${accountId ?? 'default'}`;
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      setVisible(Array.isArray(stored) && stored.every((key) => typeof key === 'string') ? stored : DEFAULT_COLUMNS);
    } catch { setVisible(DEFAULT_COLUMNS); }
    setLoadedKey(storageKey);
  }, [storageKey]);
  useEffect(() => { if (loadedKey === storageKey) try { localStorage.setItem(storageKey, JSON.stringify(visible)); } catch { /* Storage may be unavailable. */ } }, [visible, loadedKey, storageKey]);
  const columns = useMemo(() => {
    const actions = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row.actions ?? {})) actions.add(key);
    return [...METRICS, ...[...actions].sort().map((key): Column => ({ key: `action:${key}`, label: `Ação Meta: ${key}`, format: 'number' }))];
  }, [rows]);
  const activeColumns = columns.filter((column) => visible.includes(column.key));
  const sorted = [...rows].sort((a, b) => {
    const av = valueFor(a, sort.key), bv = valueFor(b, sort.key);
    if (av === null) return bv === null ? a.name.localeCompare(b.name, 'pt-BR') : 1;
    if (bv === null) return -1;
    const order = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv, 'pt-BR') : Number(av) - Number(bv);
    return (sort.direction === 'asc' ? order : -order) || a.name.localeCompare(b.name, 'pt-BR');
  });
  const toggleSort = (key: string) => setSort((current) => ({ key, direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc' }));
  const heading = (key: string, label: string, right = true) => <th key={key} scope="col" aria-sort={sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-4 py-3 font-medium ${right ? 'text-right' : 'text-left'}`}><button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground">{label}{sort.key === key ? (sort.direction === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ArrowUpDown className="size-3.5 opacity-40" />}<span className="sr-only">Ordenar por {label}</span></button></th>;
  const toggle = (key: string, checked: boolean) => setVisible((old) => checked ? [...old.filter((item) => item !== key), key] : old.filter((item) => item !== key));
  if (!hasData) return <div className="border-border text-muted-foreground rounded-xl border border-dashed px-5 py-12 text-center text-sm">Os dados de anúncios aparecerão após conectar a API oficial e fazer a primeira sincronização.</div>;
  if (!rows.length) return <div className="border-border text-muted-foreground rounded-xl border border-dashed px-5 py-12 text-center text-sm">Nenhum item com desempenho neste período.</div>;
  return <div className="space-y-3">
    <div className="flex justify-end"><details className="relative"><summary className="border-border hover:bg-muted inline-flex cursor-pointer list-none items-center gap-2 rounded-lg border px-3 py-2 text-sm"><SlidersHorizontal className="size-4" /> Personalizar colunas</summary><div className="absolute right-0 z-20 mt-2 max-h-80 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border bg-popover p-3 shadow-lg"><p className="mb-2 text-xs text-muted-foreground">Selecione as métricas para exibir. O nome está sempre visível.</p>{showCreatives && <label className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"><input type="checkbox" checked={visible.includes('creative')} onChange={(e) => toggle('creative', e.target.checked)} /> Criativo</label>}{columns.map((column) => <label key={column.key} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"><input type="checkbox" checked={visible.includes(column.key)} onChange={(e) => toggle(column.key, e.target.checked)} /> {column.label}</label>)}<button type="button" className="mt-2 px-2 text-xs text-primary hover:underline" onClick={() => setVisible(DEFAULT_COLUMNS)}>Restaurar padrão</button></div></details></div>
    <div className="border-border overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/50 text-muted-foreground text-xs"><tr>{showCreatives && visible.includes('creative') && <th scope="col" className="px-4 py-3 font-medium">Criativo</th>}{heading('name', 'Nome', false)}{activeColumns.map((column) => heading(column.key, column.label))}</tr></thead><tbody>{sorted.map((item) => <tr key={item.id} className="border-border hover:bg-muted/30 border-t">
      {showCreatives && visible.includes('creative') && <td className="px-4 py-2">{previews[item.id]?.imageUrl || previews[item.id]?.isVideo ? <button type="button" onClick={() => onPreview(item, previews[item.id])} className="relative block size-14 overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Ver criativo de ${item.name}`}>{previews[item.id].imageUrl && <img src={previews[item.id].imageUrl!} alt="" className="h-full w-full object-cover" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />}{previews[item.id].isVideo && <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white"><Play className="size-5 fill-current" /></span>}</button> : <span className="flex size-14 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground" title="Prévia indisponível"><ImageOff className="size-5" /></span>}</td>}
      <td className="max-w-[300px] min-w-[180px] truncate px-4 py-3 font-medium" title={item.name}>{item.name}</td>{activeColumns.map((column) => { const value = valueFor(item, column.key); return <td key={column.key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{typeof value !== 'number' ? '—' : column.format === 'money' && currency ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value) : column.format === 'percent' ? `${nf.format(value)}%` : nf.format(value)}</td>; })}</tr>)}</tbody></table></div>
  </div>;
}
