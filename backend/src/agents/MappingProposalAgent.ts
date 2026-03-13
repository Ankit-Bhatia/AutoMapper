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
import { jaccard } from '../utils/stringSim.js';
import {
  buildFieldSemanticProfile,
  intentSimilarity,
  isHardIncompatible,
  semanticTypeScore,
} from '../services/fieldSemantics.js';

interface LLMProposal {
  sourceField: string;
  targetField: string;
  confidence: number;
  reasoning?: string;
}

interface RankedCandidate {
  targetField: Field | ConnectorField;
  score: number;
  reasons: string[];
}

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

function appendRationale(existing: string, detail: string): string {
  return existing ? `${existing} | ${detail}` : detail;
}

function appendRationaleOnce(existing: string, detail: string | null): string {
  if (!detail) return existing;
  return existing.includes(detail) ? existing : appendRationale(existing, detail);
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

function scoreTargetCandidate(
  sourceField: Field | ConnectorField,
  targetField: Field | ConnectorField,
): RankedCandidate {
  const sourceProfile = buildFieldSemanticProfile(sourceField);
  const targetProfile = buildFieldSemanticProfile(targetField);
  const sourceText = sourceProfile.text;
  const targetText = targetProfile.text;

  const nameScore = jaccard(sourceText, targetText);
  const typeScore = semanticTypeScore(sourceProfile, targetField.dataType);
  const semanticScore = intentSimilarity(sourceProfile, targetProfile);
  const complianceScore = complianceIntersectionScore(sourceField, targetField);
  const canonicalScore =
    sourceField.iso20022Name && targetField.iso20022Name && sourceField.iso20022Name === targetField.iso20022Name
      ? 1
      : 0;
  const incompatible = isHardIncompatible(sourceProfile, targetProfile);
  const typeWeight = sourceProfile.typeReliability >= 0.8 ? 0.16 : 0.08;

  const sourceTags = sourceField.complianceTags ?? [];
  const targetTags = targetField.complianceTags ?? [];
  const sourceGlba = sourceTags.includes('GLBA_NPI');
  const sourcePci = sourceTags.includes('PCI_CARD');
  const targetGlba = targetTags.includes('GLBA_NPI');
  const targetPci = targetTags.includes('PCI_CARD');

  const compliancePenalty =
    (sourceGlba && !targetGlba ? 0.16 : 0) +
    (sourcePci && !targetPci ? 0.22 : 0);
  const sourceIsKey = Boolean(sourceField.isKey || sourceField.isExternalId);
  const targetIsUpsertKey = Boolean((targetField as ConnectorField).isUpsertKey);
  const externalIdScore = (() => {
    if (sourceIsKey && targetIsUpsertKey) return 0.25;
    if (sourceIsKey && targetField.isExternalId) return 0.15;
    if (!sourceIsKey && targetIsUpsertKey) return -0.10;
    return 0;
  })();

  let score =
    (0.30 * semanticScore) +
    (0.22 * nameScore) +
    (typeWeight * typeScore) +
    (0.16 * canonicalScore) +
    (0.12 * complianceScore) +
    externalIdScore -
    compliancePenalty;

  if (canonicalScore === 1 && typeScore >= 0.75 && semanticScore >= 0.6) {
    score = Math.max(score, 0.8);
  }
  if (semanticScore >= 0.8 && typeScore >= 0.75) {
    score += 0.08;
  }
  if (incompatible) {
    score -= 0.45;
  }

  const reasons: string[] = [];
  if (semanticScore >= 0.6) reasons.push(`semantic ${semanticScore.toFixed(2)}`);
  if (nameScore >= 0.45) reasons.push(`name ${nameScore.toFixed(2)}`);
  if (typeScore >= 0.75) reasons.push(`type ${typeScore.toFixed(2)}`);
  if (canonicalScore === 1) reasons.push('iso20022 match');
  if (complianceScore >= 0.8) reasons.push('compliance aligned');
  if (sourceIsKey && targetIsUpsertKey) reasons.push('maps to SF upsert key — preferred for deduplication');
  else if (sourceIsKey && targetField.isExternalId) reasons.push('maps to SF external ID field');
  else if (!sourceIsKey && targetIsUpsertKey) reasons.push('penalty: non-key source to SF upsert key');
  if (compliancePenalty > 0) reasons.push('compliance mismatch penalty');
  if (incompatible) reasons.push('hard incompatibility gate');

  return {
    targetField,
    score: clamp01(score),
    reasons,
  };
}

function rankTargetsForSource(
  sourceField: Field | ConnectorField,
  targetFields: (Field | ConnectorField)[],
): RankedCandidate[] {
  return targetFields
    .map((targetField) => scoreTargetCandidate(sourceField, targetField))
    .sort((a, b) => b.score - a.score);
}

function isCandidateDecisive(best: RankedCandidate | undefined, second: RankedCandidate | undefined): boolean {
  if (!best) return false;
  const margin = best.score - (second?.score ?? 0);
  return best.score >= MIN_CONTEXT_AUTOPICK_SCORE && margin >= MIN_CONTEXT_MARGIN;
}

function buildContextHint(
  sourceField: Field | ConnectorField,
  candidates: RankedCandidate[],
): string | null {
  const top = candidates.slice(0, CONTEXT_HINT_CANDIDATES);
  if (!top.length) return null;
  const detail = top
    .map((candidate) => `${candidate.targetField.name}(${candidate.score.toFixed(2)})`)
    .join(', ');
  return `${sourceField.name}: ${detail}`;
}

function buildEntityMappingIndex(entityMappings: EntityMapping[]): Map<string, EntityMapping> {
  return new Map(entityMappings.map((mapping) => [mapping.id, mapping]));
}

function buildRecordTypeAnnotation(
  entityId: string,
  targetRecordTypes: AgentContext['targetRecordTypes'],
): string | null {
  const recordTypes = targetRecordTypes?.[entityId] ?? [];
  if (recordTypes.length === 0) return null;
  if (recordTypes.length === 1) {
    return `applicable to ${recordTypes[0]?.label ?? recordTypes[0]?.name} record type`;
  }
  const labels = recordTypes.map((recordType) => recordType.label).join(', ');
  return `check record type — entity has ${recordTypes.length} variants: ${labels}`;
}

function buildUpsertKeyRationale(
  sourceField: Field | ConnectorField,
  targetField: Field | ConnectorField,
): string | null {
  const sourceIsKey = Boolean(sourceField.isKey || sourceField.isExternalId);
  const targetIsUpsertKey = Boolean((targetField as ConnectorField).isUpsertKey);
  if (sourceIsKey && targetIsUpsertKey) return 'maps to SF upsert key — preferred for deduplication';
  if (sourceIsKey && targetField.isExternalId) return 'maps to SF external ID field';
  return null;
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
    const buildAnnotationForMapping = (mapping: FieldMapping): string | null => {
      const entityMapping = entityMappingById.get(mapping.entityMappingId);
      if (!entityMapping) return null;
      return buildRecordTypeAnnotation(entityMapping.targetEntityId, context.targetRecordTypes);
    };

    const targetFieldsByEntityId = new Map<string, (Field | ConnectorField)[]>();
    for (const targetEntity of targetEntities) {
      targetFieldsByEntityId.set(
        targetEntity.id,
        fields.filter((field) => field.entityId === targetEntity.id),
      );
    }

    const rankingByMappingId = new Map<string, RankedCandidate[]>();
    const contextHints: string[] = [];

    for (const mapping of fieldMappings) {
      const sourceField = fieldById(mapping.sourceFieldId, fields);
      const entityMapping = entityMappingById.get(mapping.entityMappingId);
      if (!sourceField || !entityMapping) continue;

      const targetFields = targetFieldsByEntityId.get(entityMapping.targetEntityId) ?? [];
      const ranked = rankTargetsForSource(sourceField, targetFields);
      if (!ranked.length) continue;

      rankingByMappingId.set(mapping.id, ranked);
      if (contextHints.length < CONTEXT_HINT_LIMIT) {
        const hint = buildContextHint(sourceField, ranked);
        if (hint) contextHints.push(hint);
      }
    }

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

    const updatedMappings = [...fieldMappings];
    let improved = 0;
    const steps: AgentStep[] = [];

    // Pass 1: deterministic context ranker.
    for (let index = 0; index < updatedMappings.length; index += 1) {
      const existing = updatedMappings[index];
      if (existing.status === 'accepted' || existing.status === 'rejected') continue;

      const ranked = rankingByMappingId.get(existing.id);
      if (!ranked || !ranked.length) continue;

      const best = ranked[0];
      const second = ranked[1];
      const current = ranked.find((candidate) => candidate.targetField.id === existing.targetFieldId);

      const shouldRetarget =
        isCandidateDecisive(best, second) &&
        best !== undefined &&
        best.targetField.id !== existing.targetFieldId &&
        (best.score >= existing.confidence + MIN_IMPROVEMENT_DELTA || existing.confidence < 0.62);

      if (shouldRetarget && best) {
        const sourceName = fieldById(existing.sourceFieldId, fields)?.name ?? existing.sourceFieldId;
        const step: Omit<AgentStep, 'agentName'> = {
          action: 'context_retarget',
          detail: `Context ranker selected ${best.targetField.name} for ${sourceName} (${best.score.toFixed(2)})`,
          fieldMappingId: existing.id,
          before: { targetFieldId: existing.targetFieldId, confidence: existing.confidence },
          after: { targetFieldId: best.targetField.id, confidence: best.score },
          durationMs: 0,
          metadata: { reasons: best.reasons },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings[index] = {
          ...existing,
          targetFieldId: best.targetField.id,
          confidence: Math.max(existing.confidence, best.score),
          rationale: appendRationaleOnce(
            appendRationale(existing.rationale, `context-ranker(${best.reasons.join(', ') || 'schema signal'})`),
            buildAnnotationForMapping({ ...existing, targetFieldId: best.targetField.id }),
          ),
        };

        improved += 1;
        continue;
      }

      const currentScore = current?.score ?? 0;
      if (currentScore >= existing.confidence + MIN_IMPROVEMENT_DELTA) {
        const sourceName = fieldById(existing.sourceFieldId, fields)?.name ?? existing.sourceFieldId;
        const step: Omit<AgentStep, 'agentName'> = {
          action: 'context_rescore',
          detail: `Context ranker improved confidence for ${sourceName} to ${currentScore.toFixed(2)}`,
          fieldMappingId: existing.id,
          before: { confidence: existing.confidence },
          after: { confidence: currentScore },
          durationMs: 0,
          metadata: { reasons: current?.reasons ?? [] },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings[index] = {
          ...existing,
          confidence: currentScore,
          rationale: appendRationaleOnce(
            appendRationale(existing.rationale, `context-ranker(${(current?.reasons ?? []).join(', ') || 'schema signal'})`),
            buildAnnotationForMapping(existing),
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

        const ranked = rankingByMappingId.get(existing.id) ?? [];
        const contextCandidate = ranked.find((candidate) => candidate.targetField.id === targetField.id);
        const contextScore = contextCandidate?.score ?? scoreTargetCandidate(sourceField, targetField).score;
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
          rationale: appendRationaleOnce(
            appendRationaleOnce(
              appendRationale(
                existing.rationale,
                proposal.reasoning ? `llm-gated(${proposal.reasoning})` : 'llm-gated suggestion',
              ),
              buildUpsertKeyRationale(sourceField, targetField),
            ),
            buildAnnotationForMapping({ ...existing, targetFieldId: targetField.id }),
          ),
        };

        improved += 1;
      }
    }

    let upsertKeyMappings = 0;
    let recordTypeAnnotations = 0;
    const finalizedMappings = updatedMappings.map((mapping) => {
      const sourceField = fieldById(mapping.sourceFieldId, fields);
      const targetField = fieldById(mapping.targetFieldId, fields);
      const recordTypeAnnotation = buildAnnotationForMapping(mapping);
      let rationale = mapping.rationale;

      if (sourceField && targetField) {
        rationale = appendRationaleOnce(rationale, buildUpsertKeyRationale(sourceField, targetField));
        if ((targetField as ConnectorField).isUpsertKey) {
          upsertKeyMappings += 1;
        }
      }

      if (recordTypeAnnotation) {
        rationale = appendRationaleOnce(rationale, recordTypeAnnotation);
        recordTypeAnnotations += 1;
      }

      return rationale === mapping.rationale
        ? mapping
        : { ...mapping, rationale };
    });

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'mapping_proposal_complete',
      detail: `${provider === 'heuristic' ? 'Context ranker' : 'LLM + context ranker'} applied — ${improved} mappings improved`,
      durationMs: Date.now() - start,
      metadata: {
        proposalCount: proposals.length,
        improved,
        provider,
        rankedMappings: rankingByMappingId.size,
        upsertKeyMappings,
        recordTypeAnnotations,
      },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return {
      agentName: this.name,
      updatedFieldMappings: finalizedMappings,
      steps,
      totalImproved: improved,
    };
  }
}
