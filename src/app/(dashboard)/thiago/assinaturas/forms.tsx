'use client';

import {
  serviceFeatures,
  serviceLimits,
  type ServiceAccess,
} from '@/lib/billing/access';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  billingIntervals,
  billingStatuses,
  formatBillingPrice,
  type BillingPlan,
  type BillingSubscription,
} from '@/lib/billing/subscriptions';
import { createPlan, saveSubscription, saveAccess } from './actions';

const selectStyle =
  'bg-background w-full min-w-0 rounded-md border px-3 py-2 text-sm';

function Feedback({
  result,
}: {
  result: { ok: boolean; message: string } | null;
}) {
  if (!result) return null;
  return (
    <p
      role={result.ok ? 'status' : 'alert'}
      className={
        result.ok ? 'text-muted-foreground text-sm' : 'text-destructive text-sm'
      }
    >
      {result.message}
    </p>
  );
}

export function PlanForm() {
  const [result, submit, pending] = useActionState(createPlan, null);
  return (
    <form action={submit} className="space-y-3">
      <fieldset
        disabled={pending}
        className="grid min-w-0 gap-3 sm:grid-cols-3"
      >
        <label className="space-y-1 text-sm">
          <span>Nome</span>
          <Input
            name="name"
            maxLength={80}
            required
            placeholder="Nome do plano"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Periodicidade</span>
          <select name="interval" className={selectStyle}>
            {Object.entries(billingIntervals).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Valor por período em R$</span>
          <Input
            name="amount"
            inputMode="decimal"
            maxLength={10}
            required
            placeholder="0,00"
          />
        </label>
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? 'Cadastrando…' : 'Cadastrar plano'}
      </Button>
      <Feedback result={result} />
    </form>
  );
}

export function SubscriptionForm({
  accountId,
  subscription,
  plans,
}: {
  accountId: string;
  subscription?: BillingSubscription;
  plans: BillingPlan[];
}) {
  const [result, submit, pending] = useActionState(
    saveSubscription.bind(null, accountId),
    null
  );
  const [status, setStatus] = useState(subscription?.status ?? 'pending');
  const dateRequired = ['active', 'trialing', 'past_due'].includes(status);

  return (
    <form action={submit} className="space-y-3">
      <fieldset
        disabled={pending || plans.length === 0}
        className="grid min-w-0 gap-3 sm:grid-cols-3"
      >
        <label className="space-y-1 text-sm">
          <span>Plano</span>
          <select
            name="planId"
            required
            defaultValue={subscription?.plan_id ?? ''}
            className={selectStyle}
          >
            <option value="" disabled>
              Selecione
            </option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} · {formatBillingPrice(plan)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Status</span>
          <select
            name="status"
            className={selectStyle}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            {Object.entries(billingStatuses).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Fim do período</span>
          <Input
            type="date"
            name="periodEnd"
            min="2000-01-01"
            required={dateRequired}
            defaultValue={subscription?.period_end ?? ''}
          />
        </label>
      </fieldset>
      <Button type="submit" size="sm" disabled={pending || !plans.length}>
        {pending ? 'Salvando…' : 'Salvar assinatura'}
      </Button>
      <Feedback result={result} />
    </form>
  );
}

export function AccessForm({
  accountId,
  access,
}: {
  accountId: string;
  access?: ServiceAccess;
}) {
  const [result, submit, pending] = useActionState(
    saveAccess.bind(null, accountId),
    null
  );
  return (
    <form action={submit} className="mt-5 space-y-4 border-t pt-4">
      <h3 className="font-semibold">Personalizar entrega</h3>
      <fieldset disabled={pending} className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="complimentary"
            defaultChecked={access?.complimentary}
          />
          Acesso gratuito concedido pelo administrador
        </label>
        <p className="text-muted-foreground text-sm">
          O acesso gratuito mantém os recursos do plano e as personalizações
          abaixo.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(serviceFeatures).map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              <span>{label}</span>
              <select
                name={'feature_' + key}
                className={selectStyle}
                defaultValue={
                  access?.features[key as keyof typeof serviceFeatures] ===
                  undefined
                    ? 'plan'
                    : access.features[key as keyof typeof serviceFeatures]
                      ? 'enabled'
                      : 'disabled'
                }
              >
                <option value="plan">Seguir o plano</option>
                <option value="enabled">Habilitado</option>
                <option value="disabled">Desabilitado</option>
              </select>
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(serviceLimits).map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              <span>{label}</span>
              <Input
                name={'limit_' + key}
                placeholder="Seguir o plano"
                defaultValue={
                  access?.limits[key as keyof typeof serviceLimits] === null
                    ? 'unlimited'
                    : (access?.limits[key as keyof typeof serviceLimits] ?? '')
                }
              />
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Nos limites, deixe vazio para seguir o plano, informe um número ou use
          unlimited para ilimitado.
        </p>
        <Button size="sm" type="submit">
          {pending ? 'Salvando…' : 'Salvar personalização'}
        </Button>
      </fieldset>
      <Feedback result={result} />
    </form>
  );
}
