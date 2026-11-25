export const billingStatuses = {
  pending: 'Aguardando pagamento',
  trialing: 'Em teste',
  active: 'Ativa',
  past_due: 'Em atraso',
  canceled: 'Cancelada',
} as const;

export const billingIntervals = { monthly: 'Mensal', annual: 'Anual' } as const;

export type BillingStatus = keyof typeof billingStatuses;
export type BillingInterval = keyof typeof billingIntervals;
export type BillingPlan = {
  id: string;
  name: string;
  interval: BillingInterval;
  amount_cents: number;
};

export type BillingSubscription = {
  account_id: string;
  plan_id: string;
  status: BillingStatus;
  period_end: string | null;
};

export function formatBillingDate(date: string): string {
  return date.split('-').reverse().join('/');
}

export function parseBillingPrice(value: string): number | null {
  const match = /^(\d{1,7})(?:[,.](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

export function isBillingDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01') return false;
  const date = new Date(value + 'T00:00:00Z');
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const formatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatBillingAmount(cents: number): string {
  return formatter.format(cents / 100);
}

export function formatBillingPrice(plan: BillingPlan): string {
  return (
    formatBillingAmount(plan.amount_cents) +
    (plan.interval === 'monthly' ? '/mês' : '/ano')
  );
}
