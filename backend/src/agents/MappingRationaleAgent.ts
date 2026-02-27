/**
 * MappingRationaleAgent — generates human-readable explanations for field mappings.
 *
 * Responsibilities:
 *   - For each field mapping with confidence >= 0.3, generate a detailed rationale
 *   - Combine rule-based rationale (compliance tags, naming, types) with LLM explanation
 *   - Store rationale metadata in the FieldMapping's rationale field
 *   - Emit steps for each mapping enriched with explanatory text
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { ConnectorField, ComplianceTag } from '../connectors/IConnector.js';
import type { Field, FieldMapping } from '../types.js';
import * as LLMGateway from './llm/LLMGateway.js';

// ─── Helper functions ──────────────────────────────────────────────────────

function getComplianceTags(field: Field | ConnectorField): ComplianceTag[] {
  return (field as ConnectorField).complianceTags ?? [];
}

function hasTag(field: Field | ConnectorField, tag: ComplianceTag): boolean {
  return getComplianceTags(field).includes(tag);
}

function fieldById(
  id: string,
  fields: (Field | ConnectorField)[],
): Field | ConnectorField | undefined {
  return fields.find((f) => f.id === id);
}

function getIso20022Name(field: Field | ConnectorField): string | undefined {
  return (field as ConnectorField).iso20022Name;
}

/**
 * Calculate name token overlap between two field names.
 * Returns a score 0–1 based on shared tokens (case-insensitive).
 */
function calculateNameSimilarity(name1: string, name2: string): number {
  const tokens1 = name1.toLowerCase().split(/[\s_\-]+/).filter(Boolean);
  const tokens2 = name2.toLowerCase().split(/[\s_\-]+/).filter(Boolean);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const commonTokens = tokens1.filter((t) => tokens2.includes(t)).length;
  const uniqueTokens = new Set([...tokens1, ...tokens2]).size;

  return commonTokens / uniqueTokens;
}

/**
 * Build rule-based rationale from field metadata, compliance tags, naming, and types.
 */
function buildRuleBasedRationale(
  srcField: Field | ConnectorField,
  tgtField: Field | ConnectorField,
): string {
  const rationales: string[] = [];

  // ─── Compliance tag matching ───────────────────────────────────────────

  const srcTags = getComplianceTags(srcField);
  const tgtTags = getComplianceTags(tgtField);

  if (
    srcTags.includes('GLBA_NPI') &&
    tgtTags.includes('GLBA_NPI')
  ) {
    rationales.push(
      'Both fields carry GLBA Non-Public Personal Information classification — mapping preserves privacy controls across systems.',
    );
  }

  if (srcTags.includes('SOX_FINANCIAL')) {
    rationales.push(
      'Source field is SOX-controlled. Target field must be included in SOX change-control audit documentation.',
    );
  }

  if (srcTags.includes('PCI_CARD')) {
    rationales.push(
      'Source field is PCI-governed card data. Ensure target is a tokenized or encrypted field.',
    );
  }

  // ─── ISO 20022 canonical name match ────────────────────────────────────

  const srcIso = getIso20022Name(srcField);
  const tgtIso = getIso20022Name(tgtField);

  if (srcIso && tgtIso && srcIso === tgtIso) {
    rationales.push(
      `Both fields share ISO 20022 canonical name '${srcIso}' confirming semantic equivalence under the international payment standard.`,
    );
  }

  // ─── Name similarity ────────────────────────────────────────────────────

  const nameSimilarity = calculateNameSimilarity(srcField.name, tgtField.name);
  if (nameSimilarity > 0.6) {
    rationales.push(
      'Field names share common terminology suggesting the same business concept in both systems.',
    );
  }

  // ─── Data type compatibility ──────────────────────────────────────────

  if (srcField.dataType === tgtField.dataType) {
    rationales.push(
      `Compatible data types (${srcField.dataType}) require no transformation.`,
    );
  } else {
    rationales.push(
      `Type conversion needed: ${srcField.dataType} → ${tgtField.dataType}. Validate precision/truncation before go-live.`,
    );
  }

  return rationales.join(' ');
}

