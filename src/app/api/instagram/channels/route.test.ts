import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  pipeline: true,
  stage: true,
  channel: true,
  writes: 0,
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'tenant' }),
  toErrorResponse: () => Response.json({ error: 'internal' }, { status: 500 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        update: () => {
          state.writes++;
          return q;
        },
        maybeSingle: async () => ({
          error: null,
          data: (
            table === 'pipelines'
              ? state.pipeline
              : table === 'pipeline_stages'
                ? state.stage
                : state.channel
          )
            ? { id: 'found' }
            : null,
        }),
      };
      return q;
    },
  }),
}));
import { PATCH } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown) =>
  new Request('https://crm.test/api/instagram/channels', {
    method: 'PATCH',
    headers: { origin: 'https://crm.test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
describe('Instagram lead destination', () => {
  beforeEach(() => {
    state.pipeline = true;
    state.stage = true;
    state.channel = true;
    state.writes = 0;
  });
  it('requires both pipeline and stage', async () => {
    expect(
      (await PATCH(request({ id, pipelineId: id, stageId: null }))).status
    ).toBe(400);
    expect(state.writes).toBe(0);
  });
  it('rejects a pipeline outside the current tenant before writing', async () => {
    state.pipeline = false;
    expect(
      (await PATCH(request({ id, pipelineId: id, stageId: id }))).status
    ).toBe(400);
    expect(state.writes).toBe(0);
  });
  it('rejects a stage that does not belong to the selected pipeline', async () => {
    state.stage = false;
    expect(
      (await PATCH(request({ id, pipelineId: id, stageId: id }))).status
    ).toBe(400);
    expect(state.writes).toBe(0);
  });
  it('saves a valid destination and permits disabling automatic lead creation', async () => {
    expect(
      (await PATCH(request({ id, pipelineId: id, stageId: id }))).status
    ).toBe(200);
    expect(
      (await PATCH(request({ id, pipelineId: null, stageId: null }))).status
    ).toBe(200);
  });
});
