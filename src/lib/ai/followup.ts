import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiAgentSettings } from './agent-settings';

export async function scheduleAiFollowup(args: {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId: string;
  userId: string;
  channel: string;
  anchorMessageId: string;
  sequenceIndex: number;
  delays: AiAgentSettings['followUpDelaysHours'];
  window?: Pick<AiAgentSettings, 'followUpWindowEnabled' | 'followUpWindowStart' | 'followUpWindowEnd' | 'followUpWeekdays'>;
}) {
  const delayHours = args.delays[args.sequenceIndex];
  if (!delayHours || args.sequenceIndex > 4) return;
  const target = new Date(Date.now() + delayHours * 60 * 60 * 1000);
  const runAt = args.window?.followUpWindowEnabled
    ? nextAllowedFollowupAt(target, args.window).toISOString()
    : target.toISOString();
  const { error } = await args.db.from('ai_followup_jobs').upsert(
    {
      account_id: args.accountId,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      user_id: args.userId,
      channel: args.channel,
      sequence_index: args.sequenceIndex,
      anchor_message_id: args.anchorMessageId,
      run_at: runAt,
      status: 'pending',
    },
    {
      onConflict: 'account_id,conversation_id,sequence_index,anchor_message_id',
      ignoreDuplicates: true,
    }
  );
  if (error) throw error;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nextAllowedFollowupAt(
  target: Date,
  window: NonNullable<Parameters<typeof scheduleAiFollowup>[0]['window']>
): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const start = window.followUpWindowStart.split(':').map(Number);
  const end = window.followUpWindowEnd.split(':').map(Number);
  const startMinute = start[0] * 60 + start[1];
  const endMinute = end[0] * 60 + end[1];
  const cursor = new Date(target);
  cursor.setSeconds(0, 0);
  for (let i = 0; i <= 7 * 24 * 60; i++, cursor.setTime(cursor.getTime() + 60_000)) {
    const parts = Object.fromEntries(formatter.formatToParts(cursor).map((part) => [part.type, part.value]));
    const weekday = WEEKDAYS[parts.weekday];
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    if (window.followUpWeekdays.includes(weekday) && minute >= startMinute && minute < endMinute) return new Date(cursor);
  }
  return target;
}
