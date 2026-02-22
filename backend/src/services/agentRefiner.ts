import { v4 as uuidv4 } from 'uuid';
import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  MappingProject,
  TransformType,
  ValidationReport,
} from '../types.js';
import { validateMappings } from './validator.js';
import { typeCompatibilityScore } from '../utils/typeUtils.js';
import { jaccard } from '../utils/stringSim.js';

export interface RefinementStep {
  iteration: number;
  phase: string;
  improved: number;
  message: string;
}

export interface RefinementResult {
  steps: RefinementStep[];
  updatedFieldMappings: FieldMapping[];
  finalValidation: ValidationReport;
  totalImproved: number;
}

type ImprovementResponse = {
  improvements?: Array<{
    fieldMappingId?: string;
    newTargetFieldName?: string;
    confidence?: number;
    rationale?: string;
    transformType?: string;
  }>;
};

type ConflictResponse = {
  winner?: string;
  rationale?: string;
  demoted?: Array<{
    fieldMappingId?: string;
    alternativeTargetFieldName?: string;
  }>;
};

type RequiredResponse = {
  suggestions?: Array<{
    sourceFieldName?: string;
    targetFieldName?: string;
    confidence?: number;
    rationale?: string;
    transformType?: string;
  }>;
};

export async function runAgentRefinement(input: {
  project: MappingProject;
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  entities: Entity[];
  fields: Field[];
  onStep: (step: RefinementStep) => void;
}): Promise<RefinementResult> {
  const hasAi = Boolean(process.env.OPENAI_API_KEY);
  const steps: RefinementStep[] = [];
  const updatedFieldMappings = input.fieldMappings.map((fm) => ({ ...fm, transform: { ...fm.transform } }));
  const fieldById = new Map(input.fields.map((f) => [f.id, f]));
  const entityMappingById = new Map(input.entityMappings.map((em) => [em.id, em]));

  const step1Improved = hasAi
    ? await runFewShotRefinementAi({
        fieldMappings: updatedFieldMappings,
        fields: input.fields,
        fieldById,
        entityMappingById,
      })
    : runFewShotRefinementHeuristic({
        fieldMappings: updatedFieldMappings,
        fieldById,
      });

  const step1: RefinementStep = {
    iteration: 1,
    phase: 'few-shot-refinement',
    improved: step1Improved,
    message: hasAi
      ? `Processed low-confidence mappings with few-shot examples (${step1Improved} improved)`
      : `OPENAI_API_KEY missing. Applied heuristic confidence rescoring (${step1Improved} improved)`,
  };
  steps.push(step1);
  input.onStep(step1);

  const step2Improved = hasAi
    ? await runConflictResolutionAi({
        fieldMappings: updatedFieldMappings,
        fields: input.fields,
        fieldById,
      })
    : runConflictResolutionHeuristic(updatedFieldMappings);

  const step2: RefinementStep = {
    iteration: 2,
    phase: 'conflict-resolution',
    improved: step2Improved,
    message: hasAi
      ? `Resolved conflicting target assignments (${step2Improved} conflicts handled)`
      : `OPENAI_API_KEY missing. Resolved conflicts by confidence ranking (${step2Improved} conflicts handled)`,
  };
  steps.push(step2);
  input.onStep(step2);

  const step3Improved = hasAi
    ? await runRequiredFieldPassAi({
        entityMappings: input.entityMappings,
        fieldMappings: updatedFieldMappings,
        fields: input.fields,
      })
    : runRequiredFieldPassHeuristic({
        entityMappings: input.entityMappings,
        fieldMappings: updatedFieldMappings,
        fieldById,
      });

  const step3: RefinementStep = {
    iteration: 3,
    phase: 'required-fields',
    improved: step3Improved,
    message: hasAi
      ? `Proposed mappings for unmapped required target fields (${step3Improved} created)`
      : `OPENAI_API_KEY missing. Added heuristic required-field mappings (${step3Improved} created)`,
  };
  steps.push(step3);
  input.onStep(step3);

  const finalValidation = validateMappings({
    entityMappings: input.entityMappings,
    fieldMappings: updatedFieldMappings,
    fields: input.fields,
    entities: input.entities,
  });

  return {
    steps,
    updatedFieldMappings,
    finalValidation,
    totalImproved: step1Improved + step2Improved + step3Improved,
  };
}

