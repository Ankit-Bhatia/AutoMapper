import type { SchemaIntelligencePatternCandidate } from '../types.js';
import { CONFIRMED_PATTERNS } from '../agents/schemaIntelligenceData.js';
import { COREDIR_FSC_PATTERNS } from '../agents/coreDirSchemaData.js';

const ALL_PATTERNS = [CONFIRMED_PATTERNS, COREDIR_FSC_PATTERNS].reduce<Record<string, typeof CONFIRMED_PATTERNS[string]>>((acc, corpus) => {
  for (const [key, patterns] of Object.entries(corpus)) {
    acc[key] = (acc[key] ?? []).concat(patterns);
  }
  return acc;
}, {});

export function normalizeSchemaIntelligenceFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toCandidates(patternKey: string): SchemaIntelligencePatternCandidate[] {
  return (ALL_PATTERNS[patternKey] ?? []).flatMap((pattern) =>
    pattern.sfApiNames.map((targetFieldName) => ({
      xmlField: pattern.xmlField,
      normalizedFieldKey: patternKey,
      targetFieldName,
      targetObject: pattern.sfObject,
      confidence: pattern.confidence,
      notes: pattern.notes,
      isOneToMany: pattern.isOneToMany,
      isFormulaTarget: pattern.isFormulaTarget,
      isPersonAccountOnly: pattern.isPersonAccountOnly,
    })),
  );
}

export function getSchemaIntelligencePatternCandidates(fieldName?: string): SchemaIntelligencePatternCandidate[] {
  if (!fieldName) {
    return Object.keys(ALL_PATTERNS)
      .flatMap((patternKey) => toCandidates(patternKey))
      .sort((left, right) => left.xmlField.localeCompare(right.xmlField) || left.targetFieldName.localeCompare(right.targetFieldName));
  }

  const key = normalizeSchemaIntelligenceFieldName(fieldName);
  return toCandidates(key);
}

export function getOneToManyPatternCandidates(fieldName: string): SchemaIntelligencePatternCandidate[] {
  return getSchemaIntelligencePatternCandidates(fieldName).filter((candidate) => candidate.isOneToMany);
}

export function isOneToManyFieldName(fieldName: string): boolean {
  return getOneToManyPatternCandidates(fieldName).length > 0;
}
