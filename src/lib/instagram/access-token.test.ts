import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeInstagramToken,
  instagramAuthorizationToken,
} from './access-token';

afterEach(() => vi.unstubAllGlobals());
describe('Instagram Login token response', () => {
  it('accepts the data array documented by Meta and the older flat format', () => {
    expect(
      instagramAuthorizationToken({
        data: [
          {
            access_token: 'short-token',
            user_id: '123',
            permissions: 'instagram_business_basic',
          },
        ],
      })
    ).toBe('short-token');
    expect(instagramAuthorizationToken({ access_token: 'legacy-token' })).toBe(
      'legacy-token'
    );
  });
  it.each([
    null,
    {},
    { data: [] },
    { data: [null] },
    { data: [{ access_token: 42 }] },
    { access_token: '' },
    { error_type: 'OAuthException', access_token: 'invalid' },
  ])('rejects incomplete or rejected authorization %j', (payload) => {
    expect(instagramAuthorizationToken(payload)).toBeNull();
  });
});
describe('Instagram long-lived authorization', () => {
  it.each([
    { access_token: 'long-token', expires_in: '5184000' },
    { data: [{ access_token: 'long-token', expires_in: 5184000 }] },
  ])(
    'accepts valid expiration and token response variants',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(payload))
      );
      expect(
        (await exchangeInstagramToken('short', 'secret')).accessToken
      ).toBe('long-token');
    }
  );
  it.each([0, -1, 'invalid', '', null, 40000000])(
    'rejects an invalid lifetime %j',
    async (expires_in) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ access_token: 'token', expires_in }))
      );
      await expect(exchangeInstagramToken('short', 'secret')).rejects.toThrow(
        'autorização válida'
      );
    }
  );
  it('records error codes without logging tokens or the app secret', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            {
              error: {
                code: 190,
                error_subcode: 463,
                message: 'private-token private-secret',
              },
            },
            { status: 400 }
          )
        )
      );
      await expect(
        exchangeInstagramToken('private-token', 'private-secret')
      ).rejects.toThrow();
      const logs = JSON.stringify(warn.mock.calls);
      expect(logs).toContain('190');
      expect(logs).not.toContain('private-token');
      expect(logs).not.toContain('private-secret');
    } finally {
      warn.mockRestore();
    }
  });
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
