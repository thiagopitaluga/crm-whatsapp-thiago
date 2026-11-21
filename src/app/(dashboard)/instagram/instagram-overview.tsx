'use client';
import { useEffect, useState } from 'react';
type Overview = {
  profiles: number;
  conversations: number;
  received: number;
  sent: number;
  runs: {
    id: string;
    status: string;
    created_at: string;
    updated_at: string;
  }[];
};
export function InstagramOverview({ results = false }: { results?: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/instagram/overview', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Não foi possível carregar os indicadores.');
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
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
        <p className="text-muted-foreground mt-1 text-sm">
          Totais registrados no Organizap para esta empresa, desde o início da
          integração.
        </p>
      </div>
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
