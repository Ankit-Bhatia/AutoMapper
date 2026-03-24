import type { Connection } from 'jsforce';
import type { FieldValidationRule } from './types.js';

interface ValidationRuleRecord {
  ValidationName?: string;
  Description?: string | null;
  ErrorConditionFormula?: string | null;
  ErrorDisplayField?: string | null;
  ErrorMessage?: string | null;
  EntityDefinition?: {
    QualifiedApiName?: string | null;
  } | null;
}

function escapeSoqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractReferencedFieldNames(formula: string, fieldNames: string[]): string[] {
  if (!formula) return [];
  const matches: string[] = [];
  const orderedFieldNames = [...fieldNames].sort((left, right) => right.length - left.length);
  for (const fieldName of orderedFieldNames) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(fieldName)}([^A-Za-z0-9_]|$)`, 'i');
    if (pattern.test(formula)) {
      matches.push(fieldName);
    }
  }
  return matches;
}

export function buildValidationRuleIndex(input: {
  objectFieldNames: Map<string, string[]>;
  records: ValidationRuleRecord[];
}): Map<string, Map<string, FieldValidationRule[]>> {
  const byObject = new Map<string, Map<string, FieldValidationRule[]>>();

  for (const record of input.records) {
    const objectName = record.EntityDefinition?.QualifiedApiName ?? undefined;
    const ruleName = record.ValidationName ?? undefined;
    if (!objectName || !ruleName) continue;

    const objectFields = input.objectFieldNames.get(objectName) ?? [];
    if (!objectFields.length) continue;

    const referencedFields = extractReferencedFieldNames(record.ErrorConditionFormula ?? '', objectFields);
    const attachedFieldNames = new Set(referencedFields);
    if (record.ErrorDisplayField && objectFields.includes(record.ErrorDisplayField)) {
      attachedFieldNames.add(record.ErrorDisplayField);
    }
    if (attachedFieldNames.size === 0) continue;

    const ruleSummary: FieldValidationRule = {
      name: ruleName,
      entityName: objectName,
      errorMessage: record.ErrorMessage ?? undefined,
      description: record.Description ?? undefined,
      errorDisplayField: record.ErrorDisplayField ?? undefined,
      referencedFields: referencedFields.length ? referencedFields : undefined,
    };

    const objectIndex = byObject.get(objectName) ?? new Map<string, FieldValidationRule[]>();
    byObject.set(objectName, objectIndex);

    for (const fieldName of attachedFieldNames) {
      const existingRules = objectIndex.get(fieldName) ?? [];
      existingRules.push(ruleSummary);
      objectIndex.set(fieldName, existingRules);
    }
  }

  return byObject;
}

export async function loadSalesforceValidationRuleIndex(input: {
  conn: Connection;
  objectFieldNames: Map<string, string[]>;
}): Promise<Map<string, Map<string, FieldValidationRule[]>>> {
  const objectNames = [...input.objectFieldNames.keys()];
  if (!objectNames.length) return new Map();

  try {
    const soql = [
      'SELECT ValidationName, Description, ErrorConditionFormula, ErrorDisplayField, ErrorMessage,',
      'EntityDefinition.QualifiedApiName',
      'FROM ValidationRule',
      'WHERE Active = true',
      `AND EntityDefinition.QualifiedApiName IN (${objectNames.map((name) => `'${escapeSoqlString(name)}'`).join(', ')})`,
    ].join(' ');

    const result = await input.conn.tooling.query<ValidationRuleRecord>(soql);
    return buildValidationRuleIndex({
      objectFieldNames: input.objectFieldNames,
      records: result.records ?? [],
    });
  } catch {
    return new Map();
  }
}
