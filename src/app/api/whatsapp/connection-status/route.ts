import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';

export async function GET() {
  try {
    const { accountId, supabase } = await requireRole('agent');
    const [channels, cloud] = await Promise.all([
      supabase
        .from('whatsapp_channels')
        .select('evolution_instance_name,channel_key')
        .eq('account_id', accountId)
        .eq('provider', 'evolution'),
      supabase
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', accountId),
    ]);
    if (channels.error || cloud.error) throw channels.error || cloud.error;
    const targets = [
      {},
      ...(channels.data ?? []).map((c) => ({
        instanceName: c.evolution_instance_name,
        channelKey: c.channel_key,
      })),
    ];
    const statuses = await Promise.all(
      targets.map(async (target) => {
        try {
          const response = await fetchQrConnector(
            accountId,
            'status',
            { signal: AbortSignal.timeout(8_000) },
            target
          );
          if (!response.ok) return 'unknown';
          return (await response.json()).status as string;
        } catch {
          return 'unknown';
        }
      })
    );
    const status =
      cloud.data?.some((c) => c.status === 'connected') ||
      statuses.includes('connected')
        ? 'connected'
        : statuses.some((s) =>
              [
                'connecting',
                'reconnecting',
                'starting',
                'awaiting_qr_scan',
              ].includes(s)
            )
          ? 'connecting'
          : statuses.includes('unknown')
            ? 'unknown'
            : 'disconnected';
    return NextResponse.json(
      { status },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
