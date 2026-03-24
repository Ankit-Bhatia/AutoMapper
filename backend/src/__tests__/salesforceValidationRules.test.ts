import { describe, expect, it } from 'vitest';
import { buildValidationRuleIndex } from '../../../packages/connectors/salesforceValidationRules.js';

describe('salesforceValidationRules', () => {
  it('indexes active validation rules onto referenced and error-display fields', () => {
    const index = buildValidationRuleIndex({
      objectFieldNames: new Map([
        ['Opportunity', ['StageName', 'Amount', 'CloseDate', 'Name']],
      ]),
      records: [{
        ValidationName: 'Closed_Won_Requires_Amount_And_CloseDate',
        ErrorConditionFormula: 'ISPICKVAL(StageName, "Closed Won") && (ISBLANK(Amount) || ISBLANK(CloseDate))',
        ErrorDisplayField: 'StageName',
        ErrorMessage: 'Closed Won opportunities require Amount and CloseDate.',
        EntityDefinition: { QualifiedApiName: 'Opportunity' },
      }],
    });

    const stageRules = index.get('Opportunity')?.get('StageName') ?? [];
    const amountRules = index.get('Opportunity')?.get('Amount') ?? [];
    const closeDateRules = index.get('Opportunity')?.get('CloseDate') ?? [];

    expect(stageRules).toHaveLength(1);
    expect(amountRules).toHaveLength(1);
    expect(closeDateRules).toHaveLength(1);
    expect(stageRules[0]?.referencedFields).toEqual(expect.arrayContaining(['StageName', 'Amount', 'CloseDate']));
    expect(stageRules[0]?.errorMessage).toContain('Closed Won opportunities require Amount and CloseDate.');
  });

  it('ignores rules that do not reference known fields', () => {
    const index = buildValidationRuleIndex({
      objectFieldNames: new Map([
        ['Account', ['Name', 'BillingCity']],
      ]),
      records: [{
        ValidationName: 'Unrelated_Rule',
        ErrorConditionFormula: 'Some_Function($User.Id)',
        EntityDefinition: { QualifiedApiName: 'Account' },
      }],
    });

    expect(index.get('Account')).toBeUndefined();
  });
});
