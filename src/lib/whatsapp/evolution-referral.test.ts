import { describe, expect, it } from 'vitest';
import { normalizeEvolutionReferral } from './evolution-referral';

describe('referência de anúncio recebida pela Evolution', () => {
  it('extrai o anúncio e o clique da mensagem, inclusive dentro de mensagens temporárias', () => {
    const message = { message: { ephemeralMessage: { message: { extendedTextMessage: {
      text: 'Olá', contextInfo: { externalAdReply: {
        sourceId: '987654321012345', sourceType: 'ad', ctwaClid: 'click-123', title: 'Lotes', mediaType: 2, thumbnailUrl: 'https://example.com/thumb',
      } },
    } } } } };
    expect(normalizeEvolutionReferral(message)).toMatchObject({ sourceId: '987654321012345', sourceType: 'ad', ctwaClid: 'click-123', headline: 'Lotes', mediaType: 'video' });
  });
  it('ignora prévias comuns e anúncios citados em mensagens anteriores', () => {
    expect(normalizeEvolutionReferral({ message: { extendedTextMessage: { contextInfo: { externalAdReply: { title: 'Link', sourceUrl: 'https://example.com' } } } } })).toBeNull();
    expect(normalizeEvolutionReferral({ message: { extendedTextMessage: { contextInfo: { quotedMessage: { extendedTextMessage: { contextInfo: { externalAdReply: { sourceId: '987654321' } } } } } } } })).toBeNull();
  });
  it('aceita o formato snake case repassado por integrações', () => {
    expect(normalizeEvolutionReferral({ referral: { source_id: '123456789', ctwa_clid: 'abc' } })).toMatchObject({ sourceId: '123456789', ctwaClid: 'abc' });
  });
});
