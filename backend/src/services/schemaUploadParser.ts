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

  const entry = Object.entries(root)[0];
  if (!entry || typeof entry[1] !== 'object' || entry[1] == null) {
    throw new Error('XML does not contain inferable object nodes');
  }

  return inferSchemaFromRecords(sanitizeName(entry[0]), [entry[1] as JsonRecord], systemId);
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
    fields.push(...inferFieldsForEntity(records, entity.id));
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
  const fields = inferFieldsForEntity(objectRecords, entity.id);
  return { entities: [entity], fields, relationships: [] };
}

function inferFieldsForEntity(records: JsonRecord[], entityId: string): Field[] {
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
    inferred.push({
      id: uuidv4(),
      entityId,
      name,
      label: name,
      dataType: inferDataType(values),
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

