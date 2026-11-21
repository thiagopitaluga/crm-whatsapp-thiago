import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  resolveFlowPlan,
  composePrivateReply,
  type FlowPlanStep,
  type TriggerConfig,
} from './automation-flow';
import {
  instagramMessage,
  callInstagram,
  InstagramDeliveryError,
} from './send-content';
export type InstagramJob = {
  id: string;
  account_id: string;
  channel_id: string;
  conversation_id: string | null;
  automation_id: string;
  recipient_id: string;
  reply_text: string;
  event_type?: string;
  flow_graph?: unknown;
  execution_plan?: FlowPlanStep[] | null;
  next_step?: number;
  event_context?: {
    config?: TriggerConfig;
    startNodeId?: string;
    commentId?: string;
    messageId?: string;
    eventAt?: string;
  };
};
export async function runInstagramJob(
  db: SupabaseClient,
  job: InstagramJob,
  deadline: number
) {
  const save = async (values: Record<string, unknown>) => {
    const q = await db
      .from('instagram_automation_runs')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('account_id', job.account_id)
      .eq('status', 'sending');
    if (q.error)
      throw new InstagramDeliveryError(
        'Não foi possível registrar o progresso.',
        true
      );
  };
  try {
    const rule = await db
      .from('instagram_automations')
      .select('is_active,archived_at,channel_id')
      .eq('id', job.automation_id)
      .eq('account_id', job.account_id)
      .maybeSingle();
    const channel = await db
      .from('instagram_channels')
      .select('instagram_id,access_token_encrypted,token_expires_at')
      .eq('id', job.channel_id)
      .eq('account_id', job.account_id)
      .maybeSingle();
    if (
      rule.error ||
      channel.error ||
      !rule.data?.is_active ||
      rule.data.archived_at ||
      (rule.data.channel_id && rule.data.channel_id !== job.channel_id) ||
      !channel.data ||
      !/^\d+$/.test(channel.data.instagram_id) ||
      !/^\d+$/.test(job.recipient_id)
    )
      throw new Error('Automação pausada ou perfil indisponível.');
    if (
      channel.data.token_expires_at &&
      Date.parse(channel.data.token_expires_at) <= Date.now()
    )
      throw new Error('Reconecte o perfil do Instagram.');
    const token = decrypt(channel.data.access_token_encrypted);
    const account = channel.data.instagram_id;
    let conversation: {
      tags: unknown;
      profile_data: Record<string, unknown>;
      previous_interaction_at?: string;
      first_seen_at?: string;
      status: string;
      instagram_user_id: string;
    } | null = null;
    if (job.flow_graph && job.conversation_id) {
      const checked = await db
        .from('instagram_conversations')
        .select(
          'tags,profile_data,previous_interaction_at,first_seen_at,status,instagram_user_id'
        )
        .eq('id', job.conversation_id)
        .eq('account_id', job.account_id)
        .eq('channel_id', job.channel_id)
        .maybeSingle();
      if (checked.error || !checked.data)
        throw new Error('Conversa indisponível.');
      conversation = checked.data;
      if (conversation!.status === 'human')
        throw new Error('A conversa está com atendimento humano.');
    }
    let plan = job.execution_plan;
    if (!plan) {
      let contact: null | {
        tags?: string;
        custom_fields?: string;
        last_seen_at?: string;
        first_seen_at?: string;
      } = null;
      if (conversation && job.conversation_id) {
        const q = { data: conversation };
        let profile = q.data.profile_data || {};
        const nodes =
          (job.flow_graph as { nodes?: Array<{ data: { kind?: string } }> })
            .nodes || [];
        if (nodes.some((n) => n.data.kind === 'condition')) {
          try {
            const response = await fetch(
              `https://graph.instagram.com/v25.0/${q.data.instagram_user_id}?fields=name,username,profile_pic,is_user_follow_business,follower_count,is_verified_user`,
              {
                headers: { Authorization: 'Bearer ' + token },
                cache: 'no-store',
                signal: AbortSignal.timeout(5000),
              }
            );
            if (response.ok) {
              const p = await response.json();
              profile = {
                ...profile,
                ...(typeof p.is_user_follow_business === 'boolean'
                  ? { followsProfile: p.is_user_follow_business }
                  : {}),
                ...(typeof p.follower_count === 'number'
                  ? { followerCount: p.follower_count }
                  : {}),
                ...(typeof p.is_verified_user === 'boolean'
                  ? { verifiedProfile: p.is_verified_user }
                  : {}),
                username: p.username || profile.username,
                displayName: p.name || profile.displayName,
                profilePictureUrl: p.profile_pic || profile.profilePictureUrl,
              };
              await db
                .from('instagram_conversations')
                .update({ profile_data: profile })
                .eq('id', job.conversation_id)
                .eq('account_id', job.account_id);
            }
          } catch {
            /* Missing profile attributes stay unknown; never infer them from message text. */
          }
        }
        contact = {
          tags: JSON.stringify(q.data.tags || []),
          custom_fields: JSON.stringify(profile),
          last_seen_at: q.data.previous_interaction_at,
          first_seen_at: q.data.first_seen_at,
        };
      }
      const resolved = job.flow_graph
        ? resolveFlowPlan(
            JSON.stringify(job.flow_graph),
            contact,
            Date.now(),
            job.event_context?.startNodeId
          )
        : null;
      if (resolved?.stoppedByCycle)
        throw new Error(
          'O fluxo contém um ciclo ou excede o limite de 50 etapas.'
        );
      plan = resolved?.steps || [
        {
          type: 'content',
          content: { type: 'text', text: job.reply_text },
          buttons: [],
        },
      ];
      if (job.event_type === 'comment') {
        // A comment permits one private reply. Continue button branches only after the person responds.
        const first = plan.find((s) => s.type === 'content');
        const buttonStep = plan.find(
          (s) => s.type === 'content' && s.buttons.length
        );
        if (!first)
          throw new Error(
            'Adicione uma mensagem para responder ao comentário.'
          );
        const text = composePrivateReply(
          { steps: plan, tags: [], stoppedByCycle: false },
          job.reply_text
        );
        const buttons =
          buttonStep?.type === 'content' ? buttonStep.buttons : first.buttons;
        if (text.length > (buttons.length ? 640 : 1000))
          throw new Error(
            'A resposta privada ficou muito longa. Use até ' +
              (buttons.length ? 640 : 1000) +
              ' caracteres antes da primeira espera.'
          );
        plan = [
          { type: 'content', content: { type: 'text', text }, buttons },
          ...plan.filter((s) => s.type === 'tag' || s.type === 'action'),
        ];
      }
      if (plan.length > 200)
        throw new Error('O fluxo excede o limite de execução.');
      await save({ execution_plan: plan });
    }
    let cursor = job.next_step || 0;
    while (cursor < plan.length) {
      if (Date.now() > deadline) {
        await save({
          status: 'pending',
          next_step: cursor,
          run_at: new Date().toISOString(),
        });
        return;
      }
      const step = plan[cursor];
      if (step.type === 'delay') {
        await save({
          status: 'pending',
          next_step: cursor + 1,
          run_at: new Date(
            Date.now() + Math.min(30, step.seconds) * 1000
          ).toISOString(),
        });
        return;
      }
      if (step.type === 'tag' || step.type === 'action') {
        if (job.conversation_id) {
          if (step.type === 'tag' || step.action === 'remove_tag') {
            const q = await db.rpc('instagram_apply_flow_tags', {
              p_account: job.account_id,
              p_conversation: job.conversation_id,
              p_tags: step.tags || [],
              p_remove: step.type === 'action',
            });
            if (q.error) throw q.error;
          } else if (['open', 'close', 'human'].includes(step.action)) {
            const q = await db
              .from('instagram_conversations')
              .update({
                status: step.action === 'close' ? 'closed' : step.action,
              })
              .eq('id', job.conversation_id)
              .eq('account_id', job.account_id);
            if (q.error) throw q.error;
          }
        }
        cursor++;
        await save({ next_step: cursor });
        if (step.type === 'action' && step.action === 'human') break;
        continue;
      }
      const built = instagramMessage(
        step.content,
        step.buttons,
        job.automation_id
      );
      const recipient =
        job.event_type === 'comment'
          ? { comment_id: job.recipient_id }
          : { id: job.recipient_id };
      const sent = await callInstagram(account + '/messages', token, {
        recipient,
        message: built.message,
      });
      if (!sent.message_id)
        throw new InstagramDeliveryError(
          'A Meta não confirmou o identificador da mensagem.',
          true
        );
      if (job.conversation_id) {
        const stored = await db.from('instagram_messages').upsert(
          {
            account_id: job.account_id,
            conversation_id: job.conversation_id,
            external_id: sent.message_id,
            direction: 'outbound',
            body: step.content.text || step.content.url || '[Mídia]',
            metadata: {
              postbacks: built.postbacks,
              contentType: step.content.type,
              automationId: job.automation_id,
            },
          },
          { onConflict: 'external_id', ignoreDuplicates: true }
        );
        if (stored.error)
          throw new InstagramDeliveryError(
            'Envio confirmado; registro pendente de revisão.',
            true
          );
      }
      cursor++;
      await save({ next_step: cursor });
    }
    // Ancillary actions happen once, after every content step has been recorded.
    const config = job.event_context?.config;
    if (job.event_type === 'comment' && config?.publicRepliesEnabled) {
      const replies = (config.publicReplies || []).filter((s) => s.trim());
      if (replies.length)
        await callInstagram(job.recipient_id + '/replies', token, {
          message: replies[Math.floor(Math.random() * replies.length)],
        });
    }
    if (
      config?.autoLike &&
      job.event_context?.messageId &&
      job.event_type !== 'comment'
    )
      await callInstagram(account + '/messages', token, {
        recipient: { id: job.recipient_id },
        sender_action: 'react',
        payload: { message_id: job.event_context.messageId, reaction: 'love' },
      });
    await save({ status: 'sent', next_step: plan.length, error_message: null });
  } catch (error) {
    await save({
      status:
        error instanceof InstagramDeliveryError && error.uncertain
          ? 'uncertain'
          : 'failed',
      error_message:
        error instanceof InstagramDeliveryError
          ? error.message
          : error instanceof Error
            ? error.message.slice(0, 200)
            : 'Falha ao executar fluxo.',
    });
  }
}
