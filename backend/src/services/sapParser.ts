import { XMLParser } from 'fast-xml-parser';
import { v4 as uuidv4 } from 'uuid';
import type { Entity, Field, Relationship } from '../types.js';
import { normalizeODataType } from '../utils/typeUtils.js';

interface ParsedSchema {
  entities: Entity[];
  fields: Field[];
  relationships: Relationship[];
}

interface JsonSchemaInput {
  entities: Array<{
    name: string;
    label?: string;
    description?: string;
    fields: Array<{
      name: string;
      label?: string;
      dataType: string;
      length?: number;
      precision?: number;
      scale?: number;
      required?: boolean;
      isKey?: boolean;
      picklistValues?: string[];
    }>;
  }>;
  relationships?: Array<{
    fromEntity: string;
    toEntity: string;
    type: 'lookup' | 'masterdetail' | 'parentchild';
    viaField?: string;
  }>;
}

export function parseSapSchema(content: string, filename: string, systemId: string): ParsedSchema {
  const lowered = filename.toLowerCase();
  if (lowered.endsWith('.xml')) {
    return parseODataMetadata(content, systemId);
  }
  if (lowered.endsWith('.json')) {
    return parseJsonSchema(JSON.parse(content) as JsonSchemaInput, systemId);
  }
  if (lowered.endsWith('.csv')) {
    return parseCsvSchema(content, systemId);
  }
  throw new Error('Unsupported SAP schema file. Allowed: .xml, .json, .csv');
}

function parseJsonSchema(schema: JsonSchemaInput, systemId: string): ParsedSchema {
  const entities: Entity[] = [];
  const fields: Field[] = [];
  const relationships: Relationship[] = [];
  const byName = new Map<string, string>();

  for (const ent of schema.entities) {
    const entityId = uuidv4();
    byName.set(ent.name, entityId);
    entities.push({
      id: entityId,
      systemId,
      name: ent.name,
      label: ent.label,
      description: ent.description,
    });

    for (const fld of ent.fields) {
      fields.push({
        id: uuidv4(),
        entityId,
        name: fld.name,
        label: fld.label,
        dataType: (fld.dataType as any) ?? 'unknown',
        length: fld.length,
        precision: fld.precision,
        scale: fld.scale,
        required: fld.required,
        isKey: fld.isKey,
        picklistValues: fld.picklistValues,
      });
    }
  }

  for (const rel of schema.relationships ?? []) {
    const fromEntityId = byName.get(rel.fromEntity);
    const toEntityId = byName.get(rel.toEntity);
    if (fromEntityId && toEntityId) {
      relationships.push({
        fromEntityId,
        toEntityId,
        type: rel.type,
        viaField: rel.viaField,
      });
    }
  }

  return { entities, fields, relationships };
}

function parseODataMetadata(xml: string, systemId: string): ParsedSchema {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const doc = parser.parse(xml);
  const entities: Entity[] = [];
  const fields: Field[] = [];
  const relationships: Relationship[] = [];

  const schemas = arrayify(doc['edmx:Edmx']?.['edmx:DataServices']?.Schema ?? doc?.Edmx?.DataServices?.Schema);

  for (const schema of schemas) {
    const entityTypes = arrayify(schema.EntityType);
    const entityIdByName = new Map<string, string>();

    for (const entityType of entityTypes) {
      const entityId = uuidv4();
      const entityName = entityType.Name;
      entityIdByName.set(entityName, entityId);
      entities.push({ id: entityId, systemId, name: entityName, label: entityName });

      const keyRefs = new Set(
        arrayify(entityType.Key?.PropertyRef).map((p: Record<string, string>) => p.Name),
      );
      for (const prop of arrayify(entityType.Property)) {
        fields.push({
          id: uuidv4(),
          entityId,
          name: prop.Name,
          label: prop.Name,
          dataType: normalizeODataType(prop.Type),
          length: parseOptionalNumber(prop.MaxLength),
          precision: parseOptionalNumber(prop.Precision),
          scale: parseOptionalNumber(prop.Scale),
          required: prop.Nullable === 'false',
          isKey: keyRefs.has(prop.Name),
        });
      }
    }

    for (const entityType of entityTypes) {
      const fromEntityId = entityIdByName.get(entityType.Name);
      if (!fromEntityId) continue;
      for (const nav of arrayify(entityType.NavigationProperty)) {
        const relationship = nav.Relationship ?? '';
        const targetName = relationship.split('.').pop();
        if (!targetName) continue;
        const toEntityId = entityIdByName.get(targetName);
        if (!toEntityId) continue;
        relationships.push({
          fromEntityId,
          toEntityId,
          type: 'lookup',
          viaField: nav.Name,
        });
      }
    }
  }

  return { entities, fields, relationships };
}

function parseCsvSchema(content: string, systemId: string): ParsedSchema {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const header = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  const idx = (name: string) => header.indexOf(name);
  const entityMap = new Map<string, string>();
  const entities: Entity[] = [];
  const fields: Field[] = [];

  for (const line of lines.slice(1)) {
    const cols = line.split(',').map((c) => c.trim());
    const entityName = cols[idx('entity')];
    if (!entityName) continue;
    if (!entityMap.has(entityName)) {
      const id = uuidv4();
      entityMap.set(entityName, id);
      entities.push({ id, systemId, name: entityName, label: entityName });
    }
    fields.push({
      id: uuidv4(),
      entityId: entityMap.get(entityName)!,
      name: cols[idx('field')] ?? 'UnknownField',
      label: cols[idx('label')] || undefined,
      dataType: ((cols[idx('datatype')] as any) || 'unknown'),
      required: (cols[idx('required')] || '').toLowerCase() === 'true',
      isKey: (cols[idx('iskey')] || '').toLowerCase() === 'true',
    });
  }

  return { entities, fields, relationships: [] };
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
