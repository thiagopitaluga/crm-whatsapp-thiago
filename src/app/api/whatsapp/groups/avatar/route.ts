import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const groupJid = new URL(request.url).searchParams.get('jid') ?? '';
    if (!/^[^\s@]{1,80}@g\.us$/.test(groupJid))
      return new Response(null, { status: 400 });
    const { supabase, accountId } = await requireRole('viewer');
    const { data, error } = await supabase
      .from('whatsapp_groups')
      .select('id')
      .eq('account_id', accountId)
      .eq('group_jid', groupJid)
      .maybeSingle();
    if (error) throw error;
    if (!data) return new Response(null, { status: 404 });
    const result = await fetchQrConnector(accountId, 'groups/avatar', {
      method: 'POST',
      body: JSON.stringify({ group_id: groupJid }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!result.ok) return new Response(null, { status: 404 });
    const payload = (await result.json().catch(() => null)) as {
      url?: unknown;
    } | null;
    if (typeof payload?.url !== 'string' || !payload.url.startsWith('https://'))
      return new Response(null, { status: 404 });
    return NextResponse.redirect(payload.url, {
      headers: { 'cache-control': 'private, max-age=3600' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
