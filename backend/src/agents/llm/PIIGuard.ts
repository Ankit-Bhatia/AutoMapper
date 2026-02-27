/**
 * PIIGuard — strips PII/PCI fields from LLM prompts.
 *
 * Before any data is sent to an external LLM provider, PIIGuard:
 *   1. Identifies fields tagged GLBA_NPI or PCI_CARD
 *   2. Replaces field names and values with safe placeholders
 *   3. Returns a sanitized context safe for third-party AI calls
 *
 * This is a non-negotiable safety layer — GLBA compliance requires that
 * non-public personal information never leaves the institution without consent.
 */
import type { Field } from '../../types.js';
import type { ConnectorField, ComplianceTag } from '../../connectors/IConnector.js';

/** Tags that MUST be redacted before any LLM call */
const BLOCKED_TAGS: ComplianceTag[] = ['GLBA_NPI', 'PCI_CARD'];

/** Placeholder shown in prompts in place of a PII field name */
const PII_PLACEHOLDER = '[REDACTED_PII_FIELD]';
/** Placeholder shown in prompts in place of a PCI field name */
const PCI_PLACEHOLDER = '[REDACTED_PCI_FIELD]';

export type SafeField = {
  id: string;
  name: string;
  label: string;
  dataType: string;
  isKey?: boolean;
  required?: boolean;
  redacted: boolean;
  redactReason?: string;
};

/**
 * Sanitize a list of fields for LLM consumption.
 *
 * @param fields - raw fields from connector schema
 * @returns SafeField[] — redacted where compliance tags require it
 */
export function sanitizeFields(fields: (Field | ConnectorField)[]): SafeField[] {
  return fields.map((f) => {
    const cf = f as ConnectorField;
    const tags: ComplianceTag[] = cf.complianceTags ?? [];
    const hasGlba = tags.includes('GLBA_NPI');
    const hasPci = tags.includes('PCI_CARD');

    if (hasGlba || hasPci) {
      return {
        id: f.id,
        name: hasPci ? PCI_PLACEHOLDER : PII_PLACEHOLDER,
        label: hasPci ? '[REDACTED PCI FIELD]' : '[REDACTED PII FIELD]',
        dataType: f.dataType,
        isKey: f.isKey,
        required: f.required,
        redacted: true,
        redactReason: hasPci ? 'PCI_CARD' : 'GLBA_NPI',
      };
    }

    return {
      id: f.id,
      name: f.name,
      label: f.label ?? f.name,
      dataType: f.dataType,
      isKey: f.isKey,
      required: f.required,
      redacted: false,
    };
  });
}

/**
 * Build a PII-safe summary of the schema for LLM prompts.
 * Returns a compact string listing entities + their safe field names.
 */
export function buildSafeSchemaDescription(
  entities: { id: string; name: string; label?: string }[],
  fields: (Field | ConnectorField)[],
): string {
  const safeFields = sanitizeFields(fields);
  const fieldsByEntity = new Map<string, SafeField[]>();
  for (const sf of safeFields) {
    const rawField = fields.find((f) => f.id === sf.id);
    if (!rawField) continue;
    const entityId = rawField.entityId;
    if (!fieldsByEntity.has(entityId)) fieldsByEntity.set(entityId, []);
    fieldsByEntity.get(entityId)!.push(sf);
  }

  const lines: string[] = [];
  for (const entity of entities) {
    const eFields = fieldsByEntity.get(entity.id) ?? [];
    const fieldList = eFields
      .map((f) => `${f.name}:${f.dataType}${f.isKey ? '(key)' : ''}${f.required ? '*' : ''}`)
      .join(', ');
    lines.push(`${entity.name}: [${fieldList}]`);
  }
  return lines.join('\n');
}

/**
 * Check whether a field is safe to include in LLM prompts.
 */
export function isFieldSafeForLLM(field: Field | ConnectorField): boolean {
  const cf = field as ConnectorField;
  const tags: ComplianceTag[] = cf.complianceTags ?? [];
  return !BLOCKED_TAGS.some((t) => tags.includes(t));
}

/**
 * Count the number of PII fields that would be redacted.
 */
export function countRedactedFields(fields: (Field | ConnectorField)[]): number {
  return fields.filter((f) => !isFieldSafeForLLM(f)).length;
}
