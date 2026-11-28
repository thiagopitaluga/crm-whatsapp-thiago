import { fetchQrConnector } from './qr-connector'

export const groupActions = ['subject', 'description', 'picture', 'announcement', 'not_announcement', 'invite', 'revoke_invite'] as const
export type GroupAction = typeof groupActions[number]

export function parseGroupAction(input: Record<string, unknown>) {
  const action = input.action
  const groupJid = input.group_jid
  const senderChannelId = input.sender_channel_id
  const value = typeof input.value === 'string' ? input.value.trim() : ''
  const date = input.scheduled_at ? new Date(String(input.scheduled_at)) : new Date()
  if (!groupActions.includes(action as GroupAction) || typeof groupJid !== 'string' || !/^[^\s@]{1,80}@g\.us$/.test(groupJid) ||
      typeof senderChannelId !== 'string' || !/^[0-9a-f-]{36}$/i.test(senderChannelId) || Number.isNaN(date.getTime()))
    return { error: 'Informe grupo, número, ação e data válidos.' } as const
  if ((action === 'subject' && (value.length < 2 || value.length > 100)) ||
      (action === 'description' && value.length > 2048) ||
      (action === 'picture' && !value))
    return { error: 'Confira o conteúdo da alteração.' } as const
  return { value: { action: action as GroupAction, groupJid, senderChannelId, content: value || null, scheduledAt: date.toISOString() } } as const
}

export async function executeGroupAction(accountId: string, instanceName: string, groupJid: string, action: GroupAction, value: string | null) {
  const response = await fetchQrConnector(accountId, 'groups/control', {
    method: 'POST', body: JSON.stringify({ group_id: groupJid, action, value }), signal: AbortSignal.timeout(20_000),
  }, { instanceName })
  const payload = await response.json().catch(() => null) as { error?: string; result?: string } | null
  if (!response.ok) throw new Error(payload?.error ?? `Evolution respondeu ${response.status}`)
  return payload?.result ?? null
}
