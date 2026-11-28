import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { accountId, supabase } = await requireRole('agent');
    const { data, error } = await supabase.from('whatsapp_channels')
      .select('id,label,channel_key,evolution_instance_name')
      .eq('account_id', accountId).eq('provider', 'evolution');
    if (error) throw error;
    const channels = await Promise.all((data ?? []).map(async (channel) => {
      try {
        const response = await fetchQrConnector(accountId, 'status', { signal: AbortSignal.timeout(10_000) },
          { instanceName: channel.evolution_instance_name, channelKey: channel.channel_key, includePhone: true });
        const state = response.ok ? await response.json() as { phone?: string | null; status?: string } : null;
        return { ...channel, phone: state?.phone ?? null, status: state?.status ?? 'unknown' };
      } catch { return { ...channel, phone: null, status: 'unknown' }; }
    }));
    return NextResponse.json({ channels }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return toErrorResponse(error); }
}
