import type { Message } from '@/types';
export function mergeChatMessage(
  messages: Message[],
  message: Message
): Message[] {
  const match = message.id.startsWith('temp-')
    ? -1
    : messages.findIndex(
        (m) =>
          m.id.startsWith('temp-') &&
          m.sender_type === message.sender_type &&
          m.content_type === message.content_type &&
          (m.content_text ?? '') === (message.content_text ?? '')
      );
  const filtered =
    match < 0 ? messages : messages.filter((_, i) => i !== match);
  return (
    filtered.some((m) => m.id === message.id)
      ? filtered.map((m) => (m.id === message.id ? { ...m, ...message } : m))
      : [...filtered, message]
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
