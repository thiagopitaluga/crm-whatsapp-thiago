import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  createTemporaryPassword,
  logPlatformAdminAction,
  requirePlatformAdmin,
} from '@/lib/platform-admin';

const roles = new Set(['admin', 'agent', 'viewer']);

export async function POST(request: Request) {
  try {
    const actor = await requirePlatformAdmin();
    const body = await request.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const fullName = String(body.fullName ?? '').trim();
    const accountId = String(body.accountId ?? '').trim() || null;
    const accountName = String(body.accountName ?? '').trim();
    const role = String(body.role ?? 'agent');

    if (!/^\S+@\S+\.\S+$/.test(email) || fullName.length < 2) {
      return NextResponse.json(
        { error: 'Informe um nome e um e-mail válidos.' },
        { status: 400 }
      );
    }
    if (accountId && !roles.has(role)) {
      return NextResponse.json({ error: 'Perfil inválido.' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    if (accountId) {
      const { data: account } = await admin
        .from('accounts')
        .select('id')
        .eq('id', accountId)
        .maybeSingle();
      if (!account) {
        return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
      }
    }

    const temporaryPassword = createTemporaryPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) {
      return NextResponse.json(
        { error: createError?.message ?? 'Não foi possível criar o acesso.' },
        { status: 400 }
      );
    }

    const userId = created.user.id;
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('account_id')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile?.account_id) {
      return NextResponse.json(
        { error: 'O acesso foi criado, mas o perfil não pôde ser inicializado.' },
        { status: 500 }
      );
    }

    if (accountId) {
      const { error: membershipError } = await admin
        .from('account_memberships')
        .upsert(
          { account_id: accountId, user_id: userId, role },
          { onConflict: 'account_id,user_id' }
        );
      if (membershipError) throw membershipError;

      const { error: updateError } = await admin
        .from('profiles')
        .update({ account_id: accountId, account_role: role })
        .eq('user_id', userId);
      if (updateError) throw updateError;

      if (profile.account_id !== accountId) {
        const { error: deleteBootstrapError } = await admin
          .from('accounts')
          .delete()
          .eq('id', profile.account_id);
        if (deleteBootstrapError) throw deleteBootstrapError;
      }
    } else if (accountName) {
      const { error: renameError } = await admin
        .from('accounts')
        .update({ name: accountName })
        .eq('id', profile.account_id);
      if (renameError) throw renameError;
    }

    await logPlatformAdminAction({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'user.created',
      targetType: 'user',
      targetId: userId,
      metadata: { email, fullName, accountId, accountName, role: accountId ? role : 'owner' },
    });

    return NextResponse.json(
      { userId, email, temporaryPassword },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

