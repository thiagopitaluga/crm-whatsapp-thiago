export type BroadcastGroup = { group_jid: string; group_subject: string }
export type GroupContentKind = 'text' | 'image' | 'video' | 'audio' | 'document' | 'poll'
export type GroupRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'
export const MAX_BROADCAST_GROUPS = 300

const CONTENT_KINDS = new Set<GroupContentKind>(['text', 'image', 'video', 'audio', 'document', 'poll'])
const RECURRENCES = new Set<GroupRecurrence>(['none', 'daily', 'weekly', 'monthly'])

/** Only files in this account's public CRM bucket can reach the QR service. */
export function isAccountGroupMediaUrl(value: string, accountId: string, supabaseUrl: string): boolean {
  try {
    const candidate = new URL(value)
    const storage = new URL(supabaseUrl)
    return candidate.protocol === 'https:' && candidate.origin === storage.origin &&
      candidate.pathname.startsWith(`/storage/v1/object/public/chat-media/account-${accountId}/group-broadcast/`)
  } catch {
    return false
  }
}

export function parseGroupBroadcastInput(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const message = typeof body.message_text === 'string' ? body.message_text.trim() : ''
  const sendNow = body.send_now === true
  const date = sendNow ? new Date() : typeof body.scheduled_at === 'string' ? new Date(body.scheduled_at) : null
  const kind = typeof body.content_kind === 'string' && CONTENT_KINDS.has(body.content_kind as GroupContentKind)
    ? body.content_kind as GroupContentKind : 'text'
  const recurrence = typeof body.recurrence === 'string' && RECURRENCES.has(body.recurrence as GroupRecurrence)
    ? body.recurrence as GroupRecurrence : 'none'
  const mediaUrl = typeof body.media_url === 'string' ? body.media_url.trim() : ''
  const mediaName = typeof body.media_name === 'string' ? body.media_name.trim().slice(0, 255) : ''
  const pollOptions = Array.isArray(body.poll_options)
    ? body.poll_options.filter((option): option is string => typeof option === 'string')
      .map((option) => option.trim().slice(0, 100)).filter(Boolean).slice(0, 12)
    : []
  if (body.content_kind !== undefined && !CONTENT_KINDS.has(body.content_kind as GroupContentKind)) {
    return { error: 'Tipo de conteúdo inválido.' } as const
  }
  if (body.recurrence !== undefined && !RECURRENCES.has(body.recurrence as GroupRecurrence)) {
    return { error: 'Frequência inválida.' } as const
  }
  const inputs = Array.isArray(body.groups) ? body.groups : []
  const groups = [...new Map(inputs
    .filter((group): group is Record<string, unknown> => !!group && typeof group === 'object' && !Array.isArray(group))
    .filter((group) => typeof group.group_jid === 'string' && /^[^\s@]+@g\.us$/.test(group.group_jid))
    .map((group) => [group.group_jid as string, {
      group_jid: group.group_jid as string,
      group_subject: typeof group.group_subject === 'string' && group.group_subject.trim()
        ? group.group_subject.trim().slice(0, 255)
        : typeof group.subject === 'string' && group.subject.trim()
          ? group.subject.trim().slice(0, 255) : 'Grupo sem nome',
    } as BroadcastGroup])).values()]

  if (!name || name.length > 120 || groups.length < 1 || groups.length > MAX_BROADCAST_GROUPS) {
    return { error: `Informe um nome e selecione entre 1 e ${MAX_BROADCAST_GROUPS} grupos.` } as const
  }
  if ((!message && (kind === 'text' || kind === 'poll')) || message.length > 4096) {
    return { error: 'Informe uma mensagem válida.' } as const
  }
  if (kind === 'poll' && (pollOptions.length < 2 || new Set(pollOptions).size !== pollOptions.length)) {
    return { error: 'A enquete precisa de pelo menos duas opções diferentes.' } as const
  }
  if (kind !== 'text' && kind !== 'poll' && !mediaUrl) {
    return { error: 'Escolha um arquivo para este disparo.' } as const
  }
  if (!date || Number.isNaN(date.getTime()) || (!sendNow && date.getTime() < Date.now() + 60_000)) {
    return { error: 'Escolha uma data e hora futuras para o disparo.' } as const
  }
  if (sendNow && recurrence !== 'none') {
    return { error: 'Disparos recorrentes precisam de uma data inicial.' } as const
  }
  return { value: {
    name, message, scheduledAt: date.toISOString(), groups,
    kind, recurrence, mediaUrl: mediaUrl || null, mediaName: mediaName || null,
    pollOptions, sendNow,
  } } as const
}

