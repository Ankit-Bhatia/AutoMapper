import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CONFIRMED_PATTERNS, type ConfirmedPattern } from '../../agents/schemaIntelligenceData.ts';
import { DEFAULT_RETRIEVAL_TOP_K, retrieveCandidatesForSource } from '../../services/candidateRetrieval.ts';
import { runMappingOptimizer } from '../../services/mappingOptimizer.ts';
import type { DataType, Entity, EntityMapping, Field, FieldMapping } from '../../types.ts';
import { isActiveFieldMapping } from '../../utils/mappingStatus.ts';

export interface BenchmarkPair {
  sourceFieldId: string;
  targetFieldId: string;
  confirmedBy: string;
  notes: string;
}

export interface BenchmarkRunMetrics {
  pairCount: number;
  top1Precision: { matches: number; total: number; ratio: number };
  recallAt3: { matches: number; total: number; ratio: number };
  duplicateTargetRate: { duplicates: number; activeMappings: number; ratio: number };
  requiredFieldCoverage: { covered: number; total: number; ratio: number };
  manualCorrectionCount: number;
}

export interface BenchmarkRunResult {
  generatedAt: string;
  metrics: BenchmarkRunMetrics;
  cases: Array<{
    sourceFieldId: string;
    expectedTargetFieldId: string;
    predictedTop1TargetFieldId: string | null;
    recallAt3Hit: boolean;
    targetObject: string;
    top3: string[];
  }>;
}

export interface RunBenchmarkHarnessOptions {
  pairsPath?: string;
  outputPath?: string;
  writeResults?: boolean;
}

const DEFAULT_PAIRS_PATH = fileURLToPath(
  new URL('../../../data/benchmark-pairs.jsonl', import.meta.url),
);
const DEFAULT_RESULTS_PATH = fileURLToPath(
  new URL('../../../benchmark-results.json', import.meta.url),
);
const REQUIRED_BENCHMARK_TARGET_FIELDS = new Set([
  'FinServ__NetWorth__c',
  'Total_Assets__c',
  'Amount_Past_Due__c',
  'Date_Credit_Approved__c',
  'FinServ__Balance__c',
  'FinServ__PaymentAmount__c',
  'Current_Debt_to_Income__c',
  'US_CRS__c',
]);

