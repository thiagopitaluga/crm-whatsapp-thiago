import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { calendarAdmin, getCalendarConnection } from '@/lib/google-calendar/client';
import { syncCalendarTask } from '@/lib/google-calendar/tasks';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const connection = await getCalendarConnection(ctx.accountId);
    if (!connection || connection.status !== 'connected') return NextResponse.json({ error: 'Google Agenda não conectada' }, { status: 400 });
    const { data, error } = await calendarAdmin().from('tasks').select('*')
      .eq('account_id', ctx.accountId).eq('status', 'open')
      .gte('due_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
      .neq('google_calendar_sync_status', 'synced').order('due_at').limit(50);
    if (error) throw error;
    let synced = 0;
    let failed = 0;
    for (const task of data ?? []) {
      try { await syncCalendarTask(task); synced++; }
      catch (syncError) { console.error('[google-calendar] task sync failed:', syncError); failed++; }
    }
    return NextResponse.json({ synced, failed, remaining: (data?.length ?? 0) === 50 });
  } catch (error) { return toErrorResponse(error); }
}
