import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  MappingProject,
  ValidationReport,
} from '../types.js';

export function buildJsonExport(input: {
  project: MappingProject;
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  entities: Entity[];
  fields: Field[];
  validation: ValidationReport;
}) {
  const entityById = new Map(input.entities.map((e) => [e.id, e]));
  const fieldById = new Map(input.fields.map((f) => [f.id, f]));

  return {
    project: input.project,
    entityMappings: input.entityMappings.map((entityMapping) => {
      const sourceEntity = entityById.get(entityMapping.sourceEntityId);
      const targetEntity = entityById.get(entityMapping.targetEntityId);

      return {
        sourceEntity: sourceEntity?.name ?? entityMapping.sourceEntityId,
        targetEntity: targetEntity?.name ?? entityMapping.targetEntityId,
        confidence: entityMapping.confidence,
        rationale: entityMapping.rationale,
        fieldMappings: input.fieldMappings
          .filter((fm) => fm.entityMappingId === entityMapping.id)
          .map((fm) => ({
            sourceField: fieldById.get(fm.sourceFieldId)?.name ?? fm.sourceFieldId,
            targetField: fieldById.get(fm.targetFieldId)?.name ?? fm.targetFieldId,
            transform: fm.transform,
            confidence: fm.confidence,
            rationale: fm.rationale,
            status: fm.status,
          })),
      };
    }),
    validation: input.validation,
  };
}

export function buildCsvExport(input: {
  project: MappingProject;
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  entities: Entity[];
  fields: Field[];
}) {
  const entityById = new Map(input.entities.map((e) => [e.id, e]));
  const fieldById = new Map(input.fields.map((f) => [f.id, f]));
  const entityMappingById = new Map(input.entityMappings.map((e) => [e.id, e]));

  const rows = input.fieldMappings.map((fm) => {
    const em = entityMappingById.get(fm.entityMappingId);
    const sourceEntity = em ? (entityById.get(em.sourceEntityId)?.name ?? '') : '';
    const targetEntity = em ? (entityById.get(em.targetEntityId)?.name ?? '') : '';
    const sourceField = fieldById.get(fm.sourceFieldId)?.name ?? fm.sourceFieldId;
    const targetField = fieldById.get(fm.targetFieldId)?.name ?? fm.targetFieldId;
    return [
      input.project.name,
      sourceEntity,
      sourceField,
      targetEntity,
      targetField,
      fm.transform.type,
      JSON.stringify(fm.transform.config),
      fm.confidence.toFixed(3),
      fm.status,
      fm.rationale.replace(/[\r\n]+/g, ' '),
    ].map(csvEscape);
  });

  const header = [
    'project',
    'sourceEntity',
    'sourceField',
    'targetEntity',
    'targetField',
    'transformType',
    'transformConfig',
    'confidence',
    'status',
    'rationale',
  ];

  return [header, ...rows].map((r) => r.join(',')).join('\n');
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
