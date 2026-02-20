import { v4 as uuidv4 } from 'uuid';
import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  MappingProject,
  TransformType,
} from '../types.js';
import { bestStringMatch, jaccard } from '../utils/stringSim.js';
import { typeCompatibilityScore } from '../utils/typeUtils.js';
import { getAiSuggestions } from './llmAdapter.js';

export async function suggestMappings(input: {
  project: MappingProject;
  sourceEntities: Entity[];
  targetEntities: Entity[];
  fields: Field[];
}): Promise<{ entityMappings: EntityMapping[]; fieldMappings: FieldMapping[] }> {
  const entityMappings: EntityMapping[] = [];
  const fieldMappings: FieldMapping[] = [];

  for (const sourceEntity of input.sourceEntities) {
    const targetMatch = bestStringMatch(
      sourceEntity.name,
      input.targetEntities.map((e) => `${e.name} ${e.label ?? ''}`),
    );

    if (targetMatch.index < 0) continue;
    const targetEntity = input.targetEntities[targetMatch.index];
    const sourceFields = input.fields.filter((f) => f.entityId === sourceEntity.id);
    const targetFields = input.fields.filter((f) => f.entityId === targetEntity.id);

    const ai = await getAiSuggestions(sourceEntity, sourceFields, targetEntity, targetFields);

    const entityConfidence = ai
      ? clamp(0.6 * targetMatch.score + 0.4 * ai.confidence)
      : clamp(0.75 * targetMatch.score + 0.25);

    const entityMappingId = uuidv4();
    entityMappings.push({
      id: entityMappingId,
      projectId: input.project.id,
      sourceEntityId: sourceEntity.id,
      targetEntityId: targetEntity.id,
      confidence: entityConfidence,
      rationale: ai?.rationale ?? `Name similarity score ${targetMatch.score.toFixed(2)}`,
    });

    for (const sourceField of sourceFields) {
      const candidateScores = targetFields.map((targetField) => {
        const nameScore = jaccard(
          `${sourceField.name} ${sourceField.label ?? ''}`,
          `${targetField.name} ${targetField.label ?? ''}`,
        );
        const typeScore = typeCompatibilityScore(sourceField.dataType, targetField.dataType);
        const base = 0.65 * nameScore + 0.35 * typeScore;
        return { targetField, base, nameScore, typeScore };
      });

      candidateScores.sort((a, b) => b.base - a.base);
      const best = candidateScores[0];
      if (!best || best.base < 0.35) continue;

      const aiField = ai?.fields.find(
        (f) =>
          normalize(f.sourceFieldName) === normalize(sourceField.name) &&
          targetFields.some((t) => normalize(t.name) === normalize(f.targetFieldName)),
      );

      const chosenTarget = aiField
        ? targetFields.find((t) => normalize(t.name) === normalize(aiField.targetFieldName)) ?? best.targetField
        : best.targetField;

      const finalConfidence = clamp(
        aiField ? 0.6 * best.base + 0.4 * aiField.confidence : best.base,
      );
      const transform = inferTransform(sourceField, chosenTarget, aiField?.transformType);

      fieldMappings.push({
        id: uuidv4(),
        entityMappingId,
        sourceFieldId: sourceField.id,
        targetFieldId: chosenTarget.id,
        transform,
        confidence: finalConfidence,
        rationale:
          aiField?.rationale ||
          `Name ${best.nameScore.toFixed(2)}, type ${best.typeScore.toFixed(2)} compatibility`,
        status: 'suggested',
      });
    }
  }

  return { entityMappings, fieldMappings };
}

function inferTransform(source: Field, target: Field, aiTransform?: string): {
  type: TransformType;
  config: Record<string, unknown>;
} {
  if (aiTransform && isTransform(aiTransform)) {
    return { type: aiTransform, config: {} };
  }

  const sourceName = normalize(source.name);
  const targetName = normalize(target.name);

  if (targetName.includes('name') && (sourceName === 'name1' || sourceName === 'name2')) {
    return { type: 'concat', config: { separator: ' ', sourceFields: ['Name1', 'Name2'] } };
  }

  if (target.dataType === 'date' || target.dataType === 'datetime') {
    return { type: 'formatDate', config: { input: 'auto', output: target.dataType } };
  }

  if (target.dataType === 'picklist') {
    return { type: 'lookup', config: { mode: 'codeToPicklist' } };
  }

  if (source.dataType === 'string' && target.dataType === 'string') {
    return { type: 'trim', config: { side: 'both' } };
  }

  return { type: 'direct', config: {} };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function isTransform(value: string): value is TransformType {
  return ['direct', 'concat', 'formatDate', 'lookup', 'static', 'regex', 'split', 'trim'].includes(value);
}
