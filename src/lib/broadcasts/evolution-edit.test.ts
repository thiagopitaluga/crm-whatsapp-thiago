import { describe, expect, it } from 'vitest';
import { parseEvolutionEdit } from './evolution-edit';
import type { CampaignDelivery } from './evolution-campaign';

const sender = '11111111-1111-4111-8111-111111111111';
const delivery: CampaignDelivery = {
  senderIds: [sender], dailyLimit: 35, windowStart: '08:05', windowEnd: '21:00',
  slots: [], weekdays: [0,1,2,3,4,5,6], minDelaySeconds: 720, maxDelaySeconds: 720,
  batchSize: 30, batchPauseMinutes: 5, sendNow: true, scheduledAt: '', endAt: '',
  timeZone: 'America/Sao_Paulo',
};
const original = { message_variants: [{ text: 'Olá!' }], delivery_config: delivery };

describe('editing an Evolution campaign', () => {
  it('accepts future changes while preserving the original scheduling fields', () => {
    const result = parseEvolutionEdit({ name: 'Nova campanha', messages: ['Oi, {name}!'],
      delivery: { ...delivery, dailyLimit: 25 } }, original);
    expect('value' in result && result.value.delivery.dailyLimit).toBe(25);
    expect('value' in result && result.value.delivery.timeZone).toBe('America/Sao_Paulo');
  });
  it('rejects invalid delays and past cutoffs', () => {
    expect('error' in parseEvolutionEdit({ name: 'Teste', messages: ['Oi'],
      delivery: { ...delivery, minDelaySeconds: 1000, maxDelaySeconds: 720 } }, original)).toBe(true);
    expect('error' in parseEvolutionEdit({ name: 'Teste', messages: ['Oi'],
      delivery: { ...delivery, endAt: '2020-01-01T00:00:00Z' } }, original)).toBe(true);
  });
});
