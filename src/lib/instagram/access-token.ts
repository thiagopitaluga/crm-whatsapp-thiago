/** Supports the current Instagram Login response and earlier flat responses. */
export function instagramAuthorizationToken(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  if (body.error || body.error_type) return null;
  const entry = Array.isArray(body.data) ? body.data[0] : body;
  if (!entry || typeof entry !== 'object') return null;
  const token = (entry as Record<string, unknown>).access_token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

/** Exchange on the server only: the request contains the Instagram app secret. */
export async function exchangeInstagramToken(
  shortToken: string,
  appSecret: string
) {
  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', appSecret.trim());
  url.searchParams.set('access_token', shortToken);
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    console.warn('[instagram-token-exchange] network failure', {
      kind: error instanceof Error ? error.name : 'unknown',
    });
    // Never propagate a fetch error containing the credential-bearing URL.
    throw new Error('Não foi possível prolongar a autorização do Instagram.');
  }
  const payload: unknown = await response.json().catch(() => null);
  const result =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const entry = Array.isArray(result.data) ? result.data[0] : result;
  const expiration =
    entry && typeof entry === 'object' ? entry.expires_in : undefined;
  const expiresIn =
    typeof expiration === 'string' && /^\d+$/.test(expiration)
      ? Number(expiration)
      : expiration;
  const accessToken = instagramAuthorizationToken(result);
  if (
    !response.ok ||
    !accessToken ||
    typeof expiresIn !== 'number' ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > 366 * 86400
  ) {
    const providerError =
      result.error && typeof result.error === 'object'
        ? (result.error as Record<string, unknown>)
        : {};
    let reason =
      typeof providerError.message === 'string'
        ? providerError.message
        : typeof result.error_message === 'string'
          ? result.error_message
          : '';
    for (const value of [shortToken, appSecret, appSecret.trim()]) {
      if (value)
        reason = reason
          .replaceAll(value, '[redacted]')
          .replaceAll(encodeURIComponent(value), '[redacted]');
    }
    console.warn('[instagram-token-exchange] rejected response', {
      status: response.status,
      reason: reason.slice(0, 300),
      code:
        typeof providerError.code === 'number'
          ? providerError.code
          : typeof result.code === 'number'
            ? result.code
            : null,
      subcode:
        typeof providerError.error_subcode === 'number'
          ? providerError.error_subcode
          : null,
      hasToken: Boolean(accessToken),
      expirationType: typeof expiration,
      expiresIn:
        typeof expiresIn === 'number' && Number.isFinite(expiresIn)
          ? expiresIn
          : null,
    });
    throw new Error('O Instagram não retornou uma autorização válida.');
  }
  return {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}
