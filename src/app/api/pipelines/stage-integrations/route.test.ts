import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), auth: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.auth,
  toErrorResponse: () => new Response('{}', { status: 500 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: () => 'encrypted',
  decrypt: () => 'secret-token',
}));
import { POST, PUT } from './route';

function query(data: unknown) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  for (const method of [
    'select',
    'eq',
    'maybeSingle',
    'not',
    'order',
    'limit',
    'upsert',
  ])
    chain[method] = vi.fn(() => chain);
  return chain;
}
const config = {
  wabaId: '123456789',
  datasetId: '987654321',
  channelKey: 'my-channel',
};
function request(body: unknown) {
  return new Request(
    'https://organizap.test/api/pipelines/stage-integrations',
    { method: 'PUT', body: JSON.stringify(body) }
  );
}
describe('WhatsApp conversion configuration API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    mocks.auth.mockResolvedValue({ accountId: 'tenant' });
  });
  it('requires administrator access', async () => {
    mocks.auth.mockRejectedValue(new Error('Forbidden'));
    expect((await PUT(request({}))).status).toBe(500);
    expect(mocks.auth).toHaveBeenCalledWith('admin');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects a channel belonging to a different tenant', async () => {
    mocks.from
      .mockReturnValueOnce(query({ access_token_encrypted: 'saved' }))
      .mockReturnValueOnce(query(null));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await PUT(
      request({ pixelId: '123456', token: '', whatsappConversion: config })
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not save a dataset unrelated to the selected WABA', async () => {
    mocks.from
      .mockReturnValueOnce(query({ access_token_encrypted: 'saved' }))
      .mockReturnValueOnce(query({ id: 'channel' }));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ id: 'wrong-dataset' }),
        })
    );
    const response = await PUT(
      request({ pixelId: '123456', token: '', whatsappConversion: config })
    );
    expect(response.status).toBe(400);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
  it('saves only after Meta confirms the dataset', async () => {
    const saved = query(null);
    mocks.from
      .mockReturnValueOnce(query({ access_token_encrypted: 'saved' }))
      .mockReturnValueOnce(query({ id: 'channel' }))
      .mockReturnValueOnce(saved);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ id: config.datasetId }),
        })
    );
    expect(
      (
        await PUT(
          request({ pixelId: '123456', token: '', whatsappConversion: config })
        )
      ).status
    ).toBe(200);
    expect(saved.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'tenant',
        whatsapp_conversion: config,
        access_token_encrypted: 'saved',
      })
    );
  });
  it('does not send a test event without the explicit Meta test code', async () => {
    expect((await POST(request({ whatsapp: true }))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not invent a click when testing a WhatsApp without referrals', async () => {
    mocks.from
      .mockReturnValueOnce(
        query({ access_token_encrypted: 'saved', whatsapp_conversion: config })
      )
      .mockReturnValueOnce(query(null));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(
      (await POST(request({ whatsapp: true, testCode: 'TEST12345' }))).status
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
