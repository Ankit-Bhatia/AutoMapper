import { describe, expect, it } from 'vitest';
import {
  buildValidationRuleIndex,
  loadSalesforceValidationRuleIndex,
} from '../../../packages/connectors/salesforceValidationRules.js';

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

  it('ignores scoped identifiers when extracting referenced field names', () => {
    const index = buildValidationRuleIndex({
      objectFieldNames: new Map([
        ['Account', ['Id', 'Name', 'OwnerId']],
      ]),
      records: [{
        ValidationName: 'Owner_Review_Required',
        ErrorConditionFormula: '$User.Id <> OwnerId && ISBLANK(Account.Name)',
        EntityDefinition: { QualifiedApiName: 'Account' },
      }],
    });

    expect(index.get('Account')?.get('Id')).toBeUndefined();
    expect(index.get('Account')?.get('Name')).toBeUndefined();
    expect(index.get('Account')?.get('OwnerId')).toHaveLength(1);
  });

  it('marks validation rules unavailable when the tooling query fails', async () => {
    const index = await loadSalesforceValidationRuleIndex({
      conn: {
        tooling: {
          query: async () => {
            throw new Error('tooling unavailable');
          },
        },
      } as never,
      objectFieldNames: new Map([
        ['Opportunity', ['StageName', 'Amount']],
      ]),
    });

    expect(index.get('Opportunity')?.get('StageName')?.[0]).toMatchObject({
      name: 'validation_rules_unavailable',
      entityName: 'Opportunity',
      kind: 'unavailable',
    });
    expect(index.get('Opportunity')?.get('Amount')?.[0]?.kind).toBe('unavailable');
  });
});
