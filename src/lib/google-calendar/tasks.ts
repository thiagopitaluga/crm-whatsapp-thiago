import { calendarAdmin, calendarEventsPath, getCalendarConnection, googleCalendarRequest } from './client';

type CalendarTask = {
  id: string;
  account_id: string;
  contact_id: string;
  title: string;
  description: string | null;
  due_at: string;
  status: string;
  google_calendar_event_id: string | null;
};

function eventId(taskId: string) {
  // Google permits base32hex characters in caller-supplied event IDs.
  return `org${taskId.replaceAll('-', '').toLowerCase()}`;
}

export async function syncCalendarTask(task: CalendarTask): Promise<'synced' | 'not_connected'> {
  const db = calendarAdmin();
  const connection = await getCalendarConnection(task.account_id);
  if (!connection || connection.status !== 'connected') {
    await db.from('tasks').update({ google_calendar_sync_status: 'not_connected' }).eq('id', task.id).eq('account_id', task.account_id);
    return 'not_connected';
  }
  const calendarId = connection.calendar_id || 'primary';
  const id = task.google_calendar_event_id || eventId(task.id);
  const start = new Date(task.due_at);
  const end = new Date(start.getTime() + 30 * 60_000);
  const { data: contact } = await db.from('contacts').select('name,phone').eq('id', task.contact_id).eq('account_id', task.account_id).maybeSingle();
  const details = [task.description, contact?.name ? `Contato: ${contact.name}` : null, contact?.phone ? `Telefone: ${contact.phone}` : null, task.status === 'completed' ? 'Concluída no OrganiZAP' : null].filter(Boolean).join('\n\n');
  const event = {
    id,
    summary: task.title,
    description: details,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { organizap_task_id: task.id } },
  };
  const path = calendarEventsPath(calendarId);
  const send = (method: 'POST' | 'PATCH') => googleCalendarRequest(connection, method === 'POST' ? path : `${path}/${encodeURIComponent(id)}`, {
    method,
    body: JSON.stringify(event),
  });

  try {
    let response = await send(task.google_calendar_event_id ? 'PATCH' : 'POST');
    if (response.status === 409) response = await send('PATCH');
    if (response.status === 404 && task.google_calendar_event_id) response = await send('POST');
    if (!response.ok) throw new Error(`Google Calendar API: ${response.status}`);
    const { error } = await db.from('tasks').update({
      google_calendar_event_id: id,
      google_calendar_sync_status: 'synced',
      google_calendar_last_synced_at: new Date().toISOString(),
    }).eq('id', task.id).eq('account_id', task.account_id);
    if (error) throw error;
    return 'synced';
  } catch (error) {
    await db.from('tasks').update({ google_calendar_sync_status: 'error' }).eq('id', task.id).eq('account_id', task.account_id);
    throw error;
  }
}

export async function deleteCalendarTask(task: CalendarTask) {
  if (!task.google_calendar_event_id) return;
  const connection = await getCalendarConnection(task.account_id);
  if (!connection || connection.status !== 'connected') return;
  const response = await googleCalendarRequest(connection,
    `${calendarEventsPath(connection.calendar_id || 'primary')}/${encodeURIComponent(task.google_calendar_event_id)}`,
    { method: 'DELETE' },
  );
  if (!response.ok && response.status !== 404) throw new Error(`Google Calendar API: ${response.status}`);
}
