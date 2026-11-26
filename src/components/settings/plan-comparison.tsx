import Link from 'next/link';
import { commercialPlans, formatPlanLimit } from '@/lib/billing/catalog';
import { formatBillingAmount } from '@/lib/billing/subscriptions';

export function PlanComparison({
  commercial = false,
}: {
  commercial?: boolean;
}) {
  return (
    <section className="space-y-4" aria-labelledby="commercial-plans">
      <h2
        id="commercial-plans"
        className={commercial ? 'sr-only' : 'text-lg font-semibold'}
      >
        Planos do Organizap
      </h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {commercialPlans.map((plan) => (
          <article
            key={plan.code}
            className={`${commercial ? 'bg-white text-[#24301d]' : 'bg-card'} space-y-4 rounded-xl border p-5 ${plan.code === 'pro' ? 'border-primary' : ''}`}
          >
            <h3 className="font-semibold">{plan.name}</h3>
            {commercial && plan.code === 'pro' && (
              <p className="text-xs font-semibold text-[#607c38]">
                PARA EQUIPES EM CRESCIMENTO
              </p>
            )}
            <p>
              <strong className="text-2xl">
                {formatBillingAmount(plan.amountCents)}
              </strong>
              <span
                className={
                  commercial
                    ? 'text-sm text-[#66705d]'
                    : 'text-muted-foreground text-sm'
                }
              >
                {' '}
                /mês por empresa
              </span>
            </p>
            <dl className="space-y-3 text-sm">
              {[
                ['Usuários', formatPlanLimit(plan.users)],
                ['Números de WhatsApp', formatPlanLimit(plan.whatsapp)],
                ['Perfis de Instagram', formatPlanLimit(plan.instagram)],
                ['Funis', formatPlanLimit(plan.funnels)],
                [
                  'Automação de grupos',
                  plan.groupAutomation
                    ? 'Incluída'
                    : 'Disponível a partir do Pro',
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt
                    className={
                      commercial ? 'text-[#66705d]' : 'text-muted-foreground'
                    }
                  >
                    {label}
                  </dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
            <p
              className={
                commercial
                  ? 'text-sm text-[#66705d]'
                  : 'text-muted-foreground text-sm'
              }
            >
              Contatos, negócios, tarefas, notas e demais recursos do plano
              ilimitados.
            </p>
            {commercial && (
              <Link
                href="/signup"
                className="flex items-center justify-center rounded-lg bg-[#c6f07a] px-4 py-3 font-semibold text-[#24301d] hover:bg-[#b5e360]"
              >
                Criar minha conta
              </Link>
            )}
          </article>
        ))}
      </div>
      <p
        className={
          commercial
            ? 'text-sm text-[#66705d]'
            : 'text-muted-foreground text-sm'
        }
      >
        Agentes de IA usam a chave de API da sua empresa. O provedor cobra o
        consumo diretamente na sua conta. Tarifas de serviços externos são
        cobradas à parte, quando aplicáveis.
      </p>
    </section>
  );
}
