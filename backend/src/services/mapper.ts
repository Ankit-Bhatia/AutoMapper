import { v4 as uuidv4 } from 'uuid';
import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  MappingProject,
  TransformType,
} from '../types.js';
import { CONFIRMED_PATTERNS, type ConfirmedPattern } from '../agents/schemaIntelligenceData.js';
import { bestStringMatch, jaccard } from '../utils/stringSim.js';
import { getAiSuggestions } from './llmAdapter.js';
import {
  buildFieldSemanticProfile,
  type FieldSemanticProfile,
} from './fieldSemantics.js';
import {
  retrieveCandidatesForSource,
  retrievalSummary,
  scoreRetrievalCandidate,
} from './candidateRetrieval.js';

const LOS_TYPE_PREFIX_RE = /^(AMT|NBR|DT|TYP|IND|CD|PCT|YN|NAME|DESC|CODE|PERC|DATE|ADDR|PHONE|EMAIL|Y)_/i;
const SALESFORCE_TARGET_OBJECTS = new Set([
  'account',
  'contact',
  'opportunity',
  'case',
  'financialaccount',
  'accountparticipant',
  'partyprofile',
  'individualapplication',
  'financialgoal',
  'loan',
  'loanpackage',
  'pit',
  'collateral',
  'fee',
]);
const PATTERN_OBJECT_ALIASES: Record<string, string> = {
  account: 'account',
  contact: 'contact',
  financialaccount: 'financialaccount',
  'financial account': 'financialaccount',
  faloan: 'financialaccount',
  'fa / loan': 'financialaccount',
  loan: 'loan',
  loanpackage: 'loanpackage',
  'loan package': 'loanpackage',
  pit: 'pit',
  collateral: 'collateral',
  fee: 'fee',
  'f e e': 'fee',
  accountparticipant: 'accountparticipant',
  partyprofile: 'partyprofile',
  individualapplication: 'individualapplication',
  financialgoal: 'financialgoal',
};

interface CandidateScore {
  targetField: Field;
  targetEntityName: string;
  base: number;
  lexicalScore: number;
  semanticScore: number;
  semanticMode: 'embed' | 'concept' | 'intent';
  typeScore: number;
  domainBoost: number;
  incompatible: boolean;
  sourceProfile: FieldSemanticProfile;
}

