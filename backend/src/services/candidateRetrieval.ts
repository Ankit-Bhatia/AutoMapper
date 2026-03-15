import type { Field } from '../types.js';
import type { ConnectorField } from '../../../packages/connectors/IConnector.js';
import {
  buildFieldSemanticProfile,
  hybridSemanticSimilarity,
  isHardIncompatible,
  semanticTypeScore,
} from './fieldSemantics.js';
import { fieldEmbeddingText, type EmbeddingCache, cosineSimilarity } from './EmbeddingService.js';
import { jaccard } from '../utils/stringSim.js';

export interface RetrievalCandidate {
  targetField: Field | ConnectorField;
  retrievalScore: number;
  lexicalScore: number;
  semanticScore: number;
  semanticMode: 'embed' | 'concept' | 'intent';
  conceptScore: number;
  intentScore: number;
  typeScore: number;
  complianceScore: number;
  canonicalScore: number;
  embeddingScore?: number;
  incompatible: boolean;
  evidence: string[];
}

export interface RetrievalResult {
  sourceFieldId: string;
  sourceFieldName: string;
  rankedCandidates: RetrievalCandidate[];
  topCandidates: RetrievalCandidate[];
}

export interface RetrievalOptions {
  embeddingCache?: EmbeddingCache;
  entityNamesById?: Map<string, string>;
  topK?: number;
}

const DEFAULT_TOP_K = 5;

function entityNameFor(field: Field | ConnectorField, entityNamesById?: Map<string, string>): string | undefined {
  return entityNamesById?.get(field.entityId);
}

function complianceIntersectionScore(source: Field | ConnectorField, target: Field | ConnectorField): number {
  const sourceTags = source.complianceTags ?? [];
  const targetTags = target.complianceTags ?? [];

  if (!sourceTags.length && !targetTags.length) return 0.7;
  if (!sourceTags.length || !targetTags.length) return 0.4;

  const sourceSet = new Set(sourceTags);
  const shared = targetTags.filter((tag) => sourceSet.has(tag));
  if (shared.length > 0) return 1;
  return 0.15;
}

function buildRetrievalEvidence(candidate: {
  semanticScore: number;
  semanticMode: 'embed' | 'concept' | 'intent';
  lexicalScore: number;
  typeScore: number;
  complianceScore: number;
  canonicalScore: number;
  embeddingScore?: number;
  incompatible: boolean;
}): string[] {
  const evidence: string[] = [];
  if (candidate.semanticScore >= 0.55) {
    evidence.push(`semantic ${candidate.semanticScore.toFixed(2)} (${candidate.semanticMode})`);
  }
  if (typeof candidate.embeddingScore === 'number' && candidate.semanticMode === 'embed') {
    evidence.push(`embedding ${candidate.embeddingScore.toFixed(2)}`);
  }
  if (candidate.lexicalScore >= 0.18) evidence.push(`lexical ${candidate.lexicalScore.toFixed(2)}`);
  if (candidate.typeScore >= 0.75) evidence.push(`type ${candidate.typeScore.toFixed(2)}`);
  if (candidate.complianceScore >= 0.8) evidence.push('compliance aligned');
  if (candidate.canonicalScore === 1) evidence.push('iso20022 match');
  if (candidate.incompatible) evidence.push('hard incompatibility gate');
  return evidence;
}

