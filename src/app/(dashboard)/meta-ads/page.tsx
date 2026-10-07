'use client';

import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  Megaphone,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { MetaMetricGroup } from '@/lib/meta-ads/dashboard';

type Connection = {
  meta_ad_account_id: string;
  meta_page_ids: string[];
  is_active: boolean;
  ads_read_granted: boolean;
  leads_retrieval_granted: boolean;
  ads_last_synced_at: string | null;
  leads_last_synced_at: string | null;
  sync_error: string | null;
};
type FormLead = {
  id: string;
  contactId: string | null;
  source: string;
  submittedAt: string | null;
  name: string;
  campaignName: string | null;
  adName: string | null;
  formName: string | null;
};
type Overview = {
  range: { from: string; to: string; days: number };
  connections: Connection[];
  selectedAdAccountId: string | null;
  currency: string | null;
  mixedCurrencies: boolean;
  hasAdsData: boolean;
  ads: {
    totals: MetaMetricGroup;
    daily: MetaMetricGroup[];
    campaigns: MetaMetricGroup[];
    adsets: MetaMetricGroup[];
    ads: MetaMetricGroup[];
  };
  crmFormLeads: { count: number; recent: FormLead[] };
  failedMetaLeads: number;
};

const nf = new Intl.NumberFormat('pt-BR');
const compact = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function money(value: number, currency: string | null) {
  if (!currency) return nf.format(value);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(
    value
  );
}

