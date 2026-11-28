import { createClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

export type CalendarConnection = {
  account_id: string;
  calendar_id: string | null;
  status: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
};

export function calendarAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function getCalendarConnection(accountId: string) {
  const { data, error } = await calendarAdmin()
    .from('google_calendar_connections')
    .select('account_id,calendar_id,status,access_token_encrypted,refresh_token_encrypted,token_expires_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return data as CalendarConnection | null;
}

async function refreshAccessToken(connection: CalendarConnection): Promise<string> {
  if (!connection.refresh_token_encrypted) throw new Error('Google Agenda precisa ser reconectada');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      refresh_token: decrypt(connection.refresh_token_encrypted),
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!response.ok || !payload.access_token) {
    await calendarAdmin().from('google_calendar_connections')
      .update({ status: 'error', last_error: 'Token expirado ou revogado' })
      .eq('account_id', connection.account_id);
    throw new Error('Google Agenda precisa ser reconectada');
  }
  const expiresAt = new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString();
  const encryptedAccessToken = encrypt(payload.access_token);
  const { error } = await calendarAdmin().from('google_calendar_connections')
    .update({ access_token_encrypted: encryptedAccessToken, token_expires_at: expiresAt, status: 'connected', last_error: null })
    .eq('account_id', connection.account_id);
  if (error) throw error;
  connection.access_token_encrypted = encryptedAccessToken;
  connection.token_expires_at = expiresAt;
  return payload.access_token;
}

export async function googleCalendarRequest(
  connection: CalendarConnection,
  path: string,
  init: RequestInit = {},
) {
  if (connection.status !== 'connected') throw new Error('Google Agenda não conectada');
  let token = connection.access_token_encrypted && connection.token_expires_at &&
    new Date(connection.token_expires_at).getTime() > Date.now() + 60_000
    ? decrypt(connection.access_token_encrypted)
    : await refreshAccessToken(connection);
  const request = (accessToken: string) => fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init.headers },
    cache: 'no-store',
  });
  let response = await request(token);
  if (response.status === 401) {
    token = await refreshAccessToken(connection);
    response = await request(token);
  }
  return response;
}

export function calendarEventsPath(calendarId: string) {
  return `/calendars/${encodeURIComponent(calendarId)}/events`;
}
