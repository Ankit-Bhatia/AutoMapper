import { describe, expect, it } from 'vitest';

import type { Field, FieldMapping } from '../types.js';
import { runMappingOptimizer } from '../services/mappingOptimizer.js';

function makeField(overrides: Partial<Field> = {}): Field {
  return {
    id: 'field-1',
    entityId: 'entity-1',
    name: 'Name',
    dataType: 'string',
    required: false,
    isKey: false,
    ...overrides,
  };
}

function makeMapping(overrides: Partial<FieldMapping> = {}): FieldMapping {
  return {
    id: 'fm-1',
    entityMappingId: 'em-1',
    sourceFieldId: 'src-1',
    targetFieldId: 'tgt-1',
    transform: { type: 'direct', config: {} },
    confidence: 0.8,
    rationale: 'seeded',
    status: 'suggested',
    ...overrides,
  };
}

describe('runMappingOptimizer', () => {
  it('resolves duplicates, removes hard bans and incompatible targets, covers required fields, and flags low-confidence AI fallback', () => {
    const sourceFields = [
      makeField({ id: 'src-amt', entityId: 'src-ent', name: 'AMT_APPROVED', dataType: 'decimal' }),
      makeField({ id: 'src-pay', entityId: 'src-ent', name: 'AMT_PAYMENT', dataType: 'decimal' }),
      makeField({ id: 'src-date', entityId: 'src-ent', name: 'DATE_FUNDED', dataType: 'date' }),
      makeField({ id: 'src-fallback', entityId: 'src-ent', name: 'DESC_NOTES', dataType: 'string' }),
      makeField({ id: 'src-tax', entityId: 'src-ent', name: 'TAX_ID', dataType: 'string' }),
      makeField({ id: 'src-age', entityId: 'src-ent', name: 'AGE', dataType: 'integer' }),
    ];

    const targetFields = [
      makeField({ id: 'tgt-formula', entityId: 'tgt-ent', name: 'CalculatedScore__c', dataType: 'decimal', isFormula: true }),
      makeField({ id: 'tgt-balance', entityId: 'tgt-ent', name: 'CurrentBalance', dataType: 'decimal' }),
      makeField({ id: 'tgt-payment', entityId: 'tgt-ent', name: 'PaymentAmount', dataType: 'decimal' }),
      makeField({ id: 'tgt-stage', entityId: 'tgt-ent', name: 'StageName', dataType: 'string', required: true }),
      makeField({ id: 'tgt-formula-2', entityId: 'tgt-ent', name: 'CalculatedStage__c', dataType: 'string', isFormula: true }),
      makeField({ id: 'tgt-required-tax', entityId: 'tgt-ent', name: 'TaxId', dataType: 'string', required: true, isKey: true }),
      makeField({ id: 'tgt-email', entityId: 'tgt-ent', name: 'Email', dataType: 'string' }),
      makeField({ id: 'tgt-stale', entityId: 'tgt-ent', name: 'LegacyValue', dataType: 'string' }),
      makeField({ id: 'tgt-stale-2', entityId: 'tgt-ent', name: 'LegacyNumber', dataType: 'integer' }),
    ];

    const mappings: FieldMapping[] = [
      makeMapping({
        id: 'fm-hard-ban',
        sourceFieldId: 'src-amt',
        targetFieldId: 'tgt-formula',
        confidence: 0.91,
        retrievalShortlist: {
          sourceFieldId: 'src-amt',
          topK: 5,
          candidates: [
            { targetFieldId: 'tgt-formula', targetFieldName: 'CalculatedScore__c', retrievalScore: 0.93, semanticMode: 'alias', evidence: ['formula'] },
            { targetFieldId: 'tgt-balance', targetFieldName: 'CurrentBalance', retrievalScore: 0.88, semanticMode: 'alias', evidence: ['amount'] },
            { targetFieldId: 'tgt-payment', targetFieldName: 'PaymentAmount', retrievalScore: 0.82, semanticMode: 'intent', evidence: ['payment'] },
          ],
        },
      }),
      makeMapping({
        id: 'fm-duplicate',
        sourceFieldId: 'src-pay',
        targetFieldId: 'tgt-balance',
        confidence: 0.87,
        retrievalShortlist: {
          sourceFieldId: 'src-pay',
          topK: 5,
          candidates: [
            { targetFieldId: 'tgt-balance', targetFieldName: 'CurrentBalance', retrievalScore: 0.86, semanticMode: 'alias', evidence: ['amount'] },
            { targetFieldId: 'tgt-payment', targetFieldName: 'PaymentAmount', retrievalScore: 0.84, semanticMode: 'alias', evidence: ['payment'] },
          ],
        },
      }),
      makeMapping({
        id: 'fm-type-mismatch',
        sourceFieldId: 'src-date',
        targetFieldId: 'tgt-stage',
        confidence: 0.64,
        retrievalShortlist: {
          sourceFieldId: 'src-date',
          topK: 5,
          candidates: [
            { targetFieldId: 'tgt-stage', targetFieldName: 'StageName', retrievalScore: 0.42, semanticMode: 'intent', evidence: ['fallback'] },
            { targetFieldId: 'tgt-formula-2', targetFieldName: 'CalculatedStage__c', retrievalScore: 0.38, semanticMode: 'intent', evidence: ['fallback'] },
          ],
        },
      }),
      makeMapping({
        id: 'fm-low-confidence',
        sourceFieldId: 'src-fallback',
        targetFieldId: 'tgt-email',
        confidence: 0.55,
        rationale: 'Seeded from ai_fallback candidate',
        retrievalShortlist: {
          sourceFieldId: 'src-fallback',
          topK: 5,
          candidates: [
            { targetFieldId: 'tgt-email', targetFieldName: 'Email', retrievalScore: 0.25, semanticMode: 'intent', evidence: ['fallback'] },
          ],
        },
      }),
      makeMapping({
        id: 'fm-cover-required',
        sourceFieldId: 'src-tax',
        targetFieldId: 'tgt-stale',
        confidence: 0,
        status: 'unmatched',
        retrievalShortlist: {
          sourceFieldId: 'src-tax',
          topK: 5,
          candidates: [
            { targetFieldId: 'tgt-required-tax', targetFieldName: 'TaxId', retrievalScore: 0.45, semanticMode: 'alias', evidence: ['tax'] },
          ],
        },
      }),
      makeMapping({
        id: 'fm-do-not-force',
        sourceFieldId: 'src-age',
        targetFieldId: 'tgt-stale-2',
        confidence: 0,
        status: 'unmatched',
        retrievalShortlist: {
          sourceFieldId: 'src-age',
          topK: 5,
          candidates: [
            { targetFieldId: 'tgt-stage', targetFieldName: 'StageName', retrievalScore: 0.28, semanticMode: 'intent', evidence: ['weak'] },
          ],
        },
      }),
    ];

    const optimized = runMappingOptimizer(mappings, targetFields, {
      sourceFieldsById: new Map(sourceFields.map((field) => [field.id, field])),
    });

    const byId = new Map(optimized.map((mapping) => [mapping.id, mapping]));

    expect(byId.get('fm-hard-ban')?.targetFieldId).toBe('tgt-balance');
    expect(byId.get('fm-hard-ban')?.optimizerDisplacement).toEqual({
      originalTargetFieldId: 'tgt-formula',
      reason: 'hard_ban',
      finalAssignment: 'tgt-balance',
    });

    expect(byId.get('fm-duplicate')?.targetFieldId).toBe('tgt-payment');
    expect(byId.get('fm-duplicate')?.optimizerDisplacement).toEqual({
      originalTargetFieldId: 'tgt-balance',
      reason: 'duplicate_displaced',
      finalAssignment: 'tgt-payment',
    });

    expect(byId.get('fm-type-mismatch')?.status).toBe('unmatched');
    expect(byId.get('fm-type-mismatch')?.optimizerDisplacement).toEqual({
      originalTargetFieldId: 'tgt-stage',
      reason: 'type_incompatible',
      finalAssignment: null,
    });

    expect(byId.get('fm-low-confidence')?.lowConfidenceFallback).toBe(true);

    expect(byId.get('fm-cover-required')?.status).toBe('suggested');
    expect(byId.get('fm-cover-required')?.targetFieldId).toBe('tgt-required-tax');

    expect(byId.get('fm-do-not-force')?.status).toBe('unmatched');
    expect(byId.get('fm-do-not-force')?.targetFieldId).toBe('tgt-stale-2');

    const activeTargetIds = optimized
      .filter((mapping) => mapping.status !== 'rejected' && mapping.status !== 'unmatched')
      .map((mapping) => mapping.targetFieldId);
    expect(new Set(activeTargetIds).size).toBe(activeTargetIds.length);

    expect(activeTargetIds).toContain('tgt-required-tax');
    expect(activeTargetIds).not.toContain('tgt-formula');
    expect(activeTargetIds).not.toContain('tgt-stage');
  });
});
