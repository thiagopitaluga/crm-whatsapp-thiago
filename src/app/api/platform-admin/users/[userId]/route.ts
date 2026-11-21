import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  createTemporaryPassword,
  logPlatformAdminAction,
  requirePlatformAdmin,
} from '@/lib/platform-admin';

const editableRoles = new Set(['admin', 'agent', 'viewer']);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const actor = await requirePlatformAdmin();
    const { userId } = await context.params;
    const body = await request.json();
    const action = String(body.action ?? '');
    const admin = supabaseAdmin();

    if (action === 'block' || action === 'unblock') {
      if (userId === actor.userId && action === 'block') {
        return NextResponse.json(
          { error: 'Você não pode bloquear o próprio acesso.' },
          { status: 400 }
        );
      }
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: action === 'block' ? '876000h' : 'none',
      });
      if (error) throw error;
      await logPlatformAdminAction({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: `user.${action}`,
        targetType: 'user',
        targetId: userId,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'reset-password') {
      const temporaryPassword = createTemporaryPassword();
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password: temporaryPassword,
      });
      if (error) throw error;
      await logPlatformAdminAction({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: 'user.password_reset',
        targetType: 'user',
        targetId: userId,
      });
      return NextResponse.json({ ok: true, temporaryPassword });
    }

    if (action === 'update-membership') {
      const accountId = String(body.accountId ?? '');
      const role = String(body.role ?? '');
      if (!accountId || !editableRoles.has(role)) {
        return NextResponse.json(
          { error: 'Conta ou perfil inválido.' },
          { status: 400 }
        );
      }
      const { data: owned } = await admin
        .from('accounts')
        .select('id')
        .eq('owner_user_id', userId)
        .eq('id', accountId)
        .maybeSingle();
      if (owned) {
        return NextResponse.json(
          { error: 'Transfira a propriedade antes de alterar o proprietário.' },
          { status: 409 }
        );
      }
      const { error: membershipError } = await admin
        .from('account_memberships')
        .upsert(
          { account_id: accountId, user_id: userId, role },
          { onConflict: 'account_id,user_id' }
        );
      if (membershipError) throw membershipError;
      const { error: profileError } = await admin
        .from('profiles')
        .update({ account_id: accountId, account_role: role })
        .eq('user_id', userId);
      if (profileError) throw profileError;
      await logPlatformAdminAction({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: 'user.membership_updated',
        targetType: 'user',
        targetId: userId,
        metadata: { accountId, role },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const actor = await requirePlatformAdmin();
    const { userId } = await context.params;
    if (userId === actor.userId) {
      return NextResponse.json(
        { error: 'Você não pode excluir o próprio acesso.' },
        { status: 400 }
      );
    }
    const admin = supabaseAdmin();
    const { data: ownedAccounts, error: ownerError } = await admin
      .from('accounts')
      .select('id,name')
      .eq('owner_user_id', userId);
    if (ownerError) throw ownerError;
    if (ownedAccounts?.length) {
      return NextResponse.json(
        { error: 'Este usuário é proprietário de uma conta. Transfira a propriedade antes de excluí-lo.' },
        { status: 409 }
      );
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
    await logPlatformAdminAction({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'user.deleted',
      targetType: 'user',
      targetId: userId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

