import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  ValidationReport,
  ValidationWarning,
} from '../types.js';
import { typeCompatibilityScore } from '../utils/typeUtils.js';

export function validateMappings(input: {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  fields: Field[];
  entities: Entity[];
}): ValidationReport {
  const warnings: ValidationWarning[] = [];
  const fieldById = new Map(input.fields.map((f) => [f.id, f]));

  for (const fieldMapping of input.fieldMappings) {
    const source = fieldById.get(fieldMapping.sourceFieldId);
    const target = fieldById.get(fieldMapping.targetFieldId);
    if (!source || !target) continue;

    const comp = typeCompatibilityScore(source.dataType, target.dataType);
    if (comp < 0.6) {
      warnings.push({
        type: 'type_mismatch',
        entityMappingId: fieldMapping.entityMappingId,
        fieldMappingId: fieldMapping.id,
        message: `${source.name} (${source.dataType}) may be incompatible with ${target.name} (${target.dataType})`,
      });
    }

    if (target.picklistValues?.length && source.picklistValues?.length) {
      const covered = source.picklistValues.filter((v) => target.picklistValues!.includes(v));
      if (covered.length < source.picklistValues.length) {
        warnings.push({
          type: 'picklist_coverage',
          entityMappingId: fieldMapping.entityMappingId,
          fieldMappingId: fieldMapping.id,
          message: `Picklist coverage incomplete for ${source.name} -> ${target.name}`,
        });
      }
    }
  }

  const fieldMappingsByEntityMap = new Map<string, FieldMapping[]>();
  for (const fieldMap of input.fieldMappings) {
    const list = fieldMappingsByEntityMap.get(fieldMap.entityMappingId) ?? [];
    list.push(fieldMap);
    fieldMappingsByEntityMap.set(fieldMap.entityMappingId, list);
  }

  for (const em of input.entityMappings) {
    const mappedTargetFieldIds = new Set(
      (fieldMappingsByEntityMap.get(em.id) ?? [])
        .filter((fm) => fm.status !== 'rejected')
        .map((fm) => fm.targetFieldId),
    );

    const targetRequiredFields = input.fields.filter((f) => f.entityId === em.targetEntityId && f.required);
    for (const req of targetRequiredFields) {
      if (!mappedTargetFieldIds.has(req.id)) {
        warnings.push({
          type: 'missing_required',
          entityMappingId: em.id,
          message: `Required target field ${req.name} is not mapped`,
        });
      }
    }
  }

  return {
    warnings,
    summary: {
      totalWarnings: warnings.length,
      typeMismatch: warnings.filter((w) => w.type === 'type_mismatch').length,
      missingRequired: warnings.filter((w) => w.type === 'missing_required').length,
      picklistCoverage: warnings.filter((w) => w.type === 'picklist_coverage').length,
    },
  };
}
