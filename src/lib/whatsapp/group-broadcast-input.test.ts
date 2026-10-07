import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAccountGroupMediaUrl, MAX_BROADCAST_GROUPS, parseGroupBroadcastInput } from './group-broadcast-input'

afterEach(() => vi.useRealTimers())

describe('group broadcast input', () => {
  it('rejects a past time so a campaign cannot be immediately overdue', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T20:00:00Z'))
    expect(parseGroupBroadcastInput({
      name: 'Aviso', message_text: 'Olá', scheduled_at: '2026-10-06T19:59:00Z',
      groups: [{ group_jid: '123@g.us', subject: 'Equipe' }],
    })).toHaveProperty('error')
  })

  it('deduplicates valid group IDs and keeps their subjects', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T20:00:00Z'))
    const result = parseGroupBroadcastInput({
      name: ' Aviso ', message_text: ' Olá ', scheduled_at: '2026-10-06T20:05:00Z',
      groups: [{ group_jid: '123@g.us', subject: 'Equipe' }, { group_jid: '123@g.us', subject: 'Equipe' }],
    })
    expect(result).toEqual({ value: {
      name: 'Aviso', message: 'Olá', scheduledAt: '2026-10-06T20:05:00.000Z',
      groups: [{ group_jid: '123@g.us', group_subject: 'Equipe' }],
      kind: 'text', recurrence: 'none', mediaUrl: null, mediaName: null,
      pollOptions: [], sendNow: false,
    } })
  })

  it('accepts only media from the same account folder', () => {
    const base = 'https://project.supabase.co'
    expect(isAccountGroupMediaUrl(`${base}/storage/v1/object/public/chat-media/account-abc/group-broadcast/file.png`, 'abc', base)).toBe(true)
    expect(isAccountGroupMediaUrl(`${base}/storage/v1/object/public/chat-media/account-other/group-broadcast/file.png`, 'abc', base)).toBe(false)
    expect(isAccountGroupMediaUrl('http://127.0.0.1/storage/v1/object/public/chat-media/account-abc/group-broadcast/file.png', 'abc', base)).toBe(false)
  })

  it('accepts a full group selection but enforces the safety ceiling', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T20:00:00Z'))
    const base = { name: 'Todos', message_text: 'Olá', scheduled_at: '2026-10-06T20:05:00Z' }
    const groups = Array.from({ length: 79 }, (_, index) => ({ group_jid: `${index}@g.us`, subject: `Grupo ${index}` }))
    expect(parseGroupBroadcastInput({ ...base, groups })).toHaveProperty('value.groups', groups.map((group) => ({ group_jid: group.group_jid, group_subject: group.subject })))
    const tooMany = Array.from({ length: MAX_BROADCAST_GROUPS + 1 }, (_, index) => ({ group_jid: `${index}@g.us`, subject: `Grupo ${index}` }))
    expect(parseGroupBroadcastInput({ ...base, groups: tooMany })).toHaveProperty('error')
  })
})

