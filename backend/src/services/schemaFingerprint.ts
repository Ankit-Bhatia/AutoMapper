import { createHash } from 'node:crypto';
import type {
  DriftItem,
  Entity,
  Field,
  MappingProject,
  SchemaDriftEvent,
  SchemaFingerprint,
  StoredExportVersionRecord,
} from '../types.js';

function normalizeFieldSnapshot(field: Partial<Field> & Pick<Field, 'id' | 'entityId' | 'name' | 'dataType'>): Field {
  return {
    id: field.id,
    entityId: field.entityId,
    name: field.name,
    label: field.label,
    description: field.description,
    dataType: field.dataType,
    length: field.length,
    precision: field.precision,
    scale: field.scale,
    required: field.required,
    isKey: field.isKey,
    isExternalId: field.isExternalId,
    isFormula: field.isFormula,
    isSystemField: field.isSystemField,
    isAutoNumber: field.isAutoNumber,
    referenceTo: field.referenceTo ? [...field.referenceTo] : undefined,
    picklistValues: field.picklistValues ? [...field.picklistValues] : undefined,
    jxchangeXPath: field.jxchangeXPath,
    jxchangeXtendElemKey: field.jxchangeXtendElemKey,
    iso20022Name: field.iso20022Name,
    complianceTags: field.complianceTags ? [...field.complianceTags] : undefined,
    complianceNote: field.complianceNote,
    validationRules: field.validationRules ? structuredClone(field.validationRules) : undefined,
  };
}

function getScopedEntityIds(project: MappingProject, entities: Entity[]): { source: Set<string>; target: Set<string> } {
  return {
    source: new Set(entities.filter((entity) => entity.systemId === project.sourceSystemId).map((entity) => entity.id)),
    target: new Set(entities.filter((entity) => entity.systemId === project.targetSystemId).map((entity) => entity.id)),
  };
}

function getSnapshotFields(fields: readonly Field[], entityIds: Set<string>): Field[] {
  return fields
    .filter((field) => entityIds.has(field.entityId))
    .map((field) => normalizeFieldSnapshot(field))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function sortDriftItems(items: DriftItem[]): DriftItem[] {
  return [...items].sort((left, right) => {
    const byScope = left.scope.localeCompare(right.scope);
    if (byScope !== 0) return byScope;
    const byEntity = left.entityName.localeCompare(right.entityName);
    if (byEntity !== 0) return byEntity;
    return left.fieldName.localeCompare(right.fieldName);
  });
}

function resolveEntityName(field: Field, entitiesById: Map<string, Entity>): string {
  return entitiesById.get(field.entityId)?.name ?? field.entityId;
}

export function computeSchemaFingerprint(fields: Field[], entityIds: Set<string>): string {
  const sorted = fields
    .filter((field) => entityIds.has(field.entityId))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((field) => `${field.id}:${field.dataType}:${field.required ?? false}`);
  return createHash('sha256').update(sorted.join('|')).digest('hex');
}

export function buildFieldsSnapshot(
  project: MappingProject,
  entities: Entity[],
  fields: Field[],
): StoredExportVersionRecord['fieldsSnapshot'] {
  const scopedEntityIds = getScopedEntityIds(project, entities);
  return {
    source: getSnapshotFields(fields, scopedEntityIds.source),
    target: getSnapshotFields(fields, scopedEntityIds.target),
  };
}

export function buildSchemaFingerprint(
  project: MappingProject,
  entities: Entity[],
  fields: Field[],
  computedAt = new Date().toISOString(),
): SchemaFingerprint {
  const scopedEntityIds = getScopedEntityIds(project, entities);
  const sourceFields = fields.filter((field) => scopedEntityIds.source.has(field.entityId));
  const targetFields = fields.filter((field) => scopedEntityIds.target.has(field.entityId));
  return {
    sourceHash: computeSchemaFingerprint(fields, scopedEntityIds.source),
    targetHash: computeSchemaFingerprint(fields, scopedEntityIds.target),
    computedAt,
    fieldCount: {
      source: sourceFields.length,
      target: targetFields.length,
    },
  };
}

function classifyScopeDrift(
  scope: 'source' | 'target',
  previousFields: Field[],
  currentFields: Field[],
  entitiesById: Map<string, Entity>,
): Pick<SchemaDriftEvent, 'blockers' | 'warnings' | 'additions'> {
  const previousById = new Map(previousFields.map((field) => [field.id, field]));
  const currentById = new Map(currentFields.map((field) => [field.id, field]));
  const blockers: DriftItem[] = [];
  const warnings: DriftItem[] = [];
  const additions: DriftItem[] = [];

  for (const currentField of currentFields) {
    const previous = previousById.get(currentField.id);
    if (!previous) {
      additions.push({
        scope,
        fieldId: currentField.id,
        fieldName: currentField.name,
        entityId: currentField.entityId,
        entityName: resolveEntityName(currentField, entitiesById),
        changeType: 'added',
        currentType: currentField.dataType,
        required: currentField.required ?? false,
      });
      continue;
    }

    if (previous.dataType !== currentField.dataType) {
      const item: DriftItem = {
        scope,
        fieldId: currentField.id,
        fieldName: currentField.name,
        entityId: currentField.entityId,
        entityName: resolveEntityName(currentField, entitiesById),
        changeType: 'type_changed',
        previousType: previous.dataType,
        currentType: currentField.dataType,
        required: Boolean(previous.required || currentField.required),
      };
      if (item.required) {
        blockers.push(item);
      } else {
        warnings.push(item);
      }
    }
  }

  for (const previousField of previousFields) {
    if (currentById.has(previousField.id)) continue;
    const item: DriftItem = {
      scope,
      fieldId: previousField.id,
      fieldName: previousField.name,
      entityId: previousField.entityId,
      entityName: resolveEntityName(previousField, entitiesById),
      changeType: 'removed',
      previousType: previousField.dataType,
      required: previousField.required ?? false,
    };
    if (item.required) {
      blockers.push(item);
    } else {
      warnings.push(item);
    }
  }

  return {
    blockers: sortDriftItems(blockers),
    warnings: sortDriftItems(warnings),
    additions: sortDriftItems(additions),
  };
}

export function detectSchemaDrift(
  latestVersion: StoredExportVersionRecord | undefined,
  currentFingerprint: SchemaFingerprint,
  currentSnapshot: StoredExportVersionRecord['fieldsSnapshot'],
  entities: Entity[],
): SchemaDriftEvent | null {
  if (!latestVersion) return null;

  const sourceChanged = latestVersion.schemaFingerprint.sourceHash !== currentFingerprint.sourceHash;
  const targetChanged = latestVersion.schemaFingerprint.targetHash !== currentFingerprint.targetHash;
  if (!sourceChanged && !targetChanged) return null;

  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const sourceDiff = sourceChanged
    ? classifyScopeDrift('source', latestVersion.fieldsSnapshot.source, currentSnapshot.source, entitiesById)
    : { blockers: [], warnings: [], additions: [] };
  const targetDiff = targetChanged
    ? classifyScopeDrift('target', latestVersion.fieldsSnapshot.target, currentSnapshot.target, entitiesById)
    : { blockers: [], warnings: [], additions: [] };

  return {
    sourceChanged,
    targetChanged,
    blockers: sortDriftItems([...sourceDiff.blockers, ...targetDiff.blockers]),
    warnings: sortDriftItems([...sourceDiff.warnings, ...targetDiff.warnings]),
    additions: sortDriftItems([...sourceDiff.additions, ...targetDiff.additions]),
  };
}
