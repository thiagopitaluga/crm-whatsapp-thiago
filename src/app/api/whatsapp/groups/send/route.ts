import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { fetchQrConnector } from '@/lib/whatsapp/qr-connector';
import { supabaseAdmin } from '@/lib/ai/admin-client';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(`group-chat:${userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const groupJid = typeof body?.groupJid === 'string' ? body.groupJid : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (
      !/^[^\s@]{1,80}@g\.us$/.test(groupJid) ||
      !text ||
      text.length > 4096 ||
      text.includes('{{todos}}')
    )
      return NextResponse.json(
        { error: 'Grupo ou mensagem inválida.' },
        { status: 400 }
      );
    const { data: group, error: groupError } = await supabase
      .from('whatsapp_groups')
      .select('group_jid')
      .eq('account_id', accountId)
      .eq('group_jid', groupJid)
      .maybeSingle();
    if (groupError) throw groupError;
    if (!group)
      return NextResponse.json(
        { error: 'Grupo não encontrado nesta conta.' },
        { status: 404 }
      );

    let response: Response;
    try {
      response = await fetchQrConnector(accountId, 'groups/send', {
        method: 'POST',
        body: JSON.stringify({ kind: 'text', text, group_ids: [groupJid] }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return NextResponse.json(
        { error: 'Envio incerto. Confira o grupo antes de tentar novamente.' },
        { status: 503 }
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      results?: Array<{ status?: string; message_id?: string; error?: string }>;
    } | null;
    const result = payload?.results?.[0];
    if (!response.ok || result?.status !== 'sent')
      return NextResponse.json(
        {
          error:
            result?.status === 'failed'
              ? 'Não foi possível enviar ao grupo.'
              : 'Envio incerto. Confira o grupo antes de tentar novamente.',
        },
        { status: result?.status === 'failed' ? 502 : 503 }
      );

    // The webhook writes the same provider ID. This makes the message visible
    // immediately without creating a second copy when the echo arrives.
    if (result.message_id) {
      const { error } = await supabaseAdmin().from('group_messages').upsert(
        {
          account_id: accountId,
          group_jid: groupJid,
          message_id: result.message_id,
          participant_jid: null,
          participant_name: null,
          from_me: true,
          message_type: 'text',
          content_text: text,
        },
        {
          onConflict: 'account_id,group_jid,message_id',
          ignoreDuplicates: true,
        }
      );
      if (error)
        console.error('[group-chat] sent message cache failed:', error.code);
    }
    return NextResponse.json({
      sent: true,
      messageId: result.message_id ?? null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
