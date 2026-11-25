import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/ai/admin-client';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import {
  ingestExternalWhatsAppMessage,
  type ExternalMessageContentType,
} from '@/lib/leads/ingest';
import { extensionForMime } from '@/lib/media/filename';
import { normalizeEvolutionReferral } from '@/lib/whatsapp/evolution-referral';
import { resolveInboundAttribution } from '@/lib/attribution/click-tracking';
import { recordEvolutionCtwaAttribution } from '@/lib/attribution/ctwa-inbound';
import {
  parseEvolutionReceipt,
  receiptPreviousStatuses,
} from '@/lib/whatsapp/evolution-receipts';
import {
  fetchEvolutionMediaBase64,
  getEvolutionInstanceName,
  isValidEvolutionWebhookSecret,
} from '@/lib/whatsapp/qr-connector';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** Receives only the Evolution events needed by the CRM; history sync is ignored. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (
    !isValidEvolutionWebhookSecret(
      request.headers.get('x-evolution-webhook-secret')
    )
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => null));
  const event = typeof body?.event === 'string' ? body.event.toLowerCase() : '';
  const instance = typeof body?.instance === 'string' ? body.instance : '';
  const accountId =
    typeof url.searchParams.get('account_id') === 'string'
      ? url.searchParams.get('account_id')!
      : '';
  const requestedChannelKey =
    url.searchParams.get('channel_key') || 'whatsapp_evolution';
  let channelKey = 'whatsapp_evolution';
  let validInstance = instance === getEvolutionInstanceName(accountId);
  if (requestedChannelKey !== 'whatsapp_evolution') {
    const { data: savedChannel } = await supabaseAdmin()
      .from('whatsapp_channels')
      .select('channel_key, evolution_instance_name')
      .eq('account_id', accountId)
      .eq('channel_key', requestedChannelKey)
      .eq('evolution_instance_name', instance)
      .maybeSingle();
    validInstance = Boolean(savedChannel);
    channelKey = savedChannel?.channel_key ?? '';
  }
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !validInstance) {
    return NextResponse.json(
      { error: 'Invalid Evolution instance' },
      { status: 400 }
    );
  }
  if (event === 'messages.update') {
    const db = supabaseAdmin();
    const rows = Array.isArray(body?.data) ? body.data : [body?.data];
    for (const value of rows) {
      const receipt = parseEvolutionReceipt(value);
      if (!receipt) continue;
      const { data: matches, error } = await db
        .from('messages')
        .select('id, conversations!inner(id)')
        .eq('message_id', receipt.id)
        .in('sender_type', ['agent', 'bot'])
        .eq('conversations.account_id', accountId)
        .eq('conversations.whatsapp_channel_key', channelKey);
      if (error)
        return NextResponse.json(
          { error: 'Falha ao localizar a mensagem.' },
          { status: 503 }
        );
      if (!matches?.length) continue;
      const { error: updateError } = await db
        .from('messages')
        .update({ status: receipt.status })
        .in(
          'id',
          matches.map(({ id }) => id)
        )
        .in('status', receiptPreviousStatuses[receipt.status]);
      if (updateError)
        return NextResponse.json(
          { error: 'Falha ao salvar a confirmação.' },
          { status: 503 }
        );
    }
    return NextResponse.json({ accepted: true });
  }
  if (event !== 'messages.upsert')
    return NextResponse.json({
      accepted: true,
      ignored: event || 'unknown_event',
    });

  const dataRows = Array.isArray(body?.data) ? body.data : [body?.data];
  let processed = 0;
  for (const value of dataRows) {
    const message = asRecord(value);
    if (!message) continue;
    const key = asRecord(message.key);
    if (!key) continue;
    const remoteJid = typeof key?.remoteJid === 'string' ? key.remoteJid : '';
    const messageId = typeof key?.id === 'string' ? key.id : '';
    if (!remoteJid || !messageId) continue;

    const isGroup = remoteJid.endsWith('@g.us');
    if (isGroup) {
      if (
        process.env.EVOLUTION_GROUP_MONITOR_ENABLED === 'true' ||
        process.env.QR_GROUP_MONITOR_ENABLED === 'true'
      ) {
        await ingestGroupMessage(accountId, remoteJid, message, key);
        processed++;
      }
      continue;
    }

    const alternateJid =
      typeof key?.remoteJidAlt === 'string' ? key.remoteJidAlt : '';
    const jid = [alternateJid, remoteJid].find((candidate) =>
      candidate.endsWith('@s.whatsapp.net')
    );
    if (!jid || jid.endsWith('@broadcast') || remoteJid === 'status@broadcast')
      continue;
    const phone = `+${jid.slice(0, jid.indexOf('@')).replace(/\D/g, '')}`;
    if (phone === '+') continue;

    const content = extractMessageContent(message);
    if (!content) continue;
    const createdAt = toIsoTimestamp(
      message.messageTimestamp ?? body?.date_time
    );
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    if (
      content.mediaKind &&
      ['image', 'audio', 'document'].includes(content.mediaKind)
    ) {
      const media = await uploadEvolutionMedia(
        accountId,
        messageId,
        message,
        content.mediaKind,
        instance
      );
      if (media) {
        mediaUrl = media.url;
        mediaType = media.mimeType;
      }
    }

    try {
      const ingested = await ingestExternalWhatsAppMessage(
        supabaseAdmin(),
        accountId,
        {
          phone,
          name:
            key?.fromMe === true
              ? null
              : typeof message.pushName === 'string'
                ? message.pushName.trim() || null
                : null,
          direction: key?.fromMe === true ? 'outbound' : 'inbound',
          messageId,
          contentText: content.text,
          contentType: content.type,
          mediaUrl,
          mediaType,
          createdAt,
        }
      );
      if (ingested?.conversationId) {
        await supabaseAdmin()
          .from('conversations')
          .update({ whatsapp_channel_key: channelKey })
          .eq('id', ingested.conversationId);
      }
      if (key?.fromMe !== true && ingested?.messageInserted) {
        try {
          const db = supabaseAdmin();
          const referral = normalizeEvolutionReferral(message);
          if (referral)
            await recordEvolutionCtwaAttribution({
              db,
              accountId,
              conversationId: ingested.conversationId,
              contactId: ingested.contactId,
              messageId,
              referral,
              occurredAt: createdAt,
            });
        } catch (error) {
          console.error(
            '[evolution-webhook] attribution failed:',
            error instanceof Error ? error.message : 'unknown error'
          );
        }
        try {
          await resolveInboundAttribution(
            supabaseAdmin(),
            accountId,
            content.text,
            {
              contactId: ingested.contactId,
              conversationId: ingested.conversationId,
            }
          );
        } catch (error) {
          console.error(
            '[evolution-webhook] tracking link failed:',
            error instanceof Error ? error.message : 'unknown error'
          );
        }
      }
      if (
        key?.fromMe !== true &&
        ingested?.messageInserted &&
        content.type === 'text'
      ) {
        const { data: account } = await supabaseAdmin()
          .from('accounts')
          .select('owner_user_id')
          .eq('id', accountId)
          .maybeSingle();
        if (typeof account?.owner_user_id === 'string') {
          await dispatchInboundToAiReply({
            accountId,
            conversationId: ingested.conversationId,
            contactId: ingested.contactId,
            configOwnerUserId: account.owner_user_id,
            channel: channelKey,
          });
        }
      }
      processed++;
    } catch (error) {
      console.error(
        '[evolution-webhook] message ingest failed:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return NextResponse.json(
        { error: 'Message ingest failed' },
        { status: 500 }
      );
    }
  }
  return NextResponse.json({ accepted: true, processed });
}

