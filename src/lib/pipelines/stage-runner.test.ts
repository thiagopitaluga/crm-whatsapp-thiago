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
      .mockReturnValueOnce(result([job]))
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
});
