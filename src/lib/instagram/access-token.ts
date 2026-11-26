/** Supports the current Instagram Login response and earlier flat responses. */
export function instagramAuthorizationToken(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  if (body.error || body.error_type) return null;
  const entry = Array.isArray(body.data) ? body.data[0] : body;
  if (!entry || typeof entry !== 'object') return null;
  const token = (entry as Record<string, unknown>).access_token;
  return typeof token === 'string' && token.trim() ? token : null;
}

/** Exchange on the server only: the request contains the Instagram app secret. */
export async function exchangeInstagramToken(
  shortToken: string,
  appSecret: string
) {
  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('access_token', shortToken);
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Never propagate a fetch error containing the credential-bearing URL.
    throw new Error('Não foi possível prolongar a autorização do Instagram.');
  }
  const result = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (
    !response.ok ||
    typeof result.access_token !== 'string' ||
    !result.access_token ||
    typeof result.expires_in !== 'number' ||
    !Number.isSafeInteger(result.expires_in) ||
    result.expires_in <= 0 ||
    result.expires_in > 366 * 86400
  ) {
    throw new Error('O Instagram não retornou uma autorização válida.');
  }
  return {
    accessToken: result.access_token,
    expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString(),
  };
}
