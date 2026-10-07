import { describe, expect, it } from 'vitest';
import { normalizeMetaInsight, normalizeMetaLead } from './normalize';

describe('Meta payload normalization', () => {
  it('normalizes a daily ad row without double-counting lead action aliases', () => {
    const result = normalizeMetaInsight(
      {
        ad_id: '123456',
        date_start: '2026-10-06',
        account_currency: 'BRL',
        spend: '49.90',
        impressions: '2000',
        clicks: '30',
        inline_link_clicks: '20',
        actions: [
          { action_type: 'lead', value: '4' },
          { action_type: 'onsite_conversion.lead_grouped', value: '4' },
        ],
      },
      'account-id',
      '1234567'
    );
    expect(result).toMatchObject({
      spend: 49.9,
      impressions: 2000,
      reported_leads: 4,
      ad_id: '123456',
    });
  });

  it('rejects incomplete insight identities and impossible metrics', () => {
    expect(() =>
      normalizeMetaInsight(
        { ad_id: 'x', date_start: '2026-10-06' },
        'account-id',
        '1234567'
      )
    ).toThrow();
    expect(() =>
      normalizeMetaInsight(
        { ad_id: '123456', date_start: '2026-10-06', spend: '-1' },
        'account-id',
        '1234567'
      )
    ).toThrow();
  });

  it('keeps form answers while extracting contact information', () => {
    const lead = normalizeMetaLead({
      id: '12345678',
      form_id: '98765432',
      created_time: '2026-10-06T12:00:00+0000',
      field_data: [
        { name: 'full_name', values: ['Maria Silva'] },
        { name: 'phone_number', values: ['+5511999999999'] },
      ],
    });
    expect(lead).toMatchObject({
      leadId: '12345678',
      formId: '98765432',
      name: 'Maria Silva',
      phone: '+5511999999999',
    });
    expect(lead.fields.full_name).toBe('Maria Silva');
  });
});

