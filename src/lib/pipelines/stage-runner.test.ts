import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ from: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.send }));
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: vi.fn() }));
vi.mock('@/lib/ai/context', () => ({ buildConversationContext: vi.fn() }));
vi.mock('@/lib/ai/generate', () => ({ generateReply: vi.fn() }));
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn() }));
vi.mock('@/lib/contacts/tag-write', () => ({ addContactTagIfAbsent: vi.fn() }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: vi.fn() }));
vi.mock('@/lib/whatsapp/qr-connector', () => ({ fetchQrConnector: vi.fn() }));
vi.mock('@/lib/leads/ingest', () => ({
  ingestExternalWhatsAppMessage: vi.fn(),
}));
import { drainStageJobs } from './stage-runner';

function result(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve),
  };
  for (const key of [
    'select',
    'eq',
    'lte',
    'gt',
    'order',
    'limit',
    'maybeSingle',
    'update',
  ])
    chain[key] = vi.fn(() => chain);
  return chain;
}
const job = {
  id: 'job',
  account_id: 'account',
  deal_id: 'deal',
  stage_id: 'stage',
  source_id: 'entry',
  kind: 'rule',
  created_at: '2026-11-13T00:00:00Z',
  payload: {},
};
describe('stage job worker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });
  it('does not execute a job claimed by another worker', async () => {
    h.from.mockReturnValueOnce(result([job])).mockReturnValueOnce(result(null));
    expect(await drainStageJobs()).toBe(0);
    expect(h.from).toHaveBeenCalledTimes(2);
    expect(h.send).not.toHaveBeenCalled();
  });
  it('cancels work if the deal has left the stage', async () => {
    const finished = result(null);
    h.from
      .mockReturnValueOnce(result([job]))
      .mockReturnValueOnce(result({ id: 'job' }))
      .mockReturnValueOnce(result({ stage_id: 'another' }))
      .mockReturnValueOnce(finished);
    expect(await drainStageJobs()).toBe(1);
    expect(finished.update).toHaveBeenCalledWith({ status: 'skipped' });
    expect(h.send).not.toHaveBeenCalled();
  });
  it('cancels old entry jobs even after the deal returns to the same stage', async () => {
    const finished = result(null);
    h.from
      .mockReturnValueOnce(result([{ ...job, payload: { event: 'entered' } }]))
      .mockReturnValueOnce(result({ id: 'job' }))
      .mockReturnValueOnce(
        result({ id: 'deal', stage_id: 'stage', contact_id: 'contact' })
      )
      .mockReturnValueOnce(result({ id: 'new-entry' }))
      .mockReturnValueOnce(finished);
    await drainStageJobs();
    expect(finished.update).toHaveBeenCalledWith({ status: 'skipped' });
    expect(h.send).not.toHaveBeenCalled();
  });
  it('records failure when ownership lookup fails instead of sending', async () => {
    const finished = result(null);
    h.from
      .mockReturnValueOnce(result([job]))
      .mockReturnValueOnce(result({ id: 'job' }))
      .mockReturnValueOnce(result(null, new Error('Database unavailable')))
      .mockReturnValueOnce(finished);
    await drainStageJobs();
    expect(finished.update).toHaveBeenCalledWith({
      status: 'failed',
      error: 'Database unavailable',
    });
    expect(h.send).not.toHaveBeenCalled();
  });
  it('propagates a queue failure to cron monitoring', async () => {
    h.from.mockReturnValueOnce(result(null, new Error('Queue unavailable')));
    await expect(drainStageJobs()).rejects.toThrow('Queue unavailable');
  });
  function prepareMeta(
    clickId: string | null,
    value = 197,
    receivedAt = '2026-11-12T00:00:00Z'
  ) {
    const finished = result(null);
    h.from
      .mockReturnValueOnce(
        result([{ ...job, kind: 'meta', payload: { event: 'Purchase' } }])
      )
      .mockReturnValueOnce(result({ id: job.id }))
      .mockReturnValueOnce(
        result({
          id: 'deal',
          stage_id: 'stage',
          contact_id: 'contact',
          pipeline_id: 'pipeline',
          value,
          currency: 'BRL',
        })
      )
      .mockReturnValueOnce(result({ id: 'entry' }))
      .mockReturnValueOnce(
        result({ name: 'Venda', settings: { metaEvent: 'Purchase' } })
      )
      .mockReturnValueOnce(result({ name: 'Lead', phone: '5511999999999' }))
      .mockReturnValueOnce(result({ name: 'Vendas' }))
      .mockReturnValueOnce(
        result({ id: 'conversation', whatsapp_channel_key: 'cloud' })
      )
      .mockReturnValueOnce(
        result({
          pixel_id: 'generic-pixel',
          access_token_encrypted: 'encrypted',
          whatsapp_conversion: {
            wabaId: '123456789',
            datasetId: 'whatsapp-dataset',
            channelKey: 'cloud',
          },
        })
      )
      .mockReturnValueOnce(
        result({ ctwa_clid: clickId, received_at: receivedAt })
      )
      .mockReturnValueOnce(finished);
    return finished;
  }
  it('sends a real observed click to the WhatsApp dataset and records confirmation', async () => {
    const finished = prepareMeta('observed-click');
    const send = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ events_received: 1 }),
    });
    vi.stubGlobal('fetch', send);
    await drainStageJobs();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toContain('/whatsapp-dataset/events');
    const body = JSON.parse(send.mock.calls[0][1].body);
    expect(body.data[0]).toMatchObject({
      event_id: 'purchase-account-deal',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: {
        ctwa_clid: 'observed-click',
        whatsapp_business_account_id: '123456789',
      },
    });
    expect(finished.update).toHaveBeenCalledWith({ status: 'done' });
  });
  it('records the missing identifier without sending a falsely attributed event', async () => {
    const finished = prepareMeta(null);
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    await drainStageJobs();
    expect(send).not.toHaveBeenCalled();
    expect(finished.update).toHaveBeenCalledWith({
      status: 'failed',
      error: expect.stringContaining('ctwa_clid'),
    });
  });
  it('records failure when Meta does not confirm an accepted event', async () => {
    const finished = prepareMeta('observed-click');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ events_received: 0 }),
      })
    );
    await drainStageJobs();
    expect(finished.update).toHaveBeenCalledWith({
      status: 'failed',
      error: expect.stringContaining('não confirmou'),
    });
  });
  it('allows the referral write immediately after the first deal is created', async () => {
    const finished = prepareMeta('observed-click', 197, '2026-11-13T00:00:01Z');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ events_received: 1 }),
        })
    );
    await drainStageJobs();
    expect(finished.update).toHaveBeenCalledWith({ status: 'done' });
  });
  it('does not use an ad referral received days after the conversion', async () => {
    const finished = prepareMeta('observed-click', 197, '2026-11-16T00:00:01Z');
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    await drainStageJobs();
    expect(finished.update).toHaveBeenCalledWith({ status: 'skipped' });
    expect(send).not.toHaveBeenCalled();
  });
});
