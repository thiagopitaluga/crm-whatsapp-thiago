export function selectedValues(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}
export function validateCustomValue(
  type: string,
  value: string,
  options: string[] = []
): string {
  if (!value) return value;
  if (
    type === 'number' &&
    (!Number.isFinite(Number(value)) || !Number.isInteger(Number(value)))
  )
    throw new Error('Informe um número inteiro.');
  if (type === 'decimal' && !Number.isFinite(Number(value)))
    throw new Error('Informe um valor decimal válido.');
  if (type === 'multiselect') {
    const selected = selectedValues(value);
    if (selected.some((v) => !options.includes(v)))
      throw new Error('Selecione opções válidas.');
    return JSON.stringify(selected);
  }
  if (type === 'select' && !options.includes(value))
    throw new Error('Selecione uma opção válida.');
  return value;
}