export async function suggestMappings(input: {
  project: MappingProject;
  sourceEntities: Entity[];
  targetEntities: Entity[];
  fields: Field[];
}): Promise<{ entityMappings: EntityMapping[]; fieldMappings: FieldMapping[] }> {
  if (shouldUseRiskClamSalesforceStrategy(input)) {
    return suggestRiskClamSalesforceMappings(input);
  }

  const entityMappings: EntityMapping[] = [];
  const fieldMappings: FieldMapping[] = [];
  const entityNamesById = new Map<string, string>([
    ...input.sourceEntities.map((entity) => [entity.id, entity.name] as const),
    ...input.targetEntities.map((entity) => [entity.id, entity.name] as const),
  ]);

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
      const sourceProfile = buildFieldSemanticProfile(sourceField);
      const retrieval = retrieveCandidatesForSource(sourceField, targetFields, {
        entityNamesById,
        topK: 5,
      });
      const candidateScores: CandidateScore[] = retrieval.rankedCandidates.map((candidate) => ({
        targetField: candidate.targetField as Field,
        targetEntityName: targetEntity.name,
        base: addDomainBoost(
          candidate.retrievalScore,
          sourceEntity.name,
          targetEntity.name,
          sourceField.name,
          candidate.targetField.name,
        ),
        lexicalScore: candidate.lexicalScore,
        semanticScore: candidate.semanticScore,
        semanticMode: candidate.semanticMode,
        typeScore: candidate.typeScore,
        domainBoost: domainFieldBoost(
          sourceEntity.name,
          targetEntity.name,
          sourceField.name,
          candidate.targetField.name,
        ),
        incompatible: candidate.incompatible,
        sourceProfile,
      }));

      candidateScores.sort((a, b) => b.base - a.base);
      const best = candidateScores[0];
      if (!best) continue;

      const minThreshold = isCoreToFscPair(sourceEntity.name, targetEntity.name)
        ? 0.5
        : isLosToFscPair(sourceEntity.name, targetEntity.name)
          ? 0.44
          : 0.42;
      if (best.base < minThreshold || best.incompatible) continue;

      const aiField = ai?.fields.find(
        (f) =>
          normalize(f.sourceFieldName) === normalize(sourceField.name) &&
          targetFields.some((t) => normalize(t.name) === normalize(f.targetFieldName)),
      );

      let chosen = best;
      let usedAiCandidate = false;
      if (aiField) {
        const aiTarget = targetFields.find((t) => normalize(t.name) === normalize(aiField.targetFieldName));
        if (aiTarget) {
          const aiCandidate = scoreTargetCandidate(
            sourceEntity.name,
            targetEntity.name,
            sourceField,
            aiTarget,
            sourceProfile,
            buildFieldSemanticProfile(aiTarget),
            entityNamesById,
          );
          if (!aiCandidate.incompatible && aiCandidate.base >= minThreshold * 0.85) {
            chosen = aiCandidate;
            usedAiCandidate = true;
          }
        }
      }

      const chosenTarget = chosen.targetField;
      const finalConfidence = clamp(
        aiField && usedAiCandidate
          ? (0.55 * aiField.confidence) + (0.45 * chosen.base)
          : chosen.base,
      );
      const transform = inferTransform(sourceField, chosenTarget, aiField && usedAiCandidate ? aiField.transformType : undefined);

      fieldMappings.push({
        id: uuidv4(),
        entityMappingId,
        sourceFieldId: sourceField.id,
        targetFieldId: chosenTarget.id,
        transform,
        confidence: finalConfidence,
        rationale:
          aiField && usedAiCandidate && aiField.rationale
            ? aiField.rationale
            : `${buildCandidateRationale(chosen)} | ${retrievalSummary(retrieval)}`,
        status: 'suggested',
      });
    }
  }

  return { entityMappings, fieldMappings };
}

function shouldUseRiskClamSalesforceStrategy(input: {
  sourceEntities: Entity[];
  targetEntities: Entity[];
  fields: Field[];
}): boolean {
  if (input.sourceEntities.length === 0 || input.targetEntities.length === 0) return false;

  const sourceEntityIds = new Set(input.sourceEntities.map((entity) => entity.id));
  const targetEntityIds = new Set(input.targetEntities.map((entity) => entity.id));
  const sourceFields = input.fields.filter((field) => sourceEntityIds.has(field.entityId));
  const targetFields = input.fields.filter((field) => targetEntityIds.has(field.entityId));
  if (sourceFields.length === 0 || targetFields.length === 0) return false;

  const losPrefixCount = sourceFields.filter((field) => LOS_TYPE_PREFIX_RE.test(field.name)).length;
  const confirmedCorpusHits = sourceFields.filter((field) => Boolean(CONFIRMED_PATTERNS[normalize(field.name)])).length;
  const targetSalesforceLike = input.targetEntities.some((entity) => SALESFORCE_TARGET_OBJECTS.has(canonicalPatternObjectName(entity.name)))
    || targetFields.some((field) => field.name.startsWith('FinServ__'));

  return targetSalesforceLike && (losPrefixCount / sourceFields.length >= 0.18 || confirmedCorpusHits >= 10);
}

