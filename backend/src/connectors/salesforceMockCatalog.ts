import fs from 'node:fs';
import path from 'node:path';
import type { Field } from '../types.js';
import type { ConnectorField } from './IConnector.js';
import { normalizeSalesforceType } from '../utils/typeUtils.js';

interface CrawledField {
  name: string;
  type?: string;
  properties?: string[];
}

interface CrawledObject {
  name: string;
  fields: CrawledField[];
}

interface CrawledCatalog {
  objects: CrawledObject[];
}

let cachedCatalog: Map<string, Array<Omit<Field, 'id' | 'entityId'>>> | null = null;

function resolveCatalogPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'data/salesforce-object-reference.json'),
    path.resolve(process.cwd(), 'backend/data/salesforce-object-reference.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function loadCatalogFile(): CrawledCatalog | null {
  const filePath = resolveCatalogPath();
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CrawledCatalog;
    if (!Array.isArray(parsed.objects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function toTemplateField(field: CrawledField): Omit<Field, 'id' | 'entityId'> {
  const properties = new Set((field.properties ?? []).map((p) => p.toLowerCase()));
  const rawType = field.type ?? 'string';

  return {
    name: field.name,
    dataType: normalizeSalesforceType(rawType.toLowerCase()),
    required: !properties.has('nillable'),
    isExternalId: properties.has('external id'),
    isKey: field.name === 'Id',
  };
}

function getCatalog(): Map<string, Array<Omit<Field, 'id' | 'entityId'>>> {
  if (cachedCatalog) return cachedCatalog;

  const loaded = loadCatalogFile();
  const map = new Map<string, Array<Omit<Field, 'id' | 'entityId'>>>();
  if (loaded) {
    for (const obj of loaded.objects) {
      map.set(obj.name, obj.fields.map(toTemplateField));
    }
  }
  cachedCatalog = map;
  return map;
}

export function getSalesforceMockObjectTemplates(
  objectNames: string[],
): Record<string, Array<Omit<Field, 'id' | 'entityId'>>> {
  const catalog = getCatalog();
  const templates: Record<string, Array<Omit<Field, 'id' | 'entityId'>>> = {};
  for (const name of objectNames) {
    const fields = catalog.get(name);
    if (fields?.length) {
      templates[name] = fields;
    }
  }
  return templates;
}

export function getSalesforceMockObjectTemplatesForConnector(
  objectNames: string[],
): Record<string, Array<Omit<ConnectorField, 'id' | 'entityId'>>> {
  const base = getSalesforceMockObjectTemplates(objectNames);
  return Object.fromEntries(
    Object.entries(base).map(([name, fields]) => [name, fields as Array<Omit<ConnectorField, 'id' | 'entityId'>>]),
  );
}

export function listSalesforceMockObjectNames(): string[] {
  return Array.from(getCatalog().keys()).sort((a, b) => a.localeCompare(b));
}
