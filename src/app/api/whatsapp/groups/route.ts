import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { fetchQrConnector, QrConnectorConfigurationError } from '@/lib/whatsapp/qr-connector'

export const runtime = 'nodejs'

type ConnectorGroup = { id?: unknown; subject?: unknown; participant_count?: unknown; is_admin?: unknown }

/** Lists only metadata for groups available to this account's QR session. */
export async function GET() {
  try {
    const { accountId, supabase } = await requireRole('agent')
    const response = await fetchQrConnector(accountId, 'groups')
    if (!response.ok) {
      const { data: cached } = await supabase.from('whatsapp_groups')
        .select('group_jid, subject, participant_count, is_admin, folder, labels, last_message_at')
        .eq('account_id', accountId).order('subject')
      if (cached?.length) return NextResponse.json({ groups: cached, connected: false,
        warning: 'WhatsApp desconectado. A lista exibida é a última sincronizada.' },
        { headers: { 'cache-control': 'no-store' } })
      return unavailable(response.status)
    }
    const payload = (await response.json()) as { groups?: ConnectorGroup[]; admin_detection_version?: number }
    const adminFilterAvailable = payload.admin_detection_version === 2
    const groups = (payload.groups ?? [])
      .filter((row): row is Required<Pick<ConnectorGroup, 'id' | 'subject'>> & ConnectorGroup =>
        typeof row.id === 'string' && row.id.endsWith('@g.us') && typeof row.subject === 'string')
      .map((row) => ({
        group_jid: row.id as string,
        subject: (row.subject as string).trim().slice(0, 255) || 'Grupo sem nome',
        participant_count: typeof row.participant_count === 'number' && row.participant_count >= 0 ? row.participant_count : 0,
        is_admin: row.is_admin === true,
      }))

    // The directory is a cache for the schedule/audit UI. The authoritative
    // recipient check is repeated by the connector immediately before send.
    if (groups.length > 0) {
      const { error } = await supabase.from('whatsapp_groups').upsert(
        groups.map((group) => ({ ...group, account_id: accountId, last_seen_at: new Date().toISOString() })),
        { onConflict: 'account_id,group_jid' },
      )
      if (error) console.error('[groups] failed to cache directory:', error.message)
    }
    if (groups.length === 0) {
      return NextResponse.json({ groups: [], admin_filter_available: adminFilterAvailable }, { headers: { 'cache-control': 'no-store' } })
    }
    const { data: details } = await supabase.from('whatsapp_groups')
      .select('group_jid, folder, labels, last_message_at').eq('account_id', accountId)
      .in('group_jid', groups.map((group) => group.group_jid))
    const byJid = new Map((details ?? []).map((row) => [row.group_jid, row]))
    return NextResponse.json({ admin_filter_available: adminFilterAvailable, groups: groups.map((group) => ({ ...group,
      folder: byJid.get(group.group_jid)?.folder ?? '',
      labels: byJid.get(group.group_jid)?.labels ?? [],
      last_message_at: byJid.get(group.group_jid)?.last_message_at ?? null,
    })) }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return handle(error)
  }
}

function unavailable(status: number) {
  return NextResponse.json(
    { error: status === 409 ? 'Conecte o WhatsApp por QR para visualizar os grupos.' : 'Não foi possível carregar os grupos agora.' },
    { status: status === 409 ? 409 : 502 },
  )
}

function handle(error: unknown) {
  if (error instanceof QrConnectorConfigurationError) {
    return NextResponse.json({ error: 'O conector QR não está configurado neste ambiente.' }, { status: 503 })
  }
  return toErrorResponse(error)
}

