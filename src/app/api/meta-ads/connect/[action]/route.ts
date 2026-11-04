import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { MetaGraphReadClient } from '@/lib/meta-ads/graph-client';
import { syncMetaAdsRange } from '@/lib/meta-ads/sync';
import { parseMetaDateRange } from '@/lib/meta-ads/dashboard';

export const runtime = 'nodejs';
export const maxDuration = 300;
const COOKIE = '__Host-meta_ads_oauth';
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 };
const ID = /^\d{5,32}$/;
const STATE = /^[a-f0-9]{64}$/;
type Context = Awaited<ReturnType<typeof requireRole>>;
class SafeError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function config() {
  const appId = process.env.META_APP_ID?.trim();
  const secret = process.env.META_APP_SECRET?.trim();
  const version = process.env.META_ADS_GRAPH_VERSION?.trim() || 'v26.0';
  const redirect = process.env.META_ADS_REDIRECT_URI?.trim() ||
    new URL('/api/meta-ads/connect/callback', process.env.NEXT_PUBLIC_SITE_URL || 'https://organizap.tpxdigital.com').toString();
  if (!appId || !secret || !ID.test(appId) || !/^v\d+\.\d+$/.test(version) || !process.env.ENCRYPTION_KEY)
    throw new SafeError('A conexão Meta ainda não foi configurada no servidor.', 503);
  if (new URL(redirect).protocol !== 'https:') throw new SafeError('A conexão Meta exige HTTPS.', 503);
  return { appId, secret, version, redirect };
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
function failure(cause: unknown) {
  if (cause instanceof SafeError) return json({ error: cause.message }, cause.status);
  if (cause instanceof UnauthorizedError || cause instanceof ForbiddenError)
    return json({ error: cause.message }, cause.status);
  // Never log token responses, OAuth codes, URLs containing secrets, or raw Graph errors.
  return json({ error: 'Não foi possível concluir a conexão Meta. Tente novamente.' }, 500);
}
function dashboard(request: NextRequest, result: string) {
  const response = NextResponse.redirect(new URL('/meta-ads?meta_connection=' + result, request.nextUrl.origin), 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
function graph(token: string) {
  return new MetaGraphReadClient({ accessToken: token, version: config().version });
}
async function oauthToken(params: Record<string, string>) {
  const c = config();
  const url = new URL('https://graph.facebook.com/' + c.version + '/oauth/access_token');
  for (const [key, value] of Object.entries({ client_id: c.appId, client_secret: c.secret, ...params }))
    url.searchParams.set(key, value);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !body.access_token || !Number.isFinite(body.expires_in) || Number(body.expires_in) <= 0)
    throw new SafeError('A Meta não concluiu a autorização. Conecte novamente.', 502);
  return { token: body.access_token, expires: new Date(Date.now() + Number(body.expires_in) * 1000).toISOString() };
}
async function readSession(request: NextRequest, ctx: Context, phase: string, consume = false) {
  const value = request.cookies.get(COOKIE)?.value || '';
  if (!STATE.test(value)) throw new SafeError('A autorização expirou. Conecte novamente.', 401);
  const table = db().from('meta_ads_oauth_sessions');
  const query = consume ? table.delete() : table.select('*');
  const scoped = query.eq('state_hash', hash(value)).eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId).eq('phase', phase).gt('expires_at', new Date().toISOString());
  const { data, error } = await (consume ? scoped.select('*') : scoped).maybeSingle();
  if (error) throw error;
  if (!data) throw new SafeError('A autorização expirou. Conecte novamente.', 401);
  return data;
}
async function availableAccounts(token: string) {
  const client = graph(token);
  const permissions = await client.list('me/permissions', {}, 5);
  if (!permissions.some(item => item.permission === 'ads_read' && item.status === 'granted'))
    throw new SafeError('Autorize a leitura de anúncios para conectar esta conta.', 403);
  return (await client.list('me/adaccounts', { fields: 'id,account_id,name,account_status,currency', limit: '100' }, 50))
    .filter(item => typeof item.account_id === 'string' && ID.test(item.account_id))
    .map(item => ({ id: String(item.account_id), name: String(item.name || item.account_id),
      currency: String(item.currency || ''), status: Number(item.account_status) }));
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.pathname.split('/').pop();
  try {
    if (!['begin', 'callback', 'status'].includes(action || '')) return json({ error: 'Não encontrado.' }, 404);
    const ctx = await requireRole(action === 'status' ? 'viewer' : 'admin');
    if (action === 'status') {
      const canManage = ctx.role === 'owner' || ctx.role === 'admin';
      const { data, error } = await db().from('meta_ads_credentials')
        .select('integration_id,token_expires_at').eq('account_id', ctx.accountId);
      if (error) throw error;
      let accounts: Awaited<ReturnType<typeof availableAccounts>> = [];
      if (canManage && request.cookies.has(COOKIE)) {
        try {
          const pending = await readSession(request, ctx, 'pending');
          accounts = await availableAccounts(decrypt(pending.access_token_encrypted));
          return json({ canManage, pending: true, accounts, credentials: data || [] });
        } catch (cause) {
          if (!(cause instanceof SafeError)) throw cause;
        }
      }
      return json({ canManage, pending: false, accounts, credentials: data || [] });
    }
    const c = config();
    if (action === 'begin') {
      if (request.nextUrl.origin !== new URL(c.redirect).origin)
        throw new SafeError('Abra a conexão pelo endereço oficial do CRM.', 400);
      const state = randomBytes(32).toString('hex');
      const client = db();
      const { error: cleanupError } = await client.from('meta_ads_oauth_sessions').delete()
        .lt('expires_at', new Date().toISOString());
      if (cleanupError) throw cleanupError;
      const { error } = await client.from('meta_ads_oauth_sessions').insert({
        state_hash: hash(state), account_id: ctx.accountId, user_id: ctx.userId,
        phase: 'authorizing', expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
      if (error) throw error;
      const url = new URL('https://www.facebook.com/' + c.version + '/dialog/oauth');
      url.searchParams.set('client_id', c.appId);
      url.searchParams.set('redirect_uri', c.redirect);
      url.searchParams.set('state', state);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'ads_read');
      url.searchParams.set('auth_type', 'rerequest');
      if (process.env.META_ADS_LOGIN_CONFIG_ID) url.searchParams.set('config_id', process.env.META_ADS_LOGIN_CONFIG_ID.trim());
      const response = NextResponse.redirect(url);
      response.cookies.set(COOKIE, state, COOKIE_OPTIONS);
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('Referrer-Policy', 'no-referrer');
      return response;
    }
    const state = request.nextUrl.searchParams.get('state') || '';
    const cookie = request.cookies.get(COOKIE)?.value || '';
    if (!STATE.test(state) || !STATE.test(cookie) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie)))
      throw new SafeError('Retorno de autorização inválido.', 400);
    await readSession(request, ctx, 'authorizing', true);
    if (request.nextUrl.searchParams.has('error')) {
      const response = dashboard(request, 'cancelled');
      response.cookies.set(COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
      return response;
    }
    const code = request.nextUrl.searchParams.get('code');
    if (!code) throw new SafeError('A Meta não retornou o código de autorização.');
    const short = await oauthToken({ code, redirect_uri: c.redirect });
    const long = await oauthToken({ grant_type: 'fb_exchange_token', fb_exchange_token: short.token });
    await availableAccounts(long.token);
    const meUrl = new URL('https://graph.facebook.com/' + c.version + '/me?fields=id');
    const meResponse = await fetch(meUrl, { headers: { Authorization: 'Bearer ' + long.token },
      cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const me = await meResponse.json() as { id?: string };
    if (!meResponse.ok || !me.id || !ID.test(me.id)) throw new SafeError('Não foi possível validar a conta Meta.', 502);
    const pending = randomBytes(32).toString('hex');
    const { error } = await db().from('meta_ads_oauth_sessions').insert({
      state_hash: hash(pending), account_id: ctx.accountId, user_id: ctx.userId, phase: 'pending',
      access_token_encrypted: encrypt(long.token), meta_user_id: me.id, token_expires_at: long.expires,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    if (error) throw error;
    const response = dashboard(request, 'choose');
    response.cookies.set(COOKIE, pending, COOKIE_OPTIONS);
    return response;
  } catch (cause) {
    if (action === 'callback') {
      const response = dashboard(request, 'error');
      response.cookies.set(COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
      return response;
    }
    return failure(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') !== request.nextUrl.origin)
      throw new SafeError('Origem da solicitação inválida.', 403);
    const action = request.nextUrl.pathname.split('/').pop();
    if (!['select', 'sync', 'disconnect'].includes(action || '')) return json({ error: 'Não encontrado.' }, 404);
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => null) as { adAccountId?: unknown; days?: unknown } | null;
    if (!body || typeof body.adAccountId !== 'string' || !ID.test(body.adAccountId))
      throw new SafeError('Escolha uma conta de anúncios válida.');
    const adAccountId = body.adAccountId;
    const client = db();
    if (action === 'select') {
      const pending = await readSession(request, ctx, 'pending');
      const accounts = await availableAccounts(decrypt(pending.access_token_encrypted));
      const account = accounts.find(item => item.id === adAccountId);
      if (!account) throw new SafeError('Esta conta não foi autorizada pela Meta.', 403);
      if (new Date(pending.token_expires_at).getTime() <= Date.now())
        throw new SafeError('A autorização expirou. Conecte novamente.', 401);
      // Consume once, after validating the selection; concurrent requests cannot both link.
      await readSession(request, ctx, 'pending', true);
      const { error } = await client.rpc('connect_meta_ads_account', {
        p_account_id: ctx.accountId, p_user_id: ctx.userId, p_ad_account_id: adAccountId,
        p_name: account.name, p_token: pending.access_token_encrypted,
        p_meta_user_id: pending.meta_user_id, p_expires_at: pending.token_expires_at,
      });
      if (error?.code === '23505') throw new SafeError('Esta conta de anúncios já está vinculada a outra empresa no CRM.', 409);
      if (error) throw error;
      const response = json({ connected: true, adAccountId });
      response.cookies.set(COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
      return response;
    }
    const { data: integration, error: integrationError } = await client.from('meta_ad_account_integrations')
      .select('id,is_active').eq('account_id', ctx.accountId).eq('provider', 'meta')
      .eq('meta_ad_account_id', adAccountId).maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration) throw new SafeError('Conta de anúncios não encontrada neste CRM.', 404);
    if (action === 'disconnect') {
      const { error } = await client.from('meta_ad_account_integrations').update({ is_active: false, ads_read_granted: false })
        .eq('id', integration.id).eq('account_id', ctx.accountId);
      if (error) throw error;
      const { error: credentialError } = await client.from('meta_ads_credentials').delete()
        .eq('integration_id', integration.id).eq('account_id', ctx.accountId);
      if (credentialError) throw credentialError;
      return json({ disconnected: true });
    }
    if (!integration.is_active) throw new SafeError('Reconecte esta conta antes de sincronizar.', 409);
    if (![7, 30, 90].includes(Number(body.days))) throw new SafeError('Escolha 7, 30 ou 90 dias.');
    const range = parseMetaDateRange(new URLSearchParams({ days: String(body.days) }));
    if (!range) throw new SafeError('Período inválido.');
    const { data: credential, error: credentialError } = await client.from('meta_ads_credentials').select('*')
      .eq('integration_id', integration.id).eq('account_id', ctx.accountId).maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential || new Date(credential.token_expires_at).getTime() <= Date.now())
      throw new SafeError('A autorização expirou ou foi removida. Reconecte a conta Meta.', 401);
    const lease = new Date(Date.now() + 360_000).toISOString();
    const { data: locked, error: lockError } = await client.from('meta_ads_credentials')
      .update({ sync_lock_until: lease }).eq('integration_id', integration.id).eq('account_id', ctx.accountId)
      .lt('sync_lock_until', new Date().toISOString()).select('integration_id').maybeSingle();
    if (lockError) throw lockError;
    if (!locked) throw new SafeError('Uma sincronização está em andamento ou terminou há menos de um minuto.', 429);
    try {
      const result = await syncMetaAdsRange(client, graph(decrypt(credential.access_token_encrypted)), ctx.accountId, adAccountId, range.from, range.to);
      return json({ synced: true, ...result });
    } catch {
      const message = 'A Meta não concluiu a leitura. Verifique as permissões ou reconecte a conta e tente novamente.';
      await client.from('meta_ad_account_integrations').update({ sync_error: message })
        .eq('id', integration.id).eq('account_id', ctx.accountId);
      throw new SafeError(message, 502);
    } finally {
      await client.from('meta_ads_credentials').update({ sync_lock_until: new Date(Date.now() + 60_000).toISOString() })
        .eq('integration_id', integration.id).eq('account_id', ctx.accountId).eq('sync_lock_until', lease);
    }
  } catch (cause) { return failure(cause); }
}
