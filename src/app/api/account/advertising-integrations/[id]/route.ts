import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

const SAFE_COLUMNS =
  'id, provider, external_account_id, manager_account_id, display_name, access_scope, connection_status, credential_ref, is_active, last_sync_at, last_error, created_at, updated_at';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:advertisingIntegrationUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      isActive?: unknown;
    } | null;
    if (typeof body?.isActive !== 'boolean') {
      return NextResponse.json({ error: 'Atualização inválida.' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('advertising_integrations')
      .update({ is_active: body.isActive })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SAFE_COLUMNS)
      .maybeSingle();
    if (error) {
      console.error('[PATCH /api/account/advertising-integrations/:id] error:', error);
      return NextResponse.json({ error: 'Não foi possível atualizar a integração.' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Integração não encontrada.' }, { status: 404 });

    return NextResponse.json({ integration: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
