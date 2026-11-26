vi.mock('@/lib/billing/server-access', () => ({
  serviceEnabled: vi.fn(async () => true),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: vi.fn(() => {
    throw new Error('Banco não deveria ser acessado');
  }),
}));
import { GET } from './route';
describe('Instagram job authorization', () => {
  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 'test-secret';
  });
  it('rejects requests without a secret before database access', async () => {
    expect(
      (await GET(new Request('https://example.test/api/instagram/cron'))).status
    ).toBe(401);
  });
  it('rejects a wrong secret of equal length', async () => {
    expect(
      (
        await GET(
          new Request('https://example.test/api/instagram/cron', {
            headers: { 'x-cron-secret': 'wrong-secret' },
          })
        )
      ).status
    ).toBe(401);
  });
});
