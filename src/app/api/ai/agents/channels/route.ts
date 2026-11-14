import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { data: cloud, error } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    let cloudConnected = false;
    let cloudAddress: string | null = null;
    if (cloud?.phone_number_id && cloud.access_token) {
      try {
        const info = await verifyPhoneNumber({ phoneNumberId: cloud.phone_number_id, accessToken: decrypt(cloud.access_token) });
        cloudConnected = true;
        cloudAddress = typeof info.display_phone_number === 'string' ? info.display_phone_number : cloud.phone_number_id;
      } catch { /* Invalid credentials are shown as disconnected. */ }
    }

    let evolutionConnected = false;
    try {
      const response = await fetchQrConnector(accountId, 'status');
      if (response.ok) {
        const status = await response.json() as { status?: unknown };
        evolutionConnected = status.status === 'connected';
      }
    } catch { /* The QR/Evolution connector may not be configured. */ }

    return NextResponse.json({ channels: [
      { id: 'whatsapp_cloud', label: 'WhatsApp Cloud API', address: cloudAddress ?? cloud?.phone_number_id ?? null, connected: cloudConnected },
      { id: 'whatsapp_evolution', label: 'WhatsApp via Evolution', address: 'Instância do WhatsApp conectado', connected: evolutionConnected },
    ] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
