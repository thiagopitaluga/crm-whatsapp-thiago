import { createHmac, timingSafeEqual } from 'node:crypto';
import { isBillingDate, type BillingPlan } from './subscriptions';

const webhookIntegrityKey =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

export function abacateConfig(accountId?: string) {
  const key = process.env.ABACATEPAY_TEST_API_KEY?.trim();
  const secret = process.env.ABACATEPAY_TEST_WEBHOOK_SECRET?.trim();
  const pilot = process.env.ABACATEPAY_TEST_ACCOUNT_ID?.trim();
  const productId = process.env.ABACATEPAY_TEST_PRODUCT_ID?.trim();
  if (
    !key?.startsWith('abc_dev_') ||
    !secret ||
    secret.length < 32 ||
    !pilot ||
    (accountId && pilot !== accountId) ||
    !productId ||
    !/^prod_[\w-]+$/.test(productId)
  )
    return null;
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'https://organizap.tpxdigital.com';
  try {
    const returnUrl = new URL('/assinatura', origin);
    if (
      returnUrl.protocol !== 'https:' ||
      returnUrl.username ||
      returnUrl.password
    )
      return null;
    return { key, secret, pilot, productId, returnUrl };
  } catch {
    return null;
  }
}

export function sameValue(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyAbacateSignature(raw: Uint8Array, signature: string) {
  const expected = createHmac('sha256', webhookIntegrityKey)
    .update(raw)
    .digest('base64');
  return sameValue(signature, expected);
}

export class AbacateError extends Error {
  constructor(readonly status: number) {
    super('AbacatePay respondeu com erro ' + status);
  }
}

export async function abacateRequest(key: string, path: string, body?: object) {
  const response = await fetch('https://api.abacatepay.com/v2/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: 'Bearer ' + key,
      'content-type': 'application/json',
    },
    ...(body && { body: JSON.stringify(body) }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true || !payload.data)
    throw new AbacateError(response.status);
  return payload.data as Record<string, unknown>;
}

export function matchesAbacateProduct(
  product: Record<string, unknown>,
  productId: string,
  plan: BillingPlan
) {
  return (
    product.devMode === true &&
    product.id === productId &&
    product.status === 'ACTIVE' &&
    product.currency === 'BRL' &&
    product.price === plan.amount_cents &&
    product.cycle === (plan.interval === 'monthly' ? 'MONTHLY' : 'ANNUALLY')
  );
}

export function matchesAbacateCheckout(
  checkout: Record<string, unknown>,
  externalId: string,
  productId: string,
  cents: number
) {
  const items = checkout.items;
  return (
    checkout.devMode === true &&
    typeof checkout.id === 'string' &&
    /^bill_[\w-]+$/.test(checkout.id) &&
    checkout.externalId === externalId &&
    checkout.amount === cents &&
    Array.isArray(items) &&
    items.length === 1 &&
    items[0]?.id === productId &&
    items[0]?.quantity === 1
  );
}

export function abacateCheckoutUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://app.abacatepay.com' &&
      url.pathname.startsWith('/pay/') &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export const abacateSubscriptionEvents = new Set([
  'subscription.completed',
  'subscription.trial_started',
  'subscription.renewed',
  'subscription.payment_failed',
  'subscription.cancelled',
]);

export function abacateSubscriptionUpdate(
  event: string,
  snapshot: Record<string, unknown>,
  payment: { updatedAt?: unknown },
  subscription: { updatedAt?: unknown }
) {
  if (!abacateSubscriptionEvents.has(event)) return null;
  const eventTime = Math.max(
    ...[payment.updatedAt, subscription.updatedAt].map((value) =>
      typeof value === 'string' ? Date.parse(value) || 0 : 0
    )
  );
  if (!eventTime) return null;
  let status;
  if (snapshot.status === 'CANCELLED' || event === 'subscription.cancelled')
    status = 'canceled';
  else if (event === 'subscription.payment_failed') status = 'past_due';
  else if (event === 'subscription.trial_started') status = 'trialing';
  else if (snapshot.status === 'ACTIVE') status = 'active';
  else return null;
  const date =
    status === 'trialing' ? snapshot.trialEndsAt : snapshot.currentPeriodEnd;
  const periodEnd =
    typeof date === 'string' && isBillingDate(date.slice(0, 10))
      ? date.slice(0, 10)
      : null;
  return {
    status,
    event_at: new Date(eventTime).toISOString(),
    period_end: periodEnd,
  };
}