function suggestRiskClamSalesforceMappings(input: {
  project: MappingProject;
  sourceEntities: Entity[];
  targetEntities: Entity[];
  fields: Field[];
}): { entityMappings: EntityMapping[]; fieldMappings: FieldMapping[] } {
  const sourceEntityIds = new Set(input.sourceEntities.map((entity) => entity.id));
  const targetEntityIds = new Set(input.targetEntities.map((entity) => entity.id));
  const sourceFields = input.fields.filter((field) => sourceEntityIds.has(field.entityId));
  const targetFields = input.fields.filter((field) => targetEntityIds.has(field.entityId));
  const sourceEntityById = new Map(input.sourceEntities.map((entity) => [entity.id, entity]));
  const targetEntityById = new Map(input.targetEntities.map((entity) => [entity.id, entity]));
  const entityNamesById = new Map<string, string>([
    ...input.sourceEntities.map((entity) => [entity.id, entity.name] as const),
    ...input.targetEntities.map((entity) => [entity.id, entity.name] as const),
  ]);
  const targetFieldsByEntityId = new Map<string, Field[]>();
  const targetProfiles = new Map(targetFields.map((field) => [field.id, buildFieldSemanticProfile(field)]));

  for (const field of targetFields) {
    const bucket = targetFieldsByEntityId.get(field.entityId) ?? [];
    bucket.push(field);
    targetFieldsByEntityId.set(field.entityId, bucket);
  }

  const pairEntries = new Map<string, {
    id: string;
    sourceEntityId: string;
    targetEntityId: string;
    confidences: number[];
    confirmedPatternHits: number;
    heuristicHits: number;
  }>();
  const fieldMappings: FieldMapping[] = [];
  const mappedSourceFieldIds = new Set<string>();

  const ensureEntityPair = (sourceEntityId: string, targetEntityId: string, kind: 'confirmed' | 'heuristic'): string => {
    const key = `${sourceEntityId}:${targetEntityId}`;
    const existing = pairEntries.get(key);
    if (existing) {
      if (kind === 'confirmed') existing.confirmedPatternHits += 1;
      else existing.heuristicHits += 1;
      return existing.id;
    }

    const created = {
      id: uuidv4(),
      sourceEntityId,
      targetEntityId,
      confidences: [],
      confirmedPatternHits: kind === 'confirmed' ? 1 : 0,
      heuristicHits: kind === 'heuristic' ? 1 : 0,
    };
    pairEntries.set(key, created);
    return created.id;
  };

  for (const sourceField of sourceFields) {
    const confirmed = selectConfirmedPatternTarget(sourceField, input.targetEntities, targetFieldsByEntityId, targetFields);
    if (!confirmed) continue;

    const pairKey = `${sourceField.entityId}:${confirmed.targetEntity.id}`;
    const entityMappingId = ensureEntityPair(sourceField.entityId, confirmed.targetEntity.id, 'confirmed');
    const confidence = confirmedPatternConfidence(confirmed.pattern);
    pairEntries.get(pairKey)?.confidences.push(confidence);

    fieldMappings.push({
      id: uuidv4(),
      entityMappingId,
      sourceFieldId: sourceField.id,
      targetFieldId: confirmed.targetField.id,
      transform: inferTransform(sourceField, confirmed.targetField),
      confidence,
      rationale: buildConfirmedPatternRationale(sourceField, confirmed.targetField, confirmed.pattern),
      status: 'suggested',
    });
    mappedSourceFieldIds.add(sourceField.id);
  }

  for (const sourceField of sourceFields) {
    if (mappedSourceFieldIds.has(sourceField.id)) continue;

    const sourceEntity = sourceEntityById.get(sourceField.entityId);
    if (!sourceEntity) continue;

    const sourceProfile = buildFieldSemanticProfile(sourceField);
    const retrieval = retrieveCandidatesForSource(sourceField, targetFields, {
      entityNamesById,
      topK: 5,
    });
    const candidateScores: CandidateScore[] = retrieval.rankedCandidates.map((candidate) => {
      const targetEntity = targetEntityById.get(candidate.targetField.entityId);
      const targetEntityName = targetEntity?.name ?? '';
      const domainBoost = domainFieldBoost(
        sourceEntity.name,
        targetEntityName,
        sourceField.name,
        candidate.targetField.name,
      );

      return {
        targetField: candidate.targetField as Field,
        targetEntityName,
        base: addDomainBoost(
          candidate.retrievalScore,
          sourceEntity.name,
          targetEntityName,
          sourceField.name,
          candidate.targetField.name,
        ),
        lexicalScore: candidate.lexicalScore,
        semanticScore: candidate.semanticScore,
        semanticMode: candidate.semanticMode,
        typeScore: candidate.typeScore,
        domainBoost,
        incompatible: candidate.incompatible,
        sourceProfile,
      };
    });

    candidateScores.sort((left, right) => right.base - left.base);
    const best = candidateScores[0];
    const second = candidateScores[1];
    if (!best || best.incompatible) continue;

    const scoreGap = best.base - (second?.base ?? 0);
    const ambiguous = scoreGap < 0.06 && best.base < 0.78 && best.domainBoost < 0.26;
    const genericNameSink =
      normalize(best.targetField.name) === 'name'
      && !sourceProfile.intents.has('name')
      && !sourceProfile.intents.has('first_name')
      && !sourceProfile.intents.has('last_name');

    if (best.base < 0.58 || ambiguous || genericNameSink) continue;

    const targetEntity = targetEntityById.get(best.targetField.entityId);
    if (!targetEntity) continue;

    const pairKey = `${sourceField.entityId}:${targetEntity.id}`;
    const entityMappingId = ensureEntityPair(sourceField.entityId, targetEntity.id, 'heuristic');
    pairEntries.get(pairKey)?.confidences.push(best.base);

    fieldMappings.push({
      id: uuidv4(),
      entityMappingId,
      sourceFieldId: sourceField.id,
      targetFieldId: best.targetField.id,
      transform: inferTransform(sourceField, best.targetField),
      confidence: clamp(best.base),
      rationale: `${buildCandidateRationale(best)} | ${retrievalSummary(retrieval)}`,
      status: 'suggested',
    });
  }

  const entityMappings = Array.from(pairEntries.values())
    .map((entry) => {
      const sourceEntity = sourceEntityById.get(entry.sourceEntityId);
      const targetEntity = targetEntityById.get(entry.targetEntityId);
      const averageConfidence = entry.confidences.length
        ? entry.confidences.reduce((sum, value) => sum + value, 0) / entry.confidences.length
        : 0.72;

      return {
        id: entry.id,
        projectId: input.project.id,
        sourceEntityId: entry.sourceEntityId,
        targetEntityId: entry.targetEntityId,
        confidence: clamp(averageConfidence),
        rationale: buildRiskClamEntityRationale(
          sourceEntity?.name ?? 'Unknown',
          targetEntity?.name ?? 'Unknown',
          entry.confirmedPatternHits,
          entry.heuristicHits,
        ),
      };
    })
    .sort((left, right) => right.confidence - left.confidence);

  return { entityMappings, fieldMappings };
}

