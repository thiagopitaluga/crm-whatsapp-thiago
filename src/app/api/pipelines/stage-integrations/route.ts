import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';

export async function GET() {
  try {
    const { accountId } = await requireRole('admin');
    const { data, error } = await supabaseAdmin()
      .from('stage_integrations')
      .select('pixel_id')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      pixelId: data?.pixel_id ?? '',
      configured: Boolean(data),
      emailReady: Boolean(
        process.env.RESEND_API_KEY && process.env.STAGE_EMAIL_FROM
      ),
      cronReady: Boolean(
        process.env.AUTOMATION_CRON_SECRET ?? process.env.CRON_SECRET
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body.pixelId !== 'string' ||
      !/^\d{5,30}$/.test(body.pixelId) ||
      typeof body.token !== 'string' ||
      body.token.length < 10 ||
      body.token.length > 4096
    )
      return NextResponse.json(
        { error: 'Informe um pixel e token válidos.' },
        { status: 400 }
      );
    const { error } = await supabaseAdmin()
      .from('stage_integrations')
      .upsert({
        account_id: accountId,
        pixel_id: body.pixelId,
        access_token_encrypted: encrypt(body.token),
      });
    if (error) throw error;
    return NextResponse.json({ saved: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