export function scoreRetrievalCandidate(
  sourceField: Field | ConnectorField,
  targetField: Field | ConnectorField,
  options: RetrievalOptions = {},
): RetrievalCandidate {
  const sourceProfile = buildFieldSemanticProfile(sourceField);
  const targetProfile = buildFieldSemanticProfile(targetField);
  const sourceContext = fieldEmbeddingText(sourceField, {
    entityName: entityNameFor(sourceField, options.entityNamesById),
  });
  const targetContext = fieldEmbeddingText(targetField, {
    entityName: entityNameFor(targetField, options.entityNamesById),
  });

  const lexicalScore = jaccard(sourceContext, targetContext);
  const typeScore = semanticTypeScore(sourceProfile, targetField.dataType);

  let embeddingScore: number | undefined;
  if (options.embeddingCache) {
    const srcVec = options.embeddingCache.get(sourceField.id);
    const tgtVec = options.embeddingCache.get(targetField.id);
    if (srcVec && tgtVec) {
      embeddingScore = cosineSimilarity(srcVec, tgtVec);
    }
  }

  const semanticBlend = hybridSemanticSimilarity(sourceProfile, targetProfile, embeddingScore);
  const complianceScore = complianceIntersectionScore(sourceField, targetField);
  const canonicalScore =
    sourceField.iso20022Name && targetField.iso20022Name && sourceField.iso20022Name === targetField.iso20022Name
      ? 1
      : 0;
  const incompatible = isHardIncompatible(sourceProfile, targetProfile);
  const sourceIsKey = Boolean(sourceField.isKey || sourceField.isExternalId);
  const targetIsUpsertKey = Boolean(targetField.isUpsertKey);
  const externalIdScore = (() => {
    if (sourceIsKey && targetIsUpsertKey) return 0.18;
    if (sourceIsKey && targetField.isExternalId) return 0.10;
    if (!sourceIsKey && targetIsUpsertKey) return -0.08;
    return 0;
  })();

  let retrievalScore =
    (0.34 * semanticBlend.score) +
    (0.24 * lexicalScore) +
    (0.14 * typeScore) +
    (0.10 * canonicalScore) +
    (0.10 * complianceScore) +
    externalIdScore;

  const strongSemanticAlignment =
    !incompatible
    && typeScore >= 0.75
    && (semanticBlend.conceptScore >= 0.60 || (semanticBlend.mode === 'embed' && semanticBlend.score >= 0.72));
  if (strongSemanticAlignment) {
    retrievalScore = Math.max(retrievalScore, semanticBlend.mode === 'embed' ? 0.78 : 0.64);
  }
  if (semanticBlend.score >= 0.8 && typeScore >= 0.75) {
    retrievalScore += 0.06;
  }
  if (incompatible) {
    retrievalScore -= 0.45;
  }

  const normalized = Math.max(0, Math.min(0.99, retrievalScore));
  const evidence = buildRetrievalEvidence({
    semanticScore: semanticBlend.score,
    semanticMode: semanticBlend.mode,
    lexicalScore,
    typeScore,
    complianceScore,
    canonicalScore,
    embeddingScore,
    incompatible,
  });
  if (strongSemanticAlignment) {
    evidence.push('strong concept alignment');
  }
  if (sourceIsKey && targetIsUpsertKey) {
    evidence.push('maps to SF upsert key');
  } else if (sourceIsKey && targetField.isExternalId) {
    evidence.push('maps to SF external ID field');
  } else if (!sourceIsKey && targetIsUpsertKey) {
    evidence.push('penalty: non-key source to upsert key');
  }

  return {
    targetField,
    retrievalScore: normalized,
    lexicalScore,
    semanticScore: semanticBlend.score,
    semanticMode: semanticBlend.mode,
    conceptScore: semanticBlend.conceptScore,
    intentScore: semanticBlend.intentScore,
    typeScore,
    complianceScore,
    canonicalScore,
    embeddingScore,
    incompatible,
    evidence,
  };
}

export function retrieveCandidatesForSource(
  sourceField: Field | ConnectorField,
  targetFields: Array<Field | ConnectorField>,
  options: RetrievalOptions = {},
): RetrievalResult {
  const rankedCandidates = targetFields
    .map((targetField) => scoreRetrievalCandidate(sourceField, targetField, options))
    .sort((left, right) => right.retrievalScore - left.retrievalScore);

  const topK = options.topK ?? DEFAULT_TOP_K;
  return {
    sourceFieldId: sourceField.id,
    sourceFieldName: sourceField.name,
    rankedCandidates,
    topCandidates: rankedCandidates.slice(0, topK),
  };
}

export function retrievalSummary(result: RetrievalResult, limit = 3): string {
  const top = result.topCandidates.slice(0, limit);
  if (top.length === 0) return 'retrieval top-0';
  return `retrieval top-${top.length}: ${top.map((candidate) => `${candidate.targetField.name}(${candidate.retrievalScore.toFixed(2)})`).join(', ')}`;
}

export function retrievalMetadata(result: RetrievalResult, limit = 3): Array<Record<string, unknown>> {
  return result.topCandidates.slice(0, limit).map((candidate) => ({
    targetFieldId: candidate.targetField.id,
    targetFieldName: candidate.targetField.name,
    retrievalScore: candidate.retrievalScore,
    semanticMode: candidate.semanticMode,
    evidence: candidate.evidence,
  }));
}
