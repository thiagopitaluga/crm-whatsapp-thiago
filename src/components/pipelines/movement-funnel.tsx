'use client';

import { ChevronDown } from 'lucide-react';

interface FunnelStage {
  id: string;
  name: string;
  color: string;
}

interface FunnelMetric {
  to_stage_id: string;
  movement_count: number;
  unique_deal_count: number;
}

interface ConversionMetric {
  stage_id: string;
  next_stage_id: string | null;
  reached_count: number;
  progressed_count: number;
}

interface MovementFunnelProps {
  stages: FunnelStage[];
  summary: FunnelMetric[];
  conversion: ConversionMetric[];
  selectedStageId: string;
  onSelectStage: (stageId: string) => void;
}

export function MovementFunnel({ stages, summary, conversion, selectedStageId, onSelectStage }: MovementFunnelProps) {
  const counts = new Map(summary.map((item) => [item.to_stage_id, item]));
  const conversions = new Map(conversion.map((item) => [item.stage_id, item]));

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="movement-funnel-heading">
      <div className="mb-5">
        <h2 id="movement-funnel-heading" className="text-base font-semibold text-foreground">Etapas do funil</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Do topo até o final. Clique em uma etapa para filtrar o histórico abaixo.
        </p>
      </div>

      {stages.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Este funil ainda não tem etapas.</p>
      ) : (
        <ol className="mx-auto flex max-w-4xl flex-col items-center">
          {stages.map((stage, index) => {
            const metric = counts.get(stage.id);
            const conversionMetric = conversions.get(stage.id);
            const previousMetric = index > 0 ? conversions.get(stages[index - 1].id) : null;
            const reached = Number(previousMetric?.reached_count ?? 0);
            const progressed = Number(previousMetric?.progressed_count ?? 0);
            const width = stages.length === 1 ? 100 : 100 - (index * 34) / (stages.length - 1);
            const label = stages.length === 1 ? 'Etapa única' : index === 0 ? 'Topo do funil' : index === stages.length - 1 ? 'Final do funil' : `Etapa ${index + 1}`;
            const selected = selectedStageId === stage.id;
            return (
              <li key={stage.id} className="flex w-full flex-col items-center">
                {index > 0 && (
                  <div className="my-2 flex flex-col items-center text-center text-xs text-muted-foreground">
                    <ChevronDown aria-hidden="true" className="size-4" />
                    <span className="font-semibold tabular-nums text-foreground">
                      {reached > 0 ? `${(progressed / reached * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}
                    </span>
                    <span>{reached > 0 ? `${progressed} de ${reached} cards avançaram` : 'Sem base para calcular'}</span>
                  </div>
                )}
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${label}: ${stage.name}, ${Number(conversionMetric?.reached_count ?? 0)} cards chegaram, ${Number(metric?.movement_count ?? 0)} movimentações`}
                  onClick={() => onSelectStage(selected ? '' : stage.id)}
                  className={`w-full rounded-xl border border-t-4 px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-5 sm:py-4 ${selected ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/60'}`}
                  style={{ width: `${width}%`, borderTopColor: stage.color }}
                >
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
                  <span className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words text-sm font-semibold text-foreground sm:text-base">{stage.name}</span>
                    <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-primary sm:text-base">
                      {Number(conversionMetric?.reached_count ?? 0)} <span className="text-xs font-normal text-muted-foreground">cards chegaram</span>
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{Number(metric?.movement_count ?? 0)} movimentações no período</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-5 text-center text-xs text-muted-foreground">
        A porcentagem compara cards distintos que chegaram a uma etapa e depois à próxima etapa visível no período. A largura mostra apenas a ordem, não a conversão.
      </p>
    </section>
  );
}

