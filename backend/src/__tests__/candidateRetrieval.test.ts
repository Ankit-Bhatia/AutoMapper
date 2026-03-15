import { describe, expect, it } from 'vitest';

import { retrieveCandidatesForSource, retrievalSummary } from '../services/candidateRetrieval.js';

const makeField = (overrides: Record<string, unknown>) => ({
  id: 'field-default',
  entityId: 'entity-default',
  name: 'Name',
  dataType: 'string',
  complianceTags: [],
  ...overrides,
});

describe('candidateRetrieval', () => {
  it('returns an explicit top-K shortlist with enriched evidence for unfamiliar fields', () => {
    const sourceField = makeField({
      id: 'src-tenure',
      entityId: 'src-borrower',
      name: 'CUST_TENURE_MONTHS',
      label: 'Customer Tenure Months',
      description: 'Months customer has been with institution',
    });
    const targetFields = [
      makeField({
        id: 'tgt-years',
        entityId: 'tgt-party',
        name: 'FinServ__YearsWithFirm__c',
        label: 'Years With Firm',
        description: 'Number of years customer has been with the institution',
        dataType: 'integer',
      }),
      makeField({
        id: 'tgt-name',
        entityId: 'tgt-party',
        name: 'Name',
      }),
      makeField({
        id: 'tgt-status',
        entityId: 'tgt-party',
        name: 'Status__c',
        dataType: 'picklist',
      }),
    ];

    const result = retrieveCandidatesForSource(
      sourceField as never,
      targetFields as never,
      {
        entityNamesById: new Map([
          ['src-borrower', 'Borrower'],
          ['tgt-party', 'PartyProfile'],
        ]),
        topK: 2,
      },
    );

    expect(result.rankedCandidates[0]?.targetField.id).toBe('tgt-years');
    expect(result.topCandidates).toHaveLength(2);
    expect(result.topCandidates[0]?.evidence.some((e) => e.includes('semantic'))).toBe(true);
    expect(retrievalSummary(result)).toContain('retrieval top-2');
    expect(retrievalSummary(result)).toContain('FinServ__YearsWithFirm__c');
  });

  it('uses embedding-assisted retrieval when vectors are present', () => {
    const sourceField = makeField({
      id: 'src-key',
      entityId: 'src-borrower',
      name: 'CUST_TENURE_MONTHS',
    });
    const targetFields = [
      makeField({ id: 'tgt-years', entityId: 'tgt-party', name: 'FinServ__YearsWithFirm__c', dataType: 'integer' }),
      makeField({ id: 'tgt-name', entityId: 'tgt-party', name: 'Name' }),
    ];

    const result = retrieveCandidatesForSource(
      sourceField as never,
      targetFields as never,
      {
        topK: 2,
        embeddingCache: new Map([
          ['src-key', [1, 0]],
          ['tgt-years', [1, 0]],
          ['tgt-name', [0, 1]],
        ]),
      },
    );

    expect(result.rankedCandidates[0]?.targetField.id).toBe('tgt-years');
    expect(result.rankedCandidates[0]?.semanticMode).toBe('embed');
    expect(result.rankedCandidates[0]?.evidence.some((e) => e.includes('embedding'))).toBe(true);
  });
});