function chooseTargetEntity(
  sourceEntity: Entity,
  targetEntities: Entity[],
): { target: Entity; score: number; reason: string } | null {
  if (targetEntities.length === 0) return null;

  const hasFscModel = targetEntities.some((e) => FSC_OBJECTS.has(normalize(e.name)));
  if (!hasFscModel) {
    const labels = targetEntities.map((e) => `${e.name} ${e.label ?? ''}`);
    const fallback = bestStringMatch(sourceEntity.name, labels);
    if (fallback.index < 0) return null;
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
    const boost = fscEntityBoost(sourceEntity.name, candidate.name) + sameDomainEntityBoost(sourceEntity.name, candidate.name);
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

function canonicalPatternObjectName(value: string): string {
  const normalized = value.trim().toLowerCase();
  return PATTERN_OBJECT_ALIASES[normalized] ?? normalize(value);
}

function patternPriority(pattern: ConfirmedPattern): number {
  const confidenceWeight = pattern.confidence === 'HIGH' ? 3 : pattern.confidence === 'MEDIUM' ? 2 : 1;
  const routePenalty = pattern.isOneToMany ? -0.2 : 0;
  const formulaPenalty = pattern.isFormulaTarget ? -0.3 : 0;
  return confidenceWeight + routePenalty + formulaPenalty;
}

function selectConfirmedPatternTarget(
  sourceField: Field,
  targetEntities: Entity[],
  targetFieldsByEntityId: Map<string, Field[]>,
  targetFields: Field[],
): { pattern: ConfirmedPattern; targetEntity: Entity; targetField: Field } | null {
  const patterns = CONFIRMED_PATTERNS[normalize(sourceField.name)];
  if (!patterns || patterns.length === 0) return null;

  const orderedPatterns = [...patterns].sort((left, right) => patternPriority(right) - patternPriority(left));

  for (const pattern of orderedPatterns) {
    const expectedEntityName = canonicalPatternObjectName(pattern.sfObject);
    const entityCandidates = targetEntities.filter((entity) => {
      const normalizedName = canonicalPatternObjectName(entity.name);
      const normalizedLabel = canonicalPatternObjectName(entity.label ?? '');
      return normalizedName === expectedEntityName || normalizedLabel === expectedEntityName;
    });

    const foundInEntity = findTargetFieldForPattern(pattern, entityCandidates.flatMap((entity) => {
      const fields = targetFieldsByEntityId.get(entity.id) ?? [];
      return fields.map((field) => ({ entity, field }));
    }));
    if (foundInEntity) return foundInEntity;
  }

  return findTargetFieldForPattern(orderedPatterns[0], targetFields.flatMap((field) => {
    const entity = targetEntities.find((candidate) => candidate.id === field.entityId);
    return entity ? [{ entity, field }] : [];
  }));
}

function findTargetFieldForPattern(
  pattern: ConfirmedPattern,
  candidates: Array<{ entity: Entity; field: Field }>,
): { pattern: ConfirmedPattern; targetEntity: Entity; targetField: Field } | null {
  for (const apiName of pattern.sfApiNames) {
    const normalizedApiName = normalize(apiName);
    const exact = candidates.find(({ field }) => normalize(field.name) === normalizedApiName);
    if (exact) {
      return { pattern, targetEntity: exact.entity, targetField: exact.field };
    }
  }

  for (const apiName of pattern.sfApiNames) {
    const normalizedApiName = normalize(apiName);
    const partial = candidates.find(({ field }) => {
      const normalizedField = normalize(field.name);
      return normalizedField.includes(normalizedApiName) || normalizedApiName.includes(normalizedField);
    });
    if (partial) {
      return { pattern, targetEntity: partial.entity, targetField: partial.field };
    }
  }

  return null;
}

function confirmedPatternConfidence(pattern: ConfirmedPattern): number {
  const base = pattern.confidence === 'HIGH' ? 0.96 : pattern.confidence === 'MEDIUM' ? 0.9 : 0.84;
  return clamp(base - (pattern.isFormulaTarget ? 0.18 : 0) - (pattern.isOneToMany ? 0.04 : 0));
}

function buildConfirmedPatternRationale(sourceField: Field, targetField: Field, pattern: ConfirmedPattern): string {
  const reasons = [
    `✅ Confirmed BOSL→FSC pattern: '${sourceField.name}' → '${targetField.name}' on ${pattern.sfObject} [${pattern.confidence}]. ${pattern.notes}`,
  ];

  if (pattern.isOneToMany) {
    reasons.push(
      `⚠️ One-to-Many field: '${sourceField.name}' maps to multiple Salesforce targets in the BOSL corpus. Human routing decision required — validate this specific target is correct for your lifecycle stage.`,
    );
  }
  if (pattern.isFormulaTarget) {
    reasons.push(
      `⚠️ Formula field target: '${targetField.name}' appears to be a calculated field — inbound writes will fail. Map the source fields that feed this formula instead.`,
    );
  }
  if (pattern.isPersonAccountOnly) {
    reasons.push(
      `ℹ️ Person Account field: '${targetField.name}' (__pc suffix) only exists on Person Account records — not available for business/organisation accounts.`,
    );
  }
  if (targetField.name.startsWith('FinServ__')) {
    reasons.push(`✓ FSC standard field: '${targetField.name}' is in the FinServ__ namespace — known FSC integration target.`);
  }

  const inferredType = inferTypeFromLosPrefix(sourceField.name);
  if (inferredType) {
    const compatible = inferredType === targetField.dataType
      || (inferredType === 'decimal' && (targetField.dataType === 'number' || targetField.dataType === 'integer'))
      || (inferredType === 'string' && targetField.dataType === 'text');
    reasons.push(
      compatible
        ? `✓ Type taxonomy: source prefix '${sourceField.name.split('_')[0]}' is type-compatible with SF field type '${targetField.dataType}'.`
        : `⚠️ Type mismatch: source prefix '${sourceField.name.split('_')[0]}' suggests '${inferredType}' while SF field type is '${targetField.dataType}'.`,
    );
  }

  return reasons.join(' | ');
}

function buildRiskClamEntityRationale(
  sourceEntityName: string,
  targetEntityName: string,
  confirmedPatternHits: number,
  heuristicHits: number,
): string {
  const segments = [`RiskClam/BOSL cross-entity matching for ${sourceEntityName} → ${targetEntityName}.`];
  if (confirmedPatternHits > 0) {
    segments.push(`${confirmedPatternHits} confirmed corpus match${confirmedPatternHits === 1 ? '' : 'es'}.`);
  }
  if (heuristicHits > 0) {
    segments.push(`${heuristicHits} supplemental heuristic match${heuristicHits === 1 ? '' : 'es'}.`);
  }
  return segments.join(' ');
}

function inferTypeFromLosPrefix(fieldName: string): Field['dataType'] | null {
  const upper = fieldName.toUpperCase();
  if (/^(AMT|PERC|PCT)_/.test(upper)) return 'decimal';
  if (/^NBR_/.test(upper)) return 'integer';
  if (/^(DT|DATE)_/.test(upper)) return 'date';
  if (/^(IND|YN|Y)_/.test(upper)) return 'boolean';
  if (/^(CD|TYP|CODE)_/.test(upper)) return 'picklist';
  if (/^EMAIL_/.test(upper)) return 'email';
  if (/^PHONE_/.test(upper)) return 'phone';
  return 'string';
}

const FSC_OBJECTS = new Set([
  'financialaccount',
  'accountparticipant',
  'partyprofile',
  'individualapplication',
  'financialgoal',
]);

const LOS_ENTITY_NAMES = new Set([
  'loan',
  'borrower',
  'coborrower',
  'collateral',
  'employment',
  'income',
  'declarations',
  'product',
  'signer',
  'group',
  'debts',
  'finstmt',
]);

const LOS_PARTY_ENTITY_NAMES = new Set(['borrower', 'coborrower', 'signer', 'group']);
const LOS_ACCOUNT_ENTITY_NAMES = new Set(['loan', 'product', 'collateral', 'debts', 'finstmt']);
const LOS_APPLICATION_ENTITY_NAMES = new Set(['employment', 'income', 'declarations']);

function fscEntityBoost(sourceEntityName: string, targetEntityName: string): number {
  // RiskClam / BOSL entities get their own entity-pairing boost table
  const rcBoost = riskClamToSfEntityBoost(sourceEntityName, targetEntityName);
  if (rcBoost > 0) return rcBoost;

  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);

  const isPartyEntity =
    src === 'cif' ||
    src.includes('customer') ||
    src.includes('member') ||
    src.includes('party') ||
    LOS_PARTY_ENTITY_NAMES.has(src);
  const isFinancialAccountEntity =
    src.includes('dda') ||
    src.includes('loan') ||
    src.includes('certificate') ||
    src.includes('lineofcredit') ||
    src.includes('share') ||
    src.includes('deposit') ||
    src.includes('account') ||
    LOS_ACCOUNT_ENTITY_NAMES.has(src);
  const isApplicationEntity = LOS_APPLICATION_ENTITY_NAMES.has(src);

  if (isPartyEntity && tgt === 'partyprofile') return 0.5;
  if (isPartyEntity && tgt === 'accountparticipant') return 0.18;
  if (isPartyEntity && (tgt === 'account' || tgt === 'contact')) return 0.1;

  if (isFinancialAccountEntity && tgt === 'financialaccount') return 0.55;
  if (isFinancialAccountEntity && tgt === 'individualapplication') return 0.22;
  if (isFinancialAccountEntity && tgt === 'accountparticipant') return 0.16;
  if (isFinancialAccountEntity && tgt === 'financialgoal') return 0.1;
  if (isFinancialAccountEntity && tgt === 'account') return 0.06;

  if (isApplicationEntity && tgt === 'individualapplication') return 0.4;
  if (isApplicationEntity && tgt === 'partyprofile') return 0.12;

  if (src.includes('gl') && src.includes('account') && tgt === 'financialaccount') return 0.25;

  return 0;
}

function isCoreToFscPair(sourceEntityName: string, targetEntityName: string): boolean {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);
  return CORE_ENTITY_NAMES.has(src) && FSC_OBJECTS.has(tgt);
}

