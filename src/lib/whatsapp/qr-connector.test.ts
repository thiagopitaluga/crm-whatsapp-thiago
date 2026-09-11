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
