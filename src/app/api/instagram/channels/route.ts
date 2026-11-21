import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await supabaseAdmin()
      .from('instagram_channels')
      .select('id,instagram_id,username,token_expires_at,created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at');
    if (error) throw error;
    return NextResponse.json(
      {
        channels: data ?? [],
        canManage: ctx.role === 'owner' || ctx.role === 'admin',
        configured: Boolean(
          process.env.INSTAGRAM_APP_ID &&
          process.env.INSTAGRAM_APP_SECRET &&
          process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN &&
          process.env.ENCRYPTION_KEY
        ),
        automationEnabled: process.env.INSTAGRAM_AUTOMATION_ENABLED === 'true',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
