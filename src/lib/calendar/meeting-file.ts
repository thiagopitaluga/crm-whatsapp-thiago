function escapeText(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[;,]/g, (char) => '\\' + char);
}

function utc(date: string | Date) {
  return new Date(date)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function meetingCalendarFile(meeting: {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
}) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OrganiZAP//Agenda//PT',
    'BEGIN:VEVENT',
    `UID:${escapeText(meeting.id)}@organizap.tpxdigital.com`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(meeting.starts_at)}`,
    `DTEND:${utc(meeting.ends_at)}`,
    `SUMMARY:${escapeText(meeting.title)}`,
    ...(meeting.location ? [`LOCATION:${escapeText(meeting.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
