/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
  /** Optional sales pipeline name. A deal is created only when this exists. */
  pipeline?: string;
  /** Optional stage name within `pipeline`; blank uses that pipeline's first stage. */
  stage?: string;
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
  /** True when the CSV header includes `pipeline` or `funil`. */
  hasPipelineColumn: boolean;
  /** True when the CSV header includes `stage` or `etapa`. */
  hasStageColumn: boolean;
}

function headerIndex(headers: string[], ...aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return {
      rows: [],
      hasTagsColumn: false,
      hasCompanyColumn: false,
      hasPipelineColumn: false,
      hasStageColumn: false,
    };
  }

  const headers = lines[0]
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  // Accept both the downloadable Portuguese template and the original
  // English column names, so existing imports continue to work.
  const phoneIdx = headerIndex(headers, 'phone', 'telefone');
  if (phoneIdx === -1) {
    return {
      rows: [],
      hasTagsColumn: false,
      hasCompanyColumn: false,
      hasPipelineColumn: false,
      hasStageColumn: false,
    };
  }

  const nameIdx = headerIndex(headers, 'name', 'nome');
  const emailIdx = headerIndex(headers, 'email', 'e-mail');
  const companyIdx = headerIndex(headers, 'company', 'empresa');
  const tagsIdx = headerIndex(headers, 'tags', 'tag', 'etiquetas', 'etiqueta');
  const pipelineIdx = headerIndex(headers, 'pipeline', 'funil');
  const stageIdx = headerIndex(headers, 'stage', 'etapa');

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
      pipeline:
        pipelineIdx >= 0
          ? values[pipelineIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      stage:
        stageIdx >= 0
          ? values[stageIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
    hasPipelineColumn: pipelineIdx >= 0,
    hasStageColumn: stageIdx >= 0,
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
