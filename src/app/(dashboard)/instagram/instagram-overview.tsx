'use client';
import { useEffect, useState } from 'react';
type Overview = {
  insights: {
    channelId: string;
    profile: {
      username: string;
      name?: string;
      followers_count?: number;
      follows_count?: number;
      media_count?: number;
    };
    metrics?: Record<string, number | null>;
    follows?: number | null;
    unfollows?: number | null;
    netGrowth?: number | null;
    engagementRate?: number | null;
    unavailable?: string[];
    error?: string;
  }[];
  profiles: number;
  conversations: number;
  received: number;
  sent: number;
  runs: {
    id: string;
    status: string;
    created_at: string;
    updated_at: string;
    error_message?: string | null;
    next_step?: number;
  }[];
};
export function InstagramOverview({ results = false }: { results?: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [days, setDays] = useState(7);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/instagram/overview?days=' + days, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Não foi possível carregar os indicadores.');
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [days]);
  const cards = data
    ? [
        ['Perfis conectados', data.profiles],
        ['Conversas', data.conversations],
        ['Mensagens recebidas', data.received],
        ['Mensagens enviadas', data.sent],
      ]
    : [];
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold">
          {results ? 'Resultados' : 'Visão geral'}
        </h2>
        <select
          aria-label="Período das métricas do Instagram"
          value={days}
          onChange={(event) => { setData(null); setError(''); setDays(Number(event.target.value)); }}
          className="border-border bg-card mt-3 rounded-lg border px-3 py-2 text-sm"
        >
          <option value={7}>Últimos 7 dias</option>
          <option value={14}>Últimos 14 dias</option>
          <option value={28}>Últimos 28 dias</option>
        </select>
        <p className="text-muted-foreground mt-1 text-sm">
          Totais registrados no Organizap para esta empresa, desde o início da
          integração.
        </p>
      </div>
      {data?.insights?.map((insight) => (
        <section
          key={insight.channelId}
          className="border-border bg-card space-y-4 rounded-xl border p-4 sm:p-5"
        >
          <div>
            <h3 className="font-semibold">@{insight.profile.username}</h3>
            <p className="text-muted-foreground text-sm">
              Desempenho do perfil · últimos {days} dias
            </p>
          </div>
          {insight.error ? (
            <p role="alert" className="text-destructive text-sm">
              {insight.error}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ['Seguidores atuais', insight.profile.followers_count],
                  ['Seguindo', insight.profile.follows_count],
                  ['Publicações', insight.profile.media_count],
                  ['Novos seguidores', insight.follows],
                  ['Deixaram de seguir', insight.unfollows],
                  ['Crescimento líquido', insight.netGrowth],
                  ['Contas alcançadas', insight.metrics?.reach],
                  ['Visualizações', insight.metrics?.views],
                  ['Contas engajadas', insight.metrics?.accounts_engaged],
                  ['Interações', insight.metrics?.total_interactions],
                  [
                    'Engajamento por alcance',
                    insight.engagementRate == null
                      ? null
                      : insight.engagementRate.toLocaleString('pt-BR', {
                          maximumFractionDigits: 2,
                        }) + '%',
                  ],
                  ['Curtidas', insight.metrics?.likes],
                  ['Comentários', insight.metrics?.comments],
                  ['Compartilhamentos', insight.metrics?.shares],
                  ['Salvamentos', insight.metrics?.saves],
                  ['Respostas', insight.metrics?.replies],
                  ['Visitas ao perfil', insight.metrics?.profile_views],
                  ['Toques nos links', insight.metrics?.profile_links_taps],
                ].map(([label, value]) => (
                  <article
                    key={String(label)}
                    className="bg-muted/40 rounded-lg p-3"
                  >
                    <p className="text-muted-foreground text-xs">{label}</p>
                    <p className="mt-2 text-xl font-semibold">
                      {value == null
                        ? '—'
                        : typeof value === 'number'
                          ? value.toLocaleString('pt-BR')
                          : value}
                    </p>
                  </article>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                Engajamento por alcance = interações ÷ contas alcançadas.
                Seguidores atuais, seguindo e publicações são totais do perfil.
                “—” indica dado não disponibilizado pela Meta para este perfil,
                período ou autorização.
              </p>
            </>
          )}
        </section>
      ))}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : !data ? (
        <p className="text-muted-foreground text-sm">
          Carregando indicadores...
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(([label, value]) => (
            <article
              key={label}
              className="border-border bg-card rounded-xl border p-4"
            >
              <p className="text-muted-foreground text-sm">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </article>
          ))}
        </div>
      )}
      {results && data && (
        <section className="border-border bg-card rounded-xl border p-4">
          <h3 className="font-semibold">Últimas execuções</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Envios sem confirmação precisam de revisão antes de qualquer nova
            tentativa.
          </p>
          {data.runs.length ? (
            <ul className="divide-border mt-3 divide-y">
              {data.runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                >
                  <span>
                    {(
                      {
                        pending: 'Na fila',
                        sending: 'Processando',
                        sent: 'Enviada',
                        failed: 'Falhou',
                        uncertain: 'Confirmação incerta',
                      } as Record<string, string>
                    )[run.status] || run.status}
                    {run.next_step
                      ? ` · ${run.next_step} etapa(s) concluída(s)`
                      : ''}
                    {run.error_message && (
                      <small className="text-destructive mt-1 block">
                        {run.error_message}
                      </small>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(run.updated_at).toLocaleString('pt-BR')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
              Nenhuma execução registrada.
            </p>
          )}
        </section>
      )}
    </section>
  );
}
