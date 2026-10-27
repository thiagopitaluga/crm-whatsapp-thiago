export type LegacyConversation = {
  last_message_text: string | null;
  messages: {
    content_text: string | null;
    content_type: string;
    media_url: string | null;
  }[];
};

export function isPlaceholderOnlyContact(
  conversations: LegacyConversation[]
): boolean {
  if (!conversations.length) return false;
  const placeholder = (text: string | null) =>
    /^\[mensagem\]$/i.test(text?.trim() ?? '');
  // Also protect genuine history preserved only in a conversation preview.
  if (
    conversations.some(
      (c) => c.last_message_text?.trim() && !placeholder(c.last_message_text)
    )
  )
    return false;
  const messages = conversations.flatMap((c) => c.messages);
  if (messages.length === 1) {
    const message = messages[0];
    return (
      message.content_type === 'text' &&
      !message.media_url &&
      placeholder(message.content_text)
    );
  }
  // The first connector version stored a synthetic preview without a row.
  return (
    messages.length === 0 &&
    conversations.some((c) => placeholder(c.last_message_text))
  );
}
