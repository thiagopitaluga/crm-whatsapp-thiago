import { describe, expect, it } from 'vitest'
import { composeGroupMessage, hasGroupMentionAll, stripGroupMentionAll, supportsGroupMentionAll } from './group-mention-all'
import { parseGroupBroadcastInput } from './group-broadcast-input'

describe('group mention-all', () => {
  it('adds a single persisted marker and restores the visible message', () => {
    const stored = composeGroupMessage('Aviso importante', true)
    expect(stored).toBe('Aviso importante\n{{todos}}')
    expect(hasGroupMentionAll(stored)).toBe(true)
    expect(stripGroupMentionAll(stored)).toBe('Aviso importante')
    expect(composeGroupMessage(stored, false)).toBe('Aviso importante')
  })

  it('is limited to content types where Baileys can show a mention', () => {
    expect(supportsGroupMentionAll('text')).toBe(true)
    expect(supportsGroupMentionAll('image')).toBe(true)
    expect(supportsGroupMentionAll('video')).toBe(true)
    expect(supportsGroupMentionAll('audio')).toBe(false)
    expect(supportsGroupMentionAll('poll')).toBe(false)
  })

  it('rejects a marker without a real message or on unsupported content', () => {
    const base = { name: 'Aviso', scheduled_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      groups: [{ group_jid: '123@g.us', subject: 'Equipe' }] }
    expect(parseGroupBroadcastInput({ ...base, message_text: '{{todos}}' })).toHaveProperty('error')
    expect(parseGroupBroadcastInput({ ...base, message_text: 'Olá\n{{todos}}', content_kind: 'audio', media_url: 'https://example.com/a.mp3' })).toHaveProperty('error')
    expect(parseGroupBroadcastInput({ ...base, message_text: 'Olá\n{{todos}}', content_kind: 'text' })).toHaveProperty('value.message', 'Olá\n{{todos}}')
  })
})
