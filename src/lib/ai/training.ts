import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAiAgentSettings } from './agent-settings';

/** Save a paired example from a human inbox reply when auto-training is enabled. */
export async function captureHumanTrainingExample(args: {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  sourceMessageId: string;
  reply: string | null;
}) {
  const reply = args.reply?.trim();
  if (!reply) return;
  const { data: config, error: configError } = await args.db
    .from('ai_configs')
    .select('agent_settings')
    .eq('account_id', args.accountId)
    .maybeSingle();
  if (configError || !config) return;
  const settings = normalizeAiAgentSettings(config.agent_settings);
  if (!settings.autoTrainingEnabled) return;

  const { data: sentMessage, error: sentError } = await args.db
    .from('messages')
    .select('created_at')
    .eq('id', args.sourceMessageId)
    .eq('conversation_id', args.conversationId)
    .maybeSingle();
  if (sentError || !sentMessage?.created_at) return;

  const { data: customerMessage, error: customerError } = await args.db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'customer')
    .eq('content_type', 'text')
    .lt('created_at', sentMessage.created_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (customerError || typeof customerMessage?.content_text !== 'string')
    return;
  const customerText = customerMessage.content_text.trim();
  if (!customerText) return;

  const { error } = await args.db.from('ai_training_examples').insert({
    account_id: args.accountId,
    conversation_id: args.conversationId,
    source_message_id: args.sourceMessageId,
    customer_message: customerText.slice(0, 4000),
    agent_reply: reply.slice(0, 4000),
    status: settings.trainingRequiresApproval ? 'pending' : 'approved',
  });
  if (error && error.code !== '23505') {
    console.error(
      '[ai training] could not capture human reply:',
      error.message
    );
  }
}
