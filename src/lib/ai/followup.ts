import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiAgentSettings } from './agent-settings';

export async function scheduleAiFollowup(args: {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId: string;
  userId: string;
  channel: 'whatsapp_cloud' | 'whatsapp_evolution';
  anchorMessageId: string;
  sequenceIndex: number;
  delays: AiAgentSettings['followUpDelaysHours'];
}) {
  const delayHours = args.delays[args.sequenceIndex];
  if (!delayHours || args.sequenceIndex > 4) return;
  const { error } = await args.db.from('ai_followup_jobs').upsert(
    {
      account_id: args.accountId,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      user_id: args.userId,
      channel: args.channel,
      sequence_index: args.sequenceIndex,
      anchor_message_id: args.anchorMessageId,
      run_at: new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString(),
      status: 'pending',
    },
    {
      onConflict: 'account_id,conversation_id,sequence_index,anchor_message_id',
      ignoreDuplicates: true,
    }
  );
  if (error) throw error;
}
