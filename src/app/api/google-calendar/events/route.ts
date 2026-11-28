import { NextRequest, NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { calendarEventsPath, getCalendarConnection, googleCalendarRequest } from '@/lib/google-calendar/client';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const connection = await getCalendarConnection(ctx.accountId);
    if (!connection || connection.status !== 'connected') return NextResponse.json({ events: [] });
    const from = new Date(request.nextUrl.searchParams.get('from') || '');
    const to = new Date(request.nextUrl.searchParams.get('to') || '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() <= from.getTime() || to.getTime() - from.getTime() > 62 * 86_400_000) {
      return NextResponse.json({ error: 'Período inválido' }, { status: 400 });
    }
    const params = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    const response = await googleCalendarRequest(connection, `${calendarEventsPath(connection.calendar_id || 'primary')}?${params}`);
    if (!response.ok) throw new Error(`Google events: ${response.status}`);
    const payload = (await response.json()) as { items?: { id: string; summary?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; extendedProperties?: { private?: { organizap_task_id?: string } } }[] };
    return NextResponse.json({ events: (payload.items ?? []).filter((event) => !event.extendedProperties?.private?.organizap_task_id).map((event) => ({
      id: event.id,
      title: event.summary || 'Evento',
      starts_at: event.start?.dateTime || event.start?.date || null,
      url: event.htmlLink || null,
    })) });
  } catch (error) { return toErrorResponse(error); }
}
