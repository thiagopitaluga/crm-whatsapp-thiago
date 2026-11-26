import { serviceEnabled } from '@/lib/billing/server-access';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { runInstagramJob, type InstagramJob } from '@/lib/instagram/run-flow';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET ?? process.env.CRON_SECRET;
  if (!expected)
    return NextResponse.json(
      { error: 'Agendamento não configurado.' },
      { status: 503 }
    );
  const supplied =
    request.headers.get('x-cron-secret') ??
    (request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ||
      '');
  const a = Buffer.from(expected),
    b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  if (process.env.INSTAGRAM_AUTOMATION_ENABLED !== 'true')
    return NextResponse.json({ processed: 0, disabled: true });

  const db = supabaseAdmin();
  const deadline = Date.now() + 40000;
  const stale = await db
    .from('instagram_automation_runs')
    .update({
      status: 'uncertain',
      error_message:
        'Execução interrompida. Revise os envios antes de tentar novamente.',
    })
    .eq('status', 'sending')
    .lt('updated_at', new Date(Date.now() - 600000).toISOString());
  if (stale.error)
    return NextResponse.json(
      { error: 'Falha ao revisar execuções.' },
      { status: 500 }
    );
  const { data: jobs, error } = await db
    .from('instagram_automation_runs')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at')
    .limit(10);
  if (error)
    return NextResponse.json(
      { error: 'Falha ao consultar tarefas.' },
      { status: 500 }
    );
  let processed = 0;
  for (const job of jobs || []) {
    if (Date.now() > deadline) break;
    if (!(await serviceEnabled(db, job.account_id, 'instagram'))) continue;
    const claim = await db
      .from('instagram_automation_runs')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('account_id', job.account_id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (claim.error)
      return NextResponse.json(
        { error: 'Falha ao reservar tarefa.' },
        { status: 500 }
      );
    if (!claim.data) continue;
    await runInstagramJob(db, job as InstagramJob, deadline);
    processed++;
  }
  return NextResponse.json({ processed });
}
