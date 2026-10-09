import { fetchQrConnector } from './qr-connector'

/** Recheck live group ownership before scheduling an @todos campaign. */
export async function canMentionAllInGroups(accountId: string, groupJids: string[]): Promise<boolean> {
  const response = await fetchQrConnector(accountId, 'groups')
  if (!response.ok) return false
  const payload = await response.json() as {
    member_tools_version?: unknown
    groups?: Array<{ id?: unknown; is_admin?: unknown }>
  }
  if (payload.member_tools_version !== 1 || !Array.isArray(payload.groups)) return false
  const administered = new Set(payload.groups
    .filter((group) => group.is_admin === true && typeof group.id === 'string')
    .map((group) => group.id as string))
  return groupJids.every((jid) => administered.has(jid))
}
