import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { loadAiConfig } from '@/lib/ai/config';
import { buildConversationContext } from '@/lib/ai/context';
import { buildSystemPrompt } from '@/lib/ai/defaults';
import { generateReply } from '@/lib/ai/generate';
import { scheduleAiFollowup } from '@/lib/ai/followup';
import { buildHandoffSummary } from '@/lib/ai/handoff';
import {
  retrieveKnowledge,
  retrieveTrainingExamples,
} from '@/lib/ai/knowledge';
import { latestUserMessage } from '@/lib/ai/query';
import { logAiUsage } from '@/lib/ai/usage';
import { engineSendText } from '@/lib/flows/meta-send';
import { processDueAiAgentTriggerJobs } from '@/lib/ai/agent-triggers';
import { dispatchNotifications } from '@/lib/notifications/dispatch';

export const maxDuration = 120;

function isAuthorized(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET ?? process.env.CRON_SECRET;
  const supplied =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';
  if (!expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    const status =
      process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET ? 401 : 503;
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'cron not configured' },
      { status }
    );
  }

  const db = supabaseAdmin();
  await dispatchNotifications().catch(() => console.error('Notification dispatch failed'));
  let scheduledTriggers = { processed: 0, failed: 0, skipped: 0 };
  try {
    scheduledTriggers = await processDueAiAgentTriggerJobs(db, 10);
  } catch (error) {
    console.error('[ai agent triggers] scheduled job scan failed:', error);
  }
  const now = new Date().toISOString();
  const { data: due, error } = await db
    .from('ai_followup_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', now)
    .order('run_at', { ascending: true })
    .limit(1);
  if (error)
    return NextResponse.json({ error: error.message, scheduledTriggers }, { status: 500 });

  let processed = 0;
  let sentCount = 0;
  let skipped = 0;
  for (const job of due ?? []) {
    const { data: claim } = await db
      .from('ai_followup_jobs')
      .update({ status: 'running' })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claim) continue;
    processed++;

    const finish = async (status: 'sent' | 'cancelled' | 'failed') => {
      await db
        .from('ai_followup_jobs')
        .update({ status })
        .eq('id', job.id)
        .eq('status', 'running');
    };

    try {
      const config = await loadAiConfig(db, job.account_id, { channel: job.channel });
      if (
        !config?.autoReplyEnabled ||
        !config.agentSettings.followUpEnabled ||
        !config.agentSettings.enabledChannels.includes(job.channel)
      ) {
        await finish('cancelled');
        skipped++;
        continue;
      }

      const { data: conversation } = await db
        .from('conversations')
        .select('id, assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
        .eq('id', job.conversation_id)
        .eq('account_id', job.account_id)
        .maybeSingle();
      const { data: latest } = await db
        .from('messages')
        .select('id, sender_type, ai_generated')
        .eq('conversation_id', job.conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (
        !conversation ||
        conversation.assigned_agent_id ||
        conversation.ai_autoreply_disabled ||
        latest?.id !== job.anchor_message_id ||
        latest?.sender_type !== 'bot' ||
        latest.ai_generated !== true
      ) {
        await finish('cancelled');
        skipped++;
        continue;
      }
      if (conversation.ai_reply_count >= config.autoReplyMaxPerConversation) {
        await finish('cancelled');
        skipped++;
        continue;
      }

      const messages = await buildConversationContext(db, job.conversation_id);
      const customerMessage = latestUserMessage(messages);
      if (!customerMessage) {
        await finish('cancelled');
        skipped++;
        continue;
      }
      const [knowledge, trainingExamples] = await Promise.all([
        retrieveKnowledge(db, job.account_id, config, customerMessage),
        config.agentSettings.autoTrainingEnabled
          ? retrieveTrainingExamples(db, job.account_id, customerMessage, 3, config.agentId)
          : Promise.resolve([]),
      ]);
      const systemPrompt = buildSystemPrompt({
        userPrompt: config.systemPrompt,
        mode: 'follow_up',
        knowledge,
        agentSettings: config.agentSettings,
        trainingExamples,
      });
      const generated = await generateReply({ config, systemPrompt, messages });
      await logAiUsage(db, {
        accountId: job.account_id,
        conversationId: job.conversation_id,
        mode: 'auto_reply',
        provider: config.provider,
        model: config.model,
        usage: generated.usage,
      });
      if (generated.handoff || !generated.text) {
        await db
          .from('conversations')
          .update({
            ai_autoreply_disabled: true,
            ai_handoff_summary: buildHandoffSummary({
              messages,
              replyCount: conversation.ai_reply_count ?? 0,
            }),
          })
          .eq('id', job.conversation_id);
        await finish('cancelled');
        skipped++;
        continue;
      }

      const { data: claimed } = await db.rpc('claim_ai_reply_slot', {
        conversation_id: job.conversation_id,
        max_replies: config.autoReplyMaxPerConversation,
      });
      if (claimed !== true) {
        await finish('cancelled');
        skipped++;
        continue;
      }

      const sent = await engineSendText({
        accountId: job.account_id,
        userId: job.user_id,
        conversationId: job.conversation_id,
        contactId: job.contact_id,
        text: generated.text,
        aiGenerated: true,
      });
      await finish('sent');
      sentCount++;
      if (
        job.sequence_index + 1 <
        config.agentSettings.followUpDelaysHours.length
      ) {
        await scheduleAiFollowup({
          db,
          accountId: job.account_id,
          conversationId: job.conversation_id,
          contactId: job.contact_id,
          userId: job.user_id,
          channel: job.channel,
          anchorMessageId: sent.message_id,
          sequenceIndex: job.sequence_index + 1,
          delays: config.agentSettings.followUpDelaysHours,
          window: config.agentSettings,
        });
      }
    } catch (error) {
      console.error('[ai follow-up] job failed:', job.id, error);
      await finish('failed');
    }
  }
  return NextResponse.json({ processed, sent: sentCount, skipped, scheduledTriggers });
}
