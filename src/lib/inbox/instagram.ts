import type { Contact, Conversation } from '@/types';
export type InboxChannelFilter = 'all' | 'whatsapp' | 'instagram';
export type InstagramInboxConversation = {
  id: string;
  account_id?: string;
  created_at?: string;
  instagram_user_id: string;
  last_message_at: string;
  last_message_text?: string;
  contact_id: string | null;
  contact: Contact | null;
  status: string;
  tags: string[];
  profile_data: { name?: string; username?: string; profile_pic?: string };
  channel_username: string;
  assigned_agent_id: string | null;
  unread_count: number;
  deal_id?: string;
};
export function instagramInboxItem(
  c: InstagramInboxConversation
): Conversation {
  const created = c.created_at || c.last_message_at;
  return {
    id: c.id,
    user_id: '',
    contact_id: c.contact_id ?? '',
    inbox_channel: 'instagram',
    inbox_channel_label: c.channel_username,
    inbox_tag_names: c.tags ?? [],
    status:
      c.status === 'closed'
        ? 'closed'
        : c.status === 'human'
          ? 'pending'
          : 'open',
    assigned_agent_id: c.assigned_agent_id ?? undefined,
    last_message_at: c.last_message_at,
    last_message_text: c.last_message_text,
    unread_count: c.unread_count,
    created_at: created,
    updated_at: c.last_message_at,
    contact: {
      ...(c.contact ?? {
        id: c.contact_id ?? '',
        account_id: c.account_id ?? '',
        user_id: '',
        phone: '',
        created_at: created,
        updated_at: created,
      }),
      name:
        c.profile_data?.name ||
        c.contact?.name ||
        c.profile_data?.username ||
        `Contato ${c.instagram_user_id}`,
      avatar_url: c.profile_data?.profile_pic || c.contact?.avatar_url,
    },
  };
}
export function filterInboxChannel(
  items: Conversation[],
  filter: InboxChannelFilter
) {
  return items
    .filter(
      (item) =>
        filter === 'all' || (item.inbox_channel ?? 'whatsapp') === filter
    )
    .sort(
      (a, b) =>
        Date.parse(b.last_message_at ?? b.created_at) -
        Date.parse(a.last_message_at ?? a.created_at)
    );
}
