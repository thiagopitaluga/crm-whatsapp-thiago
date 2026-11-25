import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  abacateConfig,
  abacateRequest,
  abacateSubscriptionEvents,
  abacateSubscriptionUpdate,
  matchesAbacateCheckout,
  sameValue,
  verifyAbacateSignature,
} from '@/lib/billing/abacatepay';

export const runtime = 'nodejs';

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const accepted = () => NextResponse.json({ received: true });

export async function POST(request: Request) {
  const config = abacateConfig();
  if (!config) return new Response(null, { status: 404 });

  const secret =
    request.headers.get('x-webhook-secret') ??
    new URL(request.url).searchParams.get('webhookSecret') ??
    '';
  if (!sameValue(secret, config.secret))
    return new Response(null, { status: 401 });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > 256_000) return new Response(null, { status: 413 });
  if (
    !verifyAbacateSignature(
      raw,
      request.headers.get('x-webhook-signature') ?? ''
    )
  )
    return new Response(null, { status: 401 });
  let event;
  try {
    event = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (
    event?.apiVersion !== 2 ||
    event.devMode !== true ||
    !abacateSubscriptionEvents.has(event.event)
  )
    return accepted();

  const subscription = event.data?.subscription;
  const checkout = event.data?.checkout;
  const subscriptionId = subscription?.id;
  const checkoutId = checkout?.id;
  if (
    typeof subscriptionId !== 'string' ||
    !/^subs_[\w-]+$/.test(subscriptionId) ||
    typeof checkoutId !== 'string' ||
    !/^bill_[\w-]+$/.test(checkoutId)
  )
    return new Response(null, { status: 400 });

  try {
    const db = supabaseAdmin();
    const { data: attempt, error } = await db
      .from('billing_abacatepay_tests')
      .select('id,plan_id,product_id,checkout_id,subscription_id')
      .eq('account_id', config.pilot)
      .maybeSingle();
    if (error) throw error;
    if (!attempt) return accepted();
    const belongs =
      attempt.checkout_id === checkoutId ||
      (!attempt.checkout_id &&
        typeof checkout.externalId === 'string' &&
        uuid.test(checkout.externalId) &&
        checkout.externalId === attempt.id);
    if (
      !belongs ||
      (attempt.subscription_id && attempt.subscription_id !== subscriptionId)
    )
      return accepted();

    const snapshot = await abacateRequest(
      config.key,
      'subscriptions/get?id=' + encodeURIComponent(subscriptionId)
    );
    if (
      snapshot.devMode !== true ||
      snapshot.id !== subscriptionId ||
      snapshot.checkoutId !== checkoutId
    ) {
      return new Response(null, { status: 422 });
    }
    if (!attempt.checkout_id) {
      const [plan, providerCheckout] = await Promise.all([
        db
          .from('billing_plans')
          .select('amount_cents')
          .eq('id', attempt.plan_id)
          .single(),
        abacateRequest(
          config.key,
          'subscriptions/checkouts/get?id=' + encodeURIComponent(checkoutId)
        ),
      ]);
      if (plan.error) throw plan.error;
      if (
        !matchesAbacateCheckout(
          providerCheckout,
          attempt.id,
          attempt.product_id,
          plan.data.amount_cents
        )
      )
        return new Response(null, { status: 422 });
    }

    const update = abacateSubscriptionUpdate(
      event.event,
      snapshot,
      event.data?.payment ?? {},
      subscription
    );
    if (!update) return new Response(null, { status: 422 });
    const { error: writeError } = await db
      .from('billing_abacatepay_tests')
      .update({
        ...update,
        checkout_id: checkoutId,
        subscription_id: subscriptionId,
      })
      .eq('id', attempt.id)
      .lt('event_at', update.event_at)
      .neq('status', 'canceled');
    if (writeError) throw writeError;
    return accepted();
  } catch (error) {
    console.error('[abacatepay] webhook sync failed', error);
    return new Response(null, { status: 503 });
  }
}
