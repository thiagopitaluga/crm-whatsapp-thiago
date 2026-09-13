import { describe, expect, it } from 'vitest';
import { normalizeMetaCtwaReferral } from './ctwa-referral';

describe('normalizeMetaCtwaReferral', () => {
  it('keeps the documented Meta referral fields and CTWA click id', () => {
    expect(
      normalizeMetaCtwaReferral({
        source_url: 'https://www.facebook.com/ad',
        source_type: 'ad',
        source_id: '1200000001',
        ctwa_clid: 'ARBsExampleClickId',
        headline: 'Lotes em oferta',
        body: 'Fale conosco no WhatsApp',
        media_type: 'image',
        image_url: 'https://cdn.example/ad.jpg',
        ignored_by_the_crm: 'do not store this',
      })
    ).toEqual({
      sourceUrl: 'https://www.facebook.com/ad',
      sourceType: 'ad',
      sourceId: '1200000001',
      ctwaClid: 'ARBsExampleClickId',
      headline: 'Lotes em oferta',
      body: 'Fale conosco no WhatsApp',
      mediaType: 'image',
      imageUrl: 'https://cdn.example/ad.jpg',
      videoUrl: null,
      thumbnailUrl: null,
      metadata: {
        source_url: 'https://www.facebook.com/ad',
        source_type: 'ad',
        source_id: '1200000001',
        ctwa_clid: 'ARBsExampleClickId',
        headline: 'Lotes em oferta',
        body: 'Fale conosco no WhatsApp',
        media_type: 'image',
        image_url: 'https://cdn.example/ad.jpg',
      },
    });
  });

  it('does not create an attribution from empty, malformed, or unknown payloads', () => {
    expect(normalizeMetaCtwaReferral(null)).toBeNull();
    expect(normalizeMetaCtwaReferral('not a referral')).toBeNull();
    expect(normalizeMetaCtwaReferral({ arbitrary: 'value' })).toBeNull();
    expect(normalizeMetaCtwaReferral({ ctwa_clid: '   ' })).toBeNull();
  });

  it('bounds external referral values before persistence', () => {
    const normalized = normalizeMetaCtwaReferral({
      source_id: 'x'.repeat(300),
      ctwa_clid: ' click-1 ',
    });

    expect(normalized?.sourceId).toHaveLength(255);
    expect(normalized?.ctwaClid).toBe('click-1');
  });
});
