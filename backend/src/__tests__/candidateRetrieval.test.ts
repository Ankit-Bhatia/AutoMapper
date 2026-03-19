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

  it('prefers RiskClam payment targets over generic fee and disbursement fields on Loan', () => {
    const sourceField = makeField({
      id: 'src-payment',
      entityId: 'src-loan',
      name: 'AMT_PAYMENT',
      dataType: 'string',
    });
    const targetFields = [
      makeField({ id: 'tgt-fee', entityId: 'tgt-loan', name: 'Total_Fee_Amount__c', dataType: 'decimal' }),
      makeField({ id: 'tgt-disb', entityId: 'tgt-loan', name: 'Disbursement_Amount__c', dataType: 'decimal' }),
      makeField({ id: 'tgt-monthly', entityId: 'tgt-loan', name: 'Monthly_Payment__c', dataType: 'decimal' }),
    ];

    const result = retrieveCandidatesForSource(sourceField as never, targetFields as never, {
      entityNamesById: new Map([
        ['src-loan', 'LOAN'],
        ['tgt-loan', 'Loan'],
      ]),
    });

    expect(result.shortlist.candidates[0]?.targetFieldName).toBe('Monthly_Payment__c');
    expect(result.rankedCandidates[0]?.retrievalScore).toBeGreaterThan(result.rankedCandidates[1]?.retrievalScore ?? 0);
    expect(result.rankedCandidates[0]?.evidence).toContain('schema intelligence high match');
  });

  it('prefers DATE_APPROVAL credit-approved targets over generic open dates', () => {
    const sourceField = makeField({
      id: 'src-approval-date',
      entityId: 'src-product',
      name: 'DATE_APPROVAL',
      dataType: 'string',
    });
    const targetFields = [
      makeField({ id: 'tgt-open-date', entityId: 'tgt-financial-account', name: 'OpenDate', dataType: 'date' }),
      makeField({
        id: 'tgt-credit-approved',
        entityId: 'tgt-financial-account',
        name: 'Date_Credit_Approved__c',
        dataType: 'date',
      }),
    ];

    const result = retrieveCandidatesForSource(sourceField as never, targetFields as never, {
      entityNamesById: new Map([
        ['src-product', 'PRODUCT'],
        ['tgt-financial-account', 'FinancialAccount'],
      ]),
    });

    expect(result.shortlist.candidates[0]?.targetFieldName).toBe('Date_Credit_Approved__c');
    expect(result.rankedCandidates[0]?.retrievalScore).toBeGreaterThan(result.rankedCandidates[1]?.retrievalScore ?? 0);
    expect(result.rankedCandidates[0]?.evidence).toContain('schema intelligence high match');
  });

  it('prefers loan-specific amount targets over generic fee and disbursement fields', () => {
    const sourceField = makeField({
      id: 'src-approved-loan',
      entityId: 'src-loan',
      name: 'AMT_APPROVED_LOAN',
      dataType: 'string',
    });
    const targetFields = [
      makeField({ id: 'tgt-fee', entityId: 'tgt-loan', name: 'Total_Fee_Amount__c', dataType: 'decimal' }),
      makeField({ id: 'tgt-disb', entityId: 'tgt-loan', name: 'Disbursement_Amount__c', dataType: 'decimal' }),
      makeField({ id: 'tgt-loan-amount', entityId: 'tgt-loan', name: 'Loan_Amount_formula__c', dataType: 'decimal' }),
    ];

    const result = retrieveCandidatesForSource(sourceField as never, targetFields as never, {
      entityNamesById: new Map([
        ['src-loan', 'LOAN'],
        ['tgt-loan', 'Loan'],
      ]),
    });

    expect(result.shortlist.candidates[0]?.targetFieldName).toBe('Loan_Amount_formula__c');
    expect(result.rankedCandidates[0]?.evidence).toContain('schema intelligence medium match');
  });
});
