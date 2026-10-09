export const GROUP_MENTION_ALL_TOKEN = '{{todos}}'

export function supportsGroupMentionAll(kind: string): boolean {
  return kind === 'text' || kind === 'image' || kind === 'video'
}

export function hasGroupMentionAll(message: string): boolean {
  return message.includes(GROUP_MENTION_ALL_TOKEN)
}

export function stripGroupMentionAll(message: string): string {
  return message.replaceAll(GROUP_MENTION_ALL_TOKEN, '').trim()
}

export function composeGroupMessage(message: string, mentionAll: boolean): string {
  const plain = stripGroupMentionAll(message)
  return mentionAll ? `${plain}\n${GROUP_MENTION_ALL_TOKEN}`.trim() : plain
}
