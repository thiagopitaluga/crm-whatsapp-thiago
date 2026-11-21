import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  instagramMessage,
  callInstagram,
  InstagramDeliveryError,
} from './send-content';
afterEach(() => vi.unstubAllGlobals());
describe('Instagram content delivery', () => {
  it('builds text buttons and records only its own valid postback targets', () => {
    const p = instagramMessage(
      { type: 'text', text: 'Escolha' },
      [
        { id: 'a', type: 'flow', text: 'Detalhes', targetNodeId: 'details' },
        { type: 'url', text: 'Site', url: 'https://example.com' },
      ],
      'rule'
    );
    expect(p.postbacks).toEqual(['organizap-instagram:rule:details']);
    expect(p.message.attachment?.payload).toMatchObject({
      template_type: 'button',
      text: 'Escolha',
      buttons: [
        { type: 'postback', payload: 'organizap-instagram:rule:details' },
        { type: 'web_url', url: 'https://example.com' },
      ],
    });
  });
  it('sends an uploaded PDF as a file attachment', () => {
    expect(
      instagramMessage(
        { type: 'pdf', url: 'https://example.com/a.pdf' },
        [],
        'rule'
      ).message
    ).toMatchObject({
      attachment: {
        type: 'file',
        payload: { url: 'https://example.com/a.pdf' },
      },
    });
  });
  it('distinguishes rejected actions from uncertain network delivery', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ error: { code: 10 } }, { status: 400 })
        )
        .mockRejectedValueOnce(new Error('timeout'))
    );
    await expect(
      callInstagram('123/messages', 'token', {})
    ).rejects.toMatchObject({ uncertain: false });
    await expect(
      callInstagram('123/messages', 'token', {})
    ).rejects.toMatchObject({ uncertain: true });
  });
});
