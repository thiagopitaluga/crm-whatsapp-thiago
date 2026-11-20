export function cardNotes(
  legacy: string | undefined,
  notes: { note_text: string; created_at: string }[] = []
): string {
  let result = legacy?.trim() ?? '';
  for (const note of [...notes].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  )) {
    const text = note.note_text.trim();
    if (text && !`\n${result}\n`.includes(`\n${text}\n`))
      result = [result, text].filter(Boolean).join('\n\n');
  }
  return result;
}
