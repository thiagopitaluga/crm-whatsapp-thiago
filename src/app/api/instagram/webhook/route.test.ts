import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: vi.fn(() => {
    throw new Error('Unexpected database access');
  }),
}));
import { GET, POST } from './route';

describe('Instagram webhook verification', () => {
  beforeEach(() => {
    process.env.INSTAGRAM_APP_SECRET = 'test-secret';
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = 'verify-secret';
  });
  it('only returns a challenge for the configured verification token', async () => {
    const ok = await GET(
      new Request(
        'https://example.test/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=abc'
      )
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('abc');
    const invalid = await GET(
      new Request(
        'https://example.test/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc'
      )
    );
    expect(invalid.status).toBe(403);
  });
  it('rejects unsigned and altered payloads before accessing the database', async () => {
    const body = '{"object":"instagram"}';
    const sig = createHmac('sha256', 'test-secret').update(body).digest('hex');
    const result = await POST(
      new Request('https://example.test/api/instagram/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=' + sig },
        body: body + ' ',
      })
    );
    expect(result.status).toBe(401);
  });
  it('accepts a correctly signed unrelated event without processing it', async () => {
    const body = '{"object":"other"}';
    const signature = createHmac('sha256', 'test-secret')
      .update(body)
      .digest('hex');
    const result = await POST(
      new Request('https://example.test/api/instagram/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=' + signature },
        body,
      })
    );
    expect(result.status).toBe(200);
  });
  it('rejects signed JSON null safely', async () => {
    const body = 'null';
    const signature = createHmac('sha256', 'test-secret')
      .update(body)
      .digest('hex');
    const result = await POST(
      new Request('https://example.test/api/instagram/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=' + signature },
        body,
      })
    );
    expect(result.status).toBe(400);
  });
});
