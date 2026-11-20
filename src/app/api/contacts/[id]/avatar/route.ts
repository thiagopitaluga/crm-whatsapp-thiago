import { whatsappAvatarUrl } from '@/lib/contacts/avatar-url';
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { fetchEvolutionProfilePicture } from '@/lib/whatsapp/qr-connector';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId, userId } = await getCurrentAccount();
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('id,phone,avatar_url,avatar_checked_at')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!contact)
      return NextResponse.json(
        { error: 'Contato não encontrado' },
        { status: 404 }
      );
    const fallback = () =>
      NextResponse.json(
        { url: contact.avatar_url ?? null },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    const force = new URL(request.url).searchParams.get('refresh') === '1';
    const ttl = contact.avatar_url ? 6 * 60 * 60_000 : 60_000;
    if (
      !force &&
      contact.avatar_checked_at &&
      Date.now() - new Date(contact.avatar_checked_at).getTime() < ttl
    )
      return fallback();
    if (
      !checkRateLimit(`contact-photo:${accountId}:${userId}`, {
        limit: 60,
        windowMs: 60_000,
      }).success
    )
      return fallback();
    const { data: conversation } = await supabase
      .from('conversations')
      .select('whatsapp_channel_key')
      .eq('account_id', accountId)
      .eq('contact_id', id)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const key = conversation?.whatsapp_channel_key;
    if (key?.startsWith('whatsapp_cloud')) return fallback();
    let instanceName: string | undefined;
    if (key) {
      const { data: channel } = await supabase
        .from('whatsapp_channels')
        .select('evolution_instance_name')
        .eq('account_id', accountId)
        .eq('channel_key', key)
        .eq('provider', 'evolution')
        .maybeSingle();
      instanceName = channel?.evolution_instance_name ?? undefined;
      if (key !== 'whatsapp_evolution' && !instanceName) return fallback();
    }
    let url: string | null = null;
    try {
      url = await fetchEvolutionProfilePicture(
        accountId,
        contact.phone,
        instanceName,
        force
      );
    } catch {
      /* Photos are optional; keep the conversation available. */
    }
    url = whatsappAvatarUrl(url);
    const db = supabaseAdmin();
    await db
      .from('contacts')
      .update({
        ...(url ? { avatar_url: url } : {}),
        avatar_checked_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId);
    return NextResponse.json(
      { url: url ?? contact.avatar_url ?? null },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
