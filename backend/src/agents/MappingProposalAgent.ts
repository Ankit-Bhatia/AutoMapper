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
import type { Field, EntityMapping } from '../types.js';
import type { ConnectorField } from '../../../packages/connectors/IConnector.js';
import {
  buildSafeSchemaDescription,
  countRedactedFields,
} from './llm/PIIGuard.js';
import { llmComplete, activeProvider, buildMappingPrompt } from './llm/LLMGateway.js';
import {
  DEFAULT_RETRIEVAL_TOP_K,
  retrieveCandidatesForSource,
  retrievalSummary,
  type RetrievalResult,
} from '../services/candidateRetrieval.js';

interface LLMProposal {
  sourceField: string;
  targetField: string;
  confidence: number;
  reasoning?: string;
}

const RETRIEVAL_TOP_K = DEFAULT_RETRIEVAL_TOP_K;
const MIN_CONTEXT_AUTOPICK_SCORE = 0.68;
const MIN_CONTEXT_MARGIN = 0.08;
const MIN_LLM_CONFIDENCE = 0.72;
const MIN_LLM_CONTEXT_SCORE = 0.35;
const MIN_IMPROVEMENT_DELTA = 0.05;
const CONTEXT_HINT_LIMIT = 16;
const CONTEXT_HINT_CANDIDATES = 2;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

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

function fieldByName(name: string, entityId: string, fields: (Field | ConnectorField)[]): Field | ConnectorField | undefined {
  const exact = fields.find((field) => field.name === name && field.entityId === entityId);
  if (exact) return exact;
  const normalized = normalize(name);
  return fields.find((field) => field.entityId === entityId && normalize(field.name) === normalized);
}

function isCandidateDecisive(
  best: RetrievalResult['rankedCandidates'][number] | undefined,
  second: RetrievalResult['rankedCandidates'][number] | undefined,
): boolean {
  if (!best) return false;
  const margin = best.retrievalScore - (second?.retrievalScore ?? 0);
  return best.retrievalScore >= MIN_CONTEXT_AUTOPICK_SCORE && margin >= MIN_CONTEXT_MARGIN;
}

function buildContextHint(
  sourceField: Field | ConnectorField,
  retrieval: RetrievalResult,
): string | null {
  const top = retrieval.shortlist.candidates.slice(0, CONTEXT_HINT_CANDIDATES);
  if (!top.length) return null;
  const detail = top
    .map((candidate) => `${candidate.targetFieldName}(${candidate.retrievalScore.toFixed(2)})`)
    .join(', ');
  return `${sourceField.name}: ${detail}`;
}

