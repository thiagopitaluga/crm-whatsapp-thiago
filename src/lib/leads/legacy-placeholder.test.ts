import { expect, it } from 'vitest';
import { isPlaceholderOnlyContact } from './legacy-placeholder';

const message = {
  content_text: '[Mensagem]',
  content_type: 'text',
  media_url: null,
};
const conversation = { last_message_text: '[Mensagem]', messages: [message] };

it('identifies a single synthetic message or a legacy preview without messages', () => {
  expect(isPlaceholderOnlyContact([conversation])).toBe(true);
  expect(isPlaceholderOnlyContact([{ ...conversation, messages: [] }])).toBe(
    true
  );
});
it('protects contacts with real history, multiple messages or media', () => {
  expect(isPlaceholderOnlyContact([])).toBe(false);
  expect(
    isPlaceholderOnlyContact([
      { ...conversation, messages: [message, message] },
    ])
  ).toBe(false);
  expect(
    isPlaceholderOnlyContact([
      conversation,
      { last_message_text: 'Olá', messages: [] },
    ])
  ).toBe(false);
  expect(
    isPlaceholderOnlyContact([
      { ...conversation, messages: [{ ...message, content_type: 'image' }] },
    ])
  ).toBe(false);
  expect(
    isPlaceholderOnlyContact([
      {
        ...conversation,
        messages: [{ ...message, media_url: 'https://example.com/photo' }],
      },
    ])
  ).toBe(false);
  expect(
    isPlaceholderOnlyContact([
      conversation,
      {
        last_message_text: null,
        messages: [{ ...message, content_text: 'Oi' }],
      },
    ])
  ).toBe(false);
});
