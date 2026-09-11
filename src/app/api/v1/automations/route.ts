// GET  /api/v1/automations — list automations (scope: automations:manage)
// POST /api/v1/automations — create a draft (scope: automations:manage)
//
// Public API keys are account-scoped rather than cookie-authenticated. Every
// query here therefore filters by account_id before returning or mutating data.

import { requireApiKey } from '@/lib/auth/api-context';
import {
  buildPage,
  keysetFilter,
  parseListParams,
} from '@/lib/api/v1/pagination';
import { fail, ok, okList, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import {
  insertSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'automations:manage');
    const { limit, cursor } = parseListParams(request);

    let query = ctx.supabase
      .from('automations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const filter = keysetFilter(cursor);
    if (filter) query = query.or(filter);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/automations] list error:', error);
      return fail('internal', 'Failed to list automations', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'automations:manage');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const triggerType =
      typeof body.trigger_type === 'string' ? body.trigger_type : '';
    if (!name || !triggerType) {
      return fail('bad_request', "'name' and 'trigger_type' are required", 400);
    }
    if (body.is_active === true) {
      return fail(
        'bad_request',
        'New automations are always created as drafts. Activate them with PATCH after validation.',
        400
      );
    }
    if (body.steps !== undefined && !Array.isArray(body.steps)) {
      return fail('bad_request', "'steps' must be an array when provided", 400);
    }

    const authorId =
      ctx.createdBy ?? (await resolveAuditUserId(ctx.supabase, ctx.accountId));
    const { data: automation, error } = await ctx.supabase
      .from('automations')
      .insert({
        account_id: ctx.accountId,
        user_id: authorId,
        name,
        description:
          typeof body.description === 'string' ? body.description : null,
        trigger_type: triggerType,
        trigger_config: isRecord(body.trigger_config)
          ? body.trigger_config
          : {},
        is_active: false,
      })
      .select('*')
      .single();

    if (error || !automation) {
      console.error('[api/v1/automations] create error:', error);
      return fail('internal', 'Failed to create automation', 500);
    }

    const steps = (body.steps ?? []) as BuilderStepInput[];
    const stepError = await insertSteps(automation.id, steps);
    if (stepError) {
      await ctx.supabase
        .from('automations')
        .delete()
        .eq('id', automation.id)
        .eq('account_id', ctx.accountId);
      console.error('[api/v1/automations] step insert error:', stepError);
      return fail('internal', 'Failed to create automation steps', 500);
    }

    return ok({ automation, steps }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
