import assert from 'node:assert/strict';
import test from 'node:test';

import { getMessageContent, isRecentMessage } from './message-policy.js';

const now = Date.UTC(2026, 9, 14, 12);

test('accepts a current WhatsApp timestamp, including a Long-like value', () => {
  assert.equal(
    isRecentMessage({ toString: () => String(now / 1000) }, now),
    true
  );
  assert.equal(isRecentMessage((now - 23 * 60 * 60 * 1000) / 1000, now), true);
});

test('rejects stale, missing and implausibly future timestamps', () => {
  assert.equal(isRecentMessage((now - 25 * 60 * 60 * 1000) / 1000, now), false);
  assert.equal(isRecentMessage(undefined, now), false);
  assert.equal(isRecentMessage((now + 6 * 60 * 1000) / 1000, now), false);
});

test('ignores protocol and reaction events instead of inventing [Mensagem]', () => {
  assert.equal(
    getMessageContent({ message: { protocolMessage: { type: 1 } } }),
    null
  );
  assert.equal(
    getMessageContent({ message: { reactionMessage: { text: '👍' } } }),
    null
  );
  assert.equal(getMessageContent({ message: {} }), null);
});

test('keeps text and media inside ephemeral and view-once wrappers', () => {
  assert.deepEqual(
    getMessageContent({
      message: { ephemeralMessage: { message: { conversation: 'Olá' } } },
    }),
    { preview: 'Olá', text: 'Olá', type: 'text' }
  );
  assert.deepEqual(
    getMessageContent({
      message: {
        viewOnceMessageV2: { message: { imageMessage: { caption: 'Foto' } } },
      },
    }),
    { preview: 'Foto', text: 'Foto', type: 'image', media: { caption: 'Foto' } }
  );
});
