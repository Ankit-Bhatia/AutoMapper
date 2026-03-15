import { describe, expect, it } from 'vitest';

import { DEFAULT_RETRIEVAL_TOP_K, retrieveCandidatesForSource } from '../services/candidateRetrieval.js';

const makeField = (overrides: Record<string, unknown>) => ({
  id: 'field-default',
  entityId: 'entity-default',
  name: 'Name',
  dataType: 'string',
  complianceTags: [],
  ...overrides,
});

describe('candidateRetrieval', () => {
  it('returns top-K shortlist ranked by descending retrieval score', () => {
    const sourceField = makeField({
      id: 'src-tenure',
      entityId: 'src-borrower',
      name: 'CUST_TENURE_MONTHS',
      label: 'Customer Tenure Months',
      description: 'Months customer has been with institution',
      dataType: 'integer',
    });
    const targetFields = [
      makeField({
        id: 'tgt-years',
        entityId: 'tgt-party',
        name: 'FinServ__YearsWithFirm__c',
        label: 'Years With Firm',
        description: 'Years customer has been with institution',
        dataType: 'integer',
      }),
      makeField({
        id: 'tgt-relationship',
        entityId: 'tgt-party',
        name: 'RelationshipTenure__c',
        label: 'Relationship Tenure',
        description: 'Length of relationship in months',
        dataType: 'integer',
      }),
      makeField({
        id: 'tgt-name',
        entityId: 'tgt-party',
        name: 'Name',
        dataType: 'string',
      }),
    ];

    const result = retrieveCandidatesForSource(sourceField as never, targetFields as never, {
      entityNamesById: new Map([
        ['src-borrower', 'Borrower'],
        ['tgt-party', 'PartyProfile'],
      ]),
      topK: 2,
    });

    expect(result.shortlist.topK).toBe(2);
    expect(result.shortlist.candidates).toHaveLength(2);
    expect(result.shortlist.candidates[0]?.targetFieldId).toBe('tgt-years');
    expect(result.shortlist.candidates[0]?.retrievalScore).toBeGreaterThanOrEqual(
      result.shortlist.candidates[1]?.retrievalScore ?? 0,
    );
  });

  it('promotes unknown-intent fields when alias evidence exists', () => {
    const sourceField = makeField({
      id: 'src-tenure',
      entityId: 'src-borrower',
      name: 'CUST_TENURE_MONTHS',
      label: 'Customer Tenure Months',
      description: 'Months customer has been with institution',
      dataType: 'integer',
    });
    const targetFields = [
      makeField({
        id: 'tgt-years',
        entityId: 'tgt-party',
        name: 'YearsWithFirm__c',
        label: 'Years With Firm',
        description: 'Customer relationship length',
        dataType: 'integer',
      }),
      makeField({
        id: 'tgt-name',
        entityId: 'tgt-party',
        name: 'Name',
        dataType: 'string',
      }),
    ];

    const result = retrieveCandidatesForSource(sourceField as never, targetFields as never, {
      entityNamesById: new Map([
        ['src-borrower', 'Borrower'],
        ['tgt-party', 'PartyProfile'],
      ]),
    });

    expect(result.rankedCandidates[0]?.targetField.id).toBe('tgt-years');
    expect(result.rankedCandidates[0]?.semanticMode).toBe('alias');
    expect(result.rankedCandidates[0]?.semanticScore ?? 0).toBeGreaterThan(0.35);
    expect(result.rankedCandidates[0]?.evidence.some((item) => item.includes('semantic'))).toBe(true);
  });

  it('returns all available candidates when fewer than K exist', () => {
    const sourceField = makeField({
      id: 'src-id',
      entityId: 'src-borrower',
      name: 'CustomerId',
      dataType: 'id',
    });
    const targetFields = [
      makeField({ id: 'tgt-ext', entityId: 'tgt-party', name: 'ExternalCustomerId__c', dataType: 'id' }),
      makeField({ id: 'tgt-name', entityId: 'tgt-party', name: 'Name', dataType: 'string' }),
    ];

    const result = retrieveCandidatesForSource(sourceField as never, targetFields as never, {
      topK: DEFAULT_RETRIEVAL_TOP_K,
    });

    expect(result.shortlist.topK).toBe(DEFAULT_RETRIEVAL_TOP_K);
    expect(result.shortlist.candidates).toHaveLength(2);
  });
});
