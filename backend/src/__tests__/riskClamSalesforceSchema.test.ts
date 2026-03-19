import { describe, expect, it } from 'vitest';
import {
  augmentSalesforceSchemaForRiskClam,
  isRiskClamSourceSystem,
} from '../services/riskClamSalesforceSchema.js';

describe('riskClamSalesforceSchema', () => {
  it('detects RiskClam systems by type and BOSL naming', () => {
    expect(isRiskClamSourceSystem({ id: 'sys-1', name: 'RiskClam', type: 'riskclam' })).toBe(true);
    expect(isRiskClamSourceSystem({ id: 'sys-2', name: 'BOSL LOS Export', type: 'generic' })).toBe(true);
    expect(isRiskClamSourceSystem({ id: 'sys-3', name: 'Jack Henry', type: 'jackhenry' })).toBe(false);
  });

  it('augments mock Salesforce schema with RiskClam-specific FSC targets', () => {
    const schema = augmentSalesforceSchemaForRiskClam({
      mode: 'mock' as const,
      entities: [
        { id: 'entity-account', systemId: 'tgt', name: 'Account', label: 'Account' },
        { id: 'entity-fa', systemId: 'tgt', name: 'FinancialAccount', label: 'Financial Account' },
        { id: 'entity-app', systemId: 'tgt', name: 'IndividualApplication', label: 'Individual Application' },
      ],
      fields: [
        { id: 'field-account-id', entityId: 'entity-account', name: 'Id', dataType: 'id', required: true, isKey: true },
        { id: 'field-fa-id', entityId: 'entity-fa', name: 'Id', dataType: 'id', required: true, isKey: true },
        { id: 'field-app-id', entityId: 'entity-app', name: 'Id', dataType: 'id', required: true, isKey: true },
      ],
      relationships: [],
    });

    const financialAccount = schema.entities.find((entity) => entity.name === 'FinancialAccount');
    const individualApplication = schema.entities.find((entity) => entity.name === 'IndividualApplication');
    const loanEntity = schema.entities.find((entity) => entity.name === 'Loan');
    const loanPackageEntity = schema.entities.find((entity) => entity.name === 'LoanPackage');

    expect(financialAccount).toBeDefined();
    expect(individualApplication).toBeDefined();
    expect(loanEntity).toBeDefined();
    expect(loanPackageEntity).toBeDefined();

    expect(
      schema.fields.some((field) =>
        field.entityId === financialAccount?.id && field.name === 'FinServ__PaymentAmount__c'),
    ).toBe(true);
    expect(
      schema.fields.some((field) =>
        field.entityId === financialAccount?.id && field.name === 'Date_Credit_Approved__c'),
    ).toBe(true);
    expect(
      schema.fields.some((field) =>
        field.entityId === individualApplication?.id && field.name === 'Total_Debt_With_Us__c'),
    ).toBe(true);
    expect(
      schema.fields.some((field) =>
        field.entityId === individualApplication?.id && field.name === 'Residual_Income__c'),
    ).toBe(true);
  });
});
