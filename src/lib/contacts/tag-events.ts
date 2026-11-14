import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runAutomationsForTrigger,
  type AutomationContext,
} from '@/lib/automations/engine';
import { addContactTagIfAbsent } from './tag-write';
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';
import { loadAiConfig } from '@/lib/ai/config';
import { runAiAgentTriggers } from '@/lib/ai/agent-triggers';
import { supabaseAdmin } from '@/lib/ai/admin-client';

export { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

interface AddContactTagAndDispatchInput {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  tagId: string;
  context?: AutomationContext;
}

export interface AddContactTagResult {
  added: boolean;
  dispatched: boolean;
  reason?: 'duplicate' | 'max_depth';
}

/**
 * Central server-side tag writer. It dispatches tag_added only for a
 * newly-created join and caps chained tag automations to avoid loops.
 */
export async function addContactTagAndDispatch(
  input: AddContactTagAndDispatchInput
): Promise<AddContactTagResult> {
  const added = await addContactTagIfAbsent(input.db, {
    accountId: input.accountId,
    contactId: input.contactId,
    tagId: input.tagId,
  });

  if (!added) return { added: false, dispatched: false, reason: 'duplicate' };

  const depth = getTagChainDepth(input.context);
  if (depth >= MAX_TAG_CHAIN_DEPTH) {
    console.warn('[automations] tag_added chain depth limit reached', {
      accountId: input.accountId,
      contactId: input.contactId,
      tagId: input.tagId,
      depth,
    });
    return { added: true, dispatched: false, reason: 'max_depth' };
  }

  await runAutomationsForTrigger({
    accountId: input.accountId,
    triggerType: 'tag_added',
    contactId: input.contactId,
    context: {
      ...input.context,
      tag_id: input.tagId,
      vars: {
        ...(input.context?.vars ?? {}),
        _tag_chain_depth: depth + 1,
      },
    },
  });

  try {
    const aiDb = supabaseAdmin();
    const { data: conversation } = await aiDb.from('conversations')
      .select('id, user_id, channel, ai_agent_id')
      .eq('account_id', input.accountId).eq('contact_id', input.contactId)
      .eq('status', 'open').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (conversation?.ai_agent_id && conversation.channel) {
      const config = await loadAiConfig(aiDb, input.accountId, { agentId: conversation.ai_agent_id });
      if (config?.isActive && config.agentSettings.enabledChannels.includes(conversation.channel)) {
        await runAiAgentTriggers({
          db: aiDb,
          accountId: input.accountId,
          userId: conversation.user_id,
          contactId: input.contactId,
          conversationId: conversation.id,
          channel: conversation.channel,
          eventType: 'tag_added',
          tagId: input.tagId,
          config,
        });
      }
    }
  } catch (error) {
    console.warn('[ai agent triggers] tag-added dispatch failed:', error);
  }

  return { added: true, dispatched: true };
}
