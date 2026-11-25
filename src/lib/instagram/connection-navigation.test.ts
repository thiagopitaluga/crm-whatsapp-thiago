import { describe, expect, it } from 'vitest';
import { instagramConnectionReturnPath } from './connection-navigation';

describe('instagramConnectionReturnPath', () => {
  it('returns to the Instagram tab in Connections when requested', () => {
    expect(instagramConnectionReturnPath('connections')).toBe(
      '/connections?tab=instagram'
    );
  });

  it('defaults to Instagram and rejects arbitrary return URLs', () => {
    for (const value of [
      undefined,
      null,
      'instagram',
      'https://example.com',
      '//example.com',
      '/connections',
    ]) {
      expect(instagramConnectionReturnPath(value)).toBe('/instagram');
    }
  });
});
