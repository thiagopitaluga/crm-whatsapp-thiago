import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { MetaGraphReadClient } from './graph-client';

describe('Meta Graph read client', () => {
  it('uses a server Authorization header and strips tokens from paging URLs', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: '123456' }],
          paging: {
            next: 'https://graph.facebook.com/v25.0/123456/leads?after=abc&access_token=secret',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '234567' }] }),
      });
    const client = new MetaGraphReadClient({
      accessToken: 'secret',
      version: 'v25.0',
      fetchFn,
    });
    expect(await client.formLeads('123456')).toHaveLength(2);
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer secret'
    );
    expect(fetchFn.mock.calls[1][0]).not.toContain('secret');
  });

  it('rejects a pagination URL outside the official Graph host', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [],
        paging: { next: 'https://example.com/steal' },
      }),
    });
    const client = new MetaGraphReadClient({
      accessToken: 'secret',
      version: 'v25.0',
      fetchFn,
    });
    await expect(client.formLeads('123456')).rejects.toThrow(
      'Unexpected Meta Graph pagination URL'
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

