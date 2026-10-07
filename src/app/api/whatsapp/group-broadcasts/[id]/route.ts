import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAccountGroupMediaUrl, parseGroupBroadcastInput } from '@/lib/whatsapp/group-broadcast-input'

export const runtime = 'nodejs'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const parsed = parseGroupBroadcastInput(await request.json() as Record<string, unknown>)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { name, message, scheduledAt, groups, kind, recurrence, mediaUrl, mediaName, pollOptions } = parsed.value
    if (mediaUrl && !isAccountGroupMediaUrl(mediaUrl, accountId, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) {
      return NextResponse.json({ error: 'Use um arquivo enviado para esta conta do CRM.' }, { status: 400 })
    }
    const { data, error } = await supabase.rpc('update_scheduled_group_broadcast_v2', {
      p_account_id: accountId,
      p_broadcast_id: id,
      p_name: name,
      p_message_text: message,
      p_scheduled_at: scheduledAt,
      p_groups: groups,
      p_content_kind: kind,
      p_media_url: mediaUrl,
      p_media_name: mediaName,
      p_poll_options: pollOptions,
      p_recurrence: recurrence,
    })
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Este disparo já começou, foi excluído ou não pertence à sua conta.' }, { status: 409 })
    return NextResponse.json({ updated: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    // The status predicate makes deletion race-safe against the cron claim.
    const { data, error } = await supabase
      .from('group_broadcasts')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .in('status', ['scheduled', 'failed'])
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Só é possível excluir um disparo agendado ou com falha.' }, { status: 409 })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

