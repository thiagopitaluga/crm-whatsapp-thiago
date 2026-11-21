import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const id = new URL(request.url).searchParams.get('channel') || '';
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      )
    )
      return NextResponse.json({ error: 'Perfil inválido.' }, { status: 400 });
    const channel = await supabaseAdmin()
      .from('instagram_channels')
      .select('access_token_encrypted')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (channel.error) throw channel.error;
    if (!channel.data)
      return NextResponse.json(
        { error: 'Perfil não encontrado.' },
        { status: 404 }
      );
    const kind =
      new URL(request.url).searchParams.get('kind') === 'stories'
        ? 'stories'
        : 'media';
    const endpoint = new URL('https://graph.instagram.com/v25.0/me/' + kind);
    endpoint.searchParams.set(
      'fields',
      'id,caption,media_type,thumbnail_url,media_url,timestamp'
    );
    endpoint.searchParams.set('limit', '50');
    const response = await fetch(endpoint, {
      headers: {
        Authorization: 'Bearer ' + decrypt(channel.data.access_token_encrypted),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      return NextResponse.json(
        { error: 'Não foi possível carregar as publicações na Meta.' },
        { status: 502 }
      );
    const payload = (await response.json()) as {
      data?: Array<{
        id?: string;
        caption?: string;
        media_type?: string;
        thumbnail_url?: string;
        media_url?: string;
        timestamp?: string;
      }>;
    };
    const media = (Array.isArray(payload.data) ? payload.data : [])
      .filter(
        (item) => typeof item.id === 'string' && /^\d{5,32}$/.test(item.id)
      )
      .map((item) => ({
        id: item.id,
        caption: item.caption || 'Publicação sem legenda',
        type: item.media_type || '',
        image:
          item.thumbnail_url ||
          (item.media_type !== 'VIDEO' ? item.media_url : '') ||
          '',
        timestamp: item.timestamp || null,
      }));
    return NextResponse.json(
      { media },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
