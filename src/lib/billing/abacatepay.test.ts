import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abacateCheckoutUrl,
  abacateConfig,
  abacateSubscriptionUpdate,
  matchesAbacateCheckout,
  matchesAbacateProduct,
} from './abacatepay';

const plan = {
  id: 'plan',
  name: 'Plano',
  interval: 'monthly',
  amount_cents: 19990,
} as const;

describe('AbacatePay pilot', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('restricts checkout to the pilot account and refuses a production API key', () => {
    vi.stubEnv('ABACATEPAY_TEST_API_KEY', 'abc_dev_test');
    vi.stubEnv('ABACATEPAY_TEST_WEBHOOK_SECRET', 's'.repeat(32));
    vi.stubEnv('ABACATEPAY_TEST_ACCOUNT_ID', 'company-1');
    vi.stubEnv('ABACATEPAY_TEST_PRODUCT_ID', 'prod_test');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://organizap.example.com');
    expect(abacateConfig('company-1')?.productId).toBe('prod_test');
    expect(abacateConfig('company-2')).toBeNull();
    vi.stubEnv('ABACATEPAY_TEST_API_KEY', 'abc_prod_test');
    expect(abacateConfig('company-1')).toBeNull();
  });

  it('only accepts the assigned sandbox product, exact price, and recurring cycle', () => {
    const product = {
      devMode: true,
      id: 'prod_test',
      status: 'ACTIVE',
      currency: 'BRL',
      price: 19990,
      cycle: 'MONTHLY',
    };
    expect(matchesAbacateProduct(product, 'prod_test', plan)).toBe(true);
    for (const override of [
      { devMode: false },
      { cycle: 'ANNUALLY' },
      { price: 1999 },
      { currency: 'USD' },
    ])
      expect(
        matchesAbacateProduct({ ...product, ...override }, 'prod_test', plan)
      ).toBe(false);
  });

  it('checks checkout identity and only redirects to the hosted payment page', () => {
    const checkout = {
      id: 'bill_test',
      devMode: true,
      externalId: 'created-here',
      items: [{ id: 'prod_test', quantity: 1 }],
      amount: 19990,
    };
    expect(
      matchesAbacateCheckout(checkout, 'created-here', 'prod_test', 19990)
    ).toBe(true);
    expect(
      matchesAbacateCheckout(checkout, 'another-company', 'prod_test', 19990)
    ).toBe(false);
    expect(abacateCheckoutUrl('https://app.abacatepay.com/pay/bill_test')).toBe(
      'https://app.abacatepay.com/pay/bill_test'
    );
    expect(
      abacateCheckoutUrl('https://app.abacatepay.com.example.com/pay/bill_test')
    ).toBeNull();
  });

  it('uses the provider payment time to order renewals and failure events', () => {
    const snapshot = {
      status: 'ACTIVE',
      currentPeriodEnd: '2026-12-25T19:00:00Z',
    };
    const payment = { updatedAt: '2026-11-25T19:00:00Z' };
    const subscription = { updatedAt: '2026-11-25T18:55:00Z' };
    expect(
      abacateSubscriptionUpdate(
        'subscription.renewed',
        snapshot,
        payment,
        subscription
      )
    ).toEqual({
      status: 'active',
      event_at: '2026-11-25T19:00:00.000Z',
      period_end: '2026-12-25',
    });
    expect(
      abacateSubscriptionUpdate(
        'subscription.payment_failed',
        snapshot,
        payment,
        subscription
      )?.status
    ).toBe('past_due');
    expect(
      abacateSubscriptionUpdate(
        'subscription.payment_failed',
        { ...snapshot, status: 'CANCELLED' },
        payment,
        subscription
      )?.status
    ).toBe('canceled');
  });
});
