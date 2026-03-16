/**
 * MappingProposalAgent — context-aware mapping proposal generation.
 *
 * Workflow:
 *   1. Build deterministic context scores from schema metadata
 *      (name similarity, type compatibility, compliance tags, ISO20022 match)
 *   2. In heuristic mode (no provider), apply context ranker directly
 *   3. If LLM provider exists, request proposals and gate them through context scores
 *   4. Emit explicit step-level audit events for every rescore/retarget action
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { Field, EntityMapping, FieldMapping } from '../types.js';
import type { ConnectorField } from '../../../packages/connectors/IConnector.js';
import { countRedactedFields } from './llm/PIIGuard.js';
import { activeProvider } from './llm/LLMGateway.js';
import {
  DEFAULT_RETRIEVAL_TOP_K,
  retrieveCandidatesForSource,
  retrievalSummary,
  type RetrievalResult,
} from '../services/candidateRetrieval.js';
import {
  buildRerankerPayload,
  runStructuredReranker,
} from '../services/structuredReranker.js';
import { runMappingOptimizer } from '../services/mappingOptimizer.js';
import { isActiveFieldMapping } from '../utils/mappingStatus.js';

const RETRIEVAL_TOP_K = DEFAULT_RETRIEVAL_TOP_K;
const MIN_CONTEXT_AUTOPICK_SCORE = 0.68;
const MIN_CONTEXT_MARGIN = 0.08;
const MIN_IMPROVEMENT_DELTA = 0.05;
const MIN_RERANKER_CONFIDENCE = 0.55;
const RERANKER_TIMEOUT_MS = 2_500;
const RERANKER_MAX_OUTPUT_TOKENS = 256;

function clamp01(score: number): number {
  return Math.max(0, Math.min(0.99, score));
}

function appendRationale(existing: string | undefined, detail: string): string {
  return existing ? `${existing} | ${detail}` : detail;
}

function appendRationaleOnce(existing: string | undefined, detail: string | null): string {
  const current = existing ?? '';
  if (!detail) return current;
  return current.includes(detail) ? current : appendRationale(current, detail);
}

function fieldById(id: string, fields: (Field | ConnectorField)[]): Field | ConnectorField | undefined {
  return fields.find((field) => field.id === id);
}

function isCandidateDecisive(
  best: RetrievalResult['rankedCandidates'][number] | undefined,
  second: RetrievalResult['rankedCandidates'][number] | undefined,
): boolean {
  if (!best) return false;
  const margin = best.retrievalScore - (second?.retrievalScore ?? 0);
  return best.retrievalScore >= MIN_CONTEXT_AUTOPICK_SCORE && margin >= MIN_CONTEXT_MARGIN;
}

function buildEntityMappingIndex(entityMappings: EntityMapping[]): Map<string, EntityMapping> {
  return new Map(entityMappings.map((mapping) => [mapping.id, mapping]));
}
function buildEntityFieldIndex(
  entityIds: string[],
  fields: (Field | ConnectorField)[],
): Map<string, (Field | ConnectorField)[]> {
  const set = new Set(entityIds);
  const index = new Map<string, (Field | ConnectorField)[]>();
  for (const field of fields) {
    if (!set.has(field.entityId)) continue;
    const bucket = index.get(field.entityId) ?? [];
    bucket.push(field);
    index.set(field.entityId, bucket);
  }
  return index;
}

function requiredTargetCoverageCount(
  targetFields: (Field | ConnectorField)[],
  mappings: FieldMapping[],
): number {
  const requiredTargetIds = new Set(
    targetFields
      .filter((field) => field.required || field.isKey)
      .map((field) => field.id),
  );
  return new Set(
    mappings
      .filter((mapping) => isActiveFieldMapping(mapping) && requiredTargetIds.has(mapping.targetFieldId))
      .map((mapping) => mapping.targetFieldId),
  ).size;
}

function siblingFieldsFor(
  sourceField: Field | ConnectorField,
  sourceFieldsByEntityId: Map<string, (Field | ConnectorField)[]>,
): Array<{ field: Field | ConnectorField; relation: 'before' | 'after'; offset: number }> {
  const fields = sourceFieldsByEntityId.get(sourceField.entityId) ?? [];
  const index = fields.findIndex((field) => field.id === sourceField.id);
  if (index < 0) return [];

  const siblings: Array<{ field: Field | ConnectorField; relation: 'before' | 'after'; offset: number }> = [];
  for (let offset = 2; offset >= 1; offset -= 1) {
    const sibling = fields[index - offset];
    if (sibling) siblings.push({ field: sibling, relation: 'before', offset });
  }
  for (let offset = 1; offset <= 2; offset += 1) {
    const sibling = fields[index + offset];
    if (sibling) siblings.push({ field: sibling, relation: 'after', offset });
  }
  return siblings;
}

function shouldUseReranker(
  retrieval: RetrievalResult,
  existingTargetFieldId: string,
): boolean {
  if (retrieval.shortlist.candidates.length < 2) return false;

  const best = retrieval.rankedCandidates[0];
  const second = retrieval.rankedCandidates[1];
  if (!best) return false;

  return (
    !isCandidateDecisive(best, second)
    || best.targetField.id !== existingTargetFieldId
    || best.semanticMode === 'intent'
  );
}

export class MappingProposalAgent extends AgentBase {
  readonly name = 'MappingProposalAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, sourceEntities, targetEntities, entityMappings } = context;

    const provider = activeProvider();
    const redactedCount = countRedactedFields(fields);
    this.info(
      context,
      'pii_guard',
      `PIIGuard: ${redactedCount} PII/PCI fields will be redacted before LLM transmission`,
      { redactedCount, provider },
    );

    const entityMappingById = buildEntityMappingIndex(entityMappings);

    const entityNamesById = new Map<string, string>();
    for (const targetEntity of targetEntities) entityNamesById.set(targetEntity.id, targetEntity.name);
    for (const sourceEntity of sourceEntities) {
      entityNamesById.set(sourceEntity.id, sourceEntity.name);
    }

    const targetFieldsByEntityId = buildEntityFieldIndex(
      targetEntities.map((entity) => entity.id),
      fields,
    );
    const sourceFieldsByEntityId = buildEntityFieldIndex(
      sourceEntities.map((entity) => entity.id),
      fields,
    );

    const rankingByMappingId = new Map<string, RetrievalResult>();

    for (const mapping of fieldMappings) {
      const sourceField = fieldById(mapping.sourceFieldId, fields);
      const entityMapping = entityMappingById.get(mapping.entityMappingId);
      if (!sourceField || !entityMapping) continue;

      const targetFields = targetFieldsByEntityId.get(entityMapping.targetEntityId) ?? [];
      const retrieval = retrieveCandidatesForSource(sourceField, targetFields, {
        embeddingCache: context.embeddingCache,
        entityNamesById,
        topK: RETRIEVAL_TOP_K,
      });
      if (!retrieval.rankedCandidates.length) continue;

      rankingByMappingId.set(mapping.id, retrieval);
    }

    this.info(
      context,
      'retrieval_ready',
      `Built top-${RETRIEVAL_TOP_K} candidate shortlists for ${rankingByMappingId.size} source fields`,
      {
        shortlistsBuilt: rankingByMappingId.size,
        topK: RETRIEVAL_TOP_K,
      },
    );

    if (provider === 'heuristic') {
      this.info(
        context,
        'context_mode',
        'No LLM provider configured — applying context ranker (schema + compliance + canonical signals)',
        { rankedMappings: rankingByMappingId.size },
      );
    }

    const updatedMappings = fieldMappings.map((mapping) => {
      const retrieval = rankingByMappingId.get(mapping.id);
      if (!retrieval) return mapping;
      return {
        ...mapping,
        retrievalShortlist: retrieval.shortlist,
        rationale: appendRationaleOnce(mapping.rationale, retrievalSummary(retrieval)),
      };
    });
    let improved = 0;
    let reranked = 0;
    const steps: AgentStep[] = [];

    // Pass 1: deterministic context ranker.
    for (let index = 0; index < updatedMappings.length; index += 1) {
      const existing = updatedMappings[index];
      if (existing.status === 'accepted' || existing.status === 'rejected') continue;

      const retrieval = rankingByMappingId.get(existing.id);
      if (!retrieval || !retrieval.rankedCandidates.length) continue;

      const best = retrieval.rankedCandidates[0];
      const second = retrieval.rankedCandidates[1];
      const current = retrieval.rankedCandidates.find((candidate) => candidate.targetField.id === existing.targetFieldId);

      const shouldRetarget =
        isCandidateDecisive(best, second) &&
        best !== undefined &&
        best.targetField.id !== existing.targetFieldId &&
        (best.retrievalScore >= existing.confidence + MIN_IMPROVEMENT_DELTA || existing.confidence < 0.62);

      if (shouldRetarget && best) {
        const sourceName = fieldById(existing.sourceFieldId, fields)?.name ?? existing.sourceFieldId;
        const step: Omit<AgentStep, 'agentName'> = {
          action: 'retrieval_retarget',
          detail: `Retrieval layer selected ${best.targetField.name} for ${sourceName} (${best.retrievalScore.toFixed(2)})`,
          fieldMappingId: existing.id,
          before: { targetFieldId: existing.targetFieldId, confidence: existing.confidence },
          after: { targetFieldId: best.targetField.id, confidence: best.retrievalScore },
          durationMs: 0,
          metadata: { reasons: best.evidence },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings[index] = {
          ...existing,
          targetFieldId: best.targetField.id,
          confidence: Math.max(existing.confidence, best.retrievalScore),
          retrievalShortlist: retrieval.shortlist,
          rationale: appendRationaleOnce(
            existing.rationale,
            `retrieval-ranker(${best.evidence.join(', ') || 'schema signal'})`,
          ),
        };

        improved += 1;
        continue;
      }

      const currentScore = current?.retrievalScore ?? 0;
      if (currentScore >= existing.confidence + MIN_IMPROVEMENT_DELTA) {
        const sourceName = fieldById(existing.sourceFieldId, fields)?.name ?? existing.sourceFieldId;
        const step: Omit<AgentStep, 'agentName'> = {
          action: 'retrieval_rescore',
          detail: `Retrieval layer improved confidence for ${sourceName} to ${currentScore.toFixed(2)}`,
          fieldMappingId: existing.id,
          before: { confidence: existing.confidence },
          after: { confidence: currentScore },
          durationMs: 0,
          metadata: { reasons: current?.evidence ?? [] },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings[index] = {
          ...existing,
          confidence: currentScore,
          retrievalShortlist: retrieval.shortlist,
          rationale: appendRationaleOnce(
            existing.rationale,
            `retrieval-ranker(${(current?.evidence ?? []).join(', ') || 'schema signal'})`,
          ),
        };

        improved += 1;
      }
    }

    // Pass 2: shortlist-only structured reranker.
    if (provider !== 'heuristic') {
      for (let index = 0; index < updatedMappings.length; index += 1) {
        const existing = updatedMappings[index];
        if (existing.status === 'accepted' || existing.status === 'rejected') continue;

        const retrieval = rankingByMappingId.get(existing.id);
        if (!retrieval || !shouldUseReranker(retrieval, existing.targetFieldId)) continue;

        const sourceField = fieldById(existing.sourceFieldId, fields);
        const entityMapping = entityMappingById.get(existing.entityMappingId);
        if (!sourceField || !entityMapping) continue;

        const candidateFields = retrieval.shortlist.candidates
          .map((candidate) => fieldById(candidate.targetFieldId, fields))
          .filter((candidate): candidate is Field | ConnectorField => Boolean(candidate));
        if (candidateFields.length < 2) continue;

        const payload = buildRerankerPayload({
          sourceField,
          siblingFields: siblingFieldsFor(sourceField, sourceFieldsByEntityId),
          candidateFields,
          shortlist: retrieval.shortlist,
          currentTargetFieldId: existing.targetFieldId,
          sourceSystemType: context.sourceSystemType,
          targetSystemType: context.targetSystemType,
          sourceEntityName: entityNamesById.get(entityMapping.sourceEntityId) ?? entityMapping.sourceEntityId,
          targetEntityName: entityNamesById.get(entityMapping.targetEntityId) ?? entityMapping.targetEntityId,
          entityConfidence: entityMapping.confidence,
        });

        try {
          const rerankResult = await runStructuredReranker(payload, {
            timeoutMs: RERANKER_TIMEOUT_MS,
            retries: 1,
            maxOutputTokens: RERANKER_MAX_OUTPUT_TOKENS,
          });
          if (!rerankResult) continue;

          const { decision, provider: rerankerProvider } = rerankResult;
          if (!decision || decision.confidence < MIN_RERANKER_CONFIDENCE) continue;

          const selectedTargetField = fieldById(decision.selectedTargetFieldId, fields);
          const selectedCandidate = retrieval.rankedCandidates.find(
            (candidate) => candidate.targetField.id === decision.selectedTargetFieldId,
          );
          if (!selectedTargetField || !selectedCandidate) continue;

          const combinedConfidence = clamp01((0.65 * decision.confidence) + (0.35 * selectedCandidate.retrievalScore));
          const changesTarget = existing.targetFieldId !== selectedTargetField.id;
          const improvesConfidence = combinedConfidence >= existing.confidence + MIN_IMPROVEMENT_DELTA;
          const nextConfidence = changesTarget ? combinedConfidence : Math.max(existing.confidence, combinedConfidence);
          const step: Omit<AgentStep, 'agentName'> = {
            action: 'reranker_complete',
            detail: `Structured reranker selected ${selectedTargetField.name} for ${sourceField.name} (${decision.confidence.toFixed(2)})`,
            fieldMappingId: existing.id,
            before: { targetFieldId: existing.targetFieldId, confidence: existing.confidence },
            after: { targetFieldId: selectedTargetField.id, confidence: nextConfidence },
            durationMs: 0,
            metadata: {
              provider: rerankerProvider,
              candidateCount: payload.candidates.length,
              top1Confidence: decision.confidence,
              evidenceSignals: decision.evidenceSignals,
              reasoning: decision.reasoning,
            },
          };
          this.emit(context, step);
          steps.push({ agentName: this.name, ...step });

          updatedMappings[index] = {
            ...existing,
            targetFieldId: selectedTargetField.id,
            confidence: nextConfidence,
            retrievalShortlist: retrieval.shortlist,
            rerankerDecision: decision,
            rationale: appendRationaleOnce(
              existing.rationale,
              `reranker(${decision.evidenceSignals.join(', ') || 'retrieval'}${decision.reasoning ? `: ${decision.reasoning}` : ''})`,
            ),
          };

          reranked += 1;
          if (changesTarget || improvesConfidence) {
            improved += 1;
          }
        } catch (error) {
          this.info(
            context,
            'reranker_error',
            `Structured reranker failed for ${sourceField.name}: ${String(error)} — keeping retrieval result`,
            { fieldMappingId: existing.id, provider },
          );
        }
      }
    }

    const optimizerInput = updatedMappings.map((mapping) => ({ ...mapping }));
    const targetFieldUniverse = fields.filter((field) => targetEntities.some((entity) => entity.id === field.entityId));
    const sourceFieldsById = new Map(
      fields
        .filter((field) => sourceEntities.some((entity) => entity.id === field.entityId))
        .map((field) => [field.id, field] as const),
    );
    const requiredCoverageBefore = requiredTargetCoverageCount(targetFieldUniverse, optimizerInput);
    const optimizedMappings = runMappingOptimizer(optimizerInput, targetFieldUniverse, {
      sourceFieldsById,
    });
    const requiredCoverageAfter = requiredTargetCoverageCount(targetFieldUniverse, optimizedMappings);
    const optimizerImproved = optimizedMappings.filter((mapping, index) => {
      const before = optimizerInput[index];
      return before
        && (
          before.targetFieldId !== mapping.targetFieldId
          || before.status !== mapping.status
          || before.lowConfidenceFallback !== mapping.lowConfidenceFallback
        );
    }).length;
    const optimizerMetadata = {
      duplicatesResolved: optimizedMappings.filter((mapping) => mapping.optimizerDisplacement?.reason === 'duplicate_displaced').length,
      unmatchedFromDuplicates: optimizedMappings.filter(
        (mapping) => mapping.optimizerDisplacement?.reason === 'duplicate_displaced' && mapping.status === 'unmatched',
      ).length,
      hardBanViolationsRemoved: optimizedMappings.filter((mapping) => mapping.optimizerDisplacement?.reason === 'hard_ban').length,
      typeIncompatibleRemoved: optimizedMappings.filter((mapping) => mapping.optimizerDisplacement?.reason === 'type_incompatible').length,
      lookupOutOfScopeRemoved: optimizedMappings.filter((mapping) => mapping.optimizerDisplacement?.reason === 'lookup_out_of_scope').length,
      requiredFieldsCovered: Math.max(0, requiredCoverageAfter - requiredCoverageBefore),
      requiredFieldsUncovered: Math.max(
        0,
        targetFieldUniverse.filter((field) => field.required || field.isKey).length - requiredCoverageAfter,
      ),
      aiFailbackFlagged: optimizedMappings.filter((mapping) => mapping.lowConfidenceFallback).length,
    };
    const optimizerStep: Omit<AgentStep, 'agentName'> = {
      action: 'optimizer_complete',
      detail: `Global optimizer resolved ${optimizerMetadata.duplicatesResolved} duplicate targets and left ${optimizerMetadata.requiredFieldsUncovered} required targets uncovered`,
      durationMs: 0,
      metadata: optimizerMetadata,
    };
    this.emit(context, optimizerStep);
    steps.push({ agentName: this.name, ...optimizerStep });

    for (let index = 0; index < optimizedMappings.length; index += 1) {
      updatedMappings[index] = optimizedMappings[index];
    }
    improved += optimizerImproved;

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'mapping_proposal_complete',
      detail: `${provider === 'heuristic' ? 'Context ranker + optimizer' : 'Context ranker + shortlist reranker + optimizer'} applied — ${improved} mappings improved`,
      durationMs: Date.now() - start,
      metadata: {
        improved,
        reranked,
        provider,
        shortlistsBuilt: rankingByMappingId.size,
        topK: RETRIEVAL_TOP_K,
        ...optimizerMetadata,
      },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return {
      agentName: this.name,
      updatedFieldMappings: updatedMappings,
      steps,
      totalImproved: improved,
    };
  }
}
