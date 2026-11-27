import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('settings')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) {
      console.error('[notification-preferences]', { code: error.code });
      throw error;
    }
    return NextResponse.json({
      settings: data?.settings ?? {},
      publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function PUT(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent');
    const body = await request.json();
    const settings: Record<string, boolean | string> = {
      quietEnabled: body.quietEnabled !== false,
    };
    for (const key of [
      'messages',
      'allMessages',
      'tasks',
      'sales',
      'system',
      'quietPush',
      'weekends',
      'whatsapp',
    ])
      settings[key] = body[key] === true;
    for (const key of ['quietStart', 'quietEnd']) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body[key] ?? ''))
        return NextResponse.json(
          { error: 'Horário inválido' },
          { status: 400 }
        );
      settings[key] = body[key];
    }
    const phone = String(body.phone ?? '').replace(/\D/g, '');
    if (settings.whatsapp && !/^\d{8,15}$/.test(phone))
      return NextResponse.json(
        { error: 'Informe seu WhatsApp com DDI e DDD.' },
        { status: 400 }
      );
    settings.phone = phone;
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: userId, account_id: accountId, settings },
        { onConflict: 'user_id,account_id' }
      );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
