import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  queueInstagramAutomation,
  queueInstagramComment,
} from '@/lib/instagram/queue-automation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (
    expected &&
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') === expected &&
    params.get('hub.challenge')
  )
    return new Response(params.get('hub.challenge'), { status: 200 });
  return new Response('Não autorizado', { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  const signature = request.headers.get('x-hub-signature-256') ?? '';
  const raw = await request.text();
  const digest = secret
    ? createHmac('sha256', secret).update(raw).digest('hex')
    : '';
  const supplied = /^sha256=([0-9a-f]{64})$/i.exec(signature)?.[1] ?? '';
  if (
    !secret ||
    !supplied ||
    !timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(supplied, 'hex'))
  )
    return new Response('Assinatura inválida', { status: 401 });
  let body: {
    object?: string;
    entry?: Array<{
      id?: string;
      messaging?: Array<{
        sender?: { id?: string };
        timestamp?: number;
        message?: { mid?: string; text?: string; is_echo?: boolean };
      }>;
      changes?: Array<{
        field?: string;
        value?: {
          id?: string;
          text?: string;
          media?: { id?: string };
          from?: { id?: string };
        };
      }>;
    }>;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }
  if (!body || typeof body !== 'object')
    return new Response('JSON inválido', { status: 400 });
  if (body.object !== 'instagram') return new Response('EVENT_RECEIVED');
  if (!Array.isArray(body.entry)) return new Response('EVENT_RECEIVED');
  const db = supabaseAdmin();
  for (const entry of body.entry ?? []) {
    if (!entry || !entry.id || !/^\d+$/.test(entry.id)) continue;
    const { data: channel, error: channelError } = await db
      .from('instagram_channels')
      .select('id,account_id')
      .eq('instagram_id', entry.id)
      .maybeSingle();
    if (channelError)
      return new Response('Erro ao consultar canal', { status: 500 });
    if (!channel) continue;
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const comment = change?.value;
      if (
        change?.field !== 'comments' ||
        !comment?.id ||
        !/^\d+$/.test(comment.id) ||
        typeof comment.text !== 'string' ||
        comment.from?.id === entry.id
      )
        continue;
      try {
        await queueInstagramComment(db, {
          accountId: channel.account_id,
          channelId: channel.id,
          commentId: comment.id,
          mediaId: comment.media?.id || null,
          text: comment.text,
        });
      } catch {
        return new Response('Erro ao agendar resposta ao comentário', {
          status: 500,
        });
      }
    }
    for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (!event || typeof event !== 'object') continue;
      const sender = event.sender?.id;
      const msg = event.message;
      if (
        !sender ||
        !/^\d+$/.test(sender) ||
        !msg?.mid ||
        !msg.text ||
        msg.is_echo
      )
        continue;
      const created = new Date(
        typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
          ? event.timestamp
          : Date.now()
      );
      if (!Number.isFinite(created.getTime())) continue;
      const { data: conversation, error: conversationError } = await db
        .from('instagram_conversations')
        .upsert(
          {
            account_id: channel.account_id,
            channel_id: channel.id,
            instagram_user_id: sender,
            last_message_at: created.toISOString(),
          },
          { onConflict: 'channel_id,instagram_user_id', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle();
      if (conversationError)
        return new Response('Erro ao registrar conversa', { status: 500 });
      let id = conversation?.id;
      if (!id) {
        const existing = await db
          .from('instagram_conversations')
          .select('id')
          .eq('channel_id', channel.id)
          .eq('instagram_user_id', sender)
          .maybeSingle();
        if (existing.error || !existing.data)
          return new Response('Erro ao consultar conversa', { status: 500 });
        id = existing.data.id;
      }
      const { error } = await db
        .from('instagram_messages')
        .upsert(
          {
            account_id: channel.account_id,
            conversation_id: id,
            external_id: msg.mid,
            direction: 'inbound',
            body: msg.text,
            created_at: created.toISOString(),
          },
          { onConflict: 'external_id', ignoreDuplicates: true }
        );
      if (error)
        return new Response('Erro ao registrar mensagem', { status: 500 });
      const update = await db
        .from('instagram_conversations')
        .update({ last_message_at: created.toISOString() })
        .eq('id', id)
        .eq('account_id', channel.account_id)
        .lt('last_message_at', created.toISOString());
      if (update.error)
        return new Response('Erro ao atualizar conversa', { status: 500 });
      try {
        await queueInstagramAutomation(db, {
          accountId: channel.account_id,
          channelId: channel.id,
          conversationId: id,
          senderId: sender,
          messageId: msg.mid,
          text: msg.text,
        });
      } catch {
        // A retry can safely reprocess the event because messages and runs are unique.
        return new Response('Erro ao agendar automação', { status: 500 });
      }
    }
  }
  return new Response('EVENT_RECEIVED');
}
