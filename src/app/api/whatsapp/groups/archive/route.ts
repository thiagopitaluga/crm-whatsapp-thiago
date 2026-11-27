import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as {
      groupJid?: unknown;
      archived?: unknown;
    } | null;
    const groupJid = body?.groupJid;
    if (
      typeof groupJid !== 'string' ||
      !/^[^\s@]{1,80}@g\.us$/.test(groupJid) ||
      typeof body?.archived !== 'boolean'
    )
      return NextResponse.json(
        { error: 'Grupo ou ação inválidos.' },
        { status: 400 }
      );
    const { data, error } = await supabase
      .from('whatsapp_groups')
      .update({ archived_at: body.archived ? new Date().toISOString() : null })
      .eq('account_id', accountId)
      .eq('group_jid', groupJid)
      .select('group_jid,archived_at')
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: 'Grupo não encontrado.' },
        { status: 404 }
      );
    return NextResponse.json({ archived: Boolean(data.archived_at) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
