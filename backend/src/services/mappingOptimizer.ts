import type { ConnectorField } from '../../../packages/connectors/IConnector.js';
import { FORMULA_FIELD_TARGETS, SYSTEM_AUDIT_FIELDS } from '../agents/schemaIntelligenceData.js';
import type {
  Field,
  FieldMapping,
  OptimizerDisplacement,
  RetrievalShortlistCandidate,
} from '../types.js';
import { typeCompatibilityScore } from '../utils/typeUtils.js';

const REQUIRED_FIELD_PROMOTION_THRESHOLD = 0.30;
const LOW_CONFIDENCE_FALLBACK_THRESHOLD = 0.30;

type FieldLike = Field | ConnectorField;
type OptimizerReason = NonNullable<FieldMapping['optimizerDisplacement']>['reason'];

interface RelationshipScopeLike {
  isInScope(referenceTo: string, scopedEntityIds: string[]): boolean;
}

export interface MappingOptimizerOptions {
  sourceFieldsById?: Map<string, FieldLike>;
  relationshipGraph?: RelationshipScopeLike;
  scopedEntityIds?: string[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAiFallback(mapping: FieldMapping): boolean {
  const rationale = mapping.rationale.toLowerCase();
  return rationale.includes('ai_fallback') || rationale.includes('ai fallback');
}

function isHardBanTarget(field: FieldLike): boolean {
  const normalizedName = normalize(field.name);
  return Boolean(
    field.isFormula
    || field.isSystemField
    || field.isAutoNumber
    || FORMULA_FIELD_TARGETS.has(normalizedName)
    || SYSTEM_AUDIT_FIELDS.has(normalizedName)
    || normalizedName.includes('autonumber'),
  );
}

function isTypeCompatible(sourceField: FieldLike | undefined, targetField: FieldLike): boolean {
  if (!sourceField) return true;
  return typeCompatibilityScore(sourceField.dataType, targetField.dataType) >= 0.6;
}

function isLookupOutOfScope(
  targetField: FieldLike,
  opts?: MappingOptimizerOptions,
): boolean {
  // TODO(KAN-90): wire the concrete RelationshipGraph type once it lands on main.
  if (!opts?.relationshipGraph || !opts.scopedEntityIds?.length || !targetField.referenceTo?.length) {
    return false;
  }

  return targetField.referenceTo.some(
    (referenceTo) => !opts.relationshipGraph?.isInScope(referenceTo, opts.scopedEntityIds ?? []),
  );
}

function firstRetrievalScore(mapping: FieldMapping): number {
  return mapping.retrievalShortlist?.candidates[0]?.retrievalScore ?? 0;
}

function cloneDisplacement(
  existing: OptimizerDisplacement | undefined,
  patch: Partial<OptimizerDisplacement>,
): OptimizerDisplacement {
  return {
    originalTargetFieldId: patch.originalTargetFieldId ?? existing?.originalTargetFieldId ?? '',
    reason: patch.reason ?? existing?.reason ?? 'duplicate_displaced',
    finalAssignment: patch.finalAssignment ?? existing?.finalAssignment ?? null,
  };
}

function applyFallbackFlag(mapping: FieldMapping): FieldMapping {
  if (!isAiFallback(mapping) || firstRetrievalScore(mapping) >= LOW_CONFIDENCE_FALLBACK_THRESHOLD) {
    return mapping;
  }

  return {
    ...mapping,
    lowConfidenceFallback: true,
  };
}

function validateCandidate(
  sourceField: FieldLike | undefined,
  candidateTarget: FieldLike,
  candidateId: string,
  claimedTargetIds: Set<string>,
  opts?: MappingOptimizerOptions,
): { valid: boolean; reason?: OptimizerReason } {
  if (claimedTargetIds.has(candidateId)) {
    return { valid: false };
  }

  if (isHardBanTarget(candidateTarget)) {
    return { valid: false, reason: 'hard_ban' };
  }

  if (!isTypeCompatible(sourceField, candidateTarget)) {
    return { valid: false, reason: 'type_incompatible' };
  }

  if (isLookupOutOfScope(candidateTarget, opts)) {
    return { valid: false, reason: 'lookup_out_of_scope' };
  }

  return { valid: true };
}

function findReplacementCandidate(
  mapping: FieldMapping,
  sourceField: FieldLike | undefined,
  targetFieldsById: Map<string, FieldLike>,
  claimedTargetIds: Set<string>,
  opts?: MappingOptimizerOptions,
): RetrievalShortlistCandidate | null {
  const candidates = mapping.retrievalShortlist?.candidates ?? [];
  for (const candidate of candidates) {
    if (candidate.targetFieldId === mapping.targetFieldId) continue;
    const targetField = targetFieldsById.get(candidate.targetFieldId);
    if (!targetField) continue;

    const validation = validateCandidate(sourceField, targetField, candidate.targetFieldId, claimedTargetIds, opts);
    if (validation.valid) return candidate;
  }
  return null;
}

function reassignMapping(
  mapping: FieldMapping,
  replacement: RetrievalShortlistCandidate | null,
  reason: OptimizerReason,
): FieldMapping {
  const originalTargetFieldId = mapping.optimizerDisplacement?.originalTargetFieldId ?? mapping.targetFieldId;

  if (!replacement) {
    return {
      ...mapping,
      status: 'unmatched',
      confidence: 0,
      optimizerDisplacement: cloneDisplacement(mapping.optimizerDisplacement, {
        originalTargetFieldId,
        reason,
        finalAssignment: null,
      }),
    };
  }

  return {
    ...mapping,
    status: mapping.status === 'accepted' ? 'modified' : 'suggested',
    targetFieldId: replacement.targetFieldId,
    confidence: Math.min(mapping.confidence, replacement.retrievalScore),
    optimizerDisplacement: cloneDisplacement(mapping.optimizerDisplacement, {
      originalTargetFieldId,
      reason,
      finalAssignment: replacement.targetFieldId,
    }),
    lowConfidenceFallback: mapping.lowConfidenceFallback,
  };
}

function isCoveredRequiredTarget(mappings: FieldMapping[], targetFieldId: string): boolean {
  return mappings.some((mapping) => mapping.status !== 'rejected' && mapping.status !== 'unmatched' && mapping.targetFieldId === targetFieldId);
}

export function runMappingOptimizer(
  proposals: FieldMapping[],
  targetFields: FieldLike[],
  opts?: MappingOptimizerOptions,
): FieldMapping[] {
  const targetFieldsById = new Map(targetFields.map((field) => [field.id, field] as const));
  const sourceFieldsById = opts?.sourceFieldsById ?? new Map<string, FieldLike>();
  const current = proposals.map((proposal) => applyFallbackFlag({ ...proposal }));

  // Pass 1: validity sweep.
  for (let index = 0; index < current.length; index += 1) {
    const mapping = current[index];
    if (mapping.status === 'rejected') continue;

    const sourceField = sourceFieldsById.get(mapping.sourceFieldId);
    const targetField = targetFieldsById.get(mapping.targetFieldId);
    if (!targetField) {
      current[index] = {
        ...mapping,
        status: 'unmatched',
        confidence: 0,
        optimizerDisplacement: cloneDisplacement(mapping.optimizerDisplacement, {
          originalTargetFieldId: mapping.targetFieldId,
          reason: 'type_incompatible',
          finalAssignment: null,
        }),
      };
      continue;
    }

    let invalidReason: OptimizerReason | null = null;
    if (isHardBanTarget(targetField)) {
      invalidReason = 'hard_ban';
    } else if (!isTypeCompatible(sourceField, targetField)) {
      invalidReason = 'type_incompatible';
    } else if (isLookupOutOfScope(targetField, opts)) {
      invalidReason = 'lookup_out_of_scope';
    }

    if (!invalidReason) continue;

    const replacement = findReplacementCandidate(mapping, sourceField, targetFieldsById, new Set(), opts);
    current[index] = reassignMapping(mapping, replacement, invalidReason);
  }

  // Pass 2: duplicate target resolution.
  const activeMappings = current.filter((mapping) => mapping.status !== 'rejected' && mapping.status !== 'unmatched');
  const targetClaims = new Map<string, FieldMapping[]>();
  for (const mapping of activeMappings) {
    const bucket = targetClaims.get(mapping.targetFieldId) ?? [];
    bucket.push(mapping);
    targetClaims.set(mapping.targetFieldId, bucket);
  }

  for (const [targetFieldId, claimants] of targetClaims) {
    if (claimants.length <= 1) continue;

    claimants.sort((left, right) => right.confidence - left.confidence);
    const winner = claimants[0];
    const claimedTargetIds = new Set(
      current
        .filter((mapping) => mapping.status !== 'rejected' && mapping.status !== 'unmatched')
        .map((mapping) => mapping.targetFieldId),
    );
    claimedTargetIds.delete(targetFieldId);

    for (const claimant of claimants.slice(1)) {
      const mappingIndex = current.findIndex((mapping) => mapping.id === claimant.id);
      if (mappingIndex < 0) continue;
      const sourceField = sourceFieldsById.get(claimant.sourceFieldId);
      const replacement = findReplacementCandidate(claimant, sourceField, targetFieldsById, claimedTargetIds, opts);
      const next = reassignMapping(claimant, replacement, 'duplicate_displaced');
      current[mappingIndex] = next;
      if (next.status !== 'unmatched') {
        claimedTargetIds.add(next.targetFieldId);
      }
    }

    const winnerIndex = current.findIndex((mapping) => mapping.id === winner.id);
    if (winnerIndex >= 0) current[winnerIndex] = winner;
  }

  // Pass 3: required coverage.
  const requiredTargets = targetFields.filter((field) => field.required || field.isKey);
  for (const requiredTarget of requiredTargets) {
    if (isCoveredRequiredTarget(current, requiredTarget.id)) continue;

    const unmatchedCandidates = current
      .map((mapping, index) => ({ mapping, index }))
      .filter(({ mapping }) => mapping.status === 'unmatched')
      .map(({ mapping, index }) => {
        const candidate = mapping.retrievalShortlist?.candidates.find(
          (entry) => entry.targetFieldId === requiredTarget.id && entry.retrievalScore >= REQUIRED_FIELD_PROMOTION_THRESHOLD,
        );
        if (!candidate) return null;
        const sourceField = sourceFieldsById.get(mapping.sourceFieldId);
        const validation = validateCandidate(sourceField, requiredTarget, requiredTarget.id, new Set(), opts);
        if (!validation.valid) return null;
        return { index, mapping, candidate };
      })
      .filter((entry): entry is { index: number; mapping: FieldMapping; candidate: RetrievalShortlistCandidate } => Boolean(entry))
      .sort((left, right) => right.candidate.retrievalScore - left.candidate.retrievalScore);

    const best = unmatchedCandidates[0];
    if (!best) continue;

    current[best.index] = {
      ...best.mapping,
      status: 'suggested',
      targetFieldId: requiredTarget.id,
      confidence: Math.max(best.candidate.retrievalScore, 0.30),
      optimizerDisplacement: best.mapping.optimizerDisplacement
        ? {
            ...best.mapping.optimizerDisplacement,
            finalAssignment: requiredTarget.id,
          }
        : undefined,
    };
  }

  return current;
}
