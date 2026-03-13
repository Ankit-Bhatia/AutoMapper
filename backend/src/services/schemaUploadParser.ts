import { XMLParser } from 'fast-xml-parser';
import { v4 as uuidv4 } from 'uuid';
import type { DataType, Entity, Field, Relationship } from '../types.js';
import { parseSapSchema } from './sapParser.js';

interface ParsedSchema {
  entities: Entity[];
  fields: Field[];
  relationships: Relationship[];
}

type JsonRecord = Record<string, unknown>;

const SUPPORTED_EXTENSIONS = ['.csv', '.json', '.xml'] as const;

export function parseUploadedSchema(content: string, filename: string, systemId: string): ParsedSchema {
  const ext = extensionOf(filename);
  if (!SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
    throw new Error('Unsupported schema file. Allowed: .xml, .json, .csv');
  }

  if (ext === '.json') return parseUploadedJson(content, filename, systemId);
  if (ext === '.csv') return parseUploadedCsv(content, filename, systemId);
  return parseUploadedXml(content, filename, systemId);
}

function parseUploadedJson(content: string, filename: string, systemId: string): ParsedSchema {
  const parsed = JSON.parse(content) as unknown;

  // First try explicit schema shape (entities/fields/relationships).
  const explicit = tryParseWithSap(content, filename, systemId);
  if (explicit) return explicit;

  if (Array.isArray(parsed)) {
    return inferSchemaFromRecords(entityNameFromFilename(filename), parsed, systemId);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON must be either an array of objects or a schema object');
  }

  const root = parsed as JsonRecord;
  const entityEntries = Object.entries(root).filter(([, value]) => Array.isArray(value));
  if (entityEntries.length > 0) {
    return inferSchemaFromNamedCollections(entityEntries, systemId);
  }

  return inferSchemaFromRecords(entityNameFromFilename(filename), [root], systemId);
}

function parseUploadedCsv(content: string, filename: string, systemId: string): ParsedSchema {
  const explicit = tryParseWithSap(content, filename, systemId);
  if (explicit) return explicit;

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one data row');
  }

  const headers = splitCsvLine(lines[0]);
  const records: JsonRecord[] = lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const rec: JsonRecord = {};
    for (let i = 0; i < headers.length; i += 1) {
      rec[sanitizeName(headers[i] || `Field${i + 1}`)] = cols[i] ?? '';
    }
    return rec;
  });

  return inferSchemaFromRecords(entityNameFromFilename(filename), records, systemId);
}

function parseUploadedXml(content: string, filename: string, systemId: string): ParsedSchema {
  const explicit = tryParseWithSap(content, filename, systemId);
  if (explicit) return explicit;

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const xml = parser.parse(content) as unknown;
  if (!xml || typeof xml !== 'object') {
    throw new Error('Failed to parse XML payload');
  }

  const root = xml as JsonRecord;
  const collections = findArrayCollections(root);
  if (collections.length > 0) {
    return inferSchemaFromNamedCollections(collections, systemId);
  }

  const entry = pickPrimaryXmlRootEntry(root);
  if (!entry || typeof entry[1] !== 'object' || entry[1] == null) {
    throw new Error('XML does not contain inferable object nodes');
  }

  const rootName = sanitizeName(entry[0]);
  try {
    return inferSchemaFromXmlHierarchy(rootName, entry[1], systemId);
  } catch {
    return inferSchemaFromRecords(rootName, [entry[1] as JsonRecord], systemId);
  }
}

function pickPrimaryXmlRootEntry(root: JsonRecord): [string, unknown] | undefined {
  const entries = Object.entries(root);
  const primary = entries.find(([key]) => !key.startsWith('?') && !key.startsWith('#'));
  return primary ?? entries[0];
}

