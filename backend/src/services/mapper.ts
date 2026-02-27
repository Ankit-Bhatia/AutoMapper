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
    const targetMatch = chooseTargetEntity(sourceEntity, input.targetEntities);
    if (!targetMatch) continue;
    const targetEntity = targetMatch.target;
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
      rationale:
        ai?.rationale ??
        `${targetMatch.reason}. Combined score ${targetMatch.score.toFixed(2)}`,
    });

    for (const sourceField of sourceFields) {
      const candidateScores = targetFields.map((targetField) => {
        const nameScore = jaccard(
          `${sourceField.name} ${sourceField.label ?? ''}`,
          `${targetField.name} ${targetField.label ?? ''}`,
        );
        const typeScore = typeCompatibilityScore(sourceField.dataType, targetField.dataType);
        const semanticBoost = coreToFscFieldBoost(
          sourceEntity.name,
          targetEntity.name,
          sourceField.name,
          targetField.name,
        );
        const base = clamp(0.65 * nameScore + 0.35 * typeScore + semanticBoost);
        return { targetField, base, nameScore, typeScore, semanticBoost };
      });

      candidateScores.sort((a, b) => b.base - a.base);
      const best = candidateScores[0];
      if (!best) continue;

      const minThreshold = isCoreToFscPair(sourceEntity.name, targetEntity.name) ? 0.58 : 0.35;
      if (best.base < minThreshold) continue;

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
          `Name ${best.nameScore.toFixed(2)}, type ${best.typeScore.toFixed(2)}, semantic ${best.semanticBoost.toFixed(2)}`,
        status: 'suggested',
      });
    }
  }

  return { entityMappings, fieldMappings };
}

function chooseTargetEntity(
  sourceEntity: Entity,
  targetEntities: Entity[],
): { target: Entity; score: number; reason: string } | null {
  if (targetEntities.length === 0) return null;

  const labels = targetEntities.map((e) => `${e.name} ${e.label ?? ''}`);
  const fallback = bestStringMatch(sourceEntity.name, labels);
  if (fallback.index < 0) return null;

  const hasFscModel = targetEntities.some((e) => FSC_OBJECTS.has(normalize(e.name)));
  if (!hasFscModel) {
    return {
      target: targetEntities[fallback.index],
      score: fallback.score,
      reason: 'Name similarity',
    };
  }

  let best: { target: Entity; score: number; reason: string } | null = null;
  const sourceText = `${sourceEntity.name} ${sourceEntity.label ?? ''}`;

  for (const candidate of targetEntities) {
    const targetText = `${candidate.name} ${candidate.label ?? ''}`;
    const nameScore = jaccard(sourceText, targetText);
    const boost = fscEntityBoost(sourceEntity.name, candidate.name);
    const combined = clamp(nameScore + boost);
    const reason = boost > 0
      ? `FSC domain preference (${sourceEntity.name} -> ${candidate.name})`
      : 'Name similarity';

    if (!best || combined > best.score) {
      best = { target: candidate, score: combined, reason };
    }
  }

  return best;
}

const FSC_OBJECTS = new Set([
  'financialaccount',
  'accountparticipant',
  'partyprofile',
  'individualapplication',
  'financialgoal',
]);

function fscEntityBoost(sourceEntityName: string, targetEntityName: string): number {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);

  const isPartyEntity = src === 'cif' || src.includes('customer') || src.includes('member') || src.includes('party');
  const isFinancialAccountEntity =
    src.includes('dda') ||
    src.includes('loan') ||
    src.includes('certificate') ||
    src.includes('lineofcredit') ||
    src.includes('share') ||
    src.includes('deposit') ||
    src.includes('account');

  if (isPartyEntity && tgt === 'partyprofile') return 0.5;
  if (isPartyEntity && tgt === 'accountparticipant') return 0.18;
  if (isPartyEntity && (tgt === 'account' || tgt === 'contact')) return 0.1;

  if (isFinancialAccountEntity && tgt === 'financialaccount') return 0.55;
  if (isFinancialAccountEntity && tgt === 'accountparticipant') return 0.16;
  if (isFinancialAccountEntity && tgt === 'financialgoal') return 0.1;
  if (isFinancialAccountEntity && tgt === 'account') return 0.06;

  if (src.includes('gl') && src.includes('account') && tgt === 'financialaccount') return 0.25;

  return 0;
}

function isCoreToFscPair(sourceEntityName: string, targetEntityName: string): boolean {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);
  return CORE_ENTITY_NAMES.has(src) && FSC_OBJECTS.has(tgt);
}

const CORE_ENTITY_NAMES = new Set([
  'cif',
  'dda',
  'loanaccount',
  'glaccount',
  'certificate',
  'lineofcredit',
  'member',
  'share',
]);

const CORE_TO_FSC_FIELD_PREFS: Record<string, Record<string, string[]>> = {
  cif: {
    cifnumber: ['cifnumber'],
    taxid: ['taxid'],
    dateofbirth: ['birthdate'],
    legalname: ['legalname', 'name'],
    primaryemail: ['primaryemail'],
    primaryphone: ['primaryphone'],
    addressline1: ['addressline1'],
    city: ['city'],
    statecode: ['statecode'],
    postalcode: ['postalcode'],
    countrycode: ['countrycode'],
  },
  dda: {
    accountnumber: ['financialaccountnumber'],
    accounttype: ['financialaccounttype'],
    accountstatus: ['status'],
    currentbalance: ['currentbalance'],
    collectedbalance: ['currentbalance'],
    availablebalance: ['availablebalance'],
    opendate: ['opendate'],
    nickname: ['name'],
  },
  loanaccount: {
    loannumber: ['financialaccountnumber'],
    loantype: ['financialaccounttype'],
    loanstatus: ['status'],
    currentbalance: ['currentbalance'],
    originalprincipal: ['currentbalance'],
    originationdate: ['opendate'],
  },
  glaccount: {
    glaccountnumber: ['financialaccountnumber'],
    accountdescription: ['name'],
    accountcategory: ['financialaccounttype'],
    debitbalance: ['currentbalance'],
    creditbalance: ['currentbalance'],
    lastpostingdate: ['opendate'],
  },
};

function coreToFscFieldBoost(
  sourceEntityName: string,
  targetEntityName: string,
  sourceFieldName: string,
  targetFieldName: string,
): number {
  if (!isCoreToFscPair(sourceEntityName, targetEntityName)) return 0;

  const srcEntity = normalize(sourceEntityName);
  const srcField = normalize(sourceFieldName);
  const tgtField = normalize(targetFieldName);
  const entityPrefs = CORE_TO_FSC_FIELD_PREFS[srcEntity];
  if (!entityPrefs) return 0;

  const preferred = entityPrefs[srcField];
  if (!preferred) return 0;
  if (preferred.includes(tgtField)) return 0.28;
  return -0.05;
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
