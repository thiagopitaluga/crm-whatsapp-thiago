import { randomBytes } from 'node:crypto';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { createClient } from '@/lib/supabase/server';

function allowedEmails() {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || !user.email) throw new UnauthorizedError();
  if (!allowedEmails().has(user.email.toLowerCase())) {
    throw new ForbiddenError('Acesso restrito ao administrador geral');
  }
  return { userId: user.id, email: user.email.toLowerCase() };
}

export function createTemporaryPassword() {
  return `${randomBytes(12).toString('base64url')}Aa1!`;
}

export async function logPlatformAdminAction(input: {
  actorUserId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabaseAdmin()
    .from('platform_admin_audit_log')
    .insert({
      actor_user_id: input.actorUserId,
      actor_email: input.actorEmail,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      metadata: input.metadata ?? {},
    });
  if (error) console.error('[platform-admin] audit insert failed', error);
}

