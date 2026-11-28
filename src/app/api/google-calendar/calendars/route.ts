import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { calendarAdmin, getCalendarConnection, googleCalendarRequest } from '@/lib/google-calendar/client';

export const runtime = 'nodejs';

async function listCalendars(accountId: string) {
  const connection = await getCalendarConnection(accountId);
  if (!connection || connection.status !== 'connected') return null;
  const response = await googleCalendarRequest(connection, '/users/me/calendarList?minAccessRole=writer&maxResults=250');
  if (!response.ok) throw new Error(`Google calendar list: ${response.status}`);
  const payload = (await response.json()) as { items?: { id: string; summary: string; primary?: boolean }[] };
  return (payload.items ?? []).map(({ id, summary, primary }) => ({ id, name: summary, primary: Boolean(primary) }));
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({ calendars: await listCalendars(ctx.accountId) ?? [] });
  } catch (error) { return toErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const { calendar_id } = (await request.json()) as { calendar_id?: string };
    const calendars = await listCalendars(ctx.accountId);
    if (!calendars?.some((calendar) => calendar.id === calendar_id)) {
      return NextResponse.json({ error: 'Selecione uma agenda com permissão de edição' }, { status: 400 });
    }
    const connection = await getCalendarConnection(ctx.accountId);
    if (connection?.calendar_id !== calendar_id) {
      const { count, error: countError } = await calendarAdmin().from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId).not('google_calendar_event_id', 'is', null);
      if (countError) throw countError;
      if (count) return NextResponse.json({ error: 'Esta conta já tem tarefas sincronizadas. Para preservar os eventos, mantenha a agenda atual.' }, { status: 409 });
    }
    const { error } = await calendarAdmin().from('google_calendar_connections')
      .update({ calendar_id }).eq('account_id', ctx.accountId);
    if (error) throw error;
    return NextResponse.json({ calendar_id });
  } catch (error) { return toErrorResponse(error); }
}
