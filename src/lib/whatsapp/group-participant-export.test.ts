import { describe, expect, it } from 'vitest'
import { groupParticipantsCsv } from './group-participant-export'

describe('group participant CSV', () => {
  it('keeps columns quoted, protects spreadsheets, and supports unknown phone numbers', () => {
    const csv = groupParticipantsCsv('Equipe; vendas', [
      { name: '=HYPERLINK("evil")', phone: '5511999999999', jid: '5511999999999@s.whatsapp.net', is_admin: true },
      { name: 'Sem número', phone: '', jid: '123@lid', is_admin: false },
    ])
    expect(csv).toContain('"Equipe; vendas";"\'=HYPERLINK(""evil"")";"5511999999999"')
    expect(csv).toContain('"Sem número";"";"123@lid";"Participante"')
    expect(csv.startsWith('\uFEFF')).toBe(true)
  })
})
