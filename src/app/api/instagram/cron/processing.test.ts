vi.mock('@/lib/billing/server-access', () => ({
  serviceEnabled: vi.fn(async () => true),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  status: 'pending',
  profileAccount: 'account-a',
  sentCalls: 0,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token' }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      let update: Record<string, unknown> | undefined;
      const filters: Record<string, string> = {};
      const row = {
        id: 'job',
        account_id: 'account-a',
        channel_id: 'channel',
        conversation_id: 'conversation',
        automation_id: 'rule',
        recipient_id: '12345',
        reply_text: 'Olá',
      };
      const exec = () => {
        if (table === 'instagram_automation_runs') {
          if (update) {
            if (
              filters.account_id !== 'account-a' ||
              filters.status !== state.status
            )
              return { data: null, error: null };
            if (update.status) state.status = String(update.status);
            return { data: { id: 'job' }, error: null };
          }
          return { data: state.status === 'pending' ? [row] : [], error: null };
        }
        if (table === 'instagram_automations')
          return {
            data:
              filters.account_id === 'account-a' ? { is_active: true } : null,
            error: null,
          };
        if (table === 'instagram_channels')
          return {
            data:
              filters.account_id === state.profileAccount
                ? { instagram_id: '12345', access_token_encrypted: 'encrypted' }
                : null,
            error: null,
          };
        if (table === 'instagram_messages') return { data: null, error: null };
        throw new Error('Tabela inesperada');
      };
      const q = {
        select: () => q,
        update: (v: Record<string, unknown>) => {
          update = v;
          return q;
        },
        upsert: () => q,
        eq: (k: string, v: string) => {
          filters[k] = v;
          return q;
        },
        lt: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => exec(),
        then: (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown
        ) => Promise.resolve().then(exec).then(resolve, reject),
      };
      return q;
    },
  }),
}));
import { GET } from './route';
const request = () =>
  new Request('https://example.test/api/instagram/cron', {
    headers: { authorization: 'Bearer test-secret' },
  });
describe('Instagram automation processing', () => {
  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 'test-secret';
    process.env.INSTAGRAM_AUTOMATION_ENABLED = 'true';
    state.status = 'pending';
    state.profileAccount = 'account-a';
    state.sentCalls = 0;
    vi.restoreAllMocks();
  });
  it('does not resend a message when delivery is uncertain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        state.sentCalls++;
        throw new Error('timeout');
      })
    );
    expect((await GET(request())).status).toBe(200);
    expect(state.status).toBe('uncertain');
    expect((await GET(request())).status).toBe(200);
    expect(state.sentCalls).toBe(1);
    vi.unstubAllGlobals();
  });
  it('does not send using a channel belonging to another account', async () => {
    state.profileAccount = 'account-b';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        state.sentCalls++;
        return new Response('{}');
      })
    );
    expect((await GET(request())).status).toBe(200);
    expect(state.status).toBe('failed');
    expect(state.sentCalls).toBe(0);
    vi.unstubAllGlobals();
  });
});
