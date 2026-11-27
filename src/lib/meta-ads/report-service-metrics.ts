export type ServiceMessage = {
  conversation_id: string;
  sender_type: string;
  created_at: string;
};
export function calculateServiceMetrics(messages: ServiceMessage[]) {
  const conversations = new Map<string, { inbound?: number; reply?: number }>();
  for (const message of [...messages].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
  )) {
    const time = Date.parse(message.created_at);
    if (!Number.isFinite(time)) continue;
    const item = conversations.get(message.conversation_id) ?? {};
    if (message.sender_type === 'customer' && item.inbound === undefined)
      item.inbound = time;
    if (
      ['agent', 'bot'].includes(message.sender_type) &&
      item.inbound !== undefined &&
      item.reply === undefined
    )
      item.reply = time;
    conversations.set(message.conversation_id, item);
  }
  const received = [...conversations.values()].filter(
    (item) => item.inbound !== undefined
  );
  const seconds = received
    .filter((item) => item.reply !== undefined)
    .map((item) => (item.reply! - item.inbound!) / 1000);
  return {
    received: received.length,
    replied: seconds.length,
    unanswered: received.length - seconds.length,
    averageSeconds: seconds.length
      ? seconds.reduce((sum, value) => sum + value, 0) / seconds.length
      : null,
    withinFiveMinutes: seconds.filter((value) => value <= 300).length,
    withinHour: seconds.filter((value) => value <= 3600).length,
  };
}
export type ServiceMetrics = ReturnType<typeof calculateServiceMetrics>;
export type OrganicReport = {
  connected: boolean;
  profiles: Array<{
    name: string;
    followers: number | null;
    growth: number | null;
    engagementRate: number | null;
    interactions: number | null;
    posts: number | null;
    reach: number | null;
    visits: number | null;
  }>;
  error?: boolean;
};
