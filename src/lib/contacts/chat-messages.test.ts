import { describe, it, expect } from 'vitest';
import { mergeChatMessage } from './chat-messages';
import type { Message } from '@/types';
const msg = (
  id: string,
  text: string,
  sender: Message['sender_type'] = 'agent'
): Message => ({
  id,
  content_text: text,
  sender_type: sender,
  conversation_id: 'c',
  content_type: 'text',
  status: 'sent',
  created_at: '2026-11-20T10:00:00Z',
});
describe('Kanban chat message updates', () => {
  it('replaces only the matching optimistic message', () => {
    expect(
      mergeChatMessage(
        [msg('temp-1', 'a'), msg('temp-2', 'b')],
        msg('real', 'a')
      ).map((m) => m.id)
    ).toEqual(['temp-2', 'real']);
  });
  it('keeps pending outbound messages when the customer replies', () =>
    expect(
      mergeChatMessage(
        [msg('temp-1', 'a')],
        msg('incoming', 'reply', 'customer')
      )
    ).toHaveLength(2));
  it('updates acknowledgements without duplicating real messages', () => {
    const m = msg('real', 'a');
    expect(mergeChatMessage([m], { ...m, status: 'read' })).toEqual([
      { ...m, status: 'read' },
    ]);
  });
});
