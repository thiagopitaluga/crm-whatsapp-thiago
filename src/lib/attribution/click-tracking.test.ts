import { describe, expect, it } from 'vitest';

import {
  attributionInputFromRequest,
  attributionMarker,
  buildAttributionMessage,
  buildWhatsAppRedirectUrl,
  extractAttributionToken,
  generateAttributionToken,
  normalizeTrackingSlug,
  normalizeWhatsAppNumber,
} from './click-tracking';

describe('click tracking helpers', () => {
  it('creates an opaque, URL-safe attribution marker that can be recovered', () => {
    const token = generateAttributionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const message = buildAttributionMessage('Olá, vim pelo site.', token);
    expect(message).toContain(`Ref: ${attributionMarker(token)}`);
    expect(extractAttributionToken(message)).toBe(token);
  });

  it('does not treat a malformed or embedded marker as an attribution token', () => {
    expect(
      extractAttributionToken('textoOZ-abcdefghijklmnopqrstuvwx')
    ).toBeNull();
    expect(extractAttributionToken('OZ-short')).toBeNull();
  });

  it('accepts only public URL-safe tracking slugs and E.164-like numbers', () => {
    expect(normalizeTrackingSlug(' Morgana-Lotes ')).toBe('morgana-lotes');
    expect(normalizeTrackingSlug('Morgana/Lotes')).toBeNull();
    expect(normalizeTrackingSlug('-morgana')).toBeNull();
    expect(normalizeWhatsAppNumber('+55 (11) 99999-9999')).toBe(
      '5511999999999'
    );
    expect(normalizeWhatsAppNumber('0000')).toBeNull();
  });

  it('captures campaign query values and only persists safe page URLs', () => {
    const request = new Request(
      'https://organizap.example/w/morgana-lotes?utm_source=google&utm_campaign=lotes&gclid=g-1&fbclid=f-1&landing_url=https%3A%2F%2Fexample.com%2Flotes',
      {
        headers: {
          referer: 'https://google.com/search?q=lotes',
          'user-agent': 'test-agent',
        },
      }
    );
    expect(attributionInputFromRequest(request)).toMatchObject({
      utmSource: 'google',
      utmCampaign: 'lotes',
      gclid: 'g-1',
      fbclid: 'f-1',
      landingUrl: 'https://example.com/lotes',
      referrer: 'https://google.com/search?q=lotes',
    });
    expect(
      attributionInputFromRequest(
        new Request(
          'https://organizap.example/w/a?landing_url=javascript%3Aalert(1)'
        )
      ).landingUrl
    ).toBeNull();
  });

  it('builds a safe WhatsApp redirect URL', () => {
    expect(buildWhatsAppRedirectUrl('+55 11 99999-9999', 'Olá & Ref')).toBe(
      'https://wa.me/5511999999999?text=Ol%C3%A1%20%26%20Ref'
    );
  });
});
