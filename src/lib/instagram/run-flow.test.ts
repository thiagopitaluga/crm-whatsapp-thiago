import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }));
import { runInstagramJob, type InstagramJob } from './run-flow';
function database(job: InstagramJob & { status: string }, owner = 'account-a') {
  const sentMessages: unknown[] = [];
  const tags: string[] = [];
  const db = {
    from(table: string) {
      let values: Record<string, any> | undefined;
      const filters: Record<string, unknown> = {};
      const execute = () => {
        if (filters.account_id !== owner) return { data: null, error: null };
        if (table === 'instagram_automations')
          return {
            data: { is_active: true, channel_id: 'channel' },
            error: null,
          };
        if (table === 'instagram_channels')
          return {
            data: {
              instagram_id: '12345',
              access_token_encrypted: 'encrypted',
            },
            error: null,
          };
        if (table === 'instagram_automation_runs') {
          if (values && filters.status === job.status)
            Object.assign(job, values);
          return { data: { id: job.id }, error: null };
        }
        if (table === 'instagram_messages') {
          sentMessages.push(values);
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };
      const q = {
        select: () => q,
        update: (v: Record<string, unknown>) => {
          values = v;
          return q;
        },
        upsert: (v: Record<string, unknown>) => {
          values = v;
          filters.account_id = v.account_id;
          return q;
        },
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        maybeSingle: async () => execute(),
        then: (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown
        ) => Promise.resolve().then(execute).then(resolve, reject),
      };
      return q;
    },
    rpc: async (_fn: string, args: { p_tags: string[] }) => {
      tags.push(...args.p_tags);
      return { error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, sentMessages, tags };
}
const job = (): InstagramJob & { status: string } => ({
  id: 'job',
  account_id: 'account-a',
  channel_id: 'channel',
  conversation_id: 'conversation',
  automation_id: 'rule',
  recipient_id: '98765',
  reply_text: 'legacy',
  status: 'sending',
  execution_plan: [
    {
      type: 'content',
      content: { type: 'text', text: 'Primeira' },
      buttons: [],
    },
    { type: 'delay', seconds: 10 },
    {
      type: 'content',
      content: { type: 'image', url: 'https://example.com/a.jpg' },
      buttons: [],
    },
    { type: 'tag', tags: ['cliente'] },
  ],
  next_step: 0,
});
afterEach(() => vi.unstubAllGlobals());
describe('durable Instagram visual flow execution', () => {
  it('persists a delayed continuation and resumes at the next content without resending', async () => {
    const row = job();
    const { db, sentMessages, tags } = database(row);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ message_id: 'first' }))
      .mockResolvedValueOnce(Response.json({ message_id: 'second' }));
    vi.stubGlobal('fetch', fetcher);
    await runInstagramJob(db, { ...row }, Date.now() + 40000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('pending');
    expect(row.next_step).toBe(2);
    expect(Date.parse((row as any).run_at)).toBeGreaterThan(Date.now() + 9000);
    expect(tags).toEqual([]);
    row.status = 'sending';
    await runInstagramJob(db, { ...row }, Date.now() + 40000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(row.status).toBe('sent');
    expect(row.next_step).toBe(4);
    expect(tags).toEqual(['cliente']);
    expect(sentMessages).toHaveLength(2);
  });
  it('marks interrupted network delivery uncertain and does not advance its cursor', async () => {
    const row = job();
    const { db } = database(row);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await runInstagramJob(db, { ...row }, Date.now() + 40000);
    expect(row.status).toBe('uncertain');
    expect(row.next_step).toBe(0);
  });
  it('never sends using another company credentials', async () => {
    const row = job();
    const { db } = database(row, 'account-b');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await runInstagramJob(db, { ...row }, Date.now() + 40000);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