function dateLabel(value: string | null) {
  if (!value) return 'Ainda não sincronizado';
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function MetricCard({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: typeof Megaphone;
}) {
  return (
    <article className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <div className="text-muted-foreground flex items-start justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="text-foreground mt-3 text-2xl font-semibold tracking-tight">
        {value}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">{caption}</p>
    </article>
  );
}

function PerformanceTable({
  rows,
  currency,
  hasData,
}: {
  rows: MetaMetricGroup[];
  currency: string | null;
  hasData: boolean;
}) {
  if (!hasData)
    return (
      <div className="border-border text-muted-foreground rounded-xl border border-dashed px-5 py-12 text-center text-sm">
        Os dados de anúncios aparecerão após conectar a API oficial e fazer a
        primeira sincronização.
      </div>
    );
  if (!rows.length)
    return (
      <div className="border-border text-muted-foreground rounded-xl border border-dashed px-5 py-12 text-center text-sm">
        Nenhum item com desempenho neste período.
      </div>
    );
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Nome
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Investimento
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Impressões
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Cliques
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Leads Meta
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Custo/lead
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.id}
              className="border-border hover:bg-muted/30 border-t"
            >
              <td
                className="max-w-[300px] truncate px-4 py-3 font-medium"
                title={item.name}
              >
                {item.name}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {money(item.spend, currency)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {nf.format(item.impressions)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {nf.format(item.clicks)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {nf.format(item.reportedLeads)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {item.cpl === null ? '—' : money(item.cpl, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MetaAdsPage() {
  const [days, setDays] = useState(30);
  const [adAccount, setAdAccount] = useState('');
  const [level, setLevel] = useState<'campaigns' | 'adsets' | 'ads'>(
    'campaigns'
  );
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ days: String(days) });
        if (adAccount) query.set('ad_account_id', adAccount);
        const response = await fetch(`/api/meta-ads/overview?${query}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = (await response.json()) as Overview & { error?: string };
        if (!response.ok)
          throw new Error(body.error ?? 'Não foi possível carregar o painel.');
        setOverview(body);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setOverview(null);
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar o painel.'
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [days, adAccount, refresh]);

  const connection = overview?.connections.find(
    (item) => item.meta_ad_account_id === overview.selectedAdAccountId
  );
  const hasData = overview?.hasAdsData ?? false;
  const currency = overview?.currency ?? null;
  const total = overview?.ads.totals;
  const daily = overview?.ads.daily ?? [];
  const maxSpend = Math.max(1, ...daily.map((day) => day.spend));
  const setup = [
    { label: 'Conta de anúncios vinculada ao CRM', done: Boolean(connection) },
    {
      label: 'Permissão ads_read confirmada',
      done: Boolean(connection?.ads_read_granted),
    },
    {
      label: 'Permissão leads_retrieval confirmada',
      done: Boolean(connection?.leads_retrieval_granted),
    },
    {
      label: 'Página do Facebook vinculada',
      done: Boolean(connection?.meta_page_ids?.length),
    },
    {
      label: 'Primeira sincronização de anúncios',
      done: Boolean(connection?.ads_last_synced_at),
    },
    {
      label: 'Primeira sincronização de formulários',
      done: Boolean(connection?.leads_last_synced_at),
    },
  ];

  return (
    <main className="min-h-full space-y-6 p-4 pb-12 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-widest text-amber-500 uppercase">
            <ChartNoAxesCombined className="h-4 w-4" /> Inteligência de
            aquisição
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
            Meta Ads e formulários
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Acompanhe investimento, desempenho e leads em um só lugar. Os dados
            oficiais serão exibidos quando a integração Meta for conectada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={loading}
          className="border-border hover:bg-muted inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm disabled:opacity-50"
          aria-label="Atualizar painel"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{' '}
          Atualizar
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}
      {!error && (
        <div className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            {connection?.ads_last_synced_at ? (
              <CircleCheck className="h-4 w-4 text-emerald-500" />
            ) : (
              <CircleDashed className="h-4 w-4 text-amber-500" />
            )}
            <span className="font-medium">
              {connection?.ads_last_synced_at
                ? 'Dados oficiais disponíveis'
                : 'Aguardando conexão oficial do Meta'}
            </span>
            <span className="text-muted-foreground hidden sm:inline">
              ·{' '}
              {connection?.ads_last_synced_at
                ? `Última atualização: ${dateLabel(connection.ads_last_synced_at)}`
                : 'Nenhuma coleta da API foi iniciada'}
            </span>
          </div>
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs">
            Somente leitura dos anúncios
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          Período{' '}
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="border-border bg-background text-foreground h-9 rounded-lg border px-3"
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          Conta{' '}
          <select
            value={adAccount}
            onChange={(event) => setAdAccount(event.target.value)}
            className="border-border bg-background text-foreground h-9 max-w-[240px] rounded-lg border px-3"
          >
            <option value="">
              {overview?.connections.length
                ? 'Conta principal'
                : 'Não conectada'}
            </option>
            {overview?.connections.map((item) => (
              <option
                key={item.meta_ad_account_id}
                value={item.meta_ad_account_id}
              >
                act_{item.meta_ad_account_id}
              </option>
            ))}
          </select>
        </label>
        {overview && (
          <span className="text-muted-foreground self-center text-xs">
            {new Date(`${overview.range.from}T12:00:00Z`).toLocaleDateString(
              'pt-BR'
            )}{' '}
            –{' '}
            {new Date(`${overview.range.to}T12:00:00Z`).toLocaleDateString(
              'pt-BR'
            )}
          </span>
        )}
      </div>

      {overview?.mixedCurrencies && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
        >
          Há moedas diferentes no período. Revise a conta antes de comparar os
          valores.
        </div>
      )}
      {overview && overview.failedMetaLeads > 0 && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm"
        >
          {nf.format(overview.failedMetaLeads)} lead(s) da API Meta não puderam
          ser importados. O registro da falha foi preservado para correção e
          nova tentativa.
        </div>
      )}
      <section
        aria-label="Indicadores dos anúncios"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard
          label="Investimento"
          value={hasData && total ? money(total.spend, currency) : '—'}
          caption="Valor informado pelo Meta"
          icon={Megaphone}
        />
        <MetricCard
          label="Leads nos anúncios"
          value={hasData && total ? nf.format(total.reportedLeads) : '—'}
          caption="Eventos de lead reportados pelo Meta"
          icon={ClipboardList}
        />
        <MetricCard
          label="Custo por lead"
          value={
            hasData && total?.cpl !== null && total
              ? money(total.cpl, currency)
              : '—'
          }
          caption="Investimento ÷ leads reportados"
          icon={ChartNoAxesCombined}
        />
        <MetricCard
          label="Cliques / CTR"
          value={
            hasData && total
              ? `${compact.format(total.clicks)} · ${total.ctr === null ? '—' : `${percent.format(total.ctr)}%`}`
              : '—'
          }
          caption="Cliques e taxa sobre impressões"
          icon={ArrowUpRight}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <section
          className="border-border bg-card rounded-xl border p-5"
          aria-label="Investimento diário"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Investimento diário</h2>
            <span className="text-muted-foreground text-xs">
              Meta Ads · {days} dias
            </span>
          </div>
          {hasData && daily.length ? (
            <div
              className="border-border mt-7 flex h-44 items-end gap-1 overflow-x-auto border-b pb-1"
              role="img"
              aria-label="Gráfico de investimento diário"
            >
              {daily.map((day) => (
                <div
                  key={day.id}
                  className="group relative flex h-full min-w-2 flex-1 items-end"
                  title={`${new Date(`${day.id}T12:00:00Z`).toLocaleDateString('pt-BR')}: ${money(day.spend, currency)}`}
                >
                  <div
                    className="w-full rounded-t bg-amber-500/75 transition-colors group-hover:bg-amber-500"
                    style={{
                      height: `${Math.max(3, (day.spend / maxSpend) * 100)}%`,
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="border-border text-muted-foreground mt-5 flex h-44 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm">
              O gráfico ficará disponível após a primeira sincronização oficial.
            </div>
          )}
          <p className="text-muted-foreground mt-3 text-xs">
            Métricas de anúncios e leads importados não são a mesma contagem.
          </p>
        </section>
        <section
          className="border-border bg-card rounded-xl border p-5"
          aria-label="Preparação da integração"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-500" />
            <h2 className="font-semibold">Conexão Meta</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            Estrutura pronta para receber as permissões e os dados da API
            oficial. Nenhum token é necessário neste painel agora.
          </p>
          <ul className="mt-4 space-y-2.5">
            {setup.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-sm">
                {item.done ? (
                  <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <CircleDashed className="text-muted-foreground h-4 w-4 shrink-0" />
                )}
                <span className={item.done ? '' : 'text-muted-foreground'}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
          {connection?.sync_error && (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive mt-4 rounded-lg p-2 text-xs"
            >
              Última falha: {connection.sync_error}
            </p>
          )}
        </section>
      </div>

      <section className="space-y-4" aria-label="Desempenho por nível">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Desempenho dos anúncios</h2>
            <p className="text-muted-foreground text-xs">
              Valores da API oficial, quando conectada.
            </p>
          </div>
          <div
            className="border-border inline-flex rounded-lg border p-1"
            role="group"
            aria-label="Nível do relatório"
          >
            {(
              [
                ['campaigns', 'Campanhas'],
                ['adsets', 'Conjuntos'],
                ['ads', 'Anúncios'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setLevel(key)}
                aria-pressed={level === key}
                className={`rounded-md px-3 py-1.5 text-sm ${level === key ? 'bg-amber-500 text-black' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <PerformanceTable
          rows={overview?.ads[level] ?? []}
          currency={currency}
          hasData={hasData}
        />
      </section>

      <section className="space-y-3" aria-label="Leads de formulários no CRM">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Leads de formulários no CRM
            </h2>
            <p className="text-muted-foreground text-sm">
              Registros já importados da planilha e, futuramente, da API
              oficial. Não são os “leads nos anúncios” acima.
            </p>
          </div>
          <span className="bg-muted rounded-full px-3 py-1 text-sm font-medium">
            {overview ? nf.format(overview.crmFormLeads.count) : '—'} no período
          </span>
        </div>
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Contato
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Campanha / anúncio
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Origem
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Recebido em
                </th>
              </tr>
            </thead>
            <tbody>
              {overview?.crmFormLeads.recent.map((lead) => (
                <tr key={lead.id} className="border-border border-t">
                  <td className="px-4 py-3 font-medium">{lead.name}</td>
                  <td className="text-muted-foreground px-4 py-3">
                    {[lead.campaignName, lead.adName]
                      .filter(Boolean)
                      .join(' · ') ||
                      lead.formName ||
                      'Não informado'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="bg-muted rounded-full px-2 py-1 text-xs">
                      {lead.source === 'meta_api'
                        ? 'API Meta'
                        : 'Google Sheets'}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {lead.submittedAt ? dateLabel(lead.submittedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!overview?.crmFormLeads.recent.length && (
            <div className="text-muted-foreground px-5 py-10 text-center text-sm">
              Nenhum lead de formulário registrado neste período.
            </div>
          )}
        </div>
        {overview &&
          overview.crmFormLeads.count > overview.crmFormLeads.recent.length && (
            <p className="text-muted-foreground text-xs">
              Exibindo os 100 mais recentes. O total considera todos os
              registros do período.
            </p>
          )}
      </section>
    </main>
  );
}

