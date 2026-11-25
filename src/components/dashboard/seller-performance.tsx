'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';

type Seller = {
  name: string;
  open: number;
  won: number;
  lost: number;
  stale: number;
};

export function SellerPerformance() {
  const { accountId, canEditSettings } = useAuth();
  const [rows, setRows] = useState<Seller[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accountId || !canEditSettings) return;
    const controller = new AbortController();
    const db = createClient();
    const now = Date.now();
    const start = new Date(now - 30 * 86_400_000).toISOString();
    const staleSince = new Date(now - 7 * 86_400_000).toISOString();

    async function load() {
      const sellers = new Map<string, Seller>();
      for (let offset = 0; ; offset += 500) {
        const { data, error: queryError } = await db
          .from('deals')
          .select(
            'id,assigned_to,status,updated_at,assignee:profiles!deals_assigned_to_fkey(full_name)'
          )
          .eq('account_id', accountId!)
          .gte('created_at', start)
          .order('id')
          .range(offset, offset + 499)
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (queryError) throw queryError;
        for (const deal of data ?? []) {
          const key = deal.assigned_to ?? '';
          const assignee = deal.assignee as { full_name?: string } | null;
          const seller = sellers.get(key) ?? {
            name:
              assignee?.full_name ||
              (key ? 'Responsável sem nome' : 'Sem responsável'),
            open: 0,
            won: 0,
            lost: 0,
            stale: 0,
          };
          if (deal.status === 'open') {
            seller.open++;
            if (deal.updated_at < staleSince) seller.stale++;
          } else if (deal.status === 'won') seller.won++;
          else if (deal.status === 'lost') seller.lost++;
          sellers.set(key, seller);
        }
        if (!data || data.length < 500) break;
        if (offset >= 9500) {
          setError(
            'Há mais de 10 mil negócios no período. O relatório precisa de uma consulta agregada para esta conta.'
          );
          return;
        }
      }
      setRows(
        [...sellers.values()].sort(
          (a, b) =>
            b.won - a.won || b.open - a.open || a.name.localeCompare(b.name)
        )
      );
    }
    void load().catch(() => {
      if (!controller.signal.aborted)
        setError('Não foi possível carregar o desempenho da equipe.');
    });
    return () => controller.abort();
  }, [accountId, canEditSettings]);

  if (!canEditSettings || !accountId) return null;

  return (
    <section className="bg-card space-y-3 rounded-xl border p-4">
      <div>
        <h2 className="font-semibold">Desempenho por responsável</h2>
        <p className="text-muted-foreground text-xs">
          Situação atual dos negócios criados nos últimos 30 dias.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-muted-foreground text-sm">
          {error}
        </p>
      ) : rows === null ? (
        <p role="status" className="text-muted-foreground text-sm">
          Carregando resultados…
        </p>
      ) : rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[35rem] text-left text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                {[
                  'Responsável',
                  'Em aberto',
                  'Sem atualização há 7 dias',
                  'Ganhas',
                  'Perdidas',
                  'Conversão',
                ].map((label) => (
                  <th className="px-2 py-2" scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((seller, index) => (
                <tr className="border-t" key={index}>
                  <th className="px-2 py-2 font-medium" scope="row">
                    {seller.name}
                  </th>
                  {[seller.open, seller.stale, seller.won, seller.lost].map(
                    (value, cell) => (
                      <td className="px-2 py-2 tabular-nums" key={cell}>
                        {value}
                      </td>
                    )
                  )}
                  <td className="px-2 py-2 tabular-nums">
                    {seller.won + seller.lost
                      ? (
                          seller.won /
                          (seller.won + seller.lost)
                        ).toLocaleString('pt-BR', {
                          style: 'percent',
                          maximumFractionDigits: 1,
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted-foreground mt-2 text-xs">
            Conversão entre negócios encerrados: ganhos ÷ (ganhos + perdidos).
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Nenhum negócio criado no período.
        </p>
      )}
    </section>
  );
}
