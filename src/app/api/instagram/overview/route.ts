import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  readInstagramChannels,
  readInstagramInsights,
} from '@/lib/instagram/read-api';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const db = supabaseAdmin();
    const days = Number(new URL(request.url).searchParams.get('days') ?? 7);
    if (![7, 14, 28].includes(days))
      return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
    const channels = await readInstagramChannels(db, ctx.accountId);
    const insights = await Promise.all(
      channels.map(async (channel) => {
        try {
          return await readInstagramInsights(channel, days);
        } catch (error) {
          return {
            channelId: channel.id,
            profile: { username: channel.username },
            error:
              error instanceof Error
                ? error.message
                : 'Não foi possível consultar o Instagram.',
          };
        }
      })
    );
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
      .select(
        'id,status,created_at,updated_at,automation_id,error_message,next_step,run_at'
      )
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
        insights,
        days,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