async function runFewShotRefinementAi(input: {
  fieldMappings: FieldMapping[];
  fields: Field[];
  fieldById: Map<string, Field>;
  entityMappingById: Map<string, EntityMapping>;
}): Promise<number> {
  const fewShotExamples = input.fieldMappings
    .filter((fm) => fm.status === 'accepted' || fm.status === 'rejected')
    .map((fm) => {
      const sourceField = input.fieldById.get(fm.sourceFieldId);
      const targetField = input.fieldById.get(fm.targetFieldId);
      return {
        fieldMappingId: fm.id,
        sourceFieldName: sourceField?.name ?? '',
        targetFieldName: targetField?.name ?? '',
        confidence: fm.confidence,
        rationale: fm.rationale,
        status: fm.status,
      };
    });

  const lowConfidence = input.fieldMappings.filter((fm) => fm.status === 'suggested' && fm.confidence < 0.65);
  const byEntityMappingId = new Map<string, FieldMapping[]>();
  for (const mapping of lowConfidence) {
    const list = byEntityMappingId.get(mapping.entityMappingId) ?? [];
    list.push(mapping);
    byEntityMappingId.set(mapping.entityMappingId, list);
  }

  let improved = 0;

  for (const [entityMappingId, mappings] of byEntityMappingId.entries()) {
    const entityMap = input.entityMappingById.get(entityMappingId);
    if (!entityMap) continue;

    const availableTargetFields = input.fields
      .filter((f) => f.entityId === entityMap.targetEntityId)
      .map((f) => ({ name: f.name, dataType: f.dataType, required: Boolean(f.required) }));

    const lowConfidenceFields = mappings.map((fm) => {
      const sourceField = input.fieldById.get(fm.sourceFieldId);
      const currentTarget = input.fieldById.get(fm.targetFieldId);
      return {
        fieldMappingId: fm.id,
        sourceFieldName: sourceField?.name ?? '',
        sourceDataType: sourceField?.dataType ?? 'unknown',
        currentTargetFieldName: currentTarget?.name ?? '',
        currentConfidence: fm.confidence,
        rationale: fm.rationale,
      };
    });

    const response = await callOpenAiJson<ImprovementResponse>({
      systemPrompt:
        'You are a SAP-to-Salesforce mapping expert. Use the provided accepted/rejected examples to improve low-confidence field mappings. Return strict JSON.',
      prompt: {
        fewShotExamples,
        lowConfidenceFields,
        availableTargetFields,
      },
    });

    const improvements = response?.improvements ?? [];
    for (const candidate of improvements) {
      const mappingId = String(candidate.fieldMappingId ?? '');
      const mapping = mappings.find((fm) => fm.id === mappingId);
      if (!mapping) continue;

      const newConfidence = Number(candidate.confidence ?? 0);
      if (!Number.isFinite(newConfidence) || newConfidence <= mapping.confidence) continue;

      const normalizedTarget = normalize(String(candidate.newTargetFieldName ?? ''));
      const targetField = input.fields.find(
        (f) =>
          f.entityId === entityMap.targetEntityId &&
          normalize(f.name) === normalizedTarget,
      );

      if (targetField) {
        mapping.targetFieldId = targetField.id;
      }
      mapping.confidence = clamp(newConfidence);
      mapping.rationale = String(candidate.rationale ?? mapping.rationale);
      mapping.status = 'suggested';
      mapping.transform = {
        type: parseTransformType(candidate.transformType, mapping.transform.type),
        config: mapping.transform.config,
      };
      improved += 1;
    }
  }

  return improved;
}

function runFewShotRefinementHeuristic(input: {
  fieldMappings: FieldMapping[];
  fieldById: Map<string, Field>;
}): number {
  let improved = 0;

  for (const mapping of input.fieldMappings) {
    if (mapping.status !== 'suggested' || mapping.confidence >= 0.65) continue;
    const sourceField = input.fieldById.get(mapping.sourceFieldId);
    const targetField = input.fieldById.get(mapping.targetFieldId);
    if (!sourceField || !targetField) continue;

    const typeScore = typeCompatibilityScore(sourceField.dataType, targetField.dataType);
    const nameScore = jaccard(sourceField.name, targetField.name);
    if (typeScore >= 0.75 || (typeScore >= 0.6 && nameScore >= 0.35)) {
      const prior = mapping.confidence;
      const candidate = clamp(Math.max(prior, 0.45 + 0.35 * typeScore + 0.2 * nameScore) + 0.06);
      if (candidate > prior) {
        mapping.confidence = candidate;
        mapping.rationale = `${mapping.rationale} | heuristic-rescore(type=${typeScore.toFixed(2)},name=${nameScore.toFixed(2)})`;
        improved += 1;
      }
    }
  }

  return improved;
}

