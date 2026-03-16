import type { FieldMapping } from '@contracts';

export type SchemaIntelligenceTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type SchemaIntelligenceFindingKind =
  | 'confirmedPattern'
  | 'confirmedFamily'
  | 'formulaTarget'
  | 'oneToMany'
  | 'personAccountOnly'
  | 'fscStandardField'
  | 'typeMismatch'
  | 'typeCompatible'
  | 'systemAuditTarget'
  | 'caribbeanDomain'
  | 'baseRationale';

export interface SchemaIntelligenceFinding {
  kind: SchemaIntelligenceFindingKind;
  label: string;
  tone: SchemaIntelligenceTone;
  text: string;
}

export interface ParsedSchemaIntelligence {
  findings: SchemaIntelligenceFinding[];
  confirmedConfidenceTier?: string;
  glossaryTerms: string[];
  flags: {
    confirmedPattern: boolean;
    confirmedFamily: boolean;
    formulaTarget: boolean;
    oneToMany: boolean;
    personAccountOnly: boolean;
    fscStandardField: boolean;
    typeMismatch: boolean;
    typeCompatible: boolean;
    systemAuditTarget: boolean;
    caribbeanDomain: boolean;
  };
}

const FINDING_PREFIXES = [
  '⛔ System audit field:',
  '⚠️ Formula field target:',
  'ℹ️ Person Account field:',
  '✓ FSC standard field:',
  '⚠️ Type mismatch:',
  '✓ Type taxonomy:',
  '✅ Confirmed BOSL→FSC pattern:',
  'ℹ️ Source',
  '⚠️ One-to-Many field:',
  '🏝 Caribbean domain:',
] as const;

function startsWithKnownPrefix(value: string): boolean {
  return FINDING_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function splitRationaleSegments(rationale: string): string[] {
  const rawParts = rationale
    .split(' | ')
    .map((part) => part.trim())
    .filter(Boolean);

  const segments: string[] = [];

  for (const part of rawParts) {
    if (startsWithKnownPrefix(part)) {
      segments.push(part);
      continue;
    }

    if (segments.length === 0) {
      segments.push(part);
      continue;
    }

    const previous = segments[segments.length - 1];
    if (previous.startsWith('🏝 Caribbean domain:') || part.startsWith('(')) {
      segments[segments.length - 1] = `${previous} | ${part}`;
      continue;
    }

    segments.push(part);
  }

  return segments;
}

function baseFlags() {
  return {
    confirmedPattern: false,
    confirmedFamily: false,
    formulaTarget: false,
    oneToMany: false,
    personAccountOnly: false,
    fscStandardField: false,
    typeMismatch: false,
    typeCompatible: false,
    systemAuditTarget: false,
    caribbeanDomain: false,
  };
}

export function parseSchemaIntelligenceRationale(rationale?: string): ParsedSchemaIntelligence {
  if (!rationale) {
    return {
      findings: [],
      glossaryTerms: [],
      flags: baseFlags(),
    };
  }

  const findings: SchemaIntelligenceFinding[] = [];
  const glossaryTerms: string[] = [];
  const flags = baseFlags();
  let confirmedConfidenceTier: string | undefined;

  for (const segment of splitRationaleSegments(rationale)) {
    if (segment.startsWith('✅ Confirmed BOSL→FSC pattern:')) {
      flags.confirmedPattern = true;
      const tier = segment.match(/\[(HIGH|MEDIUM|LOW)\]/i)?.[1]?.toUpperCase();
      if (tier) confirmedConfidenceTier = tier;
      findings.push({
        kind: 'confirmedPattern',
        label: tier ? `Confirmed Pattern (${tier})` : 'Confirmed Pattern',
        tone: 'success',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('ℹ️ Source') && segment.includes('confirmed corpus')) {
      flags.confirmedFamily = true;
      findings.push({
        kind: 'confirmedFamily',
        label: 'Confirmed Family',
        tone: 'info',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('⚠️ Formula field target:') || segment.includes('formula field warning from pattern corpus')) {
      flags.formulaTarget = true;
      findings.push({
        kind: 'formulaTarget',
        label: 'Formula Field',
        tone: 'danger',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('⚠️ One-to-Many field:')) {
      flags.oneToMany = true;
      findings.push({
        kind: 'oneToMany',
        label: 'Routing Required',
        tone: 'warning',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('ℹ️ Person Account field:')) {
      flags.personAccountOnly = true;
      findings.push({
        kind: 'personAccountOnly',
        label: 'Person Account Only',
        tone: 'info',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('✓ FSC standard field:')) {
      flags.fscStandardField = true;
      findings.push({
        kind: 'fscStandardField',
        label: 'FSC Standard',
        tone: 'success',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('⚠️ Type mismatch:')) {
      flags.typeMismatch = true;
      findings.push({
        kind: 'typeMismatch',
        label: 'Type Mismatch',
        tone: 'warning',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('✓ Type taxonomy:')) {
      flags.typeCompatible = true;
      findings.push({
        kind: 'typeCompatible',
        label: 'Type Compatible',
        tone: 'success',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('⛔ System audit field:')) {
      flags.systemAuditTarget = true;
      findings.push({
        kind: 'systemAuditTarget',
        label: 'System Audit Field',
        tone: 'danger',
        text: segment,
      });
      continue;
    }

    if (segment.startsWith('🏝 Caribbean domain:')) {
      flags.caribbeanDomain = true;
      const terms = segment
        .replace('🏝 Caribbean domain:', '')
        .split(' | ')
        .map((term) => term.trim())
        .filter(Boolean);
      glossaryTerms.push(...terms);
      findings.push({
        kind: 'caribbeanDomain',
        label: 'Caribbean Context',
        tone: 'info',
        text: segment,
      });
      continue;
    }

    findings.push({
      kind: 'baseRationale',
      label: 'Mapping Context',
      tone: 'neutral',
      text: segment,
    });
  }

  return {
    findings,
    confirmedConfidenceTier,
    glossaryTerms,
    flags,
  };
}

export function getActiveFormulaTargetIds(fieldMappings: FieldMapping[]): string[] {
  return fieldMappings
    .filter((mapping) => mapping.status !== 'rejected')
    .filter((mapping) => parseSchemaIntelligenceRationale(mapping.rationale).flags.formulaTarget)
    .map((mapping) => mapping.id);
}
