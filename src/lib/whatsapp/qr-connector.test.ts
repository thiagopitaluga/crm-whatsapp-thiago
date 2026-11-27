import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchQrConnector,
  isValidQrConnectorSecret,
  QrConnectorConfigurationError,
} from './qr-connector';

const ACCOUNT_ID = '5b420b90-e13f-4e41-a063-7d0027f35b53';

describe('QR connector bridge', () => {
  const originalBaseUrl = process.env.QR_CONNECTOR_BASE_URL;
  const originalSecret = process.env.QR_CONNECTOR_SHARED_SECRET;

  beforeEach(() => {
    process.env.QR_CONNECTOR_BASE_URL = 'https://connect.example.com';
    process.env.QR_CONNECTOR_SHARED_SECRET = 'test-secret-value';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalBaseUrl === undefined) delete process.env.QR_CONNECTOR_BASE_URL;
    else process.env.QR_CONNECTOR_BASE_URL = originalBaseUrl;
    if (originalSecret === undefined)
      delete process.env.QR_CONNECTOR_SHARED_SECRET;
    else process.env.QR_CONNECTOR_SHARED_SECRET = originalSecret;
  });

  it('compares inbound secrets exactly', () => {
    expect(isValidQrConnectorSecret('test-secret-value')).toBe(true);
    expect(isValidQrConnectorSecret('test-secret-value-extra')).toBe(false);
    expect(isValidQrConnectorSecret(null)).toBe(false);
  });

  it('proxies only to the configured connector with the server secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchQrConnector(ACCOUNT_ID, 'status');

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      `https://connect.example.com/v1/sessions/${ACCOUNT_ID}/status`
    );
    expect(new Headers(init.headers).get('x-connector-secret')).toBe(
      'test-secret-value'
    );
    expect(init.cache).toBe('no-store');
  });

  it('rejects an insecure remote connector URL', async () => {
    process.env.QR_CONNECTOR_BASE_URL = 'http://connect.example.com';
    await expect(fetchQrConnector(ACCOUNT_ID, 'status')).rejects.toBeInstanceOf(
      QrConnectorConfigurationError
    );
  });
});

describe('Evolution QR images', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_QR_PROVIDER', 'evolution');
    vi.stubEnv('EVOLUTION_API_URL', 'https://evolution.example.com');
    vi.stubEnv('EVOLUTION_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('sends voice recordings through the dedicated WhatsApp audio endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ key: { id: 'voice-id' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchQrConnector(ACCOUNT_ID, 'messages/media', {
      method: 'POST',
      body: JSON.stringify({
        phone: '5511926106858',
        kind: 'audio',
        url: 'https://storage.example/voice.ogg',
      }),
    });
    expect(await response.json()).toEqual({ messageId: 'voice-id' });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toContain('/message/sendWhatsAppAudio/');
    expect(JSON.parse(String(init.body))).toEqual({
      number: '5511926106858',
      audio: 'https://storage.example/voice.ogg',
    });
  });
  it('keeps images on the media endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ key: { id: 'image-id' } }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchQrConnector(ACCOUNT_ID, 'messages/media', {
      method: 'POST',
      body: JSON.stringify({
        phone: '5511926106858',
        kind: 'image',
        url: 'https://storage.example/photo.jpg',
        caption: 'Foto',
      }),
    });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toContain('/message/sendMedia/');
    expect(JSON.parse(String(init.body))).toMatchObject({
      mediatype: 'image',
      media: 'https://storage.example/photo.jpg',
      caption: 'Foto',
    });
  });

  it('requests a fresh QR from an existing disconnected instance without recreating it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ instance: { state: 'close' } }))
      .mockResolvedValueOnce(
        Response.json({ base64: 'data:image/png;base64,aW1hZ2U=', count: 1 })
      );
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchQrConnector(ACCOUNT_ID, 'connect', {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).count).toBe(1);
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).pathname)).toEqual([
      '/instance/connectionState/organizap' + ACCOUNT_ID.replaceAll('-', ''),
      '/instance/connect/organizap' + ACCOUNT_ID.replaceAll('-', ''),
    ]);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url as URL).pathname.includes('/create')
      )
    ).toBe(false);
  });

  it('keeps an already connected instance connected when QR generation is requested', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ instance: { state: 'open' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await (
        await fetchQrConnector(ACCOUNT_ID, 'connect', {
          method: 'POST',
          body: '{}',
        })
      ).json()
    ).toEqual({ status: 'connected' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'returns the QR image for nested=%s',
    async (nested) => {
      const image = { base64: 'data:image/png;base64,aW1hZ2U=' };
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(Response.json(nested ? { qrcode: image } : image))
      );
      const response = await fetchQrConnector(ACCOUNT_ID, 'qr.svg');
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(await response.text()).toBe('image');
    }
  );

  it('does not announce a QR image when Evolution has not generated one', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ instance: { state: 'connecting' } })
        )
        .mockResolvedValueOnce(Response.json({ count: 0 }))
    );
    const response = await fetchQrConnector(ACCOUNT_ID, 'status');
    expect(await response.json()).toMatchObject({
      qr_available: false,
      qr_version: null,
    });
  });

  it('announces and fingerprints the nested QR returned while connecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ instance: { state: 'connecting' } })
        )
        .mockResolvedValueOnce(
          Response.json({ qrcode: { base64: 'aW1hZ2U=' } })
        )
    );
    const response = await fetchQrConnector(ACCOUNT_ID, 'status');
    expect(await response.json()).toMatchObject({
      qr_available: true,
      qr_version: expect.any(String),
    });
  });
});