async function runConflictResolutionAi(input: {
  fieldMappings: FieldMapping[];
  fields: Field[];
  fieldById: Map<string, Field>;
}): Promise<number> {
  const conflicts = getConflicts(input.fieldMappings);
  let resolved = 0;

  for (const group of conflicts) {
    const targetField = input.fieldById.get(group[0].targetFieldId);
    if (!targetField) continue;

    const payload = {
      targetField: {
        id: targetField.id,
        name: targetField.name,
        dataType: targetField.dataType,
      },
      conflicts: group.map((fm) => {
        const sourceField = input.fieldById.get(fm.sourceFieldId);
        return {
          fieldMappingId: fm.id,
          sourceFieldName: sourceField?.name ?? '',
          sourceDataType: sourceField?.dataType ?? 'unknown',
          confidence: fm.confidence,
          rationale: fm.rationale,
        };
      }),
      task: 'Pick a single winner mapping for this target field and provide alternative target suggestions for demoted mappings.',
    };

    const response = await callOpenAiJson<ConflictResponse>({
      systemPrompt: 'You resolve SAP-to-Salesforce mapping conflicts. Return strict JSON.',
      prompt: payload,
    });

    const winnerId = String(response?.winner ?? '');
    const winner = group.find((m) => m.id === winnerId) ?? group.reduce((best, cur) => (cur.confidence > best.confidence ? cur : best), group[0]);

    winner.confidence = clamp(winner.confidence + 0.1);
    if (response?.rationale) {
      winner.rationale = String(response.rationale);
    }

    const demotedCandidates = response?.demoted ?? [];
    for (const mapping of group) {
      if (mapping.id === winner.id) continue;
      const demoted = demotedCandidates.find((d) => d.fieldMappingId === mapping.id);
      if (demoted?.alternativeTargetFieldName) {
        const alt = findFieldByName(input.fields, demoted.alternativeTargetFieldName, targetField.entityId);
        if (alt) {
          mapping.targetFieldId = alt.id;
        }
      }
      mapping.confidence = clamp(Math.max(0.1, mapping.confidence - 0.15));
      mapping.status = 'suggested';
      if (demoted?.alternativeTargetFieldName) {
        mapping.rationale = `${mapping.rationale} | demoted due to conflict; alt=${demoted.alternativeTargetFieldName}`;
      }
    }

    resolved += 1;
  }

  return resolved;
}

function runConflictResolutionHeuristic(fieldMappings: FieldMapping[]): number {
  const conflicts = getConflicts(fieldMappings);
  for (const group of conflicts) {
    const winner = group.reduce((best, cur) => (cur.confidence > best.confidence ? cur : best), group[0]);
    winner.confidence = clamp(winner.confidence + 0.1);
    for (const mapping of group) {
      if (mapping.id === winner.id) continue;
      mapping.confidence = clamp(Math.max(0.1, mapping.confidence - 0.15));
      mapping.status = 'suggested';
      mapping.rationale = `${mapping.rationale} | demoted by heuristic conflict resolution`;
    }
  }
  return conflicts.length;
}

async function runRequiredFieldPassAi(input: {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  fields: Field[];
}): Promise<number> {
  let created = 0;

  for (const entityMapping of input.entityMappings) {
    const targetFields = input.fields.filter((f) => f.entityId === entityMapping.targetEntityId);
    const sourceFields = input.fields.filter((f) => f.entityId === entityMapping.sourceEntityId);

    const mappedTargetIds = new Set(
      input.fieldMappings
        .filter((fm) => fm.entityMappingId === entityMapping.id && (fm.status === 'accepted' || fm.status === 'suggested'))
        .map((fm) => fm.targetFieldId),
    );

    const requiredUnmapped = targetFields.filter((f) => f.required && !mappedTargetIds.has(f.id));
    if (!requiredUnmapped.length) continue;

    const mappedSourceIds = new Set(
      input.fieldMappings
        .filter((fm) => fm.entityMappingId === entityMapping.id && fm.status !== 'rejected')
        .map((fm) => fm.sourceFieldId),
    );

    const remainingSource = sourceFields.filter((f) => !mappedSourceIds.has(f.id));
    if (!remainingSource.length) continue;

    const response = await callOpenAiJson<RequiredResponse>({
      systemPrompt: 'You are a SAP-to-Salesforce field mapping expert. Fill required target fields with best-effort suggestions. Return strict JSON.',
      prompt: {
        sourceEntityId: entityMapping.sourceEntityId,
        targetEntityId: entityMapping.targetEntityId,
        requiredTargetFields: requiredUnmapped.map((f) => ({ name: f.name, dataType: f.dataType })),
        availableSourceFields: remainingSource.map((f) => ({ name: f.name, dataType: f.dataType })),
      },
    });

    const suggestions = response?.suggestions ?? [];
    for (const suggestion of suggestions) {
      const confidence = Number(suggestion.confidence ?? 0);
      if (!Number.isFinite(confidence) || confidence <= 0.4) continue;

      const sourceField = remainingSource.find((f) => normalize(f.name) === normalize(String(suggestion.sourceFieldName ?? '')));
      const targetField = requiredUnmapped.find((f) => normalize(f.name) === normalize(String(suggestion.targetFieldName ?? '')));
      if (!sourceField || !targetField) continue;
      if (mappedSourceIds.has(sourceField.id) || mappedTargetIds.has(targetField.id)) continue;

      const exists = input.fieldMappings.some(
        (fm) =>
          fm.entityMappingId === entityMapping.id &&
          fm.sourceFieldId === sourceField.id &&
          fm.targetFieldId === targetField.id,
      );
      if (exists) continue;

      input.fieldMappings.push({
        id: uuidv4(),
        entityMappingId: entityMapping.id,
        sourceFieldId: sourceField.id,
        targetFieldId: targetField.id,
        transform: {
          type: parseTransformType(suggestion.transformType, inferTransformType(sourceField, targetField)),
          config: {},
        },
        confidence: clamp(confidence),
        rationale: String(suggestion.rationale ?? 'Best-effort required field mapping'),
        status: 'suggested',
      });

      mappedTargetIds.add(targetField.id);
      mappedSourceIds.add(sourceField.id);
      created += 1;
    }
  }

  return created;
}

