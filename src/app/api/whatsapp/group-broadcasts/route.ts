import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { isAccountGroupMediaUrl, parseGroupBroadcastInput } from '@/lib/whatsapp/group-broadcast-input'
import { hasGroupMentionAll } from '@/lib/whatsapp/group-mention-all'
import { canMentionAllInGroups } from '@/lib/whatsapp/group-mention-all-server'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('group_broadcasts')
      .select('id, name, message_text, content_kind, media_url, media_name, poll_options, recurrence, series_id, occurrence_no, retry_of, status, scheduled_at, sent_at, total_groups, sent_count, failed_count, last_error, created_at, group_broadcast_targets:group_broadcast_targets!group_broadcast_targets_broadcast_account_fkey(group_jid, group_subject, status, sent_at, error_message)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    return NextResponse.json({
      broadcasts: data ?? [],
      scheduler_enabled: process.env.GROUP_BROADCAST_SCHEDULER_ENABLED === 'true',
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * Store a scheduled QR group campaign. This never sends immediately: dispatch
 * happens only when the protected cron worker claims the due campaign.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    // Vercel Hobby cannot run the minute-level scheduler. Do not accept a
    // campaign that would silently remain pending until an external worker
    // has been installed and explicitly enabled for this environment.
    if (process.env.GROUP_BROADCAST_SCHEDULER_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'Os disparos em grupos aguardam a ativação do agendador neste ambiente.' },
        { status: 503 },
      )
    }
    const limit = checkRateLimit(`group-broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    const parsed = parseGroupBroadcastInput(await request.json() as Record<string, unknown>)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { name, message, scheduledAt, groups, kind, recurrence, mediaUrl, mediaName, pollOptions } = parsed.value
    if (hasGroupMentionAll(message) && !await canMentionAllInGroups(accountId, groups.map((group) => group.group_jid))) {
      return NextResponse.json({ error: 'Para marcar todos, selecione somente grupos que você administra e atualize a conexão.' }, { status: 403 })
    }
    if (mediaUrl && !isAccountGroupMediaUrl(mediaUrl, accountId, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) {
      return NextResponse.json({ error: 'Use um arquivo enviado para esta conta do CRM.' }, { status: 400 })
    }
    const { data: available, error: groupsError } = await supabase.from('whatsapp_groups')
      .select('group_jid').eq('account_id', accountId).in('group_jid', groups.map((group) => group.group_jid))
    if (groupsError) throw groupsError
    if ((available ?? []).length !== groups.length) {
      return NextResponse.json({ error: 'Atualize a lista: um dos grupos não pertence à conexão atual.' }, { status: 400 })
    }

    const { data: broadcast, error: insertError } = await supabase
      .from('group_broadcasts')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        message_text: message,
        content_kind: kind,
        media_url: mediaUrl,
        media_name: mediaName,
        poll_options: pollOptions,
        recurrence,
        series_id: recurrence === 'none' ? null : randomUUID(),
        scheduled_at: scheduledAt,
        status: 'scheduled',
        total_groups: groups.length,
      })
      .select('id, name, status, scheduled_at, total_groups')
      .single()
    if (insertError || !broadcast) throw insertError ?? new Error('Could not create group broadcast')

    const { error: targetsError } = await supabase.from('group_broadcast_targets').insert(
      groups.map((group) => ({ ...group, account_id: accountId, broadcast_id: broadcast.id })),
    )
    if (targetsError) {
      await supabase.from('group_broadcasts').delete().eq('id', broadcast.id).eq('account_id', accountId)
      throw targetsError
    }
    return NextResponse.json({ broadcast }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

