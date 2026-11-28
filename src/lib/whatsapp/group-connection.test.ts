import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchQrConnector } from './qr-connector';

const state = vi.hoisted(() => ({
  channels: [] as { evolution_instance_name: string }[],
  filters: {} as Record<string, string>,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: (key: string, value: string) => {
          state.filters[key] = value;
          return key === 'provider'
            ? Promise.resolve({ data: state.channels, error: null })
            : query;
        },
      };
      return query;
    },
  }),
}));
const account = '2e859ae0-abfb-4d61-9d31-968b6bfad2e4';
const old = 'organizap' + account.replaceAll('-', '');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  state.filters = {};
});

describe('conexão de grupos após novo QR', () => {
  it('usa a conexão ativa cadastrada na mesma empresa quando a antiga fecha', async () => {
    vi.stubEnv('WHATSAPP_QR_PROVIDER', 'evolution');
    vi.stubEnv('EVOLUTION_API_URL', 'https://evolution.example.com');
    vi.stubEnv('EVOLUTION_API_KEY', 'test-key');
    state.channels = [
      { evolution_instance_name: old },
      { evolution_instance_name: old + 'new' },
    ];
    const fetchMock = vi.fn(async (url: URL) => {
      if (url.pathname.includes('/connectionState/'))
        return Response.json({
          instance: { state: url.pathname.endsWith('new') ? 'open' : 'close' },
        });
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchQrConnector(account, 'groups')).status).toBe(200);
    expect(state.filters).toEqual({
      account_id: account,
      provider: 'evolution',
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        url.pathname.includes('/group/fetchAllGroups/' + old + 'new')
      )
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        url.pathname.endsWith('/group/fetchAllGroups/' + old)
      )
    ).toBe(false);
  });
  it('bloqueia um disparo quando há duas conexões alternativas ativas', async () => {
    vi.stubEnv('WHATSAPP_QR_PROVIDER', 'evolution');
    vi.stubEnv('EVOLUTION_API_URL', 'https://evolution.example.com');
    vi.stubEnv('EVOLUTION_API_KEY', 'test-key');
    state.channels = [
      { evolution_instance_name: old + 'a' },
      { evolution_instance_name: old + 'b' },
    ];
    const fetchMock = vi.fn(async () =>
      Response.json({ instance: { state: 'open' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      (await fetchQrConnector(account, 'groups/send', { method: 'POST' }))
        .status
    ).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('identifica o administrador pelo phoneNumber quando o grupo usa LID', async () => {
    vi.stubEnv('WHATSAPP_QR_PROVIDER', 'evolution');
    vi.stubEnv('EVOLUTION_API_URL', 'https://evolution.example.com');
    vi.stubEnv('EVOLUTION_API_KEY', 'test-key');
    state.channels = [{ evolution_instance_name: old }];
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname.includes('/connectionState/'))
        return Response.json({ instance: { state: 'open' } });
      if (url.pathname.includes('/fetchInstances'))
        return Response.json([{ name: old, ownerJid: '5511999988889@s.whatsapp.net' }]);
      if (url.pathname.includes('/fetchAllGroups'))
        return Response.json([
          { id: '123@g.us', subject: 'Grupo admin', participants: [
            { id: '4925@lid', phoneNumber: '5511999988889@s.whatsapp.net', admin: 'admin' },
          ] },
          { id: '456@g.us', subject: 'Grupo não admin', participants: [
            { id: '4925@lid', phoneNumber: '5511999988889@s.whatsapp.net', admin: null },
          ] },
        ]);
      return Response.json([]);
    }));
    const response = await fetchQrConnector(account, 'groups');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.groups.map((group: { is_admin: boolean }) => group.is_admin)).toEqual([true, false]);
  });
});