function runRequiredFieldPassHeuristic(input: {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  fieldById: Map<string, Field>;
}): number {
  let created = 0;

  for (const entityMapping of input.entityMappings) {
    const allMappings = input.fieldMappings.filter((fm) => fm.entityMappingId === entityMapping.id);
    const sourceFields = [...input.fieldById.values()].filter((f) => f.entityId === entityMapping.sourceEntityId);
    const targetFields = [...input.fieldById.values()].filter((f) => f.entityId === entityMapping.targetEntityId);

    const mappedTarget = new Set(
      allMappings.filter((fm) => fm.status === 'accepted' || fm.status === 'suggested').map((fm) => fm.targetFieldId),
    );
    const requiredUnmapped = targetFields.filter((f) => f.required && !mappedTarget.has(f.id));

    const usedSource = new Set(allMappings.filter((fm) => fm.status !== 'rejected').map((fm) => fm.sourceFieldId));
    const remainingSource = sourceFields.filter((f) => !usedSource.has(f.id));

    for (const targetField of requiredUnmapped) {
      let best: { sourceField: Field; score: number } | null = null;
      for (const sourceField of remainingSource) {
        if (usedSource.has(sourceField.id)) continue;
        const score = 0.55 * typeCompatibilityScore(sourceField.dataType, targetField.dataType) + 0.45 * jaccard(sourceField.name, targetField.name);
        if (!best || score > best.score) {
          best = { sourceField, score };
        }
      }

      if (!best || best.score <= 0.4) continue;

      input.fieldMappings.push({
        id: uuidv4(),
        entityMappingId: entityMapping.id,
        sourceFieldId: best.sourceField.id,
        targetFieldId: targetField.id,
        transform: { type: inferTransformType(best.sourceField, targetField), config: {} },
        confidence: clamp(best.score),
        rationale: `Heuristic required-field match (score=${best.score.toFixed(2)})`,
        status: 'suggested',
      });
      usedSource.add(best.sourceField.id);
      mappedTarget.add(targetField.id);
      created += 1;
    }
  }

  return created;
}

function getConflicts(fieldMappings: FieldMapping[]): FieldMapping[][] {
  const byTarget = new Map<string, FieldMapping[]>();

  for (const mapping of fieldMappings) {
    if (mapping.status === 'rejected') continue;
    const list = byTarget.get(mapping.targetFieldId) ?? [];
    list.push(mapping);
    byTarget.set(mapping.targetFieldId, list);
  }

  return [...byTarget.values()].filter((group) => group.length > 1);
}

function findFieldByName(
  fields: Field[],
  fieldName: string,
  targetEntityId: string,
): Field | null {
  const normalized = normalize(fieldName);
  const candidates = fields.filter((f) => f.entityId === targetEntityId);
  return candidates.find((f) => normalize(f.name) === normalized) ?? null;
}

function inferTransformType(sourceField: Field, targetField: Field): TransformType {
  if (targetField.dataType === 'date' || targetField.dataType === 'datetime') return 'formatDate';
  if (targetField.dataType === 'picklist') return 'lookup';
  if (sourceField.dataType === 'string' && targetField.dataType === 'string') return 'trim';
  return 'direct';
}

function parseTransformType(value: string | undefined, fallback: TransformType): TransformType {
  if (!value) return fallback;
  const transforms: TransformType[] = ['direct', 'concat', 'formatDate', 'lookup', 'static', 'regex', 'split', 'trim'];
  return transforms.includes(value as TransformType) ? (value as TransformType) : fallback;
}

async function callOpenAiJson<T>(input: { systemPrompt: string; prompt: unknown }): Promise<T | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: JSON.stringify(input.prompt) },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
