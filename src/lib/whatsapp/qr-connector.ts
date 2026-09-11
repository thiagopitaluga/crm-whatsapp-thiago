import crypto from 'node:crypto';

export class QrConnectorConfigurationError extends Error {
  constructor(message = 'QR connector is not configured') {
    super(message);
    this.name = 'QrConnectorConfigurationError';
  }
}

export function getQrConnectorSecret(): string {
  const secret = process.env.QR_CONNECTOR_SHARED_SECRET?.trim();
  if (!secret) throw new QrConnectorConfigurationError();
  return secret;
}

export function isValidQrConnectorSecret(supplied: string | null): boolean {
  if (!supplied) return false;
  let expected: string;
  try {
    expected = getQrConnectorSecret();
  } catch {
    return false;
  }

  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function fetchQrConnector(
  accountId: string,
  suffix: 'status' | 'qr.svg' | 'connect' | 'import' | '',
  init: RequestInit = {}
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
    throw new Error('Invalid account id');
  }

  const rawBaseUrl = process.env.QR_CONNECTOR_BASE_URL?.trim();
  if (!rawBaseUrl) throw new QrConnectorConfigurationError();

  const baseUrl = new URL(rawBaseUrl);
  if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== 'localhost') {
    throw new QrConnectorConfigurationError('QR connector must use HTTPS');
  }

  const resource = suffix ? `/${suffix}` : '';
  const url = new URL(
    `/v1/sessions/${encodeURIComponent(accountId)}${resource}`,
    baseUrl
  );
  const headers = new Headers(init.headers);
  headers.set('x-connector-secret', getQrConnectorSecret());
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
}
