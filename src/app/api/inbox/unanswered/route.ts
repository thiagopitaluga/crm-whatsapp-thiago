import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';

export async function GET() {
  try {
    const { accountId } = await requireRole('agent');
    const { data, error } = await supabaseAdmin().rpc(
      'inbox_unanswered_counts',
      { p_account: accountId }
    );
    if (error) throw error;
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
