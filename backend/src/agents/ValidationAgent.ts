/**
 * ValidationAgent — validates field mappings for type compatibility and coverage.
 *
 * Checks performed:
 *   - Type compatibility (string→date, decimal→picklist, etc.)
 *   - Required target fields are covered
 *   - Picklist value alignment (values in source must exist in target)
 *   - Confidence threshold — mappings below 0.4 flagged as unresolved
 *   - Duplicate target field assignments
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { Field, FieldMapping } from '../types.js';
import type { ConnectorField } from '../connectors/IConnector.js';

const TYPE_COMPAT: Record<string, string[]> = {
  string:  ['string', 'text', 'textarea', 'picklist', 'email', 'phone', 'url'],
  text:    ['text', 'textarea', 'string'],
  integer: ['integer', 'decimal', 'string'],
  decimal: ['decimal', 'integer', 'string', 'percent', 'currency'],
  boolean: ['boolean', 'string', 'picklist'],
  date:    ['date', 'datetime', 'string'],
  datetime:['datetime', 'date', 'string'],
  email:   ['email', 'string'],
  phone:   ['phone', 'string'],
  url:     ['url', 'string'],
  picklist:['picklist', 'string', 'text'],
  percent: ['percent', 'decimal', 'integer', 'string'],
  currency:['currency', 'decimal', 'integer', 'string'],
};

function isTypeCompatible(srcType: string, tgtType: string): boolean {
  const allowed = TYPE_COMPAT[srcType.toLowerCase()] ?? [srcType.toLowerCase()];
  return allowed.includes(tgtType.toLowerCase());
}

function fieldById(id: string, fields: (Field | ConnectorField)[]): Field | ConnectorField | undefined {
  return fields.find((f) => f.id === id);
}

export class ValidationAgent extends AgentBase {
  readonly name = 'ValidationAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, targetEntities } = context;

    this.info(context, 'start', `Validating ${fieldMappings.length} field mappings...`);

    const steps: AgentStep[] = [];
    const updatedMappings: FieldMapping[] = [];
    let errorCount = 0;
    let warningCount = 0;

    // Track which target fields are covered
    const coveredTargetFields = new Set<string>();
    // Track duplicate target assignments
    const targetFieldUsage = new Map<string, string[]>(); // targetFieldId → [fieldMappingId]

    for (const mapping of fieldMappings) {
      if (!mapping.sourceFieldId || !mapping.targetFieldId) {
        updatedMappings.push(mapping);
        continue;
      }

      const srcField = fieldById(mapping.sourceFieldId, fields);
      const tgtField = fieldById(mapping.targetFieldId, fields);

      if (!srcField || !tgtField) {
        updatedMappings.push(mapping);
        continue;
      }

      coveredTargetFields.add(tgtField.id);

      // Track usage for duplicate detection
      const usages = targetFieldUsage.get(tgtField.id) ?? [];
      usages.push(mapping.id);
      targetFieldUsage.set(tgtField.id, usages);

      // Check: Type compatibility
      let newStatus = mapping.status;
      if (!isTypeCompatible(srcField.dataType, tgtField.dataType)) {
        errorCount++;
        const step: Omit<AgentStep, 'agentName'> = {
          action: 'validation_type_error',
          detail: `Type mismatch: ${srcField.name} (${srcField.dataType}) → ${tgtField.name} (${tgtField.dataType}) — incompatible types`,
          fieldMappingId: mapping.id,
          before: { status: mapping.status },
          after: { status: 'rejected' },
          durationMs: 0,
          metadata: { srcType: srcField.dataType, tgtType: tgtField.dataType },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });
        newStatus = 'rejected';
      }

      // Check: Picklist value alignment
      const srcCF = srcField as ConnectorField;
      const tgtCF = tgtField as ConnectorField;
      if (
        srcField.dataType === 'picklist' &&
        tgtField.dataType === 'picklist' &&
        srcCF.picklistValues?.length &&
        tgtCF.picklistValues?.length
      ) {
        const srcVals = new Set(srcCF.picklistValues?.map((v) => v.toLowerCase()) ?? []);
        const tgtVals = new Set(tgtCF.picklistValues?.map((v) => v.toLowerCase()) ?? []);
        const missingInTarget = [...srcVals].filter((v) => !tgtVals.has(v));

        if (missingInTarget.length > 0) {
          warningCount++;
          const step: Omit<AgentStep, 'agentName'> = {
            action: 'validation_picklist_gap',
            detail: `Picklist gap: ${missingInTarget.length} values in "${srcField.name}" have no match in "${tgtField.name}": [${missingInTarget.slice(0, 3).join(', ')}${missingInTarget.length > 3 ? '...' : ''}]`,
            fieldMappingId: mapping.id,
            durationMs: 0,
            metadata: { missingValues: missingInTarget },
          };
          this.emit(context, step);
          steps.push({ agentName: this.name, ...step });
        }
      }

      // Check: Low confidence warning
      if (mapping.confidence < 0.4 && mapping.status === 'suggested') {
        warningCount++;
        const step: Omit<AgentStep, 'agentName'> = {
          action: 'validation_low_confidence',
          detail: `Low confidence (${mapping.confidence.toFixed(2)}) for ${srcField.name} → ${tgtField.name} — manual review recommended`,
          fieldMappingId: mapping.id,
          durationMs: 0,
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });
      }

      updatedMappings.push({ ...mapping, status: newStatus });
    }

    // Check: Required target fields that are not covered
    const allTargetFields = fields.filter((f) =>
      targetEntities.some((e) => e.id === f.entityId),
    );
    const uncoveredRequired = allTargetFields.filter(
      (f) => f.required && !coveredTargetFields.has(f.id),
    );
    if (uncoveredRequired.length > 0) {
      warningCount++;
      const step: Omit<AgentStep, 'agentName'> = {
        action: 'validation_missing_required',
        detail: `${uncoveredRequired.length} required target field(s) have no mapping: [${uncoveredRequired.slice(0, 3).map((f) => f.name).join(', ')}${uncoveredRequired.length > 3 ? '...' : ''}]`,
        durationMs: 0,
        metadata: { fields: uncoveredRequired.map((f) => f.name) },
      };
      this.emit(context, step);
      steps.push({ agentName: this.name, ...step });
    }

    // Check: Duplicate target field assignments
    for (const [tgtId, mappingIds] of targetFieldUsage) {
      if (mappingIds.length > 1) {
        const tgt = fieldById(tgtId, fields);
        warningCount++;
        const step: Omit<AgentStep, 'agentName'> = {
          action: 'validation_duplicate_target',
          detail: `Target field "${tgt?.name ?? tgtId}" is assigned by ${mappingIds.length} different source fields — only one will take effect`,
          durationMs: 0,
          metadata: { mappingIds },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });
      }
    }

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'validation_complete',
      detail: `Validation complete: ${fieldMappings.length} mappings, ${errorCount} errors, ${warningCount} warnings, ${uncoveredRequired.length} required fields unmapped`,
      durationMs: Date.now() - start,
      metadata: {
        totalMappings: fieldMappings.length,
        errors: errorCount,
        warnings: warningCount,
        uncoveredRequired: uncoveredRequired.length,
      },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return {
      agentName: this.name,
      updatedFieldMappings: updatedMappings,
      steps,
      totalImproved: 0,
      metadata: summary.metadata,
    };
  }
}
