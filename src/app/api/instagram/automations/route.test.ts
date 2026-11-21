import { beforeEach, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  written: null as Record<string, unknown> | null,
  foreign: false,
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'tenant-a', role: 'owner' }),
  toErrorResponse: () => new Response(null, { status: 500 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let inserted: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const exec = () => {
        if (inserted) {
          state.written = inserted;
          return {
            data: { id: 'new', ...inserted, updated_at: '2026-11-21' },
            error: null,
          };
        }
        return {
          data: state.foreign ? null : { id: 'owned', account_id: 'tenant-a' },
          error: null,
        };
      };
      const q = {
        select: () => q,
        insert: (v: Record<string, unknown>) => {
          inserted = v;
          return q;
        },
        update: (v: Record<string, unknown>) => {
          state.written = v;
          return q;
        },
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        is: () => q,
        maybeSingle: async () => exec(),
        single: async () => exec(),
      };
      return q;
    },
  }),
}));
import { POST, PATCH } from './route';
const request = (body: unknown, origin = 'https://example.test') =>
  new Request('https://example.test/api/instagram/automations', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  state.written = null;
  state.foreign = false;
});
describe('Instagram visual editor tenant boundary', () => {
  it('rejects a foreign origin before writing any flow', async () => {
    expect(
      (await POST(request({ name: 'Fluxo' }, 'https://foreign.test'))).status
    ).toBe(403);
    expect(state.written).toBeNull();
  });
  it('cannot update a flow that is absent from the authenticated company', async () => {
    state.foreign = true;
    expect(
      (
        await PATCH(
          request({ id: '11111111-1111-4111-8111-111111111111', name: 'Troca' })
        )
      ).status
    ).toBe(404);
    expect(state.written).toBeNull();
  });
  it('saves drafts under the authenticated company, ignoring a supplied tenant and active status', async () => {
    const response = await POST(
      request({
        account_id: 'foreign',
        name: 'Fluxo',
        triggerType: 'first_message',
        replyText: 'Olá',
        status: 'active',
      })
    );
    expect(response.status).toBe(201);
    expect(state.written).toMatchObject({
      account_id: 'tenant-a',
      is_active: false,
    });
  });
});
