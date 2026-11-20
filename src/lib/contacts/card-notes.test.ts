import { it, expect } from 'vitest';
import { cardNotes } from './card-notes';
it('includes existing contact notes without a legacy deal note', () =>
  expect(
    cardNotes(undefined, [{ note_text: 'teste', created_at: '2026-11-20' }])
  ).toBe('teste'));
it('keeps legacy content and avoids duplicated quick notes', () =>
  expect(
    cardNotes('Antiga\n\nteste', [
      { note_text: 'teste', created_at: '2026-11-20' },
      { note_text: 'Nova', created_at: '2026-11-21' },
    ])
  ).toBe('Antiga\n\nteste\n\nNova'));
it('does not suppress a note just because it is a substring', () =>
  expect(
    cardNotes('teste completo', [
      { note_text: 'teste', created_at: '2026-11-20' },
    ])
  ).toBe('teste completo\n\nteste'));
