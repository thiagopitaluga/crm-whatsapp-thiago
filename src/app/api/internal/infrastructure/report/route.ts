import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

function authorized(request: Request) {
  const supplied =
    request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
  const expected = process.env.INFRASTRUCTURE_REPORT_SECRET ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return Boolean(
    expected && left.length === right.length && timingSafeEqual(left, right)
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const source = String(body.source ?? '').slice(0, 80);
    const hostname = String(body.hostname ?? '').slice(0, 255);
    const collectedAt = new Date(String(body.collectedAt ?? ''));
    const metrics = body.metrics;
    if (
      source !== 'organizap-vps' ||
      !hostname ||
      Number.isNaN(collectedAt.getTime()) ||
      !metrics ||
      typeof metrics !== 'object'
    ) {
      return NextResponse.json({ error: 'Invalid report' }, { status: 400 });
    }
    const admin = supabaseAdmin();
    const { error } = await admin.from('infrastructure_snapshots').insert({
      source,
      hostname,
      payload: metrics,
      collected_at: collectedAt.toISOString(),
    });
    if (error) throw error;

    // Retain 30 days of five-minute samples without requiring another job.
    await admin
      .from('infrastructure_snapshots')
      .delete()
      .eq('source', source)
      .lt('collected_at', new Date(Date.now() - 30 * 86400000).toISOString());

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[infrastructure-report]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

