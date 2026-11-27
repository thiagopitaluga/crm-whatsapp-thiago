import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { processDueEvolutionCampaign } from '@/lib/broadcasts/evolution-worker';

export const runtime = 'nodejs';
export const maxDuration = 45;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET;
  if (!expected) return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await processDueEvolutionCampaign());
  } catch (error) {
    console.error('[evolution-campaign] cron failed', error);
    return NextResponse.json({ error: 'Falha no processamento.' }, { status: 500 });
  }
}
