import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token' }));
import { InstagramReadApi, readInstagramInsights } from './read-api';

afterEach(() => vi.unstubAllGlobals());
describe('Instagram reads', () => {
  it('paginates with cursors without forwarding tokens from paging URLs', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: '1' }],
          paging: {
            next: 'https://untrusted.test/?access_token=private',
            cursors: { after: 'next' },
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ data: [{ id: '2' }] }));
    vi.stubGlobal('fetch', transport);
    expect(
      await new InstagramReadApi('secret').list('123/conversations')
    ).toEqual([{ id: '1' }, { id: '2' }]);
    expect(transport.mock.calls[1][0].hostname).toBe('graph.instagram.com');
    expect(transport.mock.calls[1][0].searchParams.get('after')).toBe('next');
    expect(transport.mock.calls[1][0].searchParams.has('access_token')).toBe(
      false
    );
  });
  it('preserves unavailable metrics as null and computes growth from follows minus unfollows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        const metric = url.searchParams.get('metric');
        if (!metric)
          return Response.json({ username: 'test', followers_count: 123 });
        if (metric === 'views')
          return Response.json({ error: { code: 200 } }, { status: 403 });
        if (metric === 'follows_and_unfollows')
          return Response.json({
            data: [
              {
                total_value: {
                  breakdowns: [
                    {
                      results: [
                        { dimension_values: ['FOLLOW'], value: 12 },
                        { dimension_values: ['UNFOLLOW'], value: 4 },
                      ],
                    },
                  ],
                },
              },
            ],
          });
        return Response.json({
          data: [{ total_value: { value: metric === 'reach' ? 100 : 10 } }],
        });
      })
    );
    const result = await readInstagramInsights(
      {
        id: 'channel',
        account_id: 'tenant',
        instagram_id: '123',
        username: 'test',
        access_token_encrypted: 'encrypted',
      },
      7
    );
    expect(result.netGrowth).toBe(8);
    expect(result.engagementRate).toBe(10);
    expect(result.metrics.views).toBeNull();
    expect(result.unavailable).toContain('views');
  });
});
