import { describe, expect, it } from 'vitest';
import { buildWhatsAppConversion, hashedMetaContact } from './meta-conversion';

const input = {
  config: {
    wabaId: '123456789',
    datasetId: '987654321',
    channelKey: 'whatsapp_cloud',
  },
  channelKey: 'whatsapp_cloud',
  clickId: 'real-observed-click',
  eventName: 'Purchase',
  eventId: 'stable-stage-job',
  occurredAt: '2026-11-26T10:00:00Z',
  value: 197,
  currency: 'BRL',
};
describe('WhatsApp conversion attribution', () => {
  it('uses the observed click without hashing it and the official messaging schema', () => {
    expect(buildWhatsAppConversion(input)).toEqual({
      event_name: 'Purchase',
      event_time: 1795687200,
      event_id: 'stable-stage-job',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: {
        whatsapp_business_account_id: '123456789',
        ctwa_clid: 'real-observed-click',
      },
      custom_data: { value: 197, currency: 'BRL' },
    });
    expect(buildWhatsAppConversion(input)).toEqual(
      buildWhatsAppConversion(input)
    );
  });
  it('never borrows attribution from a different WhatsApp channel', () => {
    expect(
      buildWhatsAppConversion({ ...input, channelKey: 'other-number' })
    ).toBeNull();
    expect(buildWhatsAppConversion({ ...input, channelKey: null })).toBeNull();
  });
  it('does not manufacture missing click identifiers', () => {
    expect(buildWhatsAppConversion({ ...input, clickId: null })).toBeNull();
    expect(buildWhatsAppConversion({ ...input, clickId: '  ' })).toBeNull();
  });
  it('rejects purchases with missing, negative or invalid revenue', () => {
    for (const value of [0, -5, NaN, Infinity])
      expect(() => buildWhatsAppConversion({ ...input, value })).toThrow(
        'valor positivo'
      );
    expect(() =>
      buildWhatsAppConversion({ ...input, occurredAt: 'invalid' })
    ).toThrow('Data');
  });
  it('keeps email and phone normalized and hashed for the existing pixel path', () => {
    const data = hashedMetaContact(' TEST@EXAMPLE.COM ', '+55 (11) 99999-9999');
    expect(data).toEqual(
      hashedMetaContact('test@example.com', '5511999999999')
    );
    expect(data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(data.ph[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashedMetaContact('', '---')).toEqual({});
  });
});