interface BenchmarkUniverse {
  pairs: BenchmarkPair[];
  targetEntities: Map<string, Entity>;
  targetFields: Field[];
  patternByPair: Map<string, ConfirmedPattern>;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pairKey(sourceFieldId: string, targetFieldId: string): string {
  return `${normalize(sourceFieldId)}::${normalize(targetFieldId)}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseJsonLine(line: string): BenchmarkPair | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as Partial<BenchmarkPair>;
  if (
    typeof parsed.sourceFieldId !== 'string'
    || typeof parsed.targetFieldId !== 'string'
    || typeof parsed.confirmedBy !== 'string'
    || typeof parsed.notes !== 'string'
  ) {
    throw new Error(`Invalid benchmark pair line: ${trimmed}`);
  }
  return {
    sourceFieldId: parsed.sourceFieldId,
    targetFieldId: parsed.targetFieldId,
    confirmedBy: parsed.confirmedBy,
    notes: parsed.notes,
  };
}

export function loadBenchmarkPairs(pairsPath = DEFAULT_PAIRS_PATH): BenchmarkPair[] {
  const raw = fs.readFileSync(pairsPath, 'utf8');
  return raw
    .split('\n')
    .map(parseJsonLine)
    .filter((pair): pair is BenchmarkPair => Boolean(pair));
}

function inferSourceDataType(sourceFieldId: string): DataType {
  const upper = sourceFieldId.toUpperCase();
  if (/^(AMT|PERC|PCT|RATE)_/.test(upper)) return 'decimal';
  if (/^(DATE|DT)_/.test(upper)) return 'date';
  if (/^(Y_|YN_|IND_)/.test(upper)) return 'boolean';
  if (/^(CODE|CD|STATUS)_/.test(upper)) return 'picklist';
  if (/^(NBR|ID)_/.test(upper) || upper.includes('_ID')) return 'id';
  return 'string';
}

function inferTargetDataType(pattern: ConfirmedPattern): DataType {
  const upper = pattern.sfApiNames[0]?.toUpperCase() ?? '';
  const sourceType = inferSourceDataType(pattern.xmlField);
  if (upper.includes('DATE')) return 'date';
  if (upper.includes('RATE') || upper.includes('AMOUNT') || upper.includes('BALANCE') || upper.includes('WORTH') || upper.includes('ASSET') || upper.includes('LIABILIT') || upper.includes('PAYMENT') || upper.includes('INCOME') || upper.includes('RATIO') || upper.includes('VALUE') || upper.includes('LIMIT') || upper.includes('PREMIUM')) {
    return 'decimal';
  }
  if (upper.includes('STATUS') || upper.includes('TYPE') || upper.includes('CODE') || upper.includes('CLASSIFICATION') || upper.includes('CATEGORY')) {
    return 'picklist';
  }
  if (sourceType === 'boolean') return 'boolean';
  if (upper.endsWith('ID') || upper.endsWith('ID__C') || upper.includes('NUMBER')) return 'id';
  return sourceType === 'unknown' ? 'string' : sourceType;
}

function sourceEntityNameForObject(targetObject: string): string {
  const key = normalize(targetObject);
  if (key.includes('account') || key === 'pit' || key.includes('partyinvolvedintransaction')) return 'Borrower';
  if (key.includes('loanpackage') || key === 'loan' || key.includes('financialaccount') || key === 'faloan') return 'Loan';
  if (key.includes('collateral')) return 'Collateral';
  if (key === 'fee') return 'Fee';
  return 'RiskClam';
}

function buildUniverse(pairsPath = DEFAULT_PAIRS_PATH): BenchmarkUniverse {
  const pairs = loadBenchmarkPairs(pairsPath);
  const patternByPair = new Map<string, ConfirmedPattern>();
  for (const patterns of Object.values(CONFIRMED_PATTERNS)) {
    for (const pattern of patterns) {
      const targetFieldId = pattern.sfApiNames[0];
      if (!targetFieldId) continue;
      const key = pairKey(pattern.xmlField, targetFieldId);
      if (!patternByPair.has(key)) {
        patternByPair.set(key, pattern);
      }
    }
  }

  const targetEntities = new Map<string, Entity>();
  const targetFieldsByInternalId = new Map<string, Field>();

  for (const patterns of Object.values(CONFIRMED_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.isFormulaTarget) continue;
      const targetFieldId = pattern.sfApiNames[0];
      if (!targetFieldId) continue;
      const entityId = `target-entity-${normalize(pattern.sfObject)}`;
      if (!targetEntities.has(entityId)) {
        targetEntities.set(entityId, {
          id: entityId,
          systemId: 'target-system-benchmark',
          name: pattern.sfObject,
          label: pattern.sfObject,
        });
      }

      const internalFieldId = `${entityId}.${targetFieldId}`;
      if (!targetFieldsByInternalId.has(internalFieldId)) {
        targetFieldsByInternalId.set(internalFieldId, {
          id: internalFieldId,
          entityId,
          name: targetFieldId,
          label: targetFieldId,
          description: pattern.notes,
          dataType: inferTargetDataType(pattern),
          required: REQUIRED_BENCHMARK_TARGET_FIELDS.has(targetFieldId),
          isKey: /(^|_)(ID|NUMBER|CIF)(_|$)/i.test(targetFieldId),
          isFormula: pattern.isFormulaTarget,
        });
      }
    }
  }

  return {
    pairs,
    targetEntities,
    targetFields: [...targetFieldsByInternalId.values()],
    patternByPair,
  };
}

function duplicateTargetRate(mappings: FieldMapping[]): { duplicates: number; activeMappings: number; ratio: number } {
  const activeMappings = mappings.filter((mapping) => isActiveFieldMapping(mapping));
  const counts = new Map<string, number>();
  for (const mapping of activeMappings) {
    counts.set(mapping.targetFieldId, (counts.get(mapping.targetFieldId) ?? 0) + 1);
  }

  const duplicates = activeMappings.filter((mapping) => (counts.get(mapping.targetFieldId) ?? 0) > 1).length;
  return {
    duplicates,
    activeMappings: activeMappings.length,
    ratio: activeMappings.length === 0 ? 0 : duplicates / activeMappings.length,
  };
}

function requiredCoverage(targetFields: Field[], mappings: FieldMapping[]): { covered: number; total: number; ratio: number } {
  const requiredTargetIds = targetFields.filter((field) => field.required || field.isKey).map((field) => field.id);
  const coveredIds = new Set(
    mappings
      .filter((mapping) => isActiveFieldMapping(mapping))
      .map((mapping) => mapping.targetFieldId),
  );
  const covered = requiredTargetIds.filter((id) => coveredIds.has(id)).length;
  return {
    covered,
    total: requiredTargetIds.length,
    ratio: requiredTargetIds.length === 0 ? 0 : covered / requiredTargetIds.length,
  };
}

export async function runBenchmarkHarness(
  options: RunBenchmarkHarnessOptions = {},
): Promise<BenchmarkRunResult> {
  const pairsPath = options.pairsPath ?? DEFAULT_PAIRS_PATH;
  const outputPath = options.outputPath ?? DEFAULT_RESULTS_PATH;
  const universe = buildUniverse(pairsPath);
  const sourceFieldsById = new Map<string, Field>();
  const entityMappingsByEntityId = new Map<string, EntityMapping>();
  const fieldMappings: FieldMapping[] = [];
  const cases: BenchmarkRunResult['cases'] = [];

  let top1Matches = 0;
  let recallAt3Matches = 0;

  for (const pair of universe.pairs) {
    const pattern = universe.patternByPair.get(pairKey(pair.sourceFieldId, pair.targetFieldId));
    if (!pattern) {
      throw new Error(`Benchmark pair ${pair.sourceFieldId} -> ${pair.targetFieldId} has no confirmed pattern backing it`);
    }

    const targetEntityId = `target-entity-${normalize(pattern.sfObject)}`;
    const sourceEntityId = `source-entity-${normalize(pattern.sfObject)}`;
    const sourceFieldId = `source-field-${pair.sourceFieldId}`;
    const sourceEntityName = sourceEntityNameForObject(pattern.sfObject);
    const sourceField: Field = {
      id: sourceFieldId,
      entityId: sourceEntityId,
      name: pair.sourceFieldId,
      label: pair.sourceFieldId,
      description: pair.notes,
      dataType: inferSourceDataType(pair.sourceFieldId),
    };
    sourceFieldsById.set(sourceField.id, sourceField);

    if (!entityMappingsByEntityId.has(targetEntityId)) {
      entityMappingsByEntityId.set(targetEntityId, {
        id: `entity-mapping-${normalize(pattern.sfObject)}`,
        projectId: 'benchmark-project',
        sourceEntityId,
        targetEntityId,
        confidence: 0.8,
        rationale: `Benchmark route ${sourceEntityName} -> ${pattern.sfObject}`,
      });
    }
    const entityMapping = entityMappingsByEntityId.get(targetEntityId);
    if (!entityMapping) {
      throw new Error(`Missing entity mapping for ${pattern.sfObject}`);
    }

    const targetFields = universe.targetFields.filter((field) => field.entityId === targetEntityId);
    const entityNamesById = new Map<string, string>([
      [sourceEntityId, sourceEntityName],
      [targetEntityId, pattern.sfObject],
    ]);
    const retrieval = retrieveCandidatesForSource(sourceField, targetFields, {
      topK: DEFAULT_RETRIEVAL_TOP_K,
      entityNamesById,
    });
    const top1 = retrieval.shortlist.candidates[0] ?? null;
    const top3 = retrieval.shortlist.candidates.slice(0, 3).map((candidate) => candidate.targetFieldName);
    const top1Hit = top1?.targetFieldName === pair.targetFieldId;
    const recallAt3Hit = top3.includes(pair.targetFieldId);

    if (top1Hit) top1Matches += 1;
    if (recallAt3Hit) recallAt3Matches += 1;

    const chosenTargetField = top1
      ? universe.targetFields.find((field) => field.id === top1.targetFieldId)
      : undefined;

    fieldMappings.push({
      id: randomUUID(),
      entityMappingId: entityMapping.id,
      sourceFieldId: sourceField.id,
      targetFieldId: chosenTargetField?.id ?? `${targetEntityId}.${pair.targetFieldId}`,
      transform: { type: 'direct', config: {} },
      confidence: top1?.retrievalScore ?? 0,
      rationale: `benchmark top-1 ${top1?.targetFieldName ?? 'none'}`,
      status: top1 ? 'suggested' : 'unmatched',
      retrievalShortlist: retrieval.shortlist,
    });

    cases.push({
      sourceFieldId: pair.sourceFieldId,
      expectedTargetFieldId: pair.targetFieldId,
      predictedTop1TargetFieldId: top1?.targetFieldName ?? null,
      recallAt3Hit,
      targetObject: pattern.sfObject,
      top3,
    });
  }

  const optimizedMappings = runMappingOptimizer(fieldMappings, universe.targetFields, {
    sourceFieldsById,
  });
  const duplicateRate = duplicateTargetRate(optimizedMappings);
  const requiredCoverageMetrics = requiredCoverage(universe.targetFields, optimizedMappings);

  const metrics: BenchmarkRunMetrics = {
    pairCount: universe.pairs.length,
    top1Precision: {
      matches: top1Matches,
      total: universe.pairs.length,
      ratio: universe.pairs.length === 0 ? 0 : top1Matches / universe.pairs.length,
    },
    recallAt3: {
      matches: recallAt3Matches,
      total: universe.pairs.length,
      ratio: universe.pairs.length === 0 ? 0 : recallAt3Matches / universe.pairs.length,
    },
    duplicateTargetRate: duplicateRate,
    requiredFieldCoverage: requiredCoverageMetrics,
    manualCorrectionCount: universe.pairs.length - top1Matches,
  };

  const result: BenchmarkRunResult = {
    generatedAt: new Date().toISOString(),
    metrics: {
      ...metrics,
      top1Precision: { ...metrics.top1Precision, ratio: clamp01(metrics.top1Precision.ratio) },
      recallAt3: { ...metrics.recallAt3, ratio: clamp01(metrics.recallAt3.ratio) },
      duplicateTargetRate: { ...metrics.duplicateTargetRate, ratio: clamp01(metrics.duplicateTargetRate.ratio) },
      requiredFieldCoverage: { ...metrics.requiredFieldCoverage, ratio: clamp01(metrics.requiredFieldCoverage.ratio) },
    },
    cases,
  };

  if (options.writeResults !== false) {
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  }

  return result;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

export function renderBenchmarkSummary(result: BenchmarkRunResult): string {
  const { metrics } = result;
  return [
    `Benchmark pairs: ${metrics.pairCount}`,
    `Top-1 precision: ${formatPercent(metrics.top1Precision.ratio)} (${metrics.top1Precision.matches}/${metrics.top1Precision.total})`,
    `Recall@3: ${formatPercent(metrics.recallAt3.ratio)} (${metrics.recallAt3.matches}/${metrics.recallAt3.total})`,
    `Duplicate-target rate: ${formatPercent(metrics.duplicateTargetRate.ratio)} (${metrics.duplicateTargetRate.duplicates}/${metrics.duplicateTargetRate.activeMappings} active mappings)`,
    `Required-field coverage: ${formatPercent(metrics.requiredFieldCoverage.ratio)} (${metrics.requiredFieldCoverage.covered}/${metrics.requiredFieldCoverage.total})`,
    `Manual correction count: ${metrics.manualCorrectionCount}`,
  ].join('\n');
}
