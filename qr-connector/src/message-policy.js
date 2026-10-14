// A reconnect can deliver offline messages as "notify". Only a genuinely
// recent WhatsApp message may create or update a CRM conversation.
export const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function isRecentMessage(timestamp, now = Date.now()) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  const age = now - seconds * 1000;
  return age >= -MAX_FUTURE_SKEW_MS && age <= MAX_MESSAGE_AGE_MS;
}

function unwrapContent(message) {
  let content = message?.message;
  for (let depth = 0; depth < 5 && content; depth += 1) {
    const wrapper =
      content.ephemeralMessage ||
      content.viewOnceMessage ||
      content.viewOnceMessageV2 ||
      content.viewOnceMessageV2Extension ||
      content.documentWithCaptionMessage ||
      content.editedMessage ||
      content.associatedChildMessage;
    if (!wrapper?.message) break;
    content = wrapper.message;
  }
  return content || null;
}

export function getMessageContent(message) {
  const content = unwrapContent(message);
  if (!content) return null;

  const text = content.conversation || content.extendedTextMessage?.text;
  if (typeof text === 'string' && text.trim()) {
    return { preview: text.trim(), text: text.trim(), type: 'text' };
  }
  if (content.imageMessage) {
    const caption = content.imageMessage.caption?.trim() || '[Imagem]';
    return {
      preview: caption,
      text: caption,
      type: 'image',
      media: content.imageMessage,
    };
  }
  const video = content.videoMessage || content.ptvMessage;
  if (video) {
    const caption = video.caption?.trim() || '[Vídeo]';
    return { preview: caption, text: caption, type: 'video', media: video };
  }
  if (content.documentMessage) {
    const fileName = content.documentMessage.fileName?.trim() || '[Documento]';
    return {
      preview: fileName,
      text: fileName,
      type: 'document',
      media: content.documentMessage,
    };
  }
  if (content.audioMessage) {
    return {
      preview: '[Áudio]',
      text: '[Áudio]',
      type: 'audio',
      media: content.audioMessage,
    };
  }
  if (content.stickerMessage) {
    return { preview: '[Figurinha]', text: '[Figurinha]', type: 'image' };
  }
  if (content.locationMessage) {
    return {
      preview: '[Localização]',
      text: '[Localização]',
      type: 'location',
    };
  }
  if (content.contactMessage || content.contactsArrayMessage) {
    return { preview: '[Contato]', text: '[Contato]', type: 'text' };
  }

  const reply =
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    content.interactiveResponseMessage?.body?.text;
  if (typeof reply === 'string' && reply.trim()) {
    return { preview: reply.trim(), text: reply.trim(), type: 'text' };
  }

  // Protocol, reaction, sync and other metadata events are not customer
  // messages. In particular they must never create a lead named [Mensagem].
  return null;
}
