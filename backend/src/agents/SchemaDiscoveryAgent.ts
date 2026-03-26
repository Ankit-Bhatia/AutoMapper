/**
 * SchemaDiscoveryAgent — enriches raw schema with semantic annotations.
 *
 * Responsibilities:
 *   - Infer semantic "purpose" for each field (identifier, financial, PII, status, date, reference)
 *   - Detect ISO 20022 canonical names for Jack Henry fields
 *   - Group related fields into logical clusters
 *   - Build an enriched field index consumed by downstream agents
 *
 * This agent does NOT modify mappings — it only emits metadata steps
 * that help other agents make better decisions.
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { ConnectorField } from '../../../packages/connectors/IConnector.js';
import type { Field } from '../types.js';
import { buildFieldsSnapshot, buildSchemaFingerprint, detectSchemaDrift } from '../services/schemaFingerprint.js';

/** Semantic purpose classification for a field */
export type FieldPurpose =
  | 'identifier'     // Primary key, external ID
  | 'pii_personal'   // Name, DOB, address, SSN
  | 'pii_contact'    // Email, phone
  | 'financial'      // Balance, rate, amount
  | 'status'         // Status/state picklists
  | 'date'           // Dates and timestamps
  | 'reference'      // Foreign-key / lookup fields
  | 'classification' // Type/category codes
  | 'text'           // Free text / notes
  | 'other';

/** Enriched field annotation produced by this agent */
export interface FieldAnnotation {
  fieldId: string;
  fieldName: string;
  purpose: FieldPurpose;
  semanticGroup?: string;   // e.g. "address", "balance", "identity"
  iso20022Name?: string;
  suggestedLabel?: string;
}

function inferPurpose(field: Field | ConnectorField): FieldPurpose {
  const n = field.name.toLowerCase();
  const cf = field as ConnectorField;
  const tags = cf.complianceTags ?? [];

  if (field.isKey || field.isExternalId) return 'identifier';
  if (tags.includes('PCI_CARD')) return 'pii_personal';
  if (tags.includes('GLBA_NPI')) {
    if (/email|phone|mobile/.test(n)) return 'pii_contact';
    return 'pii_personal';
  }
  if (tags.includes('SOX_FINANCIAL') || /balance|amount|rate|interest|dividend|payment/.test(n)) return 'financial';
  if (/status|state|flag|active|inactive/.test(n)) return 'status';
  if (/date|time|created|updated|opened|closed/.test(n)) return 'date';
  if (/id$|number$|code$|ref$/.test(n)) return 'reference';
  if (/type|category|class|kind/.test(n)) return 'classification';
  if (field.dataType === 'text') return 'text';
  return 'other';
}

function inferGroup(field: Field | ConnectorField): string | undefined {
  const n = field.name.toLowerCase();
  if (/address|street|city|state|postal|zip|country/.test(n)) return 'address';
  if (/balance|available|ledger/.test(n)) return 'balance';
  if (/name|firstname|lastname|legal/.test(n)) return 'identity';
  if (/email|phone|mobile|fax/.test(n)) return 'contact';
  if (/date|time/.test(n)) return 'temporal';
  if (/rate|interest|dividend|apr/.test(n)) return 'rate';
  if (/status|state/.test(n)) return 'lifecycle';
  return undefined;
}

export class SchemaDiscoveryAgent extends AgentBase {
  readonly name = 'SchemaDiscoveryAgent';

  /** Annotations produced by the last run (accessible to other agents) */
  public annotations: Map<string, FieldAnnotation> = new Map();

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields } = context;

    this.info(context, 'start', `Analysing ${fields.length} fields across ${context.sourceEntities.length + context.targetEntities.length} entities...`);

    this.annotations.clear();
    const purposeCount: Record<string, number> = {};

    for (const field of fields) {
      const purpose = inferPurpose(field);
      const group = inferGroup(field);
      const cf = field as ConnectorField;

      const annotation: FieldAnnotation = {
        fieldId: field.id,
        fieldName: field.name,
        purpose,
        semanticGroup: group,
        iso20022Name: cf.iso20022Name,
        suggestedLabel: field.label,
      };

      this.annotations.set(field.id, annotation);
      purposeCount[purpose] = (purposeCount[purpose] ?? 0) + 1;
    }

    const currentFields = fields.map((field) => ({ ...field })) as Field[];
    const currentSnapshot = buildFieldsSnapshot(
      {
        id: context.projectId,
        name: '',
        sourceSystemId: context.sourceEntities[0]?.systemId ?? '',
        targetSystemId: context.targetEntities[0]?.systemId ?? '',
        createdAt: '',
        updatedAt: '',
      },
      [...context.sourceEntities, ...context.targetEntities],
      currentFields,
    );
    const currentFingerprint = buildSchemaFingerprint(
      {
        id: context.projectId,
        name: '',
        sourceSystemId: context.sourceEntities[0]?.systemId ?? '',
        targetSystemId: context.targetEntities[0]?.systemId ?? '',
        createdAt: '',
        updatedAt: '',
      },
      [...context.sourceEntities, ...context.targetEntities],
      currentFields,
    );
    const drift = detectSchemaDrift(
      context.latestExportVersion,
      currentFingerprint,
      currentSnapshot,
      [...context.sourceEntities, ...context.targetEntities],
    );

    if (drift) {
      this.info(
        context,
        'schema_drift_detected',
        `Schema drift detected: ${drift.blockers.length} blockers, ${drift.warnings.length} warnings, ${drift.additions.length} additions`,
        drift as unknown as Record<string, unknown>,
      );
    }

    const summary = Object.entries(purposeCount)
      .map(([p, c]) => `${p}=${c}`)
      .join(', ');

    const step: Omit<AgentStep, 'agentName'> = {
      action: 'schema_discovery_complete',
      detail: `Classified ${fields.length} fields: ${summary}`,
      durationMs: Date.now() - start,
      metadata: { purposeCount, annotationCount: this.annotations.size },
    };
    this.emit(context, step);

    return {
      agentName: this.name,
      updatedFieldMappings: context.fieldMappings,
      steps: [{ agentName: this.name, ...step }],
      totalImproved: 0,
      metadata: { purposeCount },
    };
  }
}
