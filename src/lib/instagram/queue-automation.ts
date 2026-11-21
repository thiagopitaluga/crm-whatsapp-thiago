import type { SupabaseClient } from '@supabase/supabase-js';
import {
  matchGraphTrigger,
  type GraphRule,
  type TriggerEvent,
} from './graph-trigger';
export async function queueGraphEvent(
  db: SupabaseClient,
  input: {
    accountId: string;
    channelId: string;
    conversationId: string | null;
    senderId: string;
    eventId: string;
    event: TriggerEvent;
    postback?: string;
    messageId?: string;
  }
) {
  const result = await db
    .from('instagram_automations')
    .select(
      'id,trigger_type,keywords,reply_text,channel_id,target_media_id,flow_graph'
    )
    .eq('account_id', input.accountId)
    .eq('channel_id', input.channelId)
    .eq('is_active', true)
    .is('archived_at', null)
    .order('created_at')
    .order('id');
  if (result.error) throw result.error;
  const rules = (result.data || []) as GraphRule[];
  let matched = matchGraphTrigger(rules, input.channelId, input.event);
  let startNodeId: string | undefined;
  if (input.postback?.startsWith('organizap-instagram:')) {
    const parts = input.postback.split(':');
    if (parts.length !== 3) return;
    const rule = rules.find((r) => r.id === parts[1]);
    if (!rule || !input.conversationId) return;
    const proof = await db
      .from('instagram_messages')
      .select('id')
      .eq('account_id', input.accountId)
      .eq('conversation_id', input.conversationId)
      .eq('direction', 'outbound')
      .contains('metadata', { postbacks: [input.postback] })
      .limit(1)
      .maybeSingle();
    if (proof.error) throw proof.error;
    if (!proof.data) return;
    const graph = rule.flow_graph as { nodes?: Array<{ id: string }> };
    if (!graph?.nodes?.some((n) => n.id === parts[2])) return;
    startNodeId = parts[2];
    matched = {
      rule,
      config: { type: 'conversation_starter' },
      score: 0,
      index: 0,
    };
  }
  if (!matched) return;
  const q = await db.from('instagram_automation_runs').upsert(
    {
      account_id: input.accountId,
      automation_id: matched.rule.id,
      channel_id: input.channelId,
      conversation_id: input.conversationId,
      event_type: input.event.kind === 'message' ? 'message' : 'comment',
      inbound_external_id: input.eventId,
      recipient_id: input.senderId,
      reply_text: matched.rule.reply_text,
      flow_graph: matched.rule.flow_graph || null,
      event_context: {
        config: matched.config,
        startNodeId,
        commentId: input.event.kind === 'message' ? undefined : input.senderId,
        messageId: input.messageId,
        eventAt: new Date().toISOString(),
      },
      run_at: new Date().toISOString(),
    },
    { onConflict: 'channel_id,inbound_external_id', ignoreDuplicates: true }
  );
  if (q.error) throw q.error;
}
export async function queueInstagramAutomation(
  db: SupabaseClient,
  input: {
    accountId: string;
    channelId: string;
    conversationId: string;
    senderId: string;
    messageId: string;
    text: string;
    event?: Partial<TriggerEvent>;
    postback?: string;
  }
) {
  const first = await db
    .from('instagram_messages')
    .select('external_id')
    .eq('account_id', input.accountId)
    .eq('conversation_id', input.conversationId)
    .eq('direction', 'inbound')
    .order('created_at')
    .order('external_id')
    .limit(1)
    .maybeSingle();
  if (first.error) throw first.error;
  return queueGraphEvent(db, {
    ...input,
    eventId: input.messageId,
    event: {
      text: input.text,
      kind: 'message',
      firstMessage: first.data?.external_id === input.messageId,
      ...input.event,
    },
  });
}
export async function queueInstagramComment(
  db: SupabaseClient,
  input: {
    accountId: string;
    channelId: string;
    commentId: string;
    mediaId: string | null;
    text: string;
    live?: boolean;
    conversationId?: string | null;
    commenterId?: string;
  }
) {
  let conversationId = input.conversationId || null;
  if (!conversationId && input.commenterId && /^\d+$/.test(input.commenterId)) {
    const created = await db
      .from('instagram_conversations')
      .upsert(
        {
          account_id: input.accountId,
          channel_id: input.channelId,
          instagram_user_id: input.commenterId,
        },
        { onConflict: 'channel_id,instagram_user_id', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle();
    if (created.error) throw created.error;
    conversationId = created.data?.id || null;
    if (!conversationId) {
      const existing = await db
        .from('instagram_conversations')
        .select('id')
        .eq('channel_id', input.channelId)
        .eq('account_id', input.accountId)
        .eq('instagram_user_id', input.commenterId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      conversationId = existing.data?.id || null;
    }
  }
  return queueGraphEvent(db, {
    ...input,
    conversationId,
    senderId: input.commentId,
    eventId: 'comment:' + input.commentId,
    event: {
      text: input.text,
      kind: input.live ? 'live_comment' : 'comment',
      mediaId: input.mediaId,
    },
  });
}
