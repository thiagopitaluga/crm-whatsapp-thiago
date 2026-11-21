import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { logPlatformAdminAction, requirePlatformAdmin } from '@/lib/platform-admin';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const actor = await requirePlatformAdmin();
    const { accountId } = await context.params;
    const body = await request.json();
    const name = String(body.name ?? '').trim();
    if (name.length < 2 || name.length > 100) {
      return NextResponse.json({ error: 'Nome inválido.' }, { status: 400 });
    }
    const { error } = await supabaseAdmin()
      .from('accounts')
      .update({ name })
      .eq('id', accountId);
    if (error) throw error;
    await logPlatformAdminAction({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'account.renamed',
      targetType: 'account',
      targetId: accountId,
      metadata: { name },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

