import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  accountId: '12345678-1234-1234-1234-123456789abc',
}));
vi.mock('@/lib/leads/ingest', () => ({
  ingestExternalWhatsAppMessage: mocks.ingest,
}));
vi.mock('@/lib/whatsapp/qr-connector', () => ({
  isValidQrConnectorSecret: () => true,
}));
vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: async () => ({ accountId: mocks.accountId, supabase: {} }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: mocks.accountId } }),
        }),
      }),
    }),
  }),
}));

import { POST as internalPost } from '@/app/api/internal/qr-ingest/route';
import { POST as publicPost } from '@/app/api/v1/ingest/whatsapp/route';

for (const [name, post] of [
  ['internal', internalPost],
  ['API-key', publicPost],
] as const) {
  it(`${name} refuses phone-only and preview-only creation through the real route`, async () => {
    for (const payload of [
      {},
      { last_message_preview: '[Mensagem]' },
      { last_message_preview: 'Olá' },
    ]) {
      const response = await post(
        new Request('https://crm.example/api/ingest', {
          method: 'POST',
          body: JSON.stringify({
            account_id: mocks.accountId,
            phone: '5511999999999',
            ...payload,
          }),
        })
      );
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain(
        'message_required'
      );
    }
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it(`${name} forwards the provider timestamp to the guarded ingestion service`, async () => {
    mocks.ingest.mockResolvedValueOnce(null);
    const timestamp = '2020-01-01T00:00:00Z';
    const response = await post(
      new Request('https://crm.example/api/ingest', {
        method: 'POST',
        body: JSON.stringify({
          account_id: mocks.accountId,
          phone: '5511999999999',
          message_id: 'id',
          content_text: 'Oi',
          content_type: 'text',
          message_created_at: timestamp,
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.ingest).toHaveBeenCalledWith(
      expect.anything(),
      mocks.accountId,
      expect.objectContaining({ createdAt: timestamp })
    );
  });
}
