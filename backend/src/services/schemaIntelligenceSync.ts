import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARIBBEAN_DOMAIN_TOKENS,
  CONFIRMED_PATTERNS,
  FSC_NAMESPACE_PREFIX,
  FORMULA_FIELD_TARGETS,
  ONE_TO_MANY_FIELDS,
  PERSON_ACCOUNT_FIELD_SUFFIX,
  type ConfirmedPattern,
} from '../agents/schemaIntelligenceData.js';

export interface ParsedMarkdownTable {
  file: string;
  headingPath: string[];
  columns: string[];
  rows: Array<Record<string, string>>;
}

export interface PatternFieldSummary {
  xmlField: string;
  normalizedField: string;
  sfApiNames: string[];
  sfObjects: string[];
  confidence: Array<'HIGH' | 'MEDIUM' | 'LOW'>;
  isOneToMany: boolean;
  isFormulaTarget: boolean;
  isPersonAccountOnly: boolean;
  notes: string[];
  sourceRowCount: number;
}

export interface ConstantDiff<T> {
  markdown: T;
  current: T;
  matches: boolean;
}

export interface SchemaIntelligenceSyncReport {
  generatedAt: string;
  sourceFiles: string[];
  parsedTables: ParsedMarkdownTable[];
  parsedTablesByFile: Record<string, ParsedMarkdownTable[]>;
  summary: {
    markdownPatternFields: number;
    currentPatternFields: number;
    addedPatternFields: number;
    removedPatternFields: number;
    changedPatternFields: number;
    markdownOneToManyCount: number;
    currentOneToManyCount: number;
    addedOneToManyFields: number;
    removedOneToManyFields: number;
  };
  diff: {
    patterns: {
      added: PatternFieldSummary[];
      removed: PatternFieldSummary[];
      changed: Array<{
        normalizedField: string;
        markdown: PatternFieldSummary;
        current: PatternFieldSummary;
      }>;
    };
    oneToManyFields: {
      added: string[];
      removed: string[];
    };
    constants: {
      personAccountFieldSuffix: ConstantDiff<string | null>;
      fscNamespacePrefix: ConstantDiff<string | null>;
      glossaryTokensPresentInMarkdown: ConstantDiff<string[]>;
    };
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_SCHEMA_INTELLIGENCE_DIR = path.resolve(__dirname, '../../data/schema-intelligence');

function normalizeWhitespace(value: string): string {
  return value.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeSchemaIntelligenceField(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeHeadingTitle(value: string): string {
  return value.replace(/[#*`]/g, '').trim();
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => normalizeWhitespace(cell));
}

function isSeparatorRow(line: string): boolean {
  if (!line.trim().startsWith('|')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().includes('|');
}

export function parseMarkdownTables(markdown: string, file: string): ParsedMarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const headingStack: Array<{ level: number; title: string }> = [];
  const tables: ParsedMarkdownTable[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const title = normalizeHeadingTitle(headingMatch[2] ?? '');
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      continue;
    }

    const headerLine = lines[index] ?? '';
    const separatorLine = lines[index + 1] ?? '';
    if (!isTableRow(headerLine) || !isSeparatorRow(separatorLine)) {
      continue;
    }

    const columns = splitTableRow(headerLine);
    const rows: Array<Record<string, string>> = [];
    index += 2;
    while (index < lines.length && isTableRow(lines[index] ?? '')) {
      const cells = splitTableRow(lines[index] ?? '');
      const row: Record<string, string> = {};
      columns.forEach((column, columnIndex) => {
        row[column] = cells[columnIndex] ?? '';
      });
      rows.push(row);
      index += 1;
    }
    index -= 1;

    tables.push({
      file,
      headingPath: headingStack.map((entry) => entry.title),
      columns,
      rows,
    });
  }

  return tables;
}

function splitCandidateValues(value: string): string[] {
  return value
    .split(/\s*(?:\/|,|;|\|)\s*/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function inferConfidence(headingPath: string[], notes: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  const context = `${headingPath.join(' ')} ${notes}`.toLowerCase();
  if (context.includes('low confidence') || context.includes('boolean maps to text')) {
    return 'LOW';
  }
  if (context.includes('medium confidence') || context.includes('semantic matches')) {
    return 'MEDIUM';
  }
  return 'HIGH';
}

function upsertPatternSummary(
  patternMap: Map<string, PatternFieldSummary>,
  row: {
    xmlField: string;
    sfApiNames: string[];
    sfObjects: string[];
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    notes: string;
    isOneToMany: boolean;
    isFormulaTarget: boolean;
    isPersonAccountOnly: boolean;
  },
): void {
  const normalizedField = normalizeSchemaIntelligenceField(row.xmlField);
  const existing = patternMap.get(normalizedField);
  const next: PatternFieldSummary = existing ?? {
    xmlField: row.xmlField,
    normalizedField,
    sfApiNames: [],
    sfObjects: [],
    confidence: [],
    isOneToMany: false,
    isFormulaTarget: false,
    isPersonAccountOnly: false,
    notes: [],
    sourceRowCount: 0,
  };

  next.xmlField = next.xmlField || row.xmlField;
  next.sfApiNames = Array.from(new Set([...next.sfApiNames, ...row.sfApiNames])).sort();
  next.sfObjects = Array.from(new Set([...next.sfObjects, ...row.sfObjects])).sort();
  next.confidence = Array.from(new Set([...next.confidence, row.confidence])).sort() as Array<'HIGH' | 'MEDIUM' | 'LOW'>;
  next.isOneToMany = next.isOneToMany || row.isOneToMany;
  next.isFormulaTarget = next.isFormulaTarget || row.isFormulaTarget;
  next.isPersonAccountOnly = next.isPersonAccountOnly || row.isPersonAccountOnly;
  next.notes = Array.from(new Set([...next.notes, row.notes].filter(Boolean))).sort();
  next.sourceRowCount += 1;

  patternMap.set(normalizedField, next);
}

export function buildMarkdownPatternFieldSummaries(tables: ParsedMarkdownTable[]): PatternFieldSummary[] {
  const patternMap = new Map<string, PatternFieldSummary>();
  const oneToManyFields = new Set<string>(extractMarkdownOneToManyFields(tables));

  for (const table of tables) {
    if (!table.columns.includes('XML Field') || !table.columns.includes('SF API Name') || !table.columns.includes('SF Object')) {
      continue;
    }

    for (const row of table.rows) {
      const xmlField = normalizeWhitespace(row['XML Field'] ?? '');
      if (!xmlField) continue;

      const notes = normalizeWhitespace(
        row['Notes']
          ?? row['Why Non-Obvious']
          ?? row['Routing Logic']
          ?? row['Integration Impact']
          ?? '',
      );
      const sfApiNames = splitCandidateValues(row['SF API Name'] ?? '');
      const sfObjects = splitCandidateValues(row['SF Object'] ?? '');
      const normalizedField = normalizeSchemaIntelligenceField(xmlField);
      const isFormulaTarget =
        notes.toLowerCase().includes('formula field')
        || sfApiNames.some((candidate) => FORMULA_FIELD_TARGETS.has(normalizeSchemaIntelligenceField(candidate)));
      const isPersonAccountOnly = sfApiNames.some((candidate) => candidate.endsWith(PERSON_ACCOUNT_FIELD_SUFFIX));
      const isOneToMany = oneToManyFields.has(normalizedField)
        || sfApiNames.length > 1
        || sfObjects.length > 1
        || notes.toLowerCase().includes('also')
        || notes.toLowerCase().includes('route by')
        || notes.toLowerCase().includes('targets');

      upsertPatternSummary(patternMap, {
        xmlField,
        sfApiNames,
        sfObjects,
        confidence: inferConfidence(table.headingPath, notes),
        notes,
        isOneToMany,
        isFormulaTarget,
        isPersonAccountOnly,
      });
    }
  }

  return Array.from(patternMap.values()).sort((left, right) => left.normalizedField.localeCompare(right.normalizedField));
}

export function buildCurrentPatternFieldSummaries(
  patterns: Record<string, ConfirmedPattern[]> = CONFIRMED_PATTERNS,
): PatternFieldSummary[] {
  const patternMap = new Map<string, PatternFieldSummary>();

  for (const entries of Object.values(patterns)) {
    for (const entry of entries) {
      upsertPatternSummary(patternMap, {
        xmlField: entry.xmlField,
        sfApiNames: entry.sfApiNames,
        sfObjects: [entry.sfObject],
        confidence: entry.confidence,
        notes: entry.notes,
        isOneToMany: entry.isOneToMany,
        isFormulaTarget: entry.isFormulaTarget,
        isPersonAccountOnly: entry.isPersonAccountOnly,
      });
    }
  }

  return Array.from(patternMap.values()).sort((left, right) => left.normalizedField.localeCompare(right.normalizedField));
}

export function extractMarkdownOneToManyFields(tables: ParsedMarkdownTable[]): string[] {
  const values = new Set<string>();

  for (const table of tables) {
    if (!table.columns.includes('XML Field') || !table.columns.includes('# SF Targets')) {
      continue;
    }

    for (const row of table.rows) {
      const xmlField = normalizeWhitespace(row['XML Field'] ?? '');
      if (xmlField) {
        values.add(normalizeSchemaIntelligenceField(xmlField));
      }
    }
  }

  return Array.from(values).sort();
}

function findSuffixFromTables(tables: ParsedMarkdownTable[], suffix: string): string | null {
  for (const table of tables) {
    if (!table.columns.includes('Suffix')) continue;
    for (const row of table.rows) {
      if (normalizeWhitespace(row['Suffix'] ?? '') === suffix) {
        return suffix;
      }
    }
  }
  return null;
}

function findFscPrefixFromTables(tables: ParsedMarkdownTable[]): string | null {
  for (const table of tables) {
    if (!table.columns.includes('Suffix')) continue;
    for (const row of table.rows) {
      const suffix = normalizeWhitespace(row['Suffix'] ?? '');
      if (suffix.startsWith('FinServ__')) {
        return 'FinServ__';
      }
    }
  }
  return null;
}

function extractGlossaryTokens(markdown: string): string[] {
  const lowered = markdown.toLowerCase();
  return Array.from(CARIBBEAN_DOMAIN_TOKENS.keys())
    .filter((token) => lowered.includes(token.toLowerCase()))
    .sort();
}

function comparablePatternSummary(summary: PatternFieldSummary): string {
  return JSON.stringify({
    normalizedField: summary.normalizedField,
    sfApiNames: summary.sfApiNames,
    sfObjects: summary.sfObjects,
    confidence: summary.confidence,
    isOneToMany: summary.isOneToMany,
    isFormulaTarget: summary.isFormulaTarget,
    isPersonAccountOnly: summary.isPersonAccountOnly,
  });
}

export function diffPatternFieldSummaries(markdown: PatternFieldSummary[], current: PatternFieldSummary[]) {
  const markdownMap = new Map(markdown.map((entry) => [entry.normalizedField, entry]));
  const currentMap = new Map(current.map((entry) => [entry.normalizedField, entry]));

  const added = markdown
    .filter((entry) => !currentMap.has(entry.normalizedField))
    .sort((left, right) => left.normalizedField.localeCompare(right.normalizedField));
  const removed = current
    .filter((entry) => !markdownMap.has(entry.normalizedField))
    .sort((left, right) => left.normalizedField.localeCompare(right.normalizedField));
  const changed = markdown
    .filter((entry) => {
      const existing = currentMap.get(entry.normalizedField);
      return existing && comparablePatternSummary(entry) !== comparablePatternSummary(existing);
    })
    .map((entry) => ({
      normalizedField: entry.normalizedField,
      markdown: entry,
      current: currentMap.get(entry.normalizedField)!,
    }))
    .sort((left, right) => left.normalizedField.localeCompare(right.normalizedField));

  return { added, removed, changed };
}

export async function loadSchemaIntelligenceMarkdown(
  directory: string = DEFAULT_SCHEMA_INTELLIGENCE_DIR,
): Promise<Record<string, string>> {
  const fileNames = ['mapping-patterns.md', 'fsc-data-model.md', 'domain-glossary.md'];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => [fileName, await readFile(path.join(directory, fileName), 'utf8')] as const),
  );

  return Object.fromEntries(entries);
}

export async function buildSchemaIntelligenceSyncReport(
  directory: string = DEFAULT_SCHEMA_INTELLIGENCE_DIR,
): Promise<SchemaIntelligenceSyncReport> {
  const markdownFiles = await loadSchemaIntelligenceMarkdown(directory);
  const parsedTables = Object.entries(markdownFiles)
    .flatMap(([file, content]) => parseMarkdownTables(content, file));
  const parsedTablesByFile = Object.fromEntries(
    Object.entries(markdownFiles).map(([file, content]) => [file, parseMarkdownTables(content, file)]),
  );

  const markdownPatternFields = buildMarkdownPatternFieldSummaries(parsedTablesByFile['mapping-patterns.md'] ?? []);
  const currentPatternFields = buildCurrentPatternFieldSummaries();
  const patternDiff = diffPatternFieldSummaries(markdownPatternFields, currentPatternFields);

  const markdownOneToMany = extractMarkdownOneToManyFields(parsedTablesByFile['mapping-patterns.md'] ?? []);
  const currentOneToMany = Array.from(ONE_TO_MANY_FIELDS).sort();
  const markdownOneToManySet = new Set(markdownOneToMany);
  const currentOneToManySet = new Set(currentOneToMany);

  const addedOneToMany = markdownOneToMany.filter((field) => !currentOneToManySet.has(field));
  const removedOneToMany = currentOneToMany.filter((field) => !markdownOneToManySet.has(field));

  const glossaryTokensPresent = extractGlossaryTokens(markdownFiles['domain-glossary.md'] ?? '');
  const currentGlossaryTokens = Array.from(CARIBBEAN_DOMAIN_TOKENS.keys()).sort();

  return {
    generatedAt: new Date().toISOString(),
    sourceFiles: Object.keys(markdownFiles),
    parsedTables,
    parsedTablesByFile,
    summary: {
      markdownPatternFields: markdownPatternFields.length,
      currentPatternFields: currentPatternFields.length,
      addedPatternFields: patternDiff.added.length,
      removedPatternFields: patternDiff.removed.length,
      changedPatternFields: patternDiff.changed.length,
      markdownOneToManyCount: markdownOneToMany.length,
      currentOneToManyCount: currentOneToMany.length,
      addedOneToManyFields: addedOneToMany.length,
      removedOneToManyFields: removedOneToMany.length,
    },
    diff: {
      patterns: patternDiff,
      oneToManyFields: {
        added: addedOneToMany,
        removed: removedOneToMany,
      },
      constants: {
        personAccountFieldSuffix: {
          markdown: findSuffixFromTables(parsedTablesByFile['fsc-data-model.md'] ?? [], PERSON_ACCOUNT_FIELD_SUFFIX),
          current: PERSON_ACCOUNT_FIELD_SUFFIX,
          matches: findSuffixFromTables(parsedTablesByFile['fsc-data-model.md'] ?? [], PERSON_ACCOUNT_FIELD_SUFFIX) === PERSON_ACCOUNT_FIELD_SUFFIX,
        },
        fscNamespacePrefix: {
          markdown: findFscPrefixFromTables(parsedTablesByFile['fsc-data-model.md'] ?? []),
          current: FSC_NAMESPACE_PREFIX,
          matches: findFscPrefixFromTables(parsedTablesByFile['fsc-data-model.md'] ?? []) === FSC_NAMESPACE_PREFIX,
        },
        glossaryTokensPresentInMarkdown: {
          markdown: glossaryTokensPresent,
          current: currentGlossaryTokens,
          matches: JSON.stringify(glossaryTokensPresent) === JSON.stringify(currentGlossaryTokens),
        },
      },
    },
  };
}
