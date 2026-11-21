import type { SupabaseClient } from '@supabase/supabase-js';
import {
  selectInstagramCommentRule,
  selectInstagramMessageRule,
  type InstagramRule,
} from './match-trigger';

/** Schedules at most one rule per message; a unique constraint makes retries idempotent. */
export async function queueInstagramAutomation(
  db: SupabaseClient,
  input: {
    accountId: string;
    channelId: string;
    conversationId: string;
    senderId: string;
    messageId: string;
    text: string;
  }
) {
  const first = await db
    .from('instagram_messages')
    .select('external_id')
    .eq('account_id', input.accountId)
    .eq('conversation_id', input.conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: true })
    .order('external_id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (first.error) throw first.error;
  const rules = await db
    .from('instagram_automations')
    .select('id,trigger_type,keywords,reply_text,channel_id')
    .eq('account_id', input.accountId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (rules.error) throw rules.error;
  const match = selectInstagramMessageRule(
    (rules.data ?? []) as InstagramRule[],
    input.text,
    input.channelId,
    first.data?.external_id === input.messageId
  );
  if (!match) return;
  const { error } = await db
    .from('instagram_automation_runs')
    .upsert(
      {
        account_id: input.accountId,
        automation_id: match.id,
        channel_id: input.channelId,
        conversation_id: input.conversationId,
        inbound_external_id: input.messageId,
        recipient_id: input.senderId,
        reply_text: match.reply_text,
      },
      { onConflict: 'channel_id,inbound_external_id', ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function queueInstagramComment(
  db: SupabaseClient,
  input: {
    accountId: string;
    channelId: string;
    commentId: string;
    mediaId: string | null;
    text: string;
  }
) {
  const rules = await db
    .from('instagram_automations')
    .select('id,trigger_type,keywords,reply_text,channel_id,target_media_id')
    .eq('account_id', input.accountId)
    .eq('is_active', true)
    .eq('trigger_type', 'comment_keyword')
    .eq('channel_id', input.channelId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (rules.error) throw rules.error;
  const match = selectInstagramCommentRule(
    (rules.data ?? []) as InstagramRule[],
    input.text,
    input.mediaId
  );
  if (!match) return;
  const { error } = await db
    .from('instagram_automation_runs')
    .upsert(
      {
        account_id: input.accountId,
        automation_id: match.id,
        channel_id: input.channelId,
        conversation_id: null,
        event_type: 'comment',
        inbound_external_id: 'comment:' + input.commentId,
        recipient_id: input.commentId,
        reply_text: match.reply_text,
      },
      { onConflict: 'channel_id,inbound_external_id', ignoreDuplicates: true }
    );
  if (error) throw error;
}
