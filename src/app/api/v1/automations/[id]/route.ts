// GET / PATCH / DELETE /api/v1/automations/:id
// Scope: automations:manage. All operations are account-scoped.

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey(request, 'automations:manage');
    const { id } = await params;
    const automation = await findAutomation(ctx, id);
    if (!automation) return fail('not_found', 'Automation not found', 404);
    return ok({ automation, steps: await loadStepsTree(id) });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey(request, 'automations:manage');
    const { id } = await params;
    const automation = await findAutomation(ctx, id);
    if (!automation) return fail('not_found', 'Automation not found', 404);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }
    if (body.steps !== undefined && !Array.isArray(body.steps)) {
      return fail('bad_request', "'steps' must be an array when provided", 400);
    }
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
      return fail(
        'bad_request',
        "'is_active' must be a boolean when provided",
        400
      );
    }

    const update: Record<string, unknown> = {};
    for (const field of [
      'name',
      'description',
      'trigger_type',
      'trigger_config',
      'is_active',
    ]) {
      if (field in body) update[field] = body[field];
    }

    const willBeActive =
      typeof update.is_active === 'boolean'
        ? update.is_active
        : automation.is_active;
    const steps = Array.isArray(body.steps)
      ? (body.steps as BuilderStepInput[])
      : await loadStepsTree(id);
    if (willBeActive) {
      const issues = [
        ...validateTriggerForActivation(
          String(update.trigger_type ?? automation.trigger_type),
          update.trigger_config ?? automation.trigger_config
        ),
        ...validateStepsForActivation(steps),
      ];
      if (issues.length > 0) {
        return fail(
          'bad_request',
          'Cannot activate automation with invalid configuration',
          400
        );
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await ctx.supabase
        .from('automations')
        .update(update)
        .eq('id', id)
        .eq('account_id', ctx.accountId);
      if (error) {
        console.error('[api/v1/automations] update error:', error);
        return fail('internal', 'Failed to update automation', 500);
      }
    }
    if (Array.isArray(body.steps)) {
      const error = await replaceSteps(id, body.steps as BuilderStepInput[]);
      if (error) {
        console.error('[api/v1/automations] replace steps error:', error);
        return fail('internal', 'Failed to update automation steps', 500);
      }
    }

    const updated = await findAutomation(ctx, id);
    return ok({ automation: updated, steps: await loadStepsTree(id) });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey(request, 'automations:manage');
    const { id } = await params;
    const automation = await findAutomation(ctx, id);
    if (!automation) return fail('not_found', 'Automation not found', 404);
    const { error } = await ctx.supabase
      .from('automations')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[api/v1/automations] delete error:', error);
      return fail('internal', 'Failed to delete automation', 500);
    }
    return ok({ id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

async function findAutomation(
  ctx: Awaited<ReturnType<typeof requireApiKey>>,
  id: string
) {
  const { data, error } = await ctx.supabase
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
