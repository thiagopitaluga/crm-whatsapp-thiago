import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

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
  const { data: jobs, error } = await db
    .from('instagram_automation_runs')
    .select(
      'id,account_id,channel_id,conversation_id,automation_id,recipient_id,reply_text,event_type'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20);
  if (error)
    return NextResponse.json(
      { error: 'Falha ao consultar tarefas.' },
      { status: 500 }
    );
  let processed = 0;
  for (const job of jobs ?? []) {
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
    processed++;
    let sentId: string | undefined;
    let outcome: 'sent' | 'failed' | 'uncertain' = 'failed';
    try {
      const rule = await db
        .from('instagram_automations')
        .select('is_active')
        .eq('id', job.automation_id)
        .eq('account_id', job.account_id)
        .maybeSingle();
      const channel = await db
        .from('instagram_channels')
        .select('instagram_id,access_token_encrypted')
        .eq('id', job.channel_id)
        .eq('account_id', job.account_id)
        .maybeSingle();
      if (
        rule.error ||
        channel.error ||
        !rule.data?.is_active ||
        !channel.data ||
        !/^\d+$/.test(channel.data.instagram_id) ||
        !/^\d+$/.test(job.recipient_id)
      )
        throw new Error('Tarefa indisponível');
      const token = decrypt(channel.data.access_token_encrypted);
      outcome = 'uncertain'; // A timeout after submission may still mean that Meta sent the message.
      const recipient =
        job.event_type === 'comment'
          ? { comment_id: job.recipient_id }
          : { id: job.recipient_id };
      const response = await fetch(
        `https://graph.instagram.com/v25.0/${channel.data.instagram_id}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient,
            message: { text: job.reply_text },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        message_id?: string;
      };
      if (!response.ok) outcome = 'failed';
      else if (body.message_id) {
        sentId = body.message_id;
        outcome = 'sent';
      }
    } catch {
      /* uncertain sends must be reviewed, never automatically repeated */
    }
    if (sentId && job.conversation_id) {
      const saved = await db
        .from('instagram_messages')
        .upsert(
          {
            account_id: job.account_id,
            conversation_id: job.conversation_id,
            external_id: sentId,
            direction: 'outbound',
            body: job.reply_text,
          },
          { onConflict: 'external_id', ignoreDuplicates: true }
        );
      if (saved.error) outcome = 'uncertain';
    }
    const updated = await db
      .from('instagram_automation_runs')
      .update({ status: outcome, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('account_id', job.account_id)
      .eq('status', 'sending');
    if (updated.error)
      return NextResponse.json(
        { error: 'Falha ao registrar resultado.' },
        { status: 500 }
      );
  }
  return NextResponse.json({ processed });
}
