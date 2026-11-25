import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { abacateConfig } from '@/lib/billing/abacatepay';
import { AbacateCheckoutButton } from './abacate-checkout';
import {
  billingStatuses,
  formatBillingDate,
  formatBillingPrice,
  type BillingPlan,
  type BillingStatus,
} from '@/lib/billing/subscriptions';

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const account = await requireRole('admin').catch(() => null);
  if (!account) redirect('/dashboard');
  const { data, error } = await account.supabase
    .from('billing_subscriptions')
    .select('status,period_end,plan_id')
    .eq('account_id', account.accountId)
    .maybeSingle();
  const planResult = data
    ? await account.supabase
        .from('billing_plans')
        .select('id,name,interval,amount_cents')
        .eq('id', data.plan_id)
        .single()
    : null;
  const plan = planResult?.data as BillingPlan | null | undefined;
  const status = data?.status as BillingStatus | undefined;
  const pilot = Boolean(abacateConfig(account.accountId));
  const call = pilot
    ? await supabaseAdmin()
        .from('billing_abacatepay_tests')
        .select('status,period_end')
        .eq('account_id', account.accountId)
        .maybeSingle()
    : null;
  const testStatus = call?.data?.status as
    BillingStatus | 'expired' | undefined;
  const returned = (await searchParams).checkout === 'retorno';
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/settings" className="text-primary text-sm hover:underline">
        Voltar às configurações
      </Link>
      <h1 className="text-2xl font-bold">Assinatura</h1>
      <p className="text-muted-foreground text-sm">{account.account.name}</p>
      <section className="bg-card rounded-xl border p-5">
        {error || planResult?.error ? (
          <p role="alert" className="text-destructive text-sm">
            Não foi possível consultar a assinatura.
          </p>
        ) : plan && status ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              ['Plano', plan.name],
              ['Valor', formatBillingPrice(plan)],
              ['Status', billingStatuses[status]],
              [
                'Fim do período',
                data?.period_end
                  ? formatBillingDate(data.period_end)
                  : 'A definir',
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground text-sm">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            Sua empresa ainda não tem um plano registrado.
          </p>
        )}
      </section>
      {pilot && (
        <section
          className="bg-card space-y-3 rounded-xl border p-5"
          aria-labelledby="abacate-test-title"
        >
          <h2 id="abacate-test-title" className="font-semibold">
            AbacatePay · modo de teste
          </h2>
          <p className="text-muted-foreground text-sm">
            Simule um pagamento recorrente por cartão.
          </p>
          {call?.error ? (
            <p role="alert" className="text-destructive text-sm">
              Não foi possível consultar o checkout de teste.
            </p>
          ) : (
            <>
              {testStatus && (
                <p className="text-sm">
                  {testStatus === 'expired'
                    ? 'Checkout expirado'
                    : billingStatuses[testStatus]}
                  {call?.data?.period_end &&
                    ' · período até ' + formatBillingDate(call.data.period_end)}
                </p>
              )}
              {returned && (!testStatus || testStatus === 'pending') && (
                <p role="status" className="text-muted-foreground text-sm">
                  Aguardando a confirmação da AbacatePay. Atualize esta página
                  para consultar o status.
                </p>
              )}
              {account.role === 'owner' &&
                plan &&
                (!testStatus || testStatus === 'pending') && (
                  <AbacateCheckoutButton />
                )}
              {account.role === 'owner' && !plan && (
                <p className="text-muted-foreground text-sm">
                  Vincule um plano à empresa para iniciar o teste.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
