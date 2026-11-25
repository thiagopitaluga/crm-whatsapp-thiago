import { describe, expect, it } from 'vitest';
import {
  filterInboxChannel,
  instagramInboxItem,
  type InstagramInboxConversation,
} from './instagram';
import type { Conversation } from '@/types';
const instagram: InstagramInboxConversation = {
  id: 'ig-conversation',
  instagram_user_id: '123',
  last_message_at: '2026-11-25T12:00:00Z',
  contact_id: null,
  contact: null,
  status: 'human',
  tags: ['Interessado'],
  profile_data: { username: 'cliente' },
  channel_username: 'empresa',
  assigned_agent_id: null,
  unread_count: 2,
};
const whatsapp: Conversation = {
  id: 'wa-conversation',
  user_id: 'user',
  contact_id: 'contact',
  status: 'open',
  unread_count: 1,
  created_at: '2026-11-25T10:00:00Z',
  updated_at: '2026-11-25T10:00:00Z',
  last_message_at: '2026-11-25T11:00:00Z',
};
describe('unified inbox channels', () => {
  it('marks Instagram explicitly without inventing a phone number or CRM contact', () => {
    const item = instagramInboxItem(instagram);
    expect(item.inbox_channel).toBe('instagram');
    expect(item.contact?.name).toBe('cliente');
    expect(item.contact?.phone).toBe('');
    expect(item.contact_id).toBe('');
    expect(item.status).toBe('pending');
  });
  it('mixes channels by latest activity and filters them independently', () => {
    const ig = instagramInboxItem(instagram);
    expect(filterInboxChannel([whatsapp, ig], 'all').map((c) => c.id)).toEqual([
      'ig-conversation',
      'wa-conversation',
    ]);
    expect(filterInboxChannel([ig, whatsapp], 'whatsapp')).toEqual([whatsapp]);
    expect(filterInboxChannel([whatsapp, ig], 'instagram')).toEqual([ig]);
  });
  it('retains the real conversation ID so an Instagram selection never routes as WhatsApp', () => {
    const item = instagramInboxItem(instagram);
    expect(item.id).toBe(instagram.id);
    expect(item.inbox_channel).not.toBe('whatsapp');
    expect(item.inbox_tag_names).toEqual(['Interessado']);
  });
});
