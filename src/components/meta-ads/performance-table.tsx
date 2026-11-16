'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ImageOff, Play, SlidersHorizontal } from 'lucide-react';
import type { MetaMetricGroup } from '@/lib/meta-ads/dashboard';
import type { CreativePreview } from '@/lib/meta-ads/creative';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type MetricKey = 'spend' | 'impressions' | 'clicks' | 'linkClicks' | 'reportedLeads' | 'cpl' | 'ctr' | 'cpc' | 'cpm' | 'linkCtr' | 'costPerLinkClick' | 'leadConversionRate';
type Column = { key: string; label: string; format: 'money' | 'number' | 'percent' };
const METRICS: Column[] = [
  { key: 'spend', label: 'Investimento', format: 'money' },
  { key: 'impressions', label: 'Impressões', format: 'number' },
  { key: 'clicks', label: 'Cliques (todos)', format: 'number' },
  { key: 'linkClicks', label: 'Cliques no link', format: 'number' },
  { key: 'reportedLeads', label: 'Leads Meta', format: 'number' },
  { key: 'cpl', label: 'Custo por lead', format: 'money' },
  { key: 'ctr', label: 'CTR — todos os cliques', format: 'percent' },
  { key: 'linkCtr', label: 'CTR — cliques no link', format: 'percent' },
  { key: 'cpc', label: 'CPC — todos os cliques', format: 'money' },
  { key: 'costPerLinkClick', label: 'CPC — clique no link', format: 'money' },
  { key: 'cpm', label: 'CPM — custo por mil impressões', format: 'money' },
  { key: 'leadConversionRate', label: 'Leads por clique no link (%)', format: 'percent' },
];
const DEFAULT_COLUMNS = ['creative', 'spend', 'impressions', 'clicks', 'reportedLeads', 'cpl'];
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const ACTION_LABELS: Record<string, string> = {
  landing_page_view: 'Visualizações da página de destino', link_click: 'Cliques no link',
  lead: 'Leads', 'onsite_conversion.lead_grouped': 'Leads no Meta',
  'offsite_conversion.fb_pixel_lead': 'Leads pelo Pixel da Meta',
  post_engagement: 'Envolvimentos com a publicação', page_engagement: 'Envolvimentos com a página',
  post_reaction: 'Reações à publicação', comment: 'Comentários', post: 'Compartilhamentos',
  video_view: 'Reproduções de vídeo', purchase: 'Compras', add_to_cart: 'Adições ao carrinho',
  initiate_checkout: 'Inícios de finalização de compra', complete_registration: 'Cadastros concluídos',
  messaging_conversation_started_7d: 'Conversas iniciadas por mensagem',
  like: 'Curtidas na página',
  'onsite_conversion.lead': 'Leads no formulário da Meta',
  onsite_web_lead: 'Leads no site pela Meta',
  'onsite_conversion.messaging_conversation_started_7d': 'Conversas por mensagem iniciadas em até 7 dias',
  'onsite_conversion.messaging_first_reply': 'Primeiras respostas por mensagem',
  'onsite_conversion.messaging_user_depth_2_message_send': 'Conversas com 2 mensagens enviadas',
  'onsite_conversion.messaging_user_depth_3_message_send': 'Conversas com 3 mensagens enviadas',
  'onsite_conversion.total_messaging_connection': 'Conexões por mensagem',
  'onsite_conversion.post_net_comment': 'Comentários líquidos na publicação',
  'onsite_conversion.post_net_like': 'Curtidas líquidas na publicação',
  'onsite_conversion.post_net_save': 'Salvamentos líquidos da publicação',
  'onsite_conversion.post_save': 'Salvamentos da publicação',
  'onsite_conversion.post_unlike': 'Curtidas removidas da publicação',
  post_interaction_gross: 'Interações brutas com a publicação',
  post_interaction_net: 'Interações líquidas com a publicação',
  offsite_complete_registration_add_meta_leads: 'Cadastros no site associados a leads Meta',
  offsite_content_view_add_meta_leads: 'Visualizações de conteúdo no site associadas a leads Meta',
  offsite_search_add_meta_leads: 'Pesquisas no site associadas a leads Meta',
};
function actionLabel(key: string) { return ACTION_LABELS[key] ? `${ACTION_LABELS[key]} (ação Meta)` : `Ação Meta: ${key.replace(/[._:]+/g, ' ')}`; }

