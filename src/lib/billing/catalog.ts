export const commercialPlans = [
  {
    code: 'essential',
    name: 'Essencial',
    amountCents: 5700,
    users: 2,
    whatsapp: 1,
    instagram: 0,
    funnels: 3,
    groupAutomation: false,
  },
  {
    code: 'pro',
    name: 'Pro',
    amountCents: 9700,
    users: 5,
    whatsapp: 2,
    instagram: 2,
    funnels: 7,
    groupAutomation: true,
  },
  {
    code: 'unlimited',
    name: 'Ilimitado',
    amountCents: 19700,
    users: null,
    whatsapp: null,
    instagram: null,
    funnels: null,
    groupAutomation: true,
  },
] as const;

export function formatPlanLimit(value: number | null): string {
  return value === null
    ? 'Ilimitados'
    : value === 0
      ? 'Disponível a partir do Pro'
      : String(value);
}
