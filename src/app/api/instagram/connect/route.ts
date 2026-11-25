import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { exchangeInstagramToken } from '@/lib/instagram/access-token';
import { instagramConnectionReturnPath } from '@/lib/instagram/connection-navigation';

export const runtime = 'nodejs';
const cookieName = '__Host-instagram-oauth';
const returnCookieName = '__Host-instagram-oauth-return';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const options = {
  secure: true,
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 600,
};

export async function GET(request: NextRequest) {
  const callback = request.nextUrl.searchParams.has('state');
  const returnTo = callback
    ? request.cookies.get(returnCookieName)?.value
    : request.nextUrl.searchParams.get('from');
  const returnPath = instagramConnectionReturnPath(returnTo);
  const back = (status: string) => {
    const response = NextResponse.redirect(
      new URL(
        returnPath +
          (returnPath.includes('?') ? '&' : '?') +
          'connection=' +
          status,
        request.url
      ),
      303
    );
    response.cookies.set(cookieName, '', { ...options, maxAge: 0 });
    response.cookies.set(returnCookieName, '', { ...options, maxAge: 0 });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  try {
    const ctx = await requireRole('admin');
    const appId = process.env.INSTAGRAM_APP_ID;
    const secret = process.env.INSTAGRAM_APP_SECRET;
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL || 'https://organizap.tpxdigital.com';
    const redirect = new URL('/api/instagram/connect', origin).toString();
    if (
      !appId ||
      !secret ||
      !process.env.ENCRYPTION_KEY ||
      new URL(origin).origin !== request.nextUrl.origin
    )
      return back('not-configured');
    const db = supabaseAdmin();
    if (!callback) {
      const state = randomBytes(32).toString('hex');
      const { error } = await db.from('instagram_oauth_sessions').insert({
        state_hash: hash(state),
        account_id: ctx.accountId,
        user_id: ctx.userId,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
      if (error) throw error;
      const url = new URL('https://www.instagram.com/oauth/authorize');
      for (const [key, value] of Object.entries({
        client_id: appId,
        redirect_uri: redirect,
        response_type: 'code',
        force_reauth: 'true',
        scope:
          'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
        state,
      }))
        url.searchParams.set(key, value);
      const response = NextResponse.redirect(url);
      response.cookies.set(cookieName, state, options);
      response.cookies.set(
        returnCookieName,
        returnTo === 'connections' ? 'connections' : 'instagram',
        options
      );
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('Referrer-Policy', 'no-referrer');
      return response;
    }
    const state = request.nextUrl.searchParams.get('state') || '';
    const saved = request.cookies.get(cookieName)?.value || '';
    if (
      !/^[a-f0-9]{64}$/.test(state) ||
      !/^[a-f0-9]{64}$/.test(saved) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(saved))
    )
      throw new Error('Sessão inválida.');
    const { data: session, error: sessionError } = await db
      .from('instagram_oauth_sessions')
      .delete()
      .eq('state_hash', hash(state))
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .gt('expires_at', new Date().toISOString())
      .select('state_hash')
      .maybeSingle();
    if (sessionError || !session) throw new Error('Sessão expirada.');
    const code = request.nextUrl.searchParams.get('code');
    if (!code) return back('cancelled');
    const tokenResponse = await fetch(
      'https://api.instagram.com/oauth/access_token',
      {
        method: 'POST',
        body: new URLSearchParams({
          client_id: appId,
          client_secret: secret,
          grant_type: 'authorization_code',
          redirect_uri: redirect,
          code,
        }),
        cache: 'no-store',
      }
    );
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token)
      throw new Error('Falha ao autorizar Instagram.');
    const authorization = await exchangeInstagramToken(
      token.access_token,
      secret
    );
    const profileResponse = await fetch(
      'https://graph.instagram.com/v25.0/me?fields=user_id,username',
      {
        headers: { Authorization: 'Bearer ' + authorization.accessToken },
        cache: 'no-store',
      }
    );
    const profile = (await profileResponse.json()) as {
      user_id?: string;
      username?: string;
    };
    if (
      !profileResponse.ok ||
      !profile.user_id ||
      !/^\d+$/.test(profile.user_id)
    )
      throw new Error('Perfil inválido.');
    const existing = await db
      .from('instagram_channels')
      .select('account_id')
      .eq('instagram_id', profile.user_id)
      .maybeSingle();
    if (
      existing.error ||
      (existing.data && existing.data.account_id !== ctx.accountId)
    )
      throw new Error('Perfil já vinculado.');
    const subscription = await fetch(
      `https://graph.instagram.com/v25.0/${profile.user_id}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + authorization.accessToken,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          subscribed_fields: 'messages,comments,messaging_postbacks',
        }),
        cache: 'no-store',
      }
    );
    const result = (await subscription.json()) as { success?: boolean };
    if (!subscription.ok || !result.success)
      throw new Error('Falha ao registrar webhook.');
    const values = {
      username: profile.username || 'Instagram',
      access_token_encrypted: encrypt(authorization.accessToken),
      token_expires_at: authorization.expiresAt,
      updated_at: new Date().toISOString(),
    };
    const { error } = existing.data
      ? await db
          .from('instagram_channels')
          .update(values)
          .eq('instagram_id', profile.user_id)
          .eq('account_id', ctx.accountId)
      : await db.from('instagram_channels').insert({
          ...values,
          account_id: ctx.accountId,
          instagram_id: profile.user_id,
        });
    if (error) throw error;
    return back('connected');
  } catch (error) {
    if (callback) return back('error');
    return toErrorResponse(error);
  }
}
