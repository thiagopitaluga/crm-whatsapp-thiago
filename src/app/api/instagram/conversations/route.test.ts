import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  accountId: 'account-a',
  contacts: new Map<string, string>(),
  conversations: new Map<string, { account: string; contact: string | null }>(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: state.accountId }),
  toErrorResponse: () =>
    Response.json({ error: 'Erro interno' }, { status: 500 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, string> = {};
      let update: { contact_id: string | null } | null = null;
      const query = {
        select: () => query,
        eq: (key: string, value: string) => {
          filters[key] = value;
          return query;
        },
        update: (value: { contact_id: string | null }) => {
          update = value;
          return query;
        },
        maybeSingle: async () => {
          if (table === 'contacts')
            return {
              data:
                state.contacts.get(filters.id) === filters.account_id
                  ? { id: filters.id }
                  : null,
              error: null,
            };
          const item = state.conversations.get(filters.id);
          if (!item || item.account !== filters.account_id)
            return { data: null, error: null };
          if (update) item.contact = update.contact_id;
          return {
            data: { id: filters.id, contact_id: item.contact },
            error: null,
          };
        },
      };
      return query;
    },
  }),
}));
import { PATCH } from './route';
const conversation = '11111111-1111-4111-8111-111111111111';
const ownContact = '22222222-2222-4222-8222-222222222222';
const otherContact = '33333333-3333-4333-8333-333333333333';
function request(contactId: string | null, origin = 'https://crm.test') {
  return new Request('https://crm.test/api/instagram/conversations', {
    method: 'PATCH',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: conversation, contactId }),
  });
}
describe('Instagram contact linking', () => {
  beforeEach(() => {
    state.accountId = 'account-a';
    state.contacts.clear();
    state.conversations.clear();
    state.contacts.set(ownContact, 'account-a');
    state.contacts.set(otherContact, 'account-b');
    state.conversations.set(conversation, {
      account: 'account-a',
      contact: null,
    });
  });
  it('links a contact belonging to the same account', async () => {
    expect((await PATCH(request(ownContact))).status).toBe(200);
    expect(state.conversations.get(conversation)?.contact).toBe(ownContact);
  });
  it('rejects contacts from a different account', async () => {
    expect((await PATCH(request(otherContact))).status).toBe(404);
    expect(state.conversations.get(conversation)?.contact).toBeNull();
  });
  it('cannot modify a conversation from another account', async () => {
    state.accountId = 'account-b';
    expect((await PATCH(request(otherContact))).status).toBe(404);
    expect(state.conversations.get(conversation)?.contact).toBeNull();
  });
  it('rejects requests from another origin', async () => {
    expect(
      (await PATCH(request(ownContact, 'https://other.test'))).status
    ).toBe(403);
  });
});
