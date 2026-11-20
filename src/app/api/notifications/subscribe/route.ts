import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
export async function GET(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');
    const endpoint = new URL(request.url).searchParams.get('endpoint');
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .eq('endpoint', endpoint ?? '')
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ subscribed: !!data });
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');
    const sub = await request.json();
    const url = new URL(sub.endpoint);
    const hosts = [
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'web.push.apple.com',
    ];
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      !(
        hosts.includes(url.hostname) ||
        url.hostname.endsWith('.notify.windows.com')
      ) ||
      typeof sub.keys?.p256dh !== 'string' ||
      typeof sub.keys?.auth !== 'string'
    )
      return NextResponse.json(
        { error: 'Assinatura inválida' },
        { status: 400 }
      );
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        account_id: accountId,
        endpoint: url.href,
        subscription: sub,
      },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function DELETE(request: Request) {
  try {
    const { supabase, userId } = await requireRole('agent');
    const { endpoint } = await request.json();
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
