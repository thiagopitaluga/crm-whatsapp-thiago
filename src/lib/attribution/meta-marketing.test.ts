import { describe, expect, it, vi } from 'vitest';

// Next aliases this marker to an empty module for server builds. Vitest runs
// directly in Node, so it needs the equivalent harmless marker explicitly.
vi.mock('server-only', () => ({}));

import { resolveMetaMarketingAttribution } from './meta-marketing';

function dbFor(
  options: {
    integration?: { meta_ad_account_id: string } | null;
    integrationError?: { message: string } | null;
    updateError?: { message: string } | null;
  } = {}
) {
  const updates: {
    row: Record<string, unknown>;
    filters: [string, unknown][];
  }[] = [];
  const integration = Object.hasOwn(options, 'integration')
    ? options.integration
    : { meta_ad_account_id: '23845963072290549' };

  return {
    updates,
    from(table: string) {
      if (table === 'meta_ad_account_integrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: integration,
                      error: options.integrationError ?? null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'conversation_attributions') {
        const filters: [string, unknown][] = [];
        const updateQuery = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            if (filters.length === 3) {
              updates.push({ row: {}, filters });
              return Promise.resolve({ error: options.updateError ?? null });
            }
            return updateQuery;
          },
        };
        return {
          update: (row: Record<string, unknown>) => {
            updateQuery.eq = (column: string, value: unknown) => {
              filters.push([column, value]);
              if (filters.length === 3) {
                updates.push({ row, filters });
                return Promise.resolve({ error: options.updateError ?? null });
              }
              return updateQuery;
            };
            return updateQuery;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const resolvedAd = {
  id: '987654321012345',
  account_id: '23845963072290549',
  name: 'Anúncio Lotes Setembro',
  adset: {
    id: '987654321012346',
    name: 'Conjunto Interesses',
    campaign: { id: '987654321012347', name: 'Campanha Captação' },
  },
};

describe('resolveMetaMarketingAttribution', () => {
  it('enriches only a CTWA ad owned by the tenant-scoped integration', async () => {
    vi.stubEnv('META_MARKETING_ACCESS_TOKEN', 'secret-is-never-in-a-url');
    const db = dbFor();
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/987654321012345?fields=');
      expect(url).not.toContain('secret-is-never-in-a-url');
      expect(init?.headers).toEqual({
        Authorization: 'Bearer secret-is-never-in-a-url',
      });
      return { ok: true, status: 200, json: async () => resolvedAd };
    });

    await expect(
      resolveMetaMarketingAttribution({
        db: db as never,
        accountId: 'morgana-crm-account',
        conversationId: 'conversation-1',
        sourceId: '987654321012345',
        fetchFn,
      })
    ).resolves.toMatchObject({
      status: 'resolved',
      campaignName: 'Campanha Captação',
      adsetName: 'Conjunto Interesses',
      adName: 'Anúncio Lotes Setembro',
    });

    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      row: {
        meta_ad_account_id: '23845963072290549',
        meta_campaign_name: 'Campanha Captação',
        meta_adset_name: 'Conjunto Interesses',
        meta_ad_name: 'Anúncio Lotes Setembro',
      },
      filters: [
        ['account_id', 'morgana-crm-account'],
        ['conversation_id', 'conversation-1'],
        ['provider', 'meta'],
      ],
    });
  });

  it('does not call Meta or write attribution when no active tenant mapping exists', async () => {
    vi.stubEnv('META_MARKETING_ACCESS_TOKEN', 'token');
    const db = dbFor({ integration: null });
    const fetchFn = vi.fn();

    await expect(
      resolveMetaMarketingAttribution({
        db: db as never,
        accountId: 'other-crm-account',
        conversationId: 'conversation-2',
        sourceId: '987654321012345',
        fetchFn,
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'no_active_integration' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });

  it('rejects an ad returned from another advertising account', async () => {
    vi.stubEnv('META_MARKETING_ACCESS_TOKEN', 'token');
    const db = dbFor();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...resolvedAd, account_id: '11111111111111111' }),
    }));

    await expect(
      resolveMetaMarketingAttribution({
        db: db as never,
        accountId: 'morgana-crm-account',
        conversationId: 'conversation-3',
        sourceId: '987654321012345',
        fetchFn,
      })
    ).resolves.toEqual({ status: 'source_account_mismatch' });
    expect(db.updates).toHaveLength(0);
  });
});
