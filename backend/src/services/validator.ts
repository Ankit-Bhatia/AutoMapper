import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  ValidationRuleSafetySummary,
  ValidationReport,
  ValidationWarning,
} from '../types.js';
import { typeCompatibilityScore } from '../utils/typeUtils.js';
import { isActiveFieldMapping } from '../utils/mappingStatus.js';

export function validateMappings(input: {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  fields: Field[];
  entities: Entity[];
}): ValidationReport {
  const warnings: ValidationWarning[] = [];
  const fieldById = new Map(input.fields.map((f) => [f.id, f]));
  const entityById = new Map(input.entities.map((entity) => [entity.id, entity]));
  const activeFieldMappingsByEntityMap = new Map<string, FieldMapping[]>();

  for (const fieldMap of input.fieldMappings) {
    if (!isActiveFieldMapping(fieldMap)) continue;
    const list = activeFieldMappingsByEntityMap.get(fieldMap.entityMappingId) ?? [];
    list.push(fieldMap);
    activeFieldMappingsByEntityMap.set(fieldMap.entityMappingId, list);
  }

  let evaluatedRuleCount = 0;
  let fullyCoveredRuleCount = 0;
  let partialCoverageRiskCount = 0;
  let genericValidationRuleCount = 0;
  let unavailableValidationRuleCount = 0;
  const seenRuleEvaluations = new Set<string>();
  const seenUnavailableWarnings = new Set<string>();

  for (const fieldMapping of input.fieldMappings) {
    if (!isActiveFieldMapping(fieldMapping)) continue;
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

    for (const rule of target.validationRules ?? []) {
      if (rule.kind === 'unavailable') {
        const unavailableKey = `${fieldMapping.entityMappingId}:${target.entityId}`;
        if (seenUnavailableWarnings.has(unavailableKey)) continue;
        seenUnavailableWarnings.add(unavailableKey);
        unavailableValidationRuleCount++;
        warnings.push({
          type: 'validation_rules_unavailable',
          entityMappingId: fieldMapping.entityMappingId,
          fieldMappingId: fieldMapping.id,
          message: `Salesforce validation rules could not be loaded for ${rule.entityName}. Validation rule safety could not be evaluated for this object before export.`,
        });
        continue;
      }

      const ruleKey = `${fieldMapping.entityMappingId}:${target.entityId}:${rule.name}`;
      if (seenRuleEvaluations.has(ruleKey)) continue;
      seenRuleEvaluations.add(ruleKey);
      evaluatedRuleCount++;

      const activeMappings = activeFieldMappingsByEntityMap.get(fieldMapping.entityMappingId) ?? [];
      const mappedTargetFieldNames = new Set(
        activeMappings
          .map((mapping) => fieldById.get(mapping.targetFieldId))
          .filter((field): field is Field => field !== undefined && field.entityId === target.entityId)
          .map((field) => field.name),
      );

      const referencedFields = rule.referencedFields ?? [];
      if (referencedFields.length === 0) {
        genericValidationRuleCount++;
        const ruleDetail = rule.errorMessage ?? rule.description ?? 'Review target-side validation constraints before export.';
        warnings.push({
          type: 'validation_rule',
          entityMappingId: fieldMapping.entityMappingId,
          fieldMappingId: fieldMapping.id,
          message: `Target field ${target.name} is governed by validation rule "${rule.name}" on ${rule.entityName}. ${ruleDetail}`,
        });
        continue;
      }

      const coveredFields = referencedFields.filter((fieldName) => mappedTargetFieldNames.has(fieldName));
      const missingFields = referencedFields.filter((fieldName) => !mappedTargetFieldNames.has(fieldName));
      if (missingFields.length === 0) {
        fullyCoveredRuleCount++;
        continue;
      }

      partialCoverageRiskCount++;
      const coveredText = coveredFields.length ? coveredFields.join(', ') : 'none';
      const targetEntityName = entityById.get(target.entityId)?.name ?? rule.entityName;
      const ruleDetail = rule.errorMessage ?? rule.description ?? 'Review target-side validation constraints before export.';
      warnings.push({
        type: 'partial_coverage_risk',
        entityMappingId: fieldMapping.entityMappingId,
        fieldMappingId: fieldMapping.id,
        message: `Validation rule "${rule.name}" on ${targetEntityName} is only partially covered. Covered: ${coveredText}. Missing: ${missingFields.join(', ')}. ${ruleDetail}`,
      });
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
        .filter((fm) => isActiveFieldMapping(fm))
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

  const validationRuleSafety: ValidationRuleSafetySummary = {
    evaluatedRuleCount,
    fullyCoveredRuleCount,
    partialCoverageRiskCount,
    genericWarningCount: genericValidationRuleCount,
    unavailableCount: unavailableValidationRuleCount,
  };
  const validationRuleWarnings =
    genericValidationRuleCount + partialCoverageRiskCount + unavailableValidationRuleCount;

  return {
    warnings,
    summary: {
      totalWarnings: warnings.length,
      typeMismatch: warnings.filter((w) => w.type === 'type_mismatch').length,
      missingRequired: warnings.filter((w) => w.type === 'missing_required').length,
      picklistCoverage: warnings.filter((w) => w.type === 'picklist_coverage').length,
      validationRule: validationRuleWarnings,
      partialCoverageRisk: partialCoverageRiskCount,
      validationRulesUnavailable: unavailableValidationRuleCount,
    },
    validationRuleSafety,
  };
}
