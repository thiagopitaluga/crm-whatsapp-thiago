import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  abacateCheckoutUrl,
  abacateConfig,
  AbacateError,
  abacateRequest,
  matchesAbacateCheckout,
  matchesAbacateProduct,
} from '@/lib/billing/abacatepay';
import type { BillingPlan } from '@/lib/billing/subscriptions';

export const runtime = 'nodejs';

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  try {
    const { accountId, supabase } = await requireRole('owner');
    const config = abacateConfig(accountId);
    if (!config)
      return fail('Checkout em teste indisponível para esta empresa.', 404);
    if (request.headers.get('origin') !== config.returnUrl.origin) {
      return fail('Origem inválida.', 403);
    }
    const db = supabaseAdmin();
    const { data: subscription, error: subscriptionError } = await supabase
      .from('billing_subscriptions')
      .select('plan_id')
      .eq('account_id', accountId)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (!subscription)
      return fail(
        'Cadastre um plano para a empresa piloto antes de testar.',
        409
      );

    const { data: plan, error: planError } = await supabase
      .from('billing_plans')
      .select('id,name,interval,amount_cents')
      .eq('id', subscription.plan_id)
      .single();
    if (planError) throw planError;
    const product = await abacateRequest(
      config.key,
      'products/get?id=' + encodeURIComponent(config.productId)
    );
    if (
      !matchesAbacateProduct(product, config.productId, plan as BillingPlan)
    ) {
      return fail(
        'O produto de teste precisa ter o mesmo preço e ciclo do plano cadastrado em reais.',
        409
      );
    }

    const { data: reserved, error: reservationError } = await db
      .from('billing_abacatepay_tests')
      .insert({
        account_id: accountId,
        plan_id: plan.id,
        product_id: config.productId,
      })
      .select('id,plan_id,product_id,status')
      .single();
    if (reservationError && reservationError.code !== '23505')
      throw reservationError;
    const existing = reserved
      ? null
      : await db
          .from('billing_abacatepay_tests')
          .select('id,plan_id,product_id,status')
          .eq('account_id', accountId)
          .single();
    if (existing?.error) throw existing.error;
    const attempt = reserved ?? existing?.data;
    if (
      !attempt ||
      attempt.plan_id !== plan.id ||
      attempt.product_id !== config.productId ||
      attempt.status !== 'pending'
    ) {
      return fail(
        'A empresa já tem um checkout de teste registrado para este piloto.',
        409
      );
    }

    let checkout;
    if (reserved) {
      try {
        checkout = await abacateRequest(config.key, 'subscriptions/create', {
          items: [{ id: config.productId, quantity: 1 }],
          methods: ['CARD'],
          externalId: attempt.id,
          returnUrl: config.returnUrl.href,
          completionUrl: new URL('?checkout=retorno', config.returnUrl).href,
        });
      } catch (error) {
        // Release the reservation only for a definitive validation rejection.
        // Ambiguous outcomes are recovered via the provider's externalId lookup.
        if (
          error instanceof AbacateError &&
          [400, 401, 403, 422].includes(error.status)
        ) {
          await db
            .from('billing_abacatepay_tests')
            .delete()
            .eq('id', attempt.id)
            .is('checkout_id', null);
        }
        throw error;
      }
    } else {
      checkout = await abacateRequest(
        config.key,
        'subscriptions/checkouts/get?externalId=' + attempt.id
      );
    }

    const url = abacateCheckoutUrl(checkout.url);
    if (
      !matchesAbacateCheckout(
        checkout,
        attempt.id,
        config.productId,
        plan.amount_cents
      ) ||
      !url
    ) {
      return fail(
        'A AbacatePay retornou um checkout incompatível com este plano de teste.',
        502
      );
    }
    const { error: saveError } = await db
      .from('billing_abacatepay_tests')
      .update({ checkout_id: checkout.id })
      .eq('id', attempt.id)
      .or(`checkout_id.is.null,checkout_id.eq.${checkout.id}`);
    if (saveError) throw saveError;
    if (checkout.status === 'EXPIRED' || checkout.status === 'CANCELLED') {
      const { error } = await db
        .from('billing_abacatepay_tests')
        .update({ status: 'expired' })
        .eq('id', attempt.id)
        .eq('status', 'pending')
        .is('subscription_id', null);
      if (error) throw error;
    }
    if (checkout.status !== 'PENDING')
      return fail(
        'Este checkout já saiu da fase de pagamento. Consulte o status da assinatura de teste.',
        409
      );
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof AbacateError) {
      console.error('[abacatepay] checkout request failed', error.status);
      return fail(
        'O checkout de teste não está disponível. Confira a configuração ou tente novamente em instantes.',
        502
      );
    }
    return toErrorResponse(error);
  }
}
