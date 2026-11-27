import { describe, expect, it } from 'vitest';
import { brazilPhone, parseCampaignInput, personalizeCampaignMessage, validateSpintax } from './evolution-campaign';

const id = '11111111-1111-4111-8111-111111111111';
const input = {
  name: 'Campanha de teste', messages: [{ text: 'Olá, {first_name}!' }],
  audience: { mode: 'contacts', contactIds: [id] },
  delivery: { senderIds: [id], dailyLimit: 100, windowStart: '09:00', windowEnd: '18:00',
    weekdays: [1,2,3,4,5], minDelaySeconds: 45, maxDelaySeconds: 120,
    batchSize: 30, batchPauseMinutes: 5, sendNow: true },
  onSent: {}, onReply: {}, consentConfirmed: true,
};

describe('Evolution campaigns', () => {
  it('accepts a valid scheduled campaign and normalizes its limits', () => {
    const result = parseCampaignInput(input);
    expect('value' in result && result.value.delivery.dailyLimit).toBe(100);
  });
  it('rejects missing audience, sending number, consent and inverted delays', () => {
    expect('error' in parseCampaignInput({ ...input, audience: { mode: 'contacts', contactIds: [] } })).toBe(true);
    expect('error' in parseCampaignInput({ ...input, delivery: { ...input.delivery, senderIds: [] } })).toBe(true);
    expect('error' in parseCampaignInput({ ...input, consentConfirmed: false })).toBe(true);
    expect('error' in parseCampaignInput({ ...input, delivery: { ...input.delivery, minDelaySeconds: 120, maxDelaySeconds: 45 } })).toBe(true);
  });
  it('normalizes Brazilian numbers and substitutes variables and spintax', () => {
    expect(brazilPhone('(11) 97192-3669')).toBe('5511971923669');
    const text = personalizeCampaignMessage('{Olá|Oi}, {first_name}! {phone}',
      { name: 'Maria Silva', phone: '5511971923669' }, 1);
    expect(text).toMatch(/^(Olá|Oi), Maria! 5511971923669$/);
  });
  it('previews multiple options and rejects incomplete spintax before scheduling', () => {
    const message = '{Olá|Oi|Bom dia}, {first_name}! {Tudo bem?|Como vai?}';
    expect(validateSpintax(message)).toBeNull();
    const variations = [1, 2, 3, 4].map((seed) => personalizeCampaignMessage(message,
      { name: 'Maria Silva', phone: '5511971923669' }, seed));
    expect(new Set(variations).size).toBeGreaterThan(1);
    expect(variations.every((text) => text.includes('Maria!'))).toBe(true);
    expect(validateSpintax('{Olá|}')).not.toBeNull();
    expect('error' in parseCampaignInput({ ...input, messages: [{ text: 'Olá {Oi|' }] })).toBe(true);
  });
});
