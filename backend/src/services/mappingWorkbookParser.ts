import * as XLSX from 'xlsx';

export interface WorkbookFieldMappingCandidate {
  sheetName: string;
  rowNumber: number;
  sourceFieldName: string;
  targetEntityHint: string;
  targetFieldName: string;
}

interface HeaderDescriptor {
  rowIndex: number;
  sourceIndexes: number[];
  targetEntityIndex: number;
  targetFieldIndex: number;
}

const HEADER_SCAN_LIMIT = 30;
const SUMMARY_SHEET_PREFIXES = ['total fields', 'duplicated', 'unique'];
const IGNORE_SOURCE_PREFIXES = ['not in', 'internal', 'not in use', 'n/a'];

export function parseWorkbookFieldMappings(buffer: Buffer): WorkbookFieldMappingCandidate[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', dense: true });
  const out: WorkbookFieldMappingCandidate[] = [];
  const seen = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    if (isSummarySheet(sheetName)) continue;

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    });
    if (!rows.length) continue;

    const header = findHeaderDescriptor(rows);
    if (!header) continue;

    for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const targetFieldName = extractTargetFieldName(row[header.targetFieldIndex]);
      if (!targetFieldName) continue;

      const sourceFieldName = pickSourceFieldName(row, header.sourceIndexes);
      if (!sourceFieldName) continue;

      const targetEntityHint = extractTargetEntityHint(row[header.targetEntityIndex]);
      const dedupeKey = `${normalizeKey(sourceFieldName)}|${normalizeKey(targetFieldName)}|${normalizeKey(targetEntityHint)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({
        sheetName,
        rowNumber: rowIndex + 1,
        sourceFieldName,
        targetEntityHint,
        targetFieldName,
      });
    }
  }

  return out;
}

function isSummarySheet(sheetName: string): boolean {
  const normalized = sheetName.trim().toLowerCase();
  if (normalized === 'xml file') return true;
  return SUMMARY_SHEET_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function findHeaderDescriptor(rows: Array<Array<string | number | boolean>>): HeaderDescriptor | null {
  const scanLimit = Math.min(rows.length, HEADER_SCAN_LIMIT);

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const normalizedHeaders = row.map((cell) => normalizeHeader(cell));
    const targetEntityIndex = normalizedHeaders.findIndex((header) => header === 'object name');
    const targetFieldIndex = normalizedHeaders.findIndex((header) => header === 'api name');

    if (targetEntityIndex < 0 || targetFieldIndex < 0) continue;

    const sourceIndexes = normalizedHeaders
      .map((header, index) => ({ header, index }))
      .filter(({ index }) =>
        index !== targetEntityIndex &&
        index !== targetFieldIndex &&
        isSourceColumnHeader(normalizedHeaders[index] ?? ''),
      )
      .map(({ index }) => index);

    if (!sourceIndexes.length) continue;

    return {
      rowIndex,
      sourceIndexes,
      targetEntityIndex,
      targetFieldIndex,
    };
  }

  return null;
}

function isSourceColumnHeader(header: string): boolean {
  if (!header) return false;
  if (header === 'field name' || header === 'xml' || header === 'xml name') return true;
  return header.includes('xml element');
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickSourceFieldName(row: Array<string | number | boolean>, sourceIndexes: number[]): string | null {
  for (const index of sourceIndexes) {
    const candidate = extractSourceFieldName(row[index]);
    if (candidate) return candidate;
  }
  return null;
}

function extractSourceFieldName(value: unknown): string | null {
  const raw = String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (IGNORE_SOURCE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null;

  const xmlTag = raw.match(/<\s*\/?\s*([A-Za-z][A-Za-z0-9_.:-]*)\s*>/);
  if (xmlTag?.[1]) {
    return sanitizeToken(xmlTag[1]);
  }

  const plainToken = raw.match(/\b([A-Za-z][A-Za-z0-9_]{2,})\b/);
  if (!plainToken?.[1]) return null;
  return sanitizeToken(plainToken[1]);
}

function extractTargetFieldName(value: unknown): string | null {
  const token = sanitizeToken(String(value ?? ''));
  if (!token) return null;
  if (token.toLowerCase().startsWith('notin')) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) return null;
  return token;
}

function extractTargetEntityHint(value: unknown): string {
  const raw = String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!raw) return '';

  const preferred = raw.match(/\(([^)]+)\)/)?.[1]?.trim();
  if (preferred) {
    return sanitizeEntityHint(preferred);
  }
  return sanitizeEntityHint(raw);
}

function sanitizeEntityHint(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeToken(value: string): string {
  return value
    .replace(/[<>\s]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .trim();
}