function isLosToFscPair(sourceEntityName: string, targetEntityName: string): boolean {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);
  return LOS_ENTITY_NAMES.has(src) && FSC_OBJECTS.has(tgt);
}

function sameDomainEntityBoost(sourceEntityName: string, targetEntityName: string): number {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);

  if (LOS_ENTITY_NAMES.has(src) && LOS_ENTITY_NAMES.has(tgt)) return 0.12;
  if (CORE_ENTITY_NAMES.has(src) && CORE_ENTITY_NAMES.has(tgt)) return 0.12;
  return 0;
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

// ─── RiskClam (BOSL) entity → Salesforce FSC boost ────────────────────────────
const RISKCLAM_ENTITY_NAMES = new Set([
  'account',
  'financialaccount',
  'loan',
  'loanpackage',
  'partyliabilities',
  'partyinvolvedintransaction',
  'collateral',
  'fee',
  'branch',
  'riskclam',
]);

function _isRiskClamToSfPair(sourceEntityName: string, targetEntityName: string): boolean {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);
  return RISKCLAM_ENTITY_NAMES.has(src) && (FSC_OBJECTS.has(tgt) || tgt === 'account' || tgt === 'contact');
}

function riskClamToSfEntityBoost(sourceEntityName: string, targetEntityName: string): number {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);
  if (!RISKCLAM_ENTITY_NAMES.has(src)) return 0;

  if ((src === 'account' || src === 'riskclam') && (tgt === 'account' || tgt === 'contact')) return 0.50;
  if (src === 'financialaccount' && tgt === 'financialaccount') return 0.60;
  if (src === 'loan' && (tgt === 'financialaccount' || tgt === 'opportunity')) return 0.55;
  if (src === 'loanpackage' && tgt === 'individualapplication') return 0.50;
  if (src === 'partyliabilities' && tgt === 'financialaccount') return 0.45;
  if (src === 'partyinvolvedintransaction' && (tgt === 'account' || tgt === 'contact')) return 0.45;
  if (src === 'collateral' && tgt === 'financialaccount') return 0.48;
  return 0;
}

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

