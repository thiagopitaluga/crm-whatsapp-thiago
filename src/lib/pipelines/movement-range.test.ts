import { describe, expect, it } from 'vitest';
import { parseMovementRange } from './movement-range';

describe('parseMovementRange', () => {
  it('includes the whole final day in Brasília time', () => {
    expect(parseMovementRange(new URLSearchParams('from=2026-10-01&to=2026-10-07')))
      .toEqual({
        from: '2026-10-01',
        to: '2026-10-07',
        fromInstant: '2026-10-01T03:00:00.000Z',
        toExclusiveInstant: '2026-10-08T03:00:00.000Z',
      });
  });

  it('rejects invalid and reversed periods', () => {
    expect(parseMovementRange(new URLSearchParams('from=2026-02-30&to=2026-03-01'))).toBeNull();
    expect(parseMovementRange(new URLSearchParams('from=2026-10-07&to=2026-10-01'))).toBeNull();
    expect(parseMovementRange(new URLSearchParams('from=2025-01-01&to=2026-10-07'))).toBeNull();
  });
});

