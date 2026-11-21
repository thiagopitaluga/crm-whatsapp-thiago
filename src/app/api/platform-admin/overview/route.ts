import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requirePlatformAdmin } from '@/lib/platform-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = supabaseAdmin();

    const users = [];
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw error;
      users.push(...data.users);
      if (data.users.length < 1000) break;
    }

    const [profilesResult, membershipsResult, accountsResult, metricsResult, auditResult] =
      await Promise.all([
        admin
          .from('profiles')
          .select('user_id,full_name,email,account_id,account_role,created_at'),
        admin
          .from('account_memberships')
          .select('user_id,account_id,role,created_at'),
        admin
          .from('accounts')
          .select('id,name,owner_user_id,created_at')
          .order('name'),
        admin.rpc('platform_admin_overview_metrics'),
        admin
          .from('platform_admin_audit_log')
          .select('id,actor_email,action,target_type,target_id,metadata,created_at')
          .order('created_at', { ascending: false })
          .limit(60),
      ]);

    for (const result of [
      profilesResult,
      membershipsResult,
      accountsResult,
      metricsResult,
      auditResult,
    ]) {
      if (result.error) throw result.error;
    }

    const profiles = profilesResult.data ?? [];
    const memberships = membershipsResult.data ?? [];
    const accounts = accountsResult.data ?? [];
    const profileByUser = new Map(profiles.map((profile) => [profile.user_id, profile]));
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const membershipsByUser = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      const existing = membershipsByUser.get(membership.user_id) ?? [];
      existing.push(membership);
      membershipsByUser.set(membership.user_id, existing);
    }

    const now = Date.now();
    const safeUsers = users.map((user) => {
      const profile = profileByUser.get(user.id);
      const activeAccount = profile?.account_id
        ? accountById.get(profile.account_id)
        : null;
      return {
        id: user.id,
        email: user.email ?? profile?.email ?? '',
        fullName: profile?.full_name || user.user_metadata?.full_name || '',
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        emailConfirmed: Boolean(user.email_confirmed_at),
        blocked: Boolean(
          user.banned_until && Date.parse(user.banned_until) > now
        ),
        activeAccountId: profile?.account_id ?? null,
        activeAccountName: activeAccount?.name ?? null,
        activeRole: profile?.account_role ?? null,
        memberships: (membershipsByUser.get(user.id) ?? []).map((membership) => ({
          accountId: membership.account_id,
          accountName: accountById.get(membership.account_id)?.name ?? 'Conta removida',
          role: membership.role,
        })),
      };
    });

    return NextResponse.json(
      {
        users: safeUsers,
        accounts,
        metrics: metricsResult.data,
        audit: auditResult.data ?? [],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

