import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  requireRole: vi.fn(), createClient: vi.fn(), from: vi.fn(), rpc: vi.fn(),
  list: vi.fn(), sync: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: m.requireRole,
  UnauthorizedError: class UnauthorizedError extends Error { readonly status = 401; },
  ForbiddenError: class ForbiddenError extends Error { readonly status = 403; },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: m.createClient }));
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: () => 'encrypted-token', decrypt: () => 'private-token' }));
vi.mock('@/lib/meta-ads/graph-client', () => ({
  MetaGraphReadClient: class { list = m.list; },
}));
vi.mock('@/lib/meta-ads/sync', () => ({ syncMetaAdsRange: m.sync }));
import { GET, POST } from '@/app/api/meta-ads/connect/[action]/route';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';

const origin = 'https://organizap.tpxdigital.com';
const cookieName = '__Host-meta_ads_oauth';
const state = 'a'.repeat(64);
function makeQuery() {
  const q = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), lt: vi.fn(), delete: vi.fn(),
    update: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn() };
  for (const method of [q.select, q.eq, q.gt, q.lt, q.delete, q.update]) method.mockReturnValue(q);
  q.insert.mockResolvedValue({ error: null });
  return q;
}
let query: ReturnType<typeof makeQuery>;
const pending = { account_id: 'tenant-a', user_id: 'admin-a', access_token_encrypted: 'encrypted-token',
  meta_user_id: '123456789', token_expires_at: '2099-01-01T00:00:00Z' };
function post(action: string, body: unknown, requestOrigin = origin) {
  return new NextRequest(origin + '/api/meta-ads/connect/' + action, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', cookie: cookieName + '=' + state },
    body: JSON.stringify(body),
  });
}
function callback(value = state, cookie = state) {
  return new NextRequest(origin + '/api/meta-ads/connect/callback?state=' + value + '&code=secret-code',
    { headers: { cookie: cookieName + '=' + cookie } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('META_APP_ID', '1551127302916222');
  vi.stubEnv('META_APP_SECRET', 'private-app-secret');
  vi.stubEnv('ENCRYPTION_KEY', '1'.repeat(64));
  vi.stubEnv('META_ADS_REDIRECT_URI', origin + '/api/meta-ads/connect/callback');
  query = makeQuery();
  m.createClient.mockReturnValue({ from: m.from, rpc: m.rpc });
  m.from.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: pending, error: null });
  m.requireRole.mockResolvedValue({ accountId: 'tenant-a', userId: 'admin-a', role: 'admin' });
  m.rpc.mockResolvedValue({ error: null });
  vi.stubGlobal('fetch', m.fetch);
});

describe('Meta Ads connection authorization boundaries', () => {
  it('rejects cross-origin mutations before authenticating or touching the database', async () => {
    const response = await POST(post('select', { adAccountId: '12345678' }, 'https://attacker.example'));
    expect(response.status).toBe(403);
    expect(m.requireRole).not.toHaveBeenCalled();
    expect(m.createClient).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it('requires an authenticated administrator for mutation', async () => {
    m.requireRole.mockRejectedValue(new UnauthorizedError());
    expect((await POST(post('sync', { adAccountId: '12345678', days: 30 }))).status).toBe(401);
    expect(m.createClient).not.toHaveBeenCalled();
    expect(m.requireRole).toHaveBeenCalledWith('admin');
  });
  it('rejects a viewer attempting to link a connection', async () => {
    m.requireRole.mockRejectedValue(new ForbiddenError());
    expect((await POST(post('select', { adAccountId: '12345678' }))).status).toBe(403);
    expect(m.createClient).not.toHaveBeenCalled();
  });
  it('rejects callback state substitution without exchanging the code', async () => {
    const response = await GET(callback('b'.repeat(64)));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(origin + '/meta-ads?meta_connection=error');
    expect(m.createClient).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
    expect(response.headers.get('location')).not.toContain('secret-code');
  });
  it('rejects a callback without the browser-bound cookie', async () => {
    await GET(callback(state, ''));
    expect(m.createClient).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it('consumes only unexpired authorizations for the same tenant and user', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await GET(callback());
    expect(response.headers.get('location')).toContain('meta_connection=error');
    expect(query.delete).toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith('account_id', 'tenant-a');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'admin-a');
    expect(query.eq).toHaveBeenCalledWith('phase', 'authorizing');
    expect(query.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it('rejects client-supplied account IDs outside the authorized Meta account list', async () => {
    m.list.mockResolvedValueOnce([{ permission: 'ads_read', status: 'granted' }])
      .mockResolvedValueOnce([{ account_id: '12345678', name: 'Allowed account' }]);
    expect((await POST(post('select', { adAccountId: '99999999' }))).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith('account_id', 'tenant-a');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'admin-a');
  });
  it('does not link a token when ads_read was declined', async () => {
    m.list.mockResolvedValueOnce([{ permission: 'ads_read', status: 'declined' }]);
    expect((await POST(post('select', { adAccountId: '12345678' }))).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.list).toHaveBeenCalledTimes(1);
  });
  it('reports a tenant ownership conflict without exposing credentials', async () => {
    m.list.mockResolvedValueOnce([{ permission: 'ads_read', status: 'granted' }])
      .mockResolvedValueOnce([{ account_id: '12345678', name: 'Allowed account' }]);
    m.rpc.mockResolvedValue({ error: { code: '23505', message: 'internal credential detail' } });
    const response = await POST(post('select', { adAccountId: '12345678' }));
    expect(response.status).toBe(409);
    expect(m.rpc).toHaveBeenCalledWith('connect_meta_ads_account', expect.objectContaining({
      p_account_id: 'tenant-a', p_ad_account_id: '12345678', p_token: 'encrypted-token',
    }));
    expect(await response.text()).not.toMatch(/private-token|encrypted-token|internal credential detail/);
  });
  it('rejects an expired stored token before requesting metrics', async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: { id: 'integration-a', is_active: true }, error: null })
      .mockResolvedValueOnce({ data: { token_expires_at: '2000-01-01T00:00:00Z' }, error: null });
    const response = await POST(post('sync', { adAccountId: '12345678', days: 30 }));
    expect(response.status).toBe(401);
    expect(m.sync).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith('account_id', 'tenant-a');
  });
  it('rejects malformed account IDs without querying credentials', async () => {
    expect((await POST(post('sync', { adAccountId: '../another-tenant', days: 30 }))).status).toBe(400);
    expect(m.createClient).not.toHaveBeenCalled();
  });
});
