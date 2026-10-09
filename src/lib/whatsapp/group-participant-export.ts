export type GroupParticipantRow = {
  name: string
  phone: string
  jid: string
  is_admin: boolean
}

function csvCell(value: string): string {
  // Prevent spreadsheet formula execution when a group or contact name starts
  // with a formula prefix. Quoting alone does not prevent CSV injection.
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function groupParticipantsCsv(subject: string, participants: GroupParticipantRow[]): string {
  const rows = [['Grupo', 'Nome', 'Telefone', 'ID do WhatsApp', 'Papel']]
  for (const participant of participants) {
    rows.push([subject, participant.name, participant.phone, participant.jid,
      participant.is_admin ? 'Administrador' : 'Participante'])
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}