function extractMessageContent(message: Record<string, unknown>): {
  text: string;
  type: ExternalMessageContentType;
  mediaKind: string | null;
} | null {
  let content = asRecord(message.message);
  for (let depth = 0; depth < 5 && content; depth++) {
    const wrapper =
      asRecord(content.ephemeralMessage) ??
      asRecord(content.viewOnceMessage) ??
      asRecord(content.viewOnceMessageV2) ??
      asRecord(content.viewOnceMessageV2Extension) ??
      asRecord(content.documentWithCaptionMessage) ??
      asRecord(content.editedMessage);
    const nested = asRecord(wrapper?.message);
    if (!nested) break;
    content = nested;
  }
  if (!content) return null;

  const conversation =
    typeof content.conversation === 'string' ? content.conversation : '';
  const extended = asRecord(content.extendedTextMessage);
  const extendedText = typeof extended?.text === 'string' ? extended.text : '';
  const plainText = conversation || extendedText;
  if (plainText.trim())
    return { text: plainText.trim(), type: 'text', mediaKind: null };

  const image = asRecord(content.imageMessage);
  if (image)
    return {
      text: stringOr(image.caption, '[Imagem]'),
      type: 'image',
      mediaKind: 'image',
    };
  const video = asRecord(content.videoMessage) ?? asRecord(content.ptvMessage);
  if (video)
    return {
      text: stringOr(video.caption, '[Vídeo]'),
      type: 'video',
      mediaKind: 'video',
    };
  const document = asRecord(content.documentMessage);
  if (document)
    return {
      text: stringOr(document.fileName, '[Documento]'),
      type: 'document',
      mediaKind: 'document',
    };
  if (asRecord(content.audioMessage))
    return { text: '[Áudio]', type: 'audio', mediaKind: 'audio' };
  if (asRecord(content.stickerMessage))
    return { text: '[Figurinha]', type: 'image', mediaKind: null };
  if (asRecord(content.locationMessage))
    return { text: '[Localização]', type: 'location', mediaKind: null };
  if (
    asRecord(content.contactMessage) ||
    asRecord(content.contactsArrayMessage)
  )
    return { text: '[Contato]', type: 'text', mediaKind: null };
  const buttonReply = asRecord(content.buttonsResponseMessage);
  const listReply = asRecord(content.listResponseMessage);
  const templateReply = asRecord(content.templateButtonReplyMessage);
  const interactiveReply = asRecord(content.interactiveResponseMessage);
  const interactiveBody = asRecord(interactiveReply?.body);
  const reply = [
    buttonReply?.selectedDisplayText,
    listReply?.title,
    templateReply?.selectedDisplayText,
    interactiveBody?.text,
  ].find((value) => typeof value === 'string' && value.trim());
  return typeof reply === 'string'
    ? { text: reply.trim(), type: 'interactive', mediaKind: null }
    : null;
}

