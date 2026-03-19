import { describe, expect, it } from 'vitest';
import {
  getOneToManyPatternCandidates,
  getSchemaIntelligencePatternCandidates,
  isOneToManyFieldName,
  normalizeSchemaIntelligenceFieldName,
} from '../services/schemaIntelligencePatterns.js';

describe('schemaIntelligencePatterns', () => {
  it('normalizes XML field names consistently', () => {
    expect(normalizeSchemaIntelligenceFieldName('AMT_PAYMENT')).toBe('amtpayment');
    expect(normalizeSchemaIntelligenceFieldName('Amt Payment')).toBe('amtpayment');
  });

  it('returns one-to-many routing candidates for confirmed corpus fields', () => {
    const candidates = getOneToManyPatternCandidates('AMT_PAYMENT');
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.map((candidate) => candidate.targetFieldName)).toContain('FinServ__PaymentAmount__c');
    expect(candidates.map((candidate) => candidate.targetFieldName)).toContain('Monthly_Payment__c');
  });

  it('recognizes fields that require routing decisions', () => {
    expect(isOneToManyFieldName('AMT_PAYMENT')).toBe(true);
    expect(isOneToManyFieldName('UNRELATED_FIELD')).toBe(false);
  });

  it('returns the full pattern list when unfiltered', () => {
    const candidates = getSchemaIntelligencePatternCandidates();
    expect(candidates.length).toBeGreaterThan(10);
  });
});
