import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/whatsapp/qr-connector', () => ({ fetchQrConnector: vi.fn() }));
import { isQuiet } from './dispatch';
describe('notification quiet hours in Brasilia', () => {
  const settings = { quietStart: '22:00', quietEnd: '08:00', weekends: false };
  it('disables both hourly and weekend silence when switched off', () => {
    expect(
      isQuiet(
        { ...settings, quietEnabled: false, weekends: true },
        new Date('2026-11-21T03:00:00Z')
      )
    ).toBe(false);
    expect(
      isQuiet(
        { ...settings, quietEnabled: true },
        new Date('2026-11-20T01:00:00Z')
      )
    ).toBe(true);
  });
  it('handles overnight ranges and exact boundaries', () => {
    expect(isQuiet(settings, new Date('2026-11-20T01:00:00Z'))).toBe(true);
    expect(isQuiet(settings, new Date('2026-11-20T10:59:00Z'))).toBe(true);
    expect(isQuiet(settings, new Date('2026-11-20T11:00:00Z'))).toBe(false);
  });
  it('handles same-day windows', () => {
    expect(
      isQuiet(
        { ...settings, quietStart: '09:00', quietEnd: '17:00' },
        new Date('2026-11-20T15:00:00Z')
      )
    ).toBe(true);
  });
  it('uses the local day when silencing weekends', () => {
    expect(
      isQuiet({ ...settings, weekends: true }, new Date('2026-11-21T15:00:00Z'))
    ).toBe(true);
    expect(
      isQuiet({ ...settings, weekends: true }, new Date('2026-11-23T15:00:00Z'))
    ).toBe(false);
  });
  it('equal start and end disables the hourly window', () => {
    expect(
      isQuiet(
        { ...settings, quietStart: '08:00', quietEnd: '08:00' },
        new Date('2026-11-20T15:00:00Z')
      )
    ).toBe(false);
  });
});
