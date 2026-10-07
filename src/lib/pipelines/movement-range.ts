export interface MovementRange {
  from: string;
  to: string;
  fromInstant: string;
  toExclusiveInstant: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** CRM dates are interpreted in Brasília time (UTC−03:00). */
export function parseMovementRange(params: URLSearchParams): MovementRange | null {
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00-03:00`);
  const end = Date.parse(`${to}T00:00:00-03:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (!isValidCivilDate(from) || !isValidCivilDate(to)) return null;
  const days = (end - start) / 86_400_000;
  if (days < 0 || days > 365) return null;
  return {
    from,
    to,
    fromInstant: new Date(start).toISOString(),
    toExclusiveInstant: new Date(end + 86_400_000).toISOString(),
  };
}

function isValidCivilDate(value: string): boolean {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

