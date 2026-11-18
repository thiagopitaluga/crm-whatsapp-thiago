import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'tenant-secret' }));
import { enrichConnectedMetaAttribution } from './connected-meta';

function database(options: { cached?: boolean; graphAccount?: string } = {}) {
  const operations: { table: string; filters: Record<string, unknown>; update?: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const op: { table: string; filters: Record<string, unknown>; update?: Record<string, unknown> } = { table, filters: {} };
      operations.push(op);
      const result = () => {
        if (table === 'meta_ad_account_integrations') return { data: [{ id: 'integration-1', meta_ad_account_id: '123456' }], error: null };
        if (table === 'meta_ads_credentials') return { data: { access_token_encrypted: 'encrypted', token_expires_at: '2099-01-01T00:00:00Z' }, error: null };
        if (table === 'meta_ads_entities' && op.filters.entity_type === 'ad') return { data: options.cached ? { name: 'Anúncio A', campaign_id: '345678', adset_id: '234567' } : null, error: null };
        if (table === 'meta_ads_entities') return { data: [{ entity_type: 'campaign', meta_entity_id: '345678', name: 'Campanha A' }, { entity_type: 'adset', meta_entity_id: '234567', name: 'Conjunto A' }], error: null };
        return { data: null, error: null };
      };
      const chain = {
        select: () => chain,
        update: (value: Record<string, unknown>) => { op.update = value; return chain; },
        eq: (key: string, value: unknown) => { op.filters[key] = value; return chain; },
        in: (key: string, value: unknown) => { op.filters[key] = value; return Promise.resolve(result()); },
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return chain;
    },
  };
  return { db, operations };
}

describe('atribuição pela conta Meta conectada', () => {
  it('resolve campanha e conjunto pelo cache restrito à conta e atualiza a conversa e o ponto de contato', async () => {
    const { db, operations } = database({ cached: true });
    await expect(enrichConnectedMetaAttribution(db as never, 'tenant-a', 'conv-1', '456789')).resolves.toBe(true);
    const queries = operations.filter((op) => op.table === 'meta_ads_entities');
    expect(queries.every((op) => op.filters.account_id === 'tenant-a' && op.filters.meta_ad_account_id === '123456')).toBe(true);
    expect(operations.find((op) => op.table === 'attribution_touchpoints')?.update).toMatchObject({ campaign_name: 'Campanha A', ad_group_name: 'Conjunto A', ad_name: 'Anúncio A' });
  });
  it('não atribui um anúncio de outra conta Meta mesmo com resposta da API', async () => {
    const { db, operations } = database();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: '456789', account_id: '999999', name: 'Outro cliente' }) } as Response);
    try {
      await expect(enrichConnectedMetaAttribution(db as never, 'tenant-a', 'conv-1', '456789')).resolves.toBe(false);
      expect(operations.some((op) => op.table === 'conversation_attributions')).toBe(false);
      expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer tenant-secret' });
    } finally { fetchMock.mockRestore(); }
  });
});
