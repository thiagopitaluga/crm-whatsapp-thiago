import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const [cloudResult, channelsResult] = await Promise.all([
      supabase.from('whatsapp_config').select('phone_number_id, access_token, status').eq('account_id', accountId).order('created_at', { ascending: true }),
      supabase.from('whatsapp_channels').select('id, provider, channel_key, label, phone_number_id, evolution_instance_name').eq('account_id', accountId),
    ]);
    if (cloudResult.error) throw cloudResult.error;
    if (channelsResult.error) throw channelsResult.error;
    const channels: { id: string; key: string; label: string; address: string | null; connected: boolean; provider: string; pairingCodeSupported?: boolean }[] = [];
    const cloudRows = cloudResult.data ?? [];
    for (let i = 0; i < cloudRows.length; i++) {
      const cloud = cloudRows[i];
      let label = 'WhatsApp Cloud API';
      let connected = false;
      try {
        const phone = await verifyPhoneNumber({ phoneNumberId: cloud.phone_number_id, accessToken: decrypt(cloud.access_token) });
        label = phone.display_phone_number || label;
        connected = true;
      } catch { /* Show disconnected and keep this channel manageable. */ }
      const mapped = channelsResult.data?.find((row) => row.provider === 'cloud' && row.phone_number_id === cloud.phone_number_id);
      channels.push({ id: mapped?.id ?? cloud.phone_number_id, key: mapped?.channel_key ?? (i === 0 ? 'whatsapp_cloud' : `whatsapp_cloud:${cloud.phone_number_id}`), label, address: cloud.phone_number_id, connected, provider: 'cloud' });
    }
    for (const channel of channelsResult.data ?? []) {
      if (channel.provider !== 'evolution') continue;
      let connected = false;
      try {
        const response = await fetchQrConnector(accountId, 'status', {}, { instanceName: channel.evolution_instance_name, channelKey: channel.channel_key });
        const status = response.ok ? await response.json() as { status?: unknown } : null;
        connected = status?.status === 'connected';
      } catch { /* Evolution may be offline or not configured. */ }
      channels.push({ id: channel.id, key: channel.channel_key, label: channel.label, address: null, connected, provider: 'evolution', pairingCodeSupported: process.env.WHATSAPP_QR_PROVIDER === 'evolution' });
    }
    // Older QR connections use the account's default instance and may not
    // have a whatsapp_channels row. Check it separately for the inbox.
    let defaultQrConnected: boolean | null = null;
    try {
      const response = await fetchQrConnector(accountId, 'status', { signal: AbortSignal.timeout(8_000) });
      if (response.ok) {
        const status = await response.json() as { status?: unknown };
        defaultQrConnected = status.status === 'connected';
      }
    } catch { /* An unavailable connector is an unknown state. */ }
    return NextResponse.json({ channels, defaultQrConnected });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    if (process.env.WHATSAPP_QR_PROVIDER !== 'evolution') return NextResponse.json({ error: 'Conexões adicionais por QR exigem a Evolution API.' }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!name) return NextResponse.json({ error: 'Informe um nome para identificar este WhatsApp.' }, { status: 400 });
    const id = randomUUID();
    const channelKey = `whatsapp_evolution:${id}`;
    const instanceName = `organizap${accountId.replaceAll('-', '').toLowerCase()}${id.replaceAll('-', '').slice(0, 10)}`;
    const { data, error } = await supabase.from('whatsapp_channels').insert({
      account_id: accountId, provider: 'evolution', channel_key: channelKey,
      label: name, evolution_instance_name: instanceName, created_by: userId,
    }).select('id, provider, channel_key, label, evolution_instance_name').single();
    if (error) throw error;
    return NextResponse.json({ channel: { id: data.id, key: data.channel_key, label: data.label, instance_name: data.evolution_instance_name, connected: false } }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Informe a conexão que deseja remover.' }, { status: 400 });
    const { data: channel, error: fetchError } = await supabase.from('whatsapp_channels').select('id, provider, channel_key, evolution_instance_name').eq('account_id', accountId).eq('id', id).maybeSingle();
    if (fetchError) throw fetchError;
    if (!channel) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
    if (channel.provider === 'evolution' && process.env.WHATSAPP_QR_PROVIDER === 'evolution') {
      const response = await fetchQrConnector(accountId, '', { method: 'DELETE' }, { instanceName: channel.evolution_instance_name, channelKey: channel.channel_key });
      if (!response.ok) return NextResponse.json({ error: 'Não foi possível desconectar a instância na Evolution.' }, { status: 502 });
    }
    const { data: agents } = await supabase.from('ai_agents').select('id, channel_keys').eq('account_id', accountId).contains('channel_keys', [channel.channel_key]);
    for (const agent of agents ?? []) {
      await supabase.from('ai_agents').update({ channel_keys: (agent.channel_keys ?? []).filter((key: string) => key !== channel.channel_key) }).eq('id', agent.id).eq('account_id', accountId);
    }
    const { error } = await supabase.from('whatsapp_channels').delete().eq('account_id', accountId).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