function tryParseWithSap(content: string, filename: string, systemId: string): ParsedSchema | null {
  try {
    const parsed = parseSapSchema(content, filename, systemId);
    return parsed.entities.length > 0 && parsed.fields.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function inferSchemaFromNamedCollections(
  collections: Array<[string, unknown]>,
  systemId: string,
): ParsedSchema {
  const entities: Entity[] = [];
  const fields: Field[] = [];

  for (const [name, value] of collections) {
    const records = (value as unknown[]).filter((item): item is JsonRecord => Boolean(item && typeof item === 'object'));
    if (records.length === 0) continue;
    const entity = createEntity(sanitizeName(name), systemId);
    entities.push(entity);
    fields.push(
      ...inferFieldsForEntity(records, entity.id, {
        preferLosNameInference: shouldPreferLosNameInference(records),
      }),
    );
  }

  if (entities.length === 0 || fields.length === 0) {
    throw new Error('Unable to infer entities/fields from uploaded schema');
  }

  return { entities, fields, relationships: [] };
}

function inferSchemaFromRecords(entityName: string, records: unknown[], systemId: string): ParsedSchema {
  const objectRecords = records.filter((item): item is JsonRecord => Boolean(item && typeof item === 'object'));
  if (objectRecords.length === 0) {
    throw new Error('Uploaded file does not contain object records to infer schema');
  }

  const entity = createEntity(entityName, systemId);
  const fields = inferFieldsForEntity(objectRecords, entity.id, {
    preferLosNameInference: shouldPreferLosNameInference(objectRecords),
  });
  return { entities: [entity], fields, relationships: [] };
}

function inferFieldsForEntity(
  records: JsonRecord[],
  entityId: string,
  options: { preferLosNameInference?: boolean } = {},
): Field[] {
  const valueByField = new Map<string, unknown[]>();

  for (const record of records) {
    for (const [rawKey, rawValue] of Object.entries(record)) {
      const fieldName = sanitizeName(rawKey);
      if (!fieldName) continue;
      const bucket = valueByField.get(fieldName) ?? [];
      if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
        bucket.push(rawValue);
      }
      valueByField.set(fieldName, bucket);
    }
  }

  if (valueByField.size === 0) {
    throw new Error('No field columns found in uploaded records');
  }

  const inferred: Field[] = [];
  for (const [name, values] of valueByField.entries()) {
    const inferredByValues = inferDataType(values);
    const inferredByLosName = inferDataTypeFromLosName(name);
    const shouldUseLosType =
      options.preferLosNameInference &&
      Boolean(inferredByLosName) &&
      (values.length === 0 || inferredByValues === 'string' || inferredByValues === 'unknown');

    inferred.push({
      id: uuidv4(),
      entityId,
      name,
      label: name,
      dataType: shouldUseLosType ? (inferredByLosName as DataType) : inferredByValues,
      required: values.length === records.length,
      isKey: name.toLowerCase() === 'id' || name.toLowerCase().endsWith('id'),
    });
  }

  return inferred.sort((a, b) => a.name.localeCompare(b.name));
}

function inferDataType(values: unknown[]): DataType {
  if (values.length === 0) return 'string';
  const normalized = values.map((v) => String(v).trim()).filter(Boolean);
  if (normalized.length === 0) return 'string';

  const hasAt = normalized.some((v) => v.includes('@'));
  const hasPhone = normalized.some((v) => /[\d()\-\s]{7,}/.test(v));
  if (hasAt) return 'email';
  if (hasPhone) return 'phone';

  const boolSet = new Set(normalized.map((v) => v.toLowerCase()));
  if ([...boolSet].every((v) => ['true', 'false', 'yes', 'no', '0', '1'].includes(v))) return 'boolean';

  if (normalized.every((v) => /^-?\d+$/.test(v))) return 'integer';
  if (normalized.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return 'decimal';
  if (normalized.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
  if (normalized.every((v) => !Number.isNaN(Date.parse(v)))) return 'datetime';

  const unique = new Set(normalized);
  if (unique.size > 0 && unique.size <= 8 && normalized.length >= 8) return 'picklist';
  return 'string';
}

function inferDataTypeFromLosName(fieldName: string): DataType | null {
  const upper = fieldName.trim().toUpperCase();
  if (!upper) return null;

  if (/^(AMT|PERC|PCT)_/.test(upper)) return 'decimal';
  if (/^NBR_/.test(upper)) return 'integer';
  if (/^(DT|DATE)_/.test(upper)) return 'date';
  if (/^(IND|YN|Y)_/.test(upper)) return 'boolean';
  if (/^(CD|TYP|CODE)_/.test(upper)) return 'picklist';
  if (/^EMAIL_/.test(upper)) return 'email';
  if (/^PHONE_/.test(upper)) return 'phone';
  if (/^(NAME|ADDR|DESC)_/.test(upper) || /^SSN$/.test(upper)) return 'string';
  return null;
}

function shouldPreferLosNameInference(records: JsonRecord[]): boolean {
  if (!records.length) return false;
  const keys = new Set<string>();
  for (const record of records) {
    for (const rawKey of Object.keys(record)) {
      if (rawKey && rawKey.trim()) keys.add(rawKey.trim());
    }
  }
  if (!keys.size) return false;

  const losPrefixMatch = [...keys].filter((key) => /^(AMT|NBR|DT|DATE|TYP|IND|CD|PCT|PERC|YN|NAME|ADDR|PHONE|EMAIL)_/i.test(key)).length;
  return losPrefixMatch / keys.size >= 0.2;
}

function createEntity(name: string, systemId: string): Entity {
  return {
    id: uuidv4(),
    systemId,
    name,
    label: name,
  };
}

function entityNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const normalized = sanitizeName(base);
  return normalized || 'UploadedEntity';
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx).toLowerCase();
}

function sanitizeName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const clean = trimmed.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
  return clean || 'Field';
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function findArrayCollections(root: JsonRecord): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];

  function walk(node: unknown, keyHint = 'Entity'): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((item) => Boolean(item && typeof item === 'object'))) {
        out.push([keyHint, node]);
      }
      for (const child of node) walk(child, keyHint);
      return;
    }

    const rec = node as JsonRecord;
    for (const [k, v] of Object.entries(rec)) {
      if (Array.isArray(v)) {
        if (v.length > 0 && v.every((item) => Boolean(item && typeof item === 'object'))) {
          out.push([k, v]);
        }
      }
      walk(v, k);
    }
  }

  walk(root);

  const dedup = new Set<string>();
  return out.filter(([name]) => {
    const key = name.toLowerCase();
    if (dedup.has(key)) return false;
    dedup.add(key);
    return true;
  });
}

