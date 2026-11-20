import { describe, it, expect } from 'vitest';
import { whatsappAvatarUrl } from './avatar-url';
describe('WhatsApp avatar URLs', () => {
  it('accepts WhatsApp and Meta image CDNs', () => {
    expect(whatsappAvatarUrl('https://pps.whatsapp.net/pic.jpg')).toBeTruthy();
    expect(whatsappAvatarUrl('https://scontent.xx.fbcdn.net/pic')).toBeTruthy();
  });
  it('rejects credentials, insecure links and deceptive host names', () => {
    for (const value of [
      'http://pps.whatsapp.net/a',
      'https://pps.whatsapp.net.evil.test/a',
      'https://u:p@pps.whatsapp.net/a',
      'http://127.0.0.1/a',
      'javascript:alert(1)',
      null,
    ])
      expect(whatsappAvatarUrl(value)).toBeNull();
  });
});
