import fs from 'node:fs/promises';
import path from 'node:path';
import type { Entity, Field, MappingProject, EntityMapping, FieldMapping, ValidationReport } from '../types.js';
import { suggestMappings } from '../services/mapper.js';
import { validateMappings } from '../services/validator.js';

interface SapSampleField {
  name: string;
  dataType: string;
  isKey?: boolean;
  required?: boolean;
  picklistValues?: string[];
}

interface SapSampleEntity {
  name: string;
  label?: string;
  fields: SapSampleField[];
}

interface SapSampleSchema {
  entities: SapSampleEntity[];
}

interface SalesforceSampleSchema {
  entities: Entity[];
  fields: Field[];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'backend') {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

async function loadSchemas() {
  const repoRoot = resolveRepoRoot();
  const samplesDir = path.resolve(repoRoot, 'samples');

  const sapPath = path.resolve(samplesDir, 'sap/sap-schema.json');
  const sfPath = path.resolve(samplesDir, 'mock-responses/target-schema-salesforce.json');

  const [sapRaw, sfRaw] = await Promise.all([
    fs.readFile(sapPath, 'utf8'),
    fs.readFile(sfPath, 'utf8'),
  ]);

  const sapSchema = JSON.parse(sapRaw) as SapSampleSchema;
  const sfSchema = JSON.parse(sfRaw) as SalesforceSampleSchema;

  return { sapSchema, sfSchema, samplesDir };
}

function buildCanonicalModel(
  sapSchema: SapSampleSchema,
  sfSchema: SalesforceSampleSchema,
): {
  project: MappingProject;
  sourceEntities: Entity[];
  targetEntities: Entity[];
  allFields: Field[];
} {
  const sapSystemId = 'sys_sap_demo';
  const sfSystemId = sfSchema.entities[0]?.systemId ?? 'sys_sf_demo';

  const sourceEntities: Entity[] = sapSchema.entities.map((e, index) => ({
    id: `ent_sap_${index}_${slug(e.name)}`,
    systemId: sapSystemId,
    name: e.name,
    label: e.label,
    description: undefined,
  }));

  const sourceFields: Field[] = [];
  for (const entity of sapSchema.entities) {
    const entityId =
      sourceEntities.find((e) => e.name === entity.name)?.id ??
      `ent_sap_${slug(entity.name)}`;
    for (const field of entity.fields) {
      sourceFields.push({
        id: `fld_sap_${slug(entity.name)}_${slug(field.name)}`,
        entityId,
        name: field.name,
        label: undefined,
        dataType: field.dataType as Field['dataType'],
        length: undefined,
        precision: undefined,
        scale: undefined,
        required: field.required,
        isKey: field.isKey,
        isExternalId: false,
        picklistValues: field.picklistValues,
        jxchangeXPath: undefined,
        jxchangeXtendElemKey: undefined,
        iso20022Name: undefined,
        complianceTags: undefined,
        complianceNote: undefined,
      });
    }
  }

  const targetEntities = sfSchema.entities;
  const targetFields = sfSchema.fields;

  const project: MappingProject = {
    id: 'proj_sap_to_salesforce_demo',
    name: 'SAP → Salesforce Demo (Samples)',
    sourceSystemId: sapSystemId,
    targetSystemId: sfSystemId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const allFields: Field[] = [...sourceFields, ...targetFields];

  return { project, sourceEntities, targetEntities, allFields };
}

function groupMappingsForPreview(
  entityMappings: EntityMapping[],
  fieldMappings: FieldMapping[],
  entities: Entity[],
  fields: Field[],
  _validation: ValidationReport,
) {
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  const fieldByEntity = new Map<string, FieldMapping[]>();
  for (const fm of fieldMappings) {
    const list = fieldByEntity.get(fm.entityMappingId) ?? [];
    list.push(fm);
    fieldByEntity.set(fm.entityMappingId, list);
  }

  return entityMappings.map((em) => {
    const src = entityById.get(em.sourceEntityId);
    const tgt = entityById.get(em.targetEntityId);
    const fms = fieldByEntity.get(em.id) ?? [];

    return {
      entityMappingId: em.id,
      sourceEntity: {
        id: src?.id ?? em.sourceEntityId,
        name: src?.name ?? em.sourceEntityId,
        label: src?.label,
      },
      targetEntity: {
        id: tgt?.id ?? em.targetEntityId,
        name: tgt?.name ?? em.targetEntityId,
        label: tgt?.label,
      },
      confidence: em.confidence,
      rationale: em.rationale,
      fieldMappings: fms.map((fm) => {
        const sf = fieldById.get(fm.sourceFieldId);
        const tf = fieldById.get(fm.targetFieldId);
        return {
          fieldMappingId: fm.id,
          sourceField: {
            id: sf?.id ?? fm.sourceFieldId,
            name: sf?.name ?? fm.sourceFieldId,
            dataType: sf?.dataType,
            required: sf?.required,
            isKey: sf?.isKey,
          },
          targetField: {
            id: tf?.id ?? fm.targetFieldId,
            name: tf?.name ?? fm.targetFieldId,
            dataType: tf?.dataType,
            required: tf?.required,
            isKey: tf?.isKey,
          },
          transform: fm.transform,
          confidence: fm.confidence,
          status: fm.status,
          rationale: fm.rationale,
        };
      }),
    };
  });
}

async function main() {
  const { sapSchema, sfSchema, samplesDir } = await loadSchemas();

  const { project, sourceEntities, targetEntities, allFields } = buildCanonicalModel(
    sapSchema,
    sfSchema,
  );

  const suggestion = await suggestMappings({
    project,
    sourceEntities,
    targetEntities,
    fields: allFields,
  });

  const validation = validateMappings({
    entityMappings: suggestion.entityMappings,
    fieldMappings: suggestion.fieldMappings,
    fields: allFields,
    entities: [...sourceEntities, ...targetEntities],
  });

  const grouped = groupMappingsForPreview(
    suggestion.entityMappings,
    suggestion.fieldMappings,
    [...sourceEntities, ...targetEntities],
    allFields,
    validation,
  );

  const output = {
    project,
    sourceSystem: 'sap',
    targetSystem: 'salesforce',
    summary: {
      totalEntityMappings: suggestion.entityMappings.length,
      totalFieldMappings: suggestion.fieldMappings.length,
      totalWarnings: validation.summary.totalWarnings,
      typeMismatchWarnings: validation.summary.typeMismatch,
      missingRequiredWarnings: validation.summary.missingRequired,
      picklistCoverageWarnings: validation.summary.picklistCoverage,
    },
    entityMappingGroups: grouped,
    validationWarnings: validation.warnings,
  };

  const outputDir = path.resolve(samplesDir, 'output');
  await fs.mkdir(outputDir, { recursive: true });
  const outPath = path.resolve(outputDir, 'sap-to-salesforce-mappings-preview.json');
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');

  // Also print to stdout so it can be inspected directly.
  console.log(JSON.stringify(output, null, 2));
  console.log(`\nPreview written to: ${outPath}`);
}

main().catch((err) => {
  console.error('Failed to generate SAP → Salesforce mapping preview:', err);
  process.exitCode = 1;
});
