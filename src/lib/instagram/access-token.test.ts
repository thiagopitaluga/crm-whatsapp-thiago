import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeInstagramToken } from './access-token';

afterEach(() => vi.unstubAllGlobals());
describe('Instagram long-lived authorization', () => {
  it('exchanges the temporary token and records the returned expiration', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ access_token: 'long-token', expires_in: 5184000 })
      );
    vi.stubGlobal('fetch', fetcher);
    const before = Date.now();
    const result = await exchangeInstagramToken('short-token', 'app-secret');
    const [url, options] = fetcher.mock.calls[0];
    expect(url.origin).toBe('https://graph.instagram.com');
    expect(url.searchParams.get('grant_type')).toBe('ig_exchange_token');
    expect(url.searchParams.get('client_secret')).toBe('app-secret');
    expect(options.cache).toBe('no-store');
    expect(result.accessToken).toBe('long-token');
    expect(Date.parse(result.expiresAt)).toBeGreaterThanOrEqual(
      before + 5184000000
    );
  });
  it('does not treat a rejected exchange as a connected profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: 'invalid' }, { status: 400 }))
    );
    await expect(exchangeInstagramToken('short', 'secret')).rejects.toThrow(
      'autorização válida'
    );
  });
  it('never leaks the credential-bearing URL on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new Error(
            'https://graph.instagram.com/access_token?client_secret=secret'
          )
        )
    );
    await expect(exchangeInstagramToken('short', 'secret')).rejects.toThrow(
      'Não foi possível prolongar'
    );
  });
});
