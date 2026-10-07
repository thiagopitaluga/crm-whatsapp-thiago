'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowRightLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MovementFunnel } from '@/components/pipelines/movement-funnel';

interface PipelineOption { id: string; name: string }
interface StageOption { id: string; name: string; position: number; color: string }
interface StageSummary {
  to_stage_id: string;
  to_stage_name: string;
  movement_count: number;
  unique_deal_count: number;
}
interface ConversionMetric {
  stage_id: string;
  next_stage_id: string | null;
  reached_count: number;
  progressed_count: number;
}
interface MovementEvent {
  id: string;
  deal_id: string;
  deal_title: string;
  event_type: 'created' | 'moved';
  from_stage_name: string | null;
  to_stage_id: string;
  to_stage_name: string;
  changed_by_name: string | null;
  occurred_at: string;
}
interface MovementReport {
  stages: StageOption[];
  summary: StageSummary[];
  visibleStageIds: string[];
  funnel: ConversionMetric[];
  events: MovementEvent[];
  eventCount: number;
  page: number;
  pageSize: number;
}

const BRAZIL_DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});

function brazilDate(daysAgo: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' })
    .format(new Date(Date.now() - daysAgo * 86_400_000));
}

export default function PipelineMovementsPage() {
  const { accountId } = useAuth();
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [from, setFrom] = useState(() => brazilDate(29));
  const [to, setTo] = useState(() => brazilDate(0));
  const [destinationId, setDestinationId] = useState('');
  const [hiddenStageIds, setHiddenStageIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<MovementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dateError = from > to ? 'A data inicial deve ser anterior à data final.' : '';
  const orderedStages = [...(report?.stages ?? [])].sort((a, b) => a.position - b.position);
  const visibleStages = orderedStages.filter((stage) => !hiddenStageIds.includes(stage.id));
  const visibleStageIds = visibleStages.map((stage) => stage.id).join(',');
  const visibleQuery = hiddenStageIds.length > 0 ? visibleStageIds : '';
  const funnelReady = report?.visibleStageIds.join(',') === visibleStageIds;
  const currentStageIds = new Set(orderedStages.map((stage) => stage.id));
  const archivedStages = (report?.summary ?? []).filter((item) => !currentStageIds.has(item.to_stage_id));
  const totalMovements = (report?.summary ?? []).reduce((total, item) => total + Number(item.movement_count), 0);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    void supabase.from('pipelines').select('id, name').eq('account_id', accountId)
      .order('created_at').then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          setError('Não foi possível carregar os funis.');
          return;
        }
        const options = (data ?? []) as PipelineOption[];
        setPipelines(options);
        const requested = new URLSearchParams(window.location.search).get('pipeline_id');
        setPipelineId(options.find((item) => item.id === requested)?.id ?? options[0]?.id ?? '');
      });
    return () => { cancelled = true; };
  }, [accountId]);

  useEffect(() => {
    if (!pipelineId || !from || !to) return;
    if (from > to) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ pipeline_id: pipelineId, from, to, page: String(page) });
    if (destinationId) query.set('to_stage_id', destinationId);
    if (visibleQuery) query.set('visible_stage_ids', visibleQuery);
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError('');
      }
    });
    void fetch(`/api/pipelines/movements?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Falha ao carregar as movimentações.');
        return body as MovementReport;
      })
      .then((body) => { if (!controller.signal.aborted) setReport(body); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Falha ao carregar as movimentações.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pipelineId, from, to, destinationId, page, visibleQuery]);

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/pipelines" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Voltar ao Kanban
          </Link>
          <h1 className="text-xl font-semibold text-foreground">Painel de movimentações</h1>
          <p className="text-sm text-muted-foreground">Acompanhe o caminho dos cards pelas etapas do funil e consulte cada movimentação por período.</p>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_160px_160px_minmax(180px,1fr)]">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Funil
          <select value={pipelineId} onChange={(event) => { setPipelineId(event.target.value); setDestinationId(''); setHiddenStageIds([]); setReport(null); setPage(1); }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
            {pipelines.length === 0 && <option value="">Nenhum funil</option>}
            {pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          De
          <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Até
          <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Etapa de destino no histórico
          <select value={destinationId} onChange={(event) => { setDestinationId(event.target.value); setPage(1); }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option value="">Todas as etapas</option>
            {orderedStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            {archivedStages.map((stage) => <option key={stage.to_stage_id} value={stage.to_stage_id}>{stage.to_stage_name} (removida)</option>)}
          </select>
        </label>
      </div>

      {(error || dateError) && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{dateError || error}</p>}
      {loading && <p role="status" className="text-sm text-muted-foreground">Carregando movimentações...</p>}

      {report && !dateError && !error && (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowRightLeft className="size-4" /> Movimentações no período</div>
            <p className="mt-1 text-2xl font-semibold text-foreground">{totalMovements}</p>
            <p className="mt-1 text-xs text-muted-foreground">Conta cada mudança de etapa. Um mesmo card pode ser contado mais de uma vez.</p>
          </div>

          <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="visible-stages-heading">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id="visible-stages-heading" className="text-sm font-semibold text-foreground">Etapas exibidas</h2>
                <p className="mt-1 text-xs text-muted-foreground">Desmarque etapas para comparar diretamente as que permanecerem visíveis.</p>
              </div>
              {hiddenStageIds.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setHiddenStageIds([])}>Mostrar todas</Button>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Escolher etapas do funil">
              {orderedStages.map((stage) => {
                const checked = !hiddenStageIds.includes(stage.id);
                return (
                  <label key={stage.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${checked ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                    <input type="checkbox" checked={checked} disabled={checked && visibleStages.length === 1}
                      onChange={() => setHiddenStageIds((current) => checked ? [...current, stage.id] : current.filter((id) => id !== stage.id))}
                      className="accent-primary" />
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
                    {stage.name}
                  </label>
                );
              })}
            </div>
          </section>

          {funnelReady ? (
            <MovementFunnel
              stages={visibleStages}
              summary={report.summary}
              conversion={report.funnel}
              selectedStageId={destinationId}
              onSelectStage={(stageId) => { setDestinationId(stageId); setPage(1); }}
            />
          ) : <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Recalculando conversões...</p>}

          {archivedStages.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-4" aria-label="Etapas removidas">
              <h2 className="text-sm font-semibold text-foreground">Etapas removidas do funil</h2>
              <p className="mt-1 text-xs text-muted-foreground">As movimentações antigas dessas etapas continuam no histórico.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {archivedStages.map((stage) => (
                  <button key={stage.to_stage_id} type="button"
                    aria-pressed={destinationId === stage.to_stage_id}
                    onClick={() => { setDestinationId(destinationId === stage.to_stage_id ? '' : stage.to_stage_id); setPage(1); }}
                    className="rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10">
                    {stage.to_stage_name} · {Number(stage.movement_count)} entradas
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Histórico de movimentações">
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-semibold text-foreground">Histórico</h2>
              <p className="text-xs text-muted-foreground">{report.eventCount} registros no período. A criação inicial do card aparece aqui, mas não entra nas métricas de movimentação.</p>
            </div>
            {report.events.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Nenhuma movimentação registrada neste período.</p>
            ) : (
              <ol className="divide-y divide-border">
                {report.events.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{event.deal_title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-muted-foreground">
                        {event.event_type === 'created' ? 'Criado em' : <>{event.from_stage_name ?? 'Etapa anterior'} <ArrowRight className="size-3" /></>}
                        <span className="text-foreground">{event.to_stage_name}</span>
                      </p>
                    </div>
                    <div className="text-left text-xs text-muted-foreground sm:text-right">
                      <p>{BRAZIL_DATE_TIME.format(new Date(event.occurred_at))}</p>
                      <p>{event.changed_by_name ?? 'Integração ou sistema'}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {report.eventCount > report.pageSize && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <span>Página {report.page} de {Math.ceil(report.eventCount / report.pageSize)}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)} aria-label="Página anterior"><ChevronLeft className="size-4" /></Button>
                  <Button variant="outline" size="sm" disabled={page * report.pageSize >= report.eventCount || loading} onClick={() => setPage((current) => current + 1)} aria-label="Próxima página"><ChevronRight className="size-4" /></Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
      <p className="text-xs text-muted-foreground">O registro começa após a ativação desta estrutura; movimentações antigas não podem ser reconstruídas com precisão.</p>
    </div>
  );
}

