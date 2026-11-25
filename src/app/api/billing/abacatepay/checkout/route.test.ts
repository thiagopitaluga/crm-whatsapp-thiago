import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.role,
  toErrorResponse: () => new Response(null, { status: 500 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: mocks.admin,
}));

import { POST } from './route';

const plan = { id: 'plan-1', interval: 'monthly', amount_cents: 19990 };
const id = 'e77fdcb2-5183-4ad8-a305-c369caa9c57b';
const attempt = {
  id,
  plan_id: plan.id,
  product_id: 'prod_pilot',
  status: 'pending',
};
const product = {
  id: 'prod_pilot',
  devMode: true,
  status: 'ACTIVE',
  currency: 'BRL',
  price: 19990,
  cycle: 'MONTHLY',
};
const checkout = {
  id: 'bill_pilot',
  devMode: true,
  externalId: id,
  url: 'https://app.abacatepay.com/pay/bill_pilot',
  items: [{ id: 'prod_pilot', quantity: 1 }],
  amount: 19990,
  status: 'PENDING',
};
const request = (origin = 'https://organizap.example.com') =>
  new Request(origin + '/api/billing/abacatepay/checkout', {
    method: 'POST',
    headers: { origin },
  });

beforeEach(() => {
  vi.stubEnv('ABACATEPAY_TEST_API_KEY', 'abc_dev_test');
  vi.stubEnv('ABACATEPAY_TEST_WEBHOOK_SECRET', 's'.repeat(32));
  vi.stubEnv('ABACATEPAY_TEST_ACCOUNT_ID', 'company-1');
  vi.stubEnv('ABACATEPAY_TEST_PRODUCT_ID', 'prod_pilot');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://organizap.example.com');
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: { plan_id: plan.id } }),
    single: async () => ({ data: plan }),
  };
  mocks.role.mockResolvedValue({
    accountId: 'company-1',
    supabase: { from: () => query },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('checks owner, validates product and uses the stored attempt to recover a repeated click', async () => {
  const reservation = vi
    .fn()
    .mockResolvedValueOnce({ data: attempt })
    .mockResolvedValueOnce({ data: null, error: { code: '23505' } });
  const builder = {
    insert: () => ({ select: () => ({ single: reservation }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: attempt }) }) }),
    update: () => ({ eq: () => ({ or: async () => ({ error: null }) }) }),
  };
  mocks.admin.mockReturnValue({ from: () => builder });
  const provider = vi.fn(async (url: string) =>
    Response.json({
      success: true,
      data: url.includes('/products/get') ? product : checkout,
    })
  );
  vi.stubGlobal('fetch', provider);

  expect(await (await POST(request())).json()).toEqual({ url: checkout.url });
  expect(await (await POST(request())).json()).toEqual({ url: checkout.url });
  expect(mocks.role).toHaveBeenCalledWith('owner');
  const calls = provider.mock.calls.map(([url]) => url);
  expect(
    calls.filter((url) => url.endsWith('/subscriptions/create'))
  ).toHaveLength(1);
  expect(calls.at(-1)).toContain('checkouts/get?externalId=' + id);
});

it('rejects cross-origin checkout before contacting the provider', async () => {
  const provider = vi.fn();
  vi.stubGlobal('fetch', provider);
  expect((await POST(request('https://other.example.com'))).status).toBe(403);
  expect(provider).not.toHaveBeenCalled();
});