interface XmlEntityCandidate {
  name: string;
  path: string;
  parentPath?: string;
  records: JsonRecord[];
}

function inferSchemaFromXmlHierarchy(rootName: string, rootNode: unknown, systemId: string): ParsedSchema {
  const normalizedRoot = rootName || 'UploadedEntity';
  const candidates: XmlEntityCandidate[] = [];
  collectXmlEntityCandidates(normalizedRoot, rootNode, 0, 2, normalizedRoot, undefined, candidates);

  const entities: Entity[] = [];
  const fields: Field[] = [];
  const relationships: Relationship[] = [];
  const entityIdByPath = new Map<string, string>();

  for (const candidate of candidates) {
    const entity = createEntity(candidate.name, systemId);
    let inferredFields: Field[];
    try {
      inferredFields = inferFieldsForEntity(candidate.records, entity.id, { preferLosNameInference: true });
    } catch {
      continue;
    }

    if (inferredFields.length === 0) continue;
    entities.push(entity);
    fields.push(...inferredFields);
    entityIdByPath.set(candidate.path, entity.id);
  }

  for (const candidate of candidates) {
    if (!candidate.parentPath) continue;
    const fromEntityId = entityIdByPath.get(candidate.parentPath);
    const toEntityId = entityIdByPath.get(candidate.path);
    if (!fromEntityId || !toEntityId) continue;
    relationships.push({
      fromEntityId,
      toEntityId,
      type: 'parentchild',
    });
  }

  if (entities.length === 0 || fields.length === 0) {
    throw new Error('Unable to infer entities/fields from XML hierarchy');
  }

  return { entities, fields, relationships };
}

function collectXmlEntityCandidates(
  name: string,
  node: unknown,
  depth: number,
  maxDepth: number,
  path: string,
  parentPath: string | undefined,
  out: XmlEntityCandidate[],
): void {
  const records = toObjectRecords(node);
  if (records.length === 0) return;

  const scalarRecords: JsonRecord[] = [];
  const childBuckets = new Map<string, JsonRecord[]>();

  for (const record of records) {
    const scalarRecord: JsonRecord = {};

    for (const [rawKey, rawValue] of Object.entries(record)) {
      const key = sanitizeName(rawKey);
      if (!key) continue;

      if (depth < maxDepth) {
        const childRecords = toObjectRecords(rawValue).filter(hasStructuralKeys);
        if (childRecords.length > 0) {
          const bucket = childBuckets.get(key) ?? [];
          bucket.push(...childRecords);
          childBuckets.set(key, bucket);
          continue;
        }
      }

      if (Array.isArray(rawValue)) {
        const scalarValues = rawValue.filter((item) => !isJsonRecord(item));
        if (scalarValues.length > 0) {
          scalarRecord[key] = scalarValues[0];
        } else if (rawValue.length === 0) {
          scalarRecord[key] = '';
        }
        continue;
      }

      scalarRecord[key] = rawValue;
    }

    scalarRecords.push(scalarRecord);
  }

  out.push({
    name: sanitizeName(name) || 'Entity',
    path,
    parentPath,
    records: scalarRecords,
  });

  if (depth >= maxDepth) return;

  for (const [childName, childRecords] of childBuckets.entries()) {
    const childPath = `${path}.${childName}`;
    collectXmlEntityCandidates(childName, childRecords, depth + 1, maxDepth, childPath, path, out);
  }
}

function toObjectRecords(node: unknown): JsonRecord[] {
  if (Array.isArray(node)) return node.filter(isJsonRecord);
  if (isJsonRecord(node)) return [node];
  return [];
}

function isJsonRecord(node: unknown): node is JsonRecord {
  return Boolean(node && typeof node === 'object' && !Array.isArray(node));
}

function hasStructuralKeys(record: JsonRecord): boolean {
  return Object.keys(record).some((k) => k !== '#text');
}
