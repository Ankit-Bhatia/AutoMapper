/**
 * ComplianceAgent — validates regulatory tagging and flags compliance risks.
 *
 * Responsibilities:
 *   - Verify GLBA_NPI fields are only mapped to secure/encrypted targets
 *   - Flag PCI_CARD fields that map to non-PCI-scoped targets
 *   - Detect BSA_AML fields that require audit trail preservation
 *   - Warn when SOX_FINANCIAL fields map across system boundaries without reconciliation
 *   - Produce a ComplianceReport summarizing all issues
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep, ComplianceIssue, ComplianceReport } from './types.js';
import type { ConnectorField, ComplianceTag } from '../connectors/IConnector.js';
import type { Field, FieldMapping } from '../types.js';

const PCI_SECURE_TARGET_PATTERNS = /encrypted|vault|token|pci/i;
const AUDIT_REQUIRING_TAGS: ComplianceTag[] = ['BSA_AML', 'FFIEC_AUDIT'];

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

export class ComplianceAgent extends AgentBase {
  readonly name = 'ComplianceAgent';

  /** The compliance report produced by the last run */
  public lastReport: ComplianceReport | null = null;

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings } = context;

    this.info(context, 'start', 'Scanning field mappings for compliance risks...');

    const issues: ComplianceIssue[] = [];
    let piiCount = 0;
    let pciCount = 0;
    let soxCount = 0;

    for (const mapping of fieldMappings) {
      if (!mapping.sourceFieldId || !mapping.targetFieldId) continue;

      const srcField = fieldById(mapping.sourceFieldId, fields);
      const tgtField = fieldById(mapping.targetFieldId, fields);
      if (!srcField) continue;

      const srcTags = getComplianceTags(srcField);

      // Count compliance-tagged fields
      if (srcTags.includes('GLBA_NPI')) piiCount++;
      if (srcTags.includes('PCI_CARD')) pciCount++;
      if (srcTags.includes('SOX_FINANCIAL')) soxCount++;

      // Rule: GLBA_NPI fields must have a compliance note or the mapping must be reviewed
      if (hasTag(srcField, 'GLBA_NPI')) {
        const note = (srcField as ConnectorField).complianceNote;
        if (!note) {
          issues.push({
            severity: 'warning',
            rule: 'GLBA_NPI_MISSING_NOTE',
            message: `Field "${srcField.name}" is tagged GLBA_NPI but has no compliance note explaining handling requirements`,
            fieldMappingId: mapping.id,
            sourceFieldName: srcField.name,
            targetFieldName: tgtField?.name,
            complianceTags: srcTags,
          });
        }
      }

      // Rule: PCI_CARD fields must map to targets with secure naming
      if (hasTag(srcField, 'PCI_CARD') && tgtField) {
        if (!PCI_SECURE_TARGET_PATTERNS.test(tgtField.name)) {
          issues.push({
            severity: 'error',
            rule: 'PCI_CARD_INSECURE_TARGET',
            message: `PCI-governed field "${srcField.name}" maps to "${tgtField.name}" which does not appear to be a PCI-scoped or tokenised field`,
            fieldMappingId: mapping.id,
            sourceFieldName: srcField.name,
            targetFieldName: tgtField.name,
            complianceTags: srcTags,
          });
        }
      }

      // Rule: BSA_AML fields require FFIEC_AUDIT on the target system
      if (hasTag(srcField, 'BSA_AML') && tgtField) {
        const tgtTags = getComplianceTags(tgtField);
        if (!tgtTags.includes('FFIEC_AUDIT') && !tgtTags.includes('BSA_AML')) {
          issues.push({
            severity: 'warning',
            rule: 'BSA_AML_AUDIT_TRAIL_MISSING',
            message: `BSA/AML field "${srcField.name}" maps to "${tgtField.name}" — ensure the target system preserves an immutable audit trail for regulatory examination`,
            fieldMappingId: mapping.id,
            sourceFieldName: srcField.name,
            targetFieldName: tgtField.name,
            complianceTags: srcTags,
          });
        }
      }

      // Rule: SOX_FINANCIAL cross-system mappings need reconciliation note
      if (hasTag(srcField, 'SOX_FINANCIAL') && tgtField) {
        if (mapping.confidence < 0.7) {
          issues.push({
            severity: 'warning',
            rule: 'SOX_FINANCIAL_LOW_CONFIDENCE',
            message: `SOX-governed financial field "${srcField.name}" has low mapping confidence (${mapping.confidence.toFixed(2)}) — manual review required before production`,
            fieldMappingId: mapping.id,
            sourceFieldName: srcField.name,
            targetFieldName: tgtField.name,
            complianceTags: srcTags,
          });
        }
      }
    }

    // Also check for unmapped required compliance fields (FFIEC_AUDIT required fields)
    for (const field of fields) {
      if (!field.required) continue;
      const tags = getComplianceTags(field);
      if (!AUDIT_REQUIRING_TAGS.some((t) => tags.includes(t))) continue;

      const isMapped = fieldMappings.some(
        (m) => m.sourceFieldId === field.id || m.targetFieldId === field.id,
      );
      if (!isMapped) {
        issues.push({
          severity: 'info',
          rule: 'REQUIRED_COMPLIANCE_FIELD_UNMAPPED',
          message: `Required compliance field "${field.name}" (${tags.join(', ')}) has no mapping — may indicate a coverage gap`,
          sourceFieldName: field.name,
          complianceTags: tags,
        });
      }
    }

    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;

    this.lastReport = {
      issues,
      totalErrors: errors,
      totalWarnings: warnings,
      piiFieldCount: piiCount,
      pciFieldCount: pciCount,
      sox_financialFieldCount: soxCount,
    };

    const step: Omit<AgentStep, 'agentName'> = {
      action: 'compliance_scan_complete',
      detail: `Found ${piiCount} GLBA_NPI, ${pciCount} PCI_CARD, ${soxCount} SOX fields. Issues: ${errors} errors, ${warnings} warnings`,
      durationMs: Date.now() - start,
      metadata: { issueCount: issues.length, errors, warnings },
    };
    this.emit(context, step);

    if (issues.length > 0) {
      const topIssue = issues.find((i) => i.severity === 'error') ?? issues[0];
      this.info(
        context,
        'compliance_issue',
        `Top issue [${topIssue.severity.toUpperCase()}]: ${topIssue.message}`,
        { rule: topIssue.rule },
      );
    }

    return {
      agentName: this.name,
      updatedFieldMappings: fieldMappings,
      steps: [{ agentName: this.name, ...step }],
      totalImproved: 0,
      metadata: this.lastReport,
    };
  }
}
