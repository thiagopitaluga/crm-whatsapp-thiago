import { describe, expect, it } from 'vitest';
import { acceptsWhatsAppMessage } from './message-policy';

const now = Date.UTC(2026, 9, 26, 12);
const message = {
  messageId: 'provider-id',
  contentText: 'Olá',
  createdAt: new Date(now).toISOString(),
};

describe('QR message admission at the CRM boundary', () => {
  it('accepts recent text and real media placeholders', () => {
    for (const contentText of ['Olá', '[Imagem]', '[Áudio]', '[Documento]']) {
      expect(acceptsWhatsAppMessage({ ...message, contentText }, now)).toBe(
        true
      );
    }
  });
  it('rejects legacy metadata, missing ids and dates before any contact is created', () => {
    for (const invalid of [
      { contentText: '[Mensagem]' },
      { contentText: ' [mensagem] ' },
      { contentText: ' ' },
      { messageId: '' },
      { createdAt: null },
      { createdAt: 'invalid' },
      { createdAt: new Date(now - 24 * 60 * 60_000 - 1).toISOString() },
      { createdAt: new Date(now + 5 * 60_000 + 1).toISOString() },
    ])
      expect(acceptsWhatsAppMessage({ ...message, ...invalid }, now)).toBe(
        false
      );
  });
});