/**
 * Call LLM to generate a short 1-sentence explanation if a provider is available.
 */
async function generateLLMRationale(
  srcEntity: string,
  srcField: Field | ConnectorField,
  tgtEntity: string,
  tgtField: Field | ConnectorField,
  ruleBasedRationale: string,
): Promise<string | null> {
  // Check if a provider is active (not heuristic mode)
  if (LLMGateway.activeProvider() === 'heuristic') {
    return null;
  }

  try {
    const prompt = `In one sentence, explain why ${srcEntity}.${srcField.name} (from source system) maps to ${tgtEntity}.${tgtField.name} (from target system). Context: ${ruleBasedRationale}`;

    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a financial systems integration expert. Provide concise, one-sentence explanations for field mappings.',
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    const response = await LLMGateway.llmComplete(messages);
    if (response && response.content) {
      return response.content.trim();
    }
  } catch (err) {
    // Silently fall back if LLM fails
    console.error('LLM rationale generation failed:', err);
  }

  return null;
}

// ─── Agent implementation ──────────────────────────────────────────────────

export class MappingRationaleAgent extends AgentBase {
  readonly name = 'MappingRationaleAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, sourceEntities, targetEntities } = context;

    this.info(context, 'start', 'Generating human-readable rationales for field mappings...');

    const updatedFieldMappings = [...fieldMappings];
    const steps: Omit<AgentStep, 'agentName'>[] = [];
    let totalImproved = 0;

    for (const mapping of updatedFieldMappings) {
      // Skip mappings with low confidence
      if (mapping.confidence < 0.3) {
        continue;
      }

      // Skip if no source/target field
      if (!mapping.sourceFieldId || !mapping.targetFieldId) {
        continue;
      }

      const srcField = fieldById(mapping.sourceFieldId, fields);
      const tgtField = fieldById(mapping.targetFieldId, fields);

      if (!srcField || !tgtField) {
        continue;
      }

      // Find the source and target entities for context
      const srcEntity = sourceEntities.find((e) => e.id === srcField.entityId);
      const tgtEntity = targetEntities.find((e) => e.id === tgtField.entityId);

      if (!srcEntity || !tgtEntity) {
        continue;
      }

      // Generate rule-based rationale
      const ruleBasedRationale = buildRuleBasedRationale(srcField, tgtField);

      // Try to append LLM rationale if provider is available
      let finalRationale = ruleBasedRationale;
      const llmRationale = await generateLLMRationale(
        srcEntity.name,
        srcField,
        tgtEntity.name,
        tgtField,
        ruleBasedRationale,
      );

      if (llmRationale) {
        finalRationale = `${ruleBasedRationale} (LLM insight: ${llmRationale})`;
      }

      // Update the mapping with the rationale
      mapping.rationale = finalRationale;

      // Emit a step documenting this enrichment
      const stepStart = Date.now();
      steps.push({
        action: 'rationale_generated',
        detail: `Generated rationale for ${srcField.name} → ${tgtField.name}`,
        fieldMappingId: mapping.id,
        durationMs: Date.now() - stepStart,
        metadata: {
          rationaleLength: finalRationale.length,
          hasLLMInsight: !!llmRationale,
        },
      });
      this.emit(context, steps[steps.length - 1]);

      totalImproved++;
    }

    const mainStep: Omit<AgentStep, 'agentName'> = {
      action: 'rationale_generation_complete',
      detail: `Generated rationales for ${totalImproved} field mappings`,
      durationMs: Date.now() - start,
      metadata: { rationalesGenerated: totalImproved },
    };

    steps.push(mainStep);
    this.emit(context, mainStep);

    return {
      agentName: this.name,
      updatedFieldMappings,
      steps: steps.map((s) => ({ agentName: this.name, ...s })),
      totalImproved,
    };
  }
}
