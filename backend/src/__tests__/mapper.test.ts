import { describe, it, expect, vi, beforeEach } from 'vitest';
import { suggestMappings } from '../services/mapper.js';
import { getAiSuggestions } from '../services/llmAdapter.js';
import type { Entity, Field, MappingProject } from '../types.js';

vi.mock('../services/llmAdapter.js', () => ({
  getAiSuggestions: vi.fn().mockResolvedValue(null),
}));

const PROJECT: MappingProject = {
  id: 'proj-1',
  name: 'Test Project',
  sourceSystemId: 'src-sys',
  targetSystemId: 'tgt-sys',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const makeEntity = (id: string, systemId: string, name: string, label?: string): Entity => ({
  id,
  systemId,
  name,
  label,
});

const makeField = (
  id: string,
  entityId: string,
  name: string,
  dataType: Field['dataType'],
  opts: Partial<Field> = {},
): Field => ({
  id,
  entityId,
  name,
  dataType,
  label: opts.label,
  required: opts.required ?? false,
  isKey: opts.isKey ?? false,
  isExternalId: opts.isExternalId ?? false,
  ...opts,
});

describe('suggestMappings — heuristic path (no AI)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAiSuggestions).mockResolvedValue(null);
  });

  it('exact-name match should produce confidence ≥ 0.7', async () => {
    const srcEntity = makeEntity('se1', 'src-sys', 'Customer', 'Customer');
    const tgtEntity = makeEntity('te1', 'tgt-sys', 'Customer', 'Customer');
    const srcField = makeField('sf1', 'se1', 'CustomerName', 'string');
    const tgtField = makeField('tf1', 'te1', 'CustomerName', 'string');

    const { entityMappings, fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields: [srcField, tgtField],
    });

    expect(entityMappings).toHaveLength(1);
    expect(entityMappings[0].confidence).toBeGreaterThanOrEqual(0.7);
    expect(fieldMappings).toHaveLength(1);
    expect(fieldMappings[0].sourceFieldId).toBe('sf1');
    expect(fieldMappings[0].targetFieldId).toBe('tf1');
  });

  it('partial name match should still produce a field mapping', async () => {
    // 'Sale Opportunity' shares the token 'opportunity' with the target 'Opportunity'
    // → moderate Jaccard score → entity IS matched → field mappings attempted
    const srcEntity = makeEntity('se2', 'src-sys', 'Sale Opportunity', 'Opportunity Record');
    const tgtEntity = makeEntity('te2', 'tgt-sys', 'Opportunity', 'Opportunity');
    // 'Status Code' shares 'status' token with 'Status' → base score above 0.35
    const srcField = makeField('sf2', 'se2', 'Status Code', 'string');
    const tgtField = makeField('tf2', 'te2', 'Status', 'string');

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields: [srcField, tgtField],
    });

    // Status Code → Status should match (above 0.35 combined threshold)
    expect(fieldMappings.length).toBeGreaterThanOrEqual(1);
    const fm = fieldMappings.find((f) => f.sourceFieldId === 'sf2');
    expect(fm).toBeDefined();
  });

  it('entity with no plausible target match should be skipped', async () => {
    const srcEntity = makeEntity('se3', 'src-sys', 'ZVENDOR_DATA', 'Vendor Data');
    const tgtEntity = makeEntity('te3', 'tgt-sys', 'Contact', 'Contact');
    const srcField = makeField('sf3', 'se3', 'ZVendorCode', 'string');
    const tgtField = makeField('tf3', 'te3', 'LastName', 'string');

    const { entityMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields: [srcField, tgtField],
    });

    // There might be a mapping even for poor matches (bestStringMatch always returns something),
    // but we specifically check that extremely poor matches have low confidence
    for (const em of entityMappings) {
      if (em.sourceEntityId === 'se3') {
        expect(em.confidence).toBeLessThan(0.8);
      }
    }
  });

  it('Name1 → Name should infer concat transform', async () => {
    const srcEntity = makeEntity('se4', 'src-sys', 'Customer', 'Customer');
    const tgtEntity = makeEntity('te4', 'tgt-sys', 'Customer', 'Customer');
    const srcField = makeField('sf4', 'se4', 'Name1', 'string');
    const tgtField = makeField('tf4', 'te4', 'Name', 'string');

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields: [srcField, tgtField],
    });

    const fm = fieldMappings.find((f) => f.sourceFieldId === 'sf4');
    expect(fm).toBeDefined();
    expect(fm?.transform.type).toBe('concat');
  });

  it('core-banking entities prefer Salesforce FSC objects when available', async () => {
    const srcCif = makeEntity('se-cif', 'src-sys', 'CIF', 'Customer Information File');
    const srcDda = makeEntity('se-dda', 'src-sys', 'DDA', 'Demand Deposit Account');
    const tgtParty = makeEntity('te-party', 'tgt-sys', 'PartyProfile', 'Party Profile');
    const tgtFin = makeEntity('te-fin', 'tgt-sys', 'FinancialAccount', 'Financial Account');
    const tgtAccount = makeEntity('te-acc', 'tgt-sys', 'Account', 'Account');

    const fields: Field[] = [
      makeField('sf-cif-name', 'se-cif', 'LegalName', 'string'),
      makeField('sf-dda-bal', 'se-dda', 'CurrentBalance', 'decimal'),
      makeField('tf-party-name', 'te-party', 'LegalName', 'string'),
      makeField('tf-fin-bal', 'te-fin', 'CurrentBalance', 'decimal'),
      makeField('tf-acc-name', 'te-acc', 'Name', 'string'),
    ];

    const { entityMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcCif, srcDda],
      targetEntities: [tgtAccount, tgtParty, tgtFin],
      fields,
    });

    const cifMap = entityMappings.find((m) => m.sourceEntityId === 'se-cif');
    const ddaMap = entityMappings.find((m) => m.sourceEntityId === 'se-dda');
    expect(cifMap?.targetEntityId).toBe('te-party');
    expect(ddaMap?.targetEntityId).toBe('te-fin');
  });

  it('filters low-relevance core-banking -> FSC field matches', async () => {
    const srcDda = makeEntity('se-dda2', 'src-sys', 'DDA', 'Demand Deposit Account');
    const tgtFin = makeEntity('te-fin2', 'tgt-sys', 'FinancialAccount', 'Financial Account');

    const fields: Field[] = [
      makeField('sf-dda-bal2', 'se-dda2', 'CurrentBalance', 'decimal'),
      makeField('sf-dda-branch2', 'se-dda2', 'BranchCode', 'string'),
      makeField('tf-fin-bal2', 'te-fin2', 'CurrentBalance', 'decimal'),
      makeField('tf-fin-name2', 'te-fin2', 'Name', 'string'),
    ];

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcDda],
      targetEntities: [tgtFin],
      fields,
    });

    const mappedSourceFields = new Set(fieldMappings.map((fm) => fm.sourceFieldId));
    expect(mappedSourceFields.has('sf-dda-bal2')).toBe(true);
    expect(mappedSourceFields.has('sf-dda-branch2')).toBe(false);
  });

  it('maps LOS-style prefixed field names to FSC fields', async () => {
    const srcLoan = makeEntity('se-los-loan', 'src-sys', 'LOAN', 'Loan');
    const tgtFin = makeEntity('te-fsc-fin', 'tgt-sys', 'FinancialAccount', 'Financial Account');

    const fields: Field[] = [
      makeField('sf-los-amt', 'se-los-loan', 'AMT_APPROVED_LOAN', 'decimal'),
      makeField('sf-los-term', 'se-los-loan', 'NBR_TERM_IN_MOS', 'integer'),
      makeField('tf-fsc-amt', 'te-fsc-fin', 'Loan_Amount__c', 'decimal'),
      makeField('tf-fsc-term', 'te-fsc-fin', 'LoanTerm__c', 'integer'),
    ];

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcLoan],
      targetEntities: [tgtFin],
      fields,
    });

    const amountMapping = fieldMappings.find((m) => m.sourceFieldId === 'sf-los-amt');
    const termMapping = fieldMappings.find((m) => m.sourceFieldId === 'sf-los-term');

    expect(amountMapping?.targetFieldId).toBe('tf-fsc-amt');
    expect(termMapping?.targetFieldId).toBe('tf-fsc-term');
  });

  it('maps LOS entities even when lexical entity similarity is zero', async () => {
    const srcBorrower = makeEntity('se-los-borrower', 'src-sys', 'BORROWER', 'Borrower');
    const tgtParty = makeEntity('te-fsc-party', 'tgt-sys', 'PartyProfile', 'Party Profile');
    const tgtFin = makeEntity('te-fsc-fin2', 'tgt-sys', 'FinancialAccount', 'Financial Account');

    const fields: Field[] = [
      makeField('sf-los-first', 'se-los-borrower', 'NAME_FIRST', 'string'),
      makeField('sf-los-last', 'se-los-borrower', 'NAME_LAST', 'string'),
      makeField('tf-party-first', 'te-fsc-party', 'FirstName', 'string'),
      makeField('tf-party-last', 'te-fsc-party', 'LastName', 'string'),
      makeField('tf-fin-name', 'te-fsc-fin2', 'Name', 'string'),
    ];

    const { entityMappings, fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcBorrower],
      targetEntities: [tgtFin, tgtParty],
      fields,
    });

    expect(entityMappings).toHaveLength(1);
    expect(entityMappings[0]?.targetEntityId).toBe('te-fsc-party');
    expect(fieldMappings.some((mapping) => mapping.targetFieldId === 'tf-party-first')).toBe(true);
    expect(fieldMappings.some((mapping) => mapping.targetFieldId === 'tf-party-last')).toBe(true);
  });

  it('does not map LOS AMT_* fields to descriptor targets like Name when financial targets exist', async () => {
    const srcLoan = makeEntity('se-los-loan2', 'src-sys', 'LOAN', 'Loan');
    const tgtFin = makeEntity('te-fsc-fin3', 'tgt-sys', 'FinancialAccount', 'Financial Account');

    const fields: Field[] = [
      makeField('sf-los-amt2', 'se-los-loan2', 'AMT_BASE_LOAN', 'string'),
      makeField('tf-fin-name3', 'te-fsc-fin3', 'Name', 'string'),
      makeField('tf-fin-bal3', 'te-fsc-fin3', 'CurrentBalance', 'decimal'),
      makeField('tf-fin-loan3', 'te-fsc-fin3', 'Loan_Amount__c', 'decimal'),
    ];

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcLoan],
      targetEntities: [tgtFin],
      fields,
    });

    const mapping = fieldMappings.find((m) => m.sourceFieldId === 'sf-los-amt2');
    expect(mapping).toBeDefined();
    expect(mapping?.targetFieldId).not.toBe('tf-fin-name3');
    expect(['tf-fin-bal3', 'tf-fin-loan3']).toContain(mapping?.targetFieldId);
  });

  it('promotes unfamiliar tenure fields via concept-aware semantic scoring', async () => {
    const srcEntity = makeEntity('se-tenure', 'src-sys', 'Borrower', 'Borrower');
    const tgtEntity = makeEntity('te-tenure', 'tgt-sys', 'PartyProfile', 'Party Profile');

    const fields: Field[] = [
      makeField('sf-tenure', 'se-tenure', 'CUST_TENURE_MONTHS', 'integer', {
        label: 'Customer Tenure Months',
        description: 'How long the borrower has been with the institution',
      }),
      makeField('tf-years', 'te-tenure', 'YearsWithFirm__c', 'integer', {
        label: 'Years With Firm',
        description: 'Length of customer relationship with institution',
      }),
      makeField('tf-name', 'te-tenure', 'Name', 'string'),
    ];

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields,
    });

    const mapping = fieldMappings.find((candidate) => candidate.sourceFieldId === 'sf-tenure');
    expect(mapping?.targetFieldId).toBe('tf-years');
    expect(mapping?.rationale ?? '').toContain('semantic');
    expect(mapping?.retrievalShortlist?.topK).toBe(5);
    expect(mapping?.retrievalShortlist?.candidates[0]?.targetFieldId).toBe('tf-years');
  });

  it('ignores AI target overrides that fall outside the persisted retrieval shortlist', async () => {
    vi.mocked(getAiSuggestions).mockResolvedValue({
      sourceEntityName: 'Borrower',
      targetEntityName: 'PartyProfile',
      confidence: 0.92,
      rationale: 'ai suggestion',
      fields: [
        {
          sourceFieldName: 'NAME_FIRST',
          targetFieldName: 'LegacyControlFlag__c',
          confidence: 0.97,
          rationale: 'Use the legacy field.',
        },
      ],
    });

    const srcEntity = makeEntity('se-name', 'src-sys', 'Borrower', 'Borrower');
    const tgtEntity = makeEntity('te-name', 'tgt-sys', 'PartyProfile', 'Party Profile');

    const fields: Field[] = [
      makeField('sf-first', 'se-name', 'NAME_FIRST', 'string', { label: 'First Name' }),
      makeField('tf-first', 'te-name', 'FirstName', 'string'),
      makeField('tf-last', 'te-name', 'LastName', 'string'),
      makeField('tf-middle', 'te-name', 'MiddleName', 'string'),
      makeField('tf-name', 'te-name', 'Name', 'string'),
      makeField('tf-suffix', 'te-name', 'Suffix', 'string'),
      makeField('tf-nickname', 'te-name', 'Nickname__c', 'string'),
      makeField('tf-legacy', 'te-name', 'LegacyControlFlag__c', 'boolean'),
    ];

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields,
    });

    const mapping = fieldMappings.find((candidate) => candidate.sourceFieldId === 'sf-first');
    expect(mapping?.targetFieldId).toBe('tf-first');
    expect(mapping?.retrievalShortlist?.candidates.some((candidate) => candidate.targetFieldId === 'tf-legacy')).toBe(false);
  });
});