function buildEntityMappingIndex(entityMappings: EntityMapping[]): Map<string, EntityMapping> {
  return new Map(entityMappings.map((mapping) => [mapping.id, mapping]));
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

    const targetFieldsByEntityId = new Map<string, (Field | ConnectorField)[]>();
    const entityNamesById = new Map<string, string>();
    for (const targetEntity of targetEntities) {
      entityNamesById.set(targetEntity.id, targetEntity.name);
      targetFieldsByEntityId.set(
        targetEntity.id,
        fields.filter((field) => field.entityId === targetEntity.id),
      );
    }
    for (const sourceEntity of sourceEntities) {
      entityNamesById.set(sourceEntity.id, sourceEntity.name);
    }

    const rankingByMappingId = new Map<string, RetrievalResult>();
    const contextHints: string[] = [];

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
      if (contextHints.length < CONTEXT_HINT_LIMIT) {
        const hint = buildContextHint(sourceField, retrieval);
        if (hint) contextHints.push(hint);
      }
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

    // Build safe schema descriptions (PII stripped)
    const srcDesc = buildSafeSchemaDescription(sourceEntities, fields.filter((field) =>
      sourceEntities.some((entity) => entity.id === field.entityId),
    ));
    const tgtDesc = buildSafeSchemaDescription(targetEntities, fields.filter((field) =>
      targetEntities.some((entity) => entity.id === field.entityId),
    ));

    const highConfidenceHints: string[] = fieldMappings
      .filter((mapping) => mapping.confidence >= 0.85)
      .slice(0, 5)
      .map((mapping) => {
        const sourceName = fieldById(mapping.sourceFieldId, fields)?.name ?? '?';
        const targetName = fieldById(mapping.targetFieldId, fields)?.name ?? '?';
        return `${sourceName} → ${targetName} (${mapping.confidence.toFixed(2)})`;
      });

    let proposals: LLMProposal[] = [];
    if (provider !== 'heuristic') {
      const messages = buildMappingPrompt(
        srcDesc,
        tgtDesc,
        [...highConfidenceHints, ...contextHints].slice(0, 32),
      );

      this.info(context, 'llm_call', `Sending PII-safe schema to ${provider}...`);

      try {
        const response = await llmComplete(messages);
        if (response) {
          const jsonMatch = response.content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as unknown;
            if (Array.isArray(parsed)) {
              proposals = parsed as LLMProposal[];
            }
          }

          this.info(
            context,
            'llm_response',
            `Received ${proposals.length} mapping proposals from ${response.provider} (${response.tokensUsed ?? '?'} tokens)`,
            { provider: response.provider, tokensUsed: response.tokensUsed },
          );
        }
      } catch (error) {
        this.info(context, 'llm_error', `LLM call failed: ${String(error)} — using context ranker only`);
      }
    } else {
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

    // Pass 2: LLM suggestions gated by context quality.
    for (const proposal of proposals) {
      if (proposal.confidence < MIN_LLM_CONFIDENCE) continue;

      for (const entityMapping of entityMappings) {
        const sourceField = fieldByName(proposal.sourceField, entityMapping.sourceEntityId, fields);
        const targetField = fieldByName(proposal.targetField, entityMapping.targetEntityId, fields);
        if (!sourceField || !targetField) continue;

        const existingIndex = updatedMappings.findIndex(
          (mapping) => mapping.entityMappingId === entityMapping.id && mapping.sourceFieldId === sourceField.id,
        );
        if (existingIndex < 0) continue;

        const existing = updatedMappings[existingIndex];
        if (existing.status === 'accepted' || existing.status === 'rejected') continue;

        const retrieval = rankingByMappingId.get(existing.id);
        const contextCandidate = retrieval?.rankedCandidates.find((candidate) => candidate.targetField.id === targetField.id);
        const contextScore = contextCandidate?.retrievalScore
          ?? retrieveCandidatesForSource(sourceField, [targetField], {
            embeddingCache: context.embeddingCache,
            entityNamesById,
            topK: 1,
          }).rankedCandidates[0]?.retrievalScore
          ?? 0;
        if (contextScore < MIN_LLM_CONTEXT_SCORE) continue;

        const mergedConfidence = clamp01((0.6 * proposal.confidence) + (0.4 * contextScore));
        const changesTarget = existing.targetFieldId !== targetField.id;
        const improvesConfidence = mergedConfidence >= existing.confidence + MIN_IMPROVEMENT_DELTA;
        if (!changesTarget && !improvesConfidence) continue;

        const stepAction = changesTarget ? 'llm_retarget' : 'llm_rescore';
        const step: Omit<AgentStep, 'agentName'> = {
          action: stepAction,
          detail: `LLM proposed ${proposal.sourceField} → ${proposal.targetField} (${proposal.confidence.toFixed(2)}), gated score ${mergedConfidence.toFixed(2)}`,
          fieldMappingId: existing.id,
          before: { targetFieldId: existing.targetFieldId, confidence: existing.confidence },
          after: { targetFieldId: targetField.id, confidence: mergedConfidence },
          durationMs: 0,
          metadata: {
            provider,
            reasoning: proposal.reasoning,
            llmConfidence: proposal.confidence,
            contextScore,
          },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings[existingIndex] = {
          ...existing,
          targetFieldId: targetField.id,
          confidence: Math.max(existing.confidence, mergedConfidence),
          retrievalShortlist: retrieval?.shortlist ?? existing.retrievalShortlist,
          rationale: appendRationaleOnce(
            existing.rationale,
            proposal.reasoning ? `llm-gated(${proposal.reasoning})` : 'llm-gated suggestion',
          ),
        };

        improved += 1;
      }
    }

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'mapping_proposal_complete',
      detail: `${provider === 'heuristic' ? 'Context ranker' : 'LLM + context ranker'} applied — ${improved} mappings improved`,
      durationMs: Date.now() - start,
      metadata: {
        proposalCount: proposals.length,
        improved,
        provider,
        shortlistsBuilt: rankingByMappingId.size,
        topK: RETRIEVAL_TOP_K,
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
