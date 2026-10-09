import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { groupParticipantsCsv, type GroupParticipantRow } from '@/lib/whatsapp/group-participant-export'
import { fetchQrConnector, QrConnectorConfigurationError } from '@/lib/whatsapp/qr-connector'

export const runtime = 'nodejs'

/** Download one group at a time; participant details are never cached in Supabase. */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null) as { group_jid?: unknown } | null
    const groupJid = body?.group_jid
    if (typeof groupJid !== 'string' || !/^[^\s@]{1,80}@g\.us$/.test(groupJid)) {
      return NextResponse.json({ error: 'Selecione um grupo válido.' }, { status: 400 })
    }
    const limit = checkRateLimit(`group-participants:${accountId}:${userId}`, { limit: 10, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)
    const response = await fetchQrConnector(accountId, 'groups/participants', {
      method: 'POST', body: JSON.stringify({ group_id: groupJid }), signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      return NextResponse.json({ error: response.status === 403
        ? 'Somente grupos que você administra podem ser exportados.'
        : response.status === 409 ? 'Conecte o WhatsApp para exportar os participantes.'
          : 'Não foi possível obter os participantes deste grupo.' }, { status: response.status === 403 ? 403 : 502 })
    }
    const payload = await response.json() as { subject?: unknown; participants?: unknown }
    if (typeof payload.subject !== 'string' || !Array.isArray(payload.participants)) {
      return NextResponse.json({ error: 'O conector retornou uma lista inválida.' }, { status: 502 })
    }
    const participants = payload.participants.slice(0, 5000).filter((row): row is GroupParticipantRow =>
      !!row && typeof row === 'object' && typeof row.name === 'string' &&
      typeof row.phone === 'string' && typeof row.jid === 'string' && typeof row.is_admin === 'boolean')
    const csv = groupParticipantsCsv(payload.subject.slice(0, 255), participants)
    return new Response(csv, { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="participantes-grupo.csv"',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
      'x-unavailable-phones': String(participants.filter((row) => !row.phone).length),
    } })
  } catch (error) {
    if (error instanceof QrConnectorConfigurationError) {
      return NextResponse.json({ error: 'O conector QR não está configurado.' }, { status: 503 })
    }
    return toErrorResponse(error)
  }
}
