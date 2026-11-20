import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { dispatchNotifications } from '@/lib/notifications/dispatch';
export const maxDuration = 120;
export async function GET(request: Request) {
  const a = Buffer.from(
    request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  );
  const b = Buffer.from(process.env.NOTIFICATIONS_CRON_SECRET ?? '');
  if (!b.length || a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await dispatchNotifications());
}