const LOS_TO_FSC_FIELD_PREFS: Record<string, string[]> = {
  approvedloan: ['loanamount', 'loanamountc', 'currentbalance'],
  loanamount: ['loanamount', 'loanamountc', 'currentbalance'],
  term: ['loanterm', 'loantermc', 'termmonths'],
  terminmos: ['loanterm', 'loantermc', 'termmonths'],
  termmos: ['loanterm', 'loantermc', 'termmonths'],
  grossmonthlyincome: ['grossmonthlyincome', 'grossincome'],
  grossincome: ['grossmonthlyincome', 'grossincome'],
  debtincome: ['debtoincomeratio', 'dti'],
  dti: ['debtoincomeratio', 'dti'],
  first: ['firstname', 'name'],
  last: ['lastname', 'name'],
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

function losToFscFieldBoost(
  sourceEntityName: string,
  targetEntityName: string,
  sourceFieldName: string,
  targetFieldName: string,
): number {
  if (!isLosToFscPair(sourceEntityName, targetEntityName)) return 0;

  const sourceSemantic = normalize(stripLosTypePrefix(sourceFieldName));
  const targetSemantic = normalize(targetFieldName);
  if (!sourceSemantic || !targetSemantic) return 0;

  for (const [sourceToken, preferredTargets] of Object.entries(LOS_TO_FSC_FIELD_PREFS)) {
    if (sourceSemantic === sourceToken || sourceSemantic.includes(sourceToken)) {
      if (preferredTargets.some((targetToken) => targetSemantic.includes(targetToken))) {
        return 0.24;
      }
    }
  }

  return 0;
}

function corpusFieldBoost(
  targetEntityName: string,
  sourceFieldName: string,
  targetFieldName: string,
): number {
  const patterns = CONFIRMED_PATTERNS[normalize(sourceFieldName)];
  if (!patterns || patterns.length === 0) return 0;

  const normalizedTargetEntity = canonicalPatternObjectName(targetEntityName);
  const normalizedTargetField = normalize(targetFieldName);

  for (const pattern of patterns) {
    const normalizedPatternObject = canonicalPatternObjectName(pattern.sfObject);
    const exactField = pattern.sfApiNames.some((apiName) => normalize(apiName) === normalizedTargetField);
    const partialField = pattern.sfApiNames.some((apiName) => {
      const normalizedApiName = normalize(apiName);
      return normalizedTargetField.includes(normalizedApiName) || normalizedApiName.includes(normalizedTargetField);
    });

    if (normalizedPatternObject === normalizedTargetEntity && exactField) return 0.52;
    if (normalizedPatternObject === normalizedTargetEntity && partialField) return 0.32;
    if (exactField) return 0.18;
  }

  return 0;
}

function domainFieldBoost(
  sourceEntityName: string,
  targetEntityName: string,
  sourceFieldName: string,
  targetFieldName: string,
): number {
  return coreToFscFieldBoost(sourceEntityName, targetEntityName, sourceFieldName, targetFieldName)
    + losToFscFieldBoost(sourceEntityName, targetEntityName, sourceFieldName, targetFieldName)
    + corpusFieldBoost(targetEntityName, sourceFieldName, targetFieldName);
}

function scoreTargetCandidate(
  sourceEntityName: string,
  targetEntityName: string,
  sourceField: Field,
  targetField: Field,
  sourceProfile: FieldSemanticProfile,
  targetProfile: FieldSemanticProfile,
  entityNamesById?: Map<string, string>,
): CandidateScore {
  const retrieved = scoreRetrievalCandidate(sourceField, targetField, { entityNamesById });
  const semanticScore = retrieved.semanticScore;
  const typeScore = retrieved.typeScore;
  const domainBoost = domainFieldBoost(
    sourceEntityName,
    targetEntityName,
    sourceField.name,
    targetField.name,
  );

  return {
    targetField,
    targetEntityName,
    base: addDomainBoost(retrieved.retrievalScore, sourceEntityName, targetEntityName, sourceField.name, targetField.name),
    lexicalScore: retrieved.lexicalScore,
    semanticScore,
    semanticMode: retrieved.semanticMode,
    typeScore,
    domainBoost,
    incompatible: retrieved.incompatible,
    sourceProfile,
  };
}

function addDomainBoost(
  retrievalScore: number,
  sourceEntityName: string,
  targetEntityName: string,
  sourceFieldName: string,
  targetFieldName: string,
): number {
  return clamp(retrievalScore + domainFieldBoost(
    sourceEntityName,
    targetEntityName,
    sourceFieldName,
    targetFieldName,
  ));
}

function buildCandidateRationale(candidate: CandidateScore): string {
  const segments = [
    `semantic ${candidate.semanticScore.toFixed(2)} (${candidate.semanticMode})`,
    `lexical ${candidate.lexicalScore.toFixed(2)}`,
    `type ${candidate.typeScore.toFixed(2)} (${candidate.sourceProfile.inferredType}→${candidate.targetField.dataType})`,
  ];

  if (candidate.domainBoost !== 0) {
    segments.push(`domain ${candidate.domainBoost.toFixed(2)}`);
  }
  if (candidate.semanticMode === 'concept' && candidate.semanticScore >= 0.6) {
    segments.push('concept-aligned');
  }
  if (candidate.incompatible) {
    segments.push('compatibility gate: borderline');
  }

  return segments.join(', ');
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

function stripLosTypePrefix(value: string): string {
  return value.replace(LOS_TYPE_PREFIX_RE, '');
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function isTransform(value: string): value is TransformType {
  return ['direct', 'concat', 'formatDate', 'lookup', 'static', 'regex', 'split', 'trim'].includes(value);
}