function valueFor(row: MetaMetricGroup, key: string): string | number | null {
  if (key === 'name') return row.name;
  if (key.startsWith('action:')) return row.actions?.[key.slice(7)] ?? 0;
  const value = row[key as MetricKey];
  return typeof value === 'number' ? value : null;
}

export function PerformanceTable({ rows, currency, hasData, previews, showCreatives, onPreview, accountId, toolbar }: {
  rows: MetaMetricGroup[]; currency: string | null; hasData: boolean;
  previews: Record<string, CreativePreview>; showCreatives: boolean; accountId: string | null;
  onPreview: (item: MetaMetricGroup, preview: CreativePreview) => void;
  toolbar: ReactNode;
}) {
  const [visible, setVisible] = useState<string[]>(DEFAULT_COLUMNS);
  const [draft, setDraft] = useState<string[]>(DEFAULT_COLUMNS);
  const [open, setOpen] = useState(false);
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
    return [...METRICS, ...[...actions].sort().map((key): Column => ({ key: `action:${key}`, label: actionLabel(key), format: 'number' }))];
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
  const toggle = (key: string, checked: boolean) => setDraft((old) => checked ? [...old.filter((item) => item !== key), key] : old.filter((item) => item !== key));
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-end gap-2">{toolbar}<Button type="button" variant="outline" onClick={() => { setDraft([...visible]); setOpen(true); }}><SlidersHorizontal className="size-4" />Personalizar colunas</Button></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl"><DialogTitle>Personalizar colunas</DialogTitle><DialogDescription>Selecione as informações que deseja visualizar. O nome estará sempre visível.</DialogDescription><div className="max-h-[55vh] space-y-1 overflow-y-auto py-2">{showCreatives && <label className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"><input type="checkbox" checked={draft.includes('creative')} onChange={(e) => toggle('creative', e.target.checked)} /> Prévia do criativo</label>}{columns.map((column) => <label key={column.key} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"><input type="checkbox" checked={draft.includes(column.key)} onChange={(e) => toggle(column.key, e.target.checked)} /> {column.label}</label>)}</div><div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4"><Button type="button" variant="ghost" onClick={() => setDraft([...DEFAULT_COLUMNS])}>Restaurar padrão</Button><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button type="button" onClick={() => { setVisible(draft); setOpen(false); }}>Aplicar</Button></div></div></DialogContent></Dialog>
    {!hasData ? <div className="border-border text-muted-foreground rounded-xl border border-dashed px-5 py-12 text-center text-sm">Os dados de anúncios aparecerão após conectar a API oficial e fazer a primeira sincronização.</div> : !rows.length ? <div className="border-border text-muted-foreground rounded-xl border border-dashed px-5 py-12 text-center text-sm">Nenhum item com desempenho neste período.</div> :
    <div className="border-border overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/50 text-muted-foreground text-xs"><tr>{showCreatives && visible.includes('creative') && <th scope="col" className="px-4 py-3 font-medium">Criativo</th>}{heading('name', 'Nome', false)}{activeColumns.map((column) => heading(column.key, column.label))}</tr></thead><tbody>{sorted.map((item) => <tr key={item.id} className="border-border hover:bg-muted/30 border-t">
      {showCreatives && visible.includes('creative') && <td className="px-4 py-2">{previews[item.id]?.imageUrl || previews[item.id]?.isVideo ? <button type="button" onClick={() => onPreview(item, previews[item.id])} className="relative block size-14 overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Ver criativo de ${item.name}`}>{previews[item.id].imageUrl && <img src={previews[item.id].imageUrl!} alt="" className="h-full w-full object-cover" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />}{previews[item.id].isVideo && <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white"><Play className="size-5 fill-current" /></span>}</button> : <span className="flex size-14 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground" title="Prévia indisponível"><ImageOff className="size-5" /></span>}</td>}
      <td className="max-w-[300px] min-w-[180px] truncate px-4 py-3 font-medium" title={item.name}>{item.name}</td>{activeColumns.map((column) => { const value = valueFor(item, column.key); return <td key={column.key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{typeof value !== 'number' ? '—' : column.format === 'money' && currency ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value) : column.format === 'percent' ? `${nf.format(value)}%` : nf.format(value)}</td>; })}</tr>)}</tbody></table></div>
    }
  </div>;
}