async function uploadEvolutionMedia(
  accountId: string,
  messageId: string,
  message: Record<string, unknown>,
  mediaKind: string | null,
  instanceName: string
): Promise<{ url: string; mimeType: string } | null> {
  const data = await fetchEvolutionMediaBase64(
    accountId,
    message,
    AbortSignal.timeout(20_000),
    instanceName
  ).catch(() => null);
  if (!data) return null;
  const bytes = Buffer.from(data.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) return null;

  const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'https://organizap.tpxdigital.com';
  if (!secret) return null;
  const reservation = await fetch(
    new URL('/api/internal/qr-media-upload', siteUrl),
    {
      method: 'POST',
      headers: {
        'x-connector-secret': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        account_id: accountId,
        message_id: messageId,
        content_hash: createHash('sha256').update(bytes).digest('hex'),
        kind: inferStoredMediaKind(mediaKind),
        mime_type: data.mimeType,
        file_name:
          data.fileName || `${messageId}.${extensionForMime(data.mimeType)}`,
      }),
      signal: AbortSignal.timeout(8_000),
    }
  ).catch(() => null);
  if (!reservation?.ok) return null;
  const upload = (await reservation.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    typeof upload?.upload_url !== 'string' ||
    typeof upload.media_url !== 'string'
  )
    return null;
  const stored = await fetch(upload.upload_url, {
    method: 'PUT',
    headers: { 'content-type': data.mimeType, 'x-upsert': 'true' },
    body: bytes,
    signal: AbortSignal.timeout(28_000),
  }).catch(() => null);
  return stored?.ok ? { url: upload.media_url, mimeType: data.mimeType } : null;
}

function inferStoredMediaKind(
  mediaKind: string | null
): 'image' | 'audio' | 'document' {
  return mediaKind === 'audio' || mediaKind === 'document'
    ? mediaKind
    : 'image';
}

async function ingestGroupMessage(
  accountId: string,
  groupJid: string,
  message: Record<string, unknown>,
  key: Record<string, unknown>
) {
  const messageId = typeof key.id === 'string' ? key.id : '';
  const content = extractMessageContent(message);
  if (!messageId || !content) return;
  const admin = supabaseAdmin();
  const { data: known } = await admin
    .from('whatsapp_groups')
    .select('id')
    .eq('account_id', accountId)
    .eq('group_jid', groupJid)
    .maybeSingle();
  if (!known) return;
  const participant =
    typeof key.participantAlt === 'string'
      ? key.participantAlt
      : typeof key.participant === 'string'
        ? key.participant
        : null;
  const timestamp = toIsoTimestamp(message.messageTimestamp);
  const { error } = await admin.from('group_messages').upsert(
    {
      account_id: accountId,
      group_jid: groupJid,
      message_id: messageId,
      participant_jid: participant,
      participant_name:
        typeof message.pushName === 'string'
          ? message.pushName.slice(0, 200)
          : null,
      from_me: key.fromMe === true,
      message_type: content.type,
      content_text: content.text.slice(0, 4096),
      created_at: timestamp,
    },
    { onConflict: 'account_id,group_jid,message_id', ignoreDuplicates: true }
  );
  if (error)
    console.error(
      '[evolution-webhook] group message insert failed:',
      error.message
    );
  await admin
    .from('whatsapp_groups')
    .update({ last_message_at: timestamp })
    .eq('account_id', accountId)
    .eq('group_jid', groupJid);
}

function toIsoTimestamp(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0)
      return new Date(numeric * 1000).toISOString();
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
