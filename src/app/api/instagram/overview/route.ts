import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const db = supabaseAdmin();
    const queries = [
      db
        .from('instagram_channels')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      db
        .from('instagram_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      db
        .from('instagram_messages')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('direction', 'inbound'),
      db
        .from('instagram_messages')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('direction', 'outbound'),
    ];
    const results = await Promise.all(queries);
    if (results.some((result) => result.error))
      throw new Error('Falha ao carregar indicadores.');
    const runs = await db
      .from('instagram_automation_runs')
      .select('id,status,created_at,updated_at,automation_id')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (runs.error) throw runs.error;
    return NextResponse.json(
      {
        profiles: results[0].count ?? 0,
        conversations: results[1].count ?? 0,
        received: results[2].count ?? 0,
        sent: results[3].count ?? 0,
        runs: runs.data ?? [],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
