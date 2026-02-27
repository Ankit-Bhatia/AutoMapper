/**
 * MappingProposalAgent — LLM-assisted mapping generation with PII guard.
 *
 * Workflow:
 *   1. Build PII-safe schema descriptions using PIIGuard
 *   2. Call LLMGateway.llmComplete() with a structured prompt
 *   3. Parse the JSON response into mapping proposals
 *   4. Apply proposals to low-confidence or unmapped fields
 *   5. Fall back to heuristic (no-op) if no LLM provider available
 *
 * All external LLM calls go through PIIGuard — GLBA_NPI and PCI_CARD
 * field names are replaced with placeholders before transmission.
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { Field, FieldMapping, EntityMapping } from '../types.js';
import type { ConnectorField } from '../connectors/IConnector.js';
import {
  buildSafeSchemaDescription,
  countRedactedFields,
} from './llm/PIIGuard.js';
import { llmComplete, activeProvider, buildMappingPrompt } from './llm/LLMGateway.js';

interface LLMProposal {
  sourceField: string;
  targetField: string;
  confidence: number;
  reasoning?: string;
}

const MIN_CONFIDENCE_THRESHOLD = 0.55;

function fieldById(id: string, fields: (Field | ConnectorField)[]): Field | ConnectorField | undefined {
  return fields.find((f) => f.id === id);
}

function fieldByName(name: string, entityId: string, fields: (Field | ConnectorField)[]): Field | ConnectorField | undefined {
  return fields.find((f) => f.name === name && f.entityId === entityId);
}

export class MappingProposalAgent extends AgentBase {
  readonly name = 'MappingProposalAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, sourceEntities, targetEntities, entityMappings } = context;

    const provider = activeProvider();
    if (provider === 'heuristic') {
      this.info(
        context,
        'skip',
        'No LLM provider configured (OPENAI_API_KEY / ANTHROPIC_API_KEY) — MappingProposalAgent running in heuristic mode (no-op)',
      );
      return this.noOp(fieldMappings);
    }

    const redactedCount = countRedactedFields(fields);
    this.info(
      context,
      'pii_guard',
      `PIIGuard: ${redactedCount} PII/PCI fields will be redacted before LLM transmission`,
      { redactedCount, provider },
    );

    // Build safe schema descriptions (PII stripped)
    const srcDesc = buildSafeSchemaDescription(sourceEntities, fields.filter((f) =>
      sourceEntities.some((e) => e.id === f.entityId),
    ));
    const tgtDesc = buildSafeSchemaDescription(targetEntities, fields.filter((f) =>
      targetEntities.some((e) => e.id === f.entityId),
    ));

    // Build hints from already-confirmed high-confidence mappings
    const hints: string[] = fieldMappings
      .filter((m) => m.confidence >= 0.85 && m.sourceFieldId && m.targetFieldId)
      .slice(0, 5)
      .map((m) => {
        const src = fieldById(m.sourceFieldId!, fields)?.name ?? '?';
        const tgt = fieldById(m.targetFieldId!, fields)?.name ?? '?';
        return `${src} → ${tgt} (${m.confidence.toFixed(2)})`;
      });

    const messages = buildMappingPrompt(srcDesc, tgtDesc, hints);

    this.info(context, 'llm_call', `Sending PII-safe schema to ${provider}...`);

    let proposals: LLMProposal[] = [];
    try {
      const response = await llmComplete(messages);
      if (!response) {
        return this.noOp(fieldMappings);
      }

      // Parse JSON array from response
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
    } catch (err) {
      this.info(context, 'llm_error', `LLM call failed: ${String(err)} — falling back to heuristic`);
      return this.noOp(fieldMappings);
    }

    // Apply LLM proposals to low-confidence mappings
    const updatedMappings = [...fieldMappings];
    let improved = 0;
    const steps: AgentStep[] = [];

    for (const proposal of proposals) {
      if (proposal.confidence < MIN_CONFIDENCE_THRESHOLD) continue;

      // Find the entity mapping context
      for (const em of entityMappings) {
        const srcField = fieldByName(proposal.sourceField, em.sourceEntityId, fields);
        const tgtField = fieldByName(proposal.targetField, em.targetEntityId, fields);
        if (!srcField || !tgtField) continue;

        // Find existing mapping for this source field
        const existingIdx = updatedMappings.findIndex(
          (m) => m.entityMappingId === em.id && m.sourceFieldId === srcField.id,
        );

        if (existingIdx >= 0) {
          const existing = updatedMappings[existingIdx];
          // Only update if LLM proposal is higher confidence
          if (proposal.confidence > existing.confidence) {
            const step: Omit<AgentStep, 'agentName'> = {
              action: 'llm_rescore',
              detail: `LLM proposed ${proposal.sourceField} → ${proposal.targetField} (${proposal.confidence.toFixed(2)}): ${proposal.reasoning ?? ''}`,
              fieldMappingId: existing.id,
              before: { confidence: existing.confidence },
              after: { confidence: proposal.confidence },
              durationMs: 0,
              metadata: { provider, reasoning: proposal.reasoning },
            };
            this.emit(context, step);
            steps.push({ agentName: this.name, ...step });

            updatedMappings[existingIdx] = { ...existing, confidence: proposal.confidence };
            improved++;
          }
        }
      }
    }

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'mapping_proposal_complete',
      detail: `LLM-assisted proposals applied — ${improved} mappings improved via ${provider}`,
      durationMs: Date.now() - start,
      metadata: { proposalCount: proposals.length, improved, provider },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return { agentName: this.name, updatedFieldMappings: updatedMappings, steps, totalImproved: improved };
  }
}
