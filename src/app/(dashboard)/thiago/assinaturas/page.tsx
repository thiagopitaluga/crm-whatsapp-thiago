import { PlanComparison } from '@/components/settings/plan-comparison';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import {
  billingStatuses,
  formatBillingAmount,
  formatBillingDate,
  formatBillingPrice,
  type BillingPlan,
  type BillingSubscription,
} from '@/lib/billing/subscriptions';
import { PlanForm, SubscriptionForm, AccessForm } from './forms';

const PAGE_SIZE = 20;

export default async function PlatformBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; busca?: string }>;
}) {
  try {
    await requirePlatformAdmin();
  } catch {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const search =
    typeof params.busca === 'string' ? params.busca.trim().slice(0, 80) : '';
  const page =
    typeof params.pagina === 'string' && /^\d{1,5}$/.test(params.pagina)
      ? Math.max(1, Number(params.pagina))
      : 1;
  const db = supabaseAdmin();
  const first = (page - 1) * PAGE_SIZE;
  let accountQuery = db.from('accounts').select('id,name', { count: 'exact' });
  if (search)
    accountQuery = accountQuery.ilike(
      'name',
      '%' + search.replace(/[\\%_]/g, '\\$&') + '%'
    );
  const [catalog, companies, summary] = await Promise.all([
    db
      .from('billing_plans')
      .select('id,name,interval,amount_cents')
      .order('created_at'),
    accountQuery
      .order('name')
      .order('id')
      .range(first, first + PAGE_SIZE - 1),
    db.rpc('billing_summary'),
  ]);
  const accounts = companies.data ?? [];
  const customAccess = await db
    .from('billing_account_access')
    .select('account_id,complimentary,features,limits')
    .in(
      'account_id',
      accounts.map((a) => a.id)
    );
  const accessByAccount = new Map(
    (customAccess.data ?? []).map((a) => [a.account_id, a])
  );

  const subscriptions = accounts.length
    ? await db
        .from('billing_subscriptions')
        .select('account_id,plan_id,status,period_end')
        .in(
          'account_id',
          accounts.map(({ id }) => id)
        )
    : { data: [], error: null };
  const loadError =
    customAccess.error ??
    catalog.error ??
    companies.error ??
    subscriptions.error ??
    summary.error;
  const plans = (catalog.data ?? []) as BillingPlan[];
  const byAccount = new Map(
    (subscriptions.data ?? ([] as BillingSubscription[])).map((row) => [
      row.account_id,
      row as BillingSubscription,
    ])
  );
  const byPlan = new Map(plans.map((plan) => [plan.id, plan]));
  const link = (number: number) =>
    '/thiago/assinaturas?' +
    new URLSearchParams({
      pagina: String(number),
      ...(search && { busca: search }),
    });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <Link href="/thiago" className="text-primary text-sm hover:underline">
          Voltar à administração
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Assinaturas</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cadastro manual de planos e assinaturas por empresa.
        </p>
      </header>

      {loadError ? (
        <p
          role="alert"
          className="text-destructive rounded-lg border p-4 text-sm"
        >
          Não foi possível carregar a área comercial. Verifique se a migração de
          assinaturas foi aplicada.
        </p>
      ) : (
        <>
          <section
            aria-label="Resumo comercial"
            className="grid gap-2 sm:grid-cols-4"
          >
            {[
              ['Ativas no período', summary.data?.active ?? 0],
              ['Testes vigentes', summary.data?.trialing ?? 0],
              ['Em atraso', summary.data?.past_due ?? 0],
              [
                'Receita mensal contratada',
                formatBillingAmount(summary.data?.monthly_cents ?? 0),
              ],
            ].map(([label, value]) => (
              <div key={label} className="bg-card rounded-lg border p-3">
                <p className="text-muted-foreground text-xs">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </section>
          <section className="bg-card space-y-4 rounded-xl border p-4">
            <h2 className="font-semibold">Catálogo de planos</h2>
            <PlanComparison />
            <PlanForm />
            {plans.length > 0 && (
              <ul className="divide-y border-t text-sm">
                {plans.map((plan) => (
                  <li
                    key={plan.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>{plan.name}</span>
                    <span className="text-muted-foreground">
                      {formatBillingPrice(plan)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-card space-y-4 rounded-xl border p-4">
            <h2 className="font-semibold">Empresas</h2>
            <form className="flex flex-wrap gap-2" action="/thiago/assinaturas">
              <input
                aria-label="Nome da empresa"
                name="busca"
                defaultValue={search}
                className="bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
                placeholder="Buscar por nome"
              />
              <button
                className="hover:bg-muted rounded-md border px-4 py-2 text-sm"
                type="submit"
              >
                Buscar
              </button>
            </form>

            {accounts.length ? (
              <ul className="space-y-2">
                {accounts.map((account) => {
                  const subscription = byAccount.get(account.id);
                  const plan = subscription && byPlan.get(subscription.plan_id);
                  return (
                    <li key={account.id}>
                      <details className="rounded-lg border p-3">
                        <summary className="cursor-pointer text-sm">
                          <strong>{account.name}</strong>
                          <span className="text-muted-foreground ml-2">
                            {subscription
                              ? billingStatuses[subscription.status]
                              : 'Sem assinatura'}
                            {plan ? ' · ' + plan.name : ''}
                            {subscription?.period_end
                              ? ' · até ' +
                                formatBillingDate(subscription.period_end)
                              : ''}
                          </span>
                        </summary>
                        <div className="mt-3">
                          <SubscriptionForm
                            accountId={account.id}
                            subscription={subscription}
                            plans={plans}
                          />
                          <AccessForm
                            accountId={account.id}
                            access={accessByAccount.get(account.id)}
                          />
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                Nenhuma empresa encontrada nesta página.
              </p>
            )}
            <nav
              aria-label="Paginação de empresas"
              className="flex gap-4 text-sm"
            >
              {page > 1 && (
                <Link
                  href={link(page - 1)}
                  className="text-primary hover:underline"
                >
                  Anterior
                </Link>
              )}
              {(companies.count ?? 0) > first + PAGE_SIZE && (
                <Link
                  href={link(page + 1)}
                  className="text-primary hover:underline"
                >
                  Próxima
                </Link>
              )}
            </nav>
          </section>
        </>
      )}
    </div>
  );
}
