import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRole, fetchQrConnector, upsert } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  fetchQrConnector: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: () => new Response('error', { status: 500 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { send: {} },
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/whatsapp/qr-connector', () => ({ fetchQrConnector }));
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ from: () => ({ upsert }) }),
}));

import { POST } from './route';

const groupJid = '123456@g.us';
function request(body: unknown) {
  return new Request(
    'https://organizap.tpxdigital.com/api/whatsapp/groups/send',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }
  );
}

describe('group inbox send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { group_jid: groupJid }, error: null });
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    requireRole.mockResolvedValue({
      accountId: 'account-1',
      userId: 'user-1',
      supabase: { from: () => query },
    });
    fetchQrConnector.mockResolvedValue(
      Response.json({ results: [{ status: 'sent', message_id: 'provider-1' }] })
    );
    upsert.mockResolvedValue({ error: null });
  });

  it('rejects an invalid group and never contacts the provider', async () => {
    const response = await POST(
      request({ groupJid: 'not-a-group', text: 'Olá' })
    );
    expect(response.status).toBe(400);
    expect(fetchQrConnector).not.toHaveBeenCalled();
  });

  it('sends only to the verified group and stores the provider id once', async () => {
    const response = await POST(request({ groupJid, text: 'Olá grupo' }));
    expect(response.status).toBe(200);
    expect(fetchQrConnector).toHaveBeenCalledWith(
      'account-1',
      'groups/send',
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'text',
          text: 'Olá grupo',
          group_ids: [groupJid],
        }),
      })
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        group_jid: groupJid,
        message_id: 'provider-1',
        from_me: true,
      }),
      expect.objectContaining({ ignoreDuplicates: true })
    );
  });
});
