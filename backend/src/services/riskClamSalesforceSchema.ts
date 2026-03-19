import { randomUUID } from 'node:crypto';
import { CONFIRMED_PATTERNS } from '../agents/schemaIntelligenceData.js';
import type { DataType, Entity, Field, Relationship, System } from '../types.js';

interface SalesforceSchemaLike {
  entities: Entity[];
  fields: Field[];
  relationships: Relationship[];
  mode: 'live' | 'mock';
}

const ENTITY_ALIASES: Record<string, string[]> = {
  account: ['Account'],
  contact: ['Contact'],
  financialaccount: ['FinancialAccount'],
  'financial account': ['FinancialAccount'],
  loan: ['FinancialAccount', 'Loan'],
  loanpackage: ['IndividualApplication', 'LoanPackage'],
  'loan package': ['IndividualApplication', 'LoanPackage'],
  pit: ['IndividualApplication', 'PIT'],
  collateral: ['FinancialAccount', 'Collateral'],
  fee: ['FinancialAccount', 'FEE'],
};

const DEFAULT_ENTITY_FIELDS: Record<string, Array<Pick<Field, 'name' | 'dataType' | 'required' | 'isKey'>>> = {
  Loan: [
    { name: 'Id', dataType: 'id', required: true, isKey: true },
    { name: 'Name', dataType: 'string', required: true, isKey: false },
  ],
  LoanPackage: [
    { name: 'Id', dataType: 'id', required: true, isKey: true },
    { name: 'Name', dataType: 'string', required: true, isKey: false },
  ],
  PIT: [
    { name: 'Id', dataType: 'id', required: true, isKey: true },
    { name: 'Name', dataType: 'string', required: true, isKey: false },
  ],
  Collateral: [
    { name: 'Id', dataType: 'id', required: true, isKey: true },
    { name: 'Name', dataType: 'string', required: true, isKey: false },
  ],
  FEE: [
    { name: 'Id', dataType: 'id', required: true, isKey: true },
    { name: 'Name', dataType: 'string', required: true, isKey: false },
  ],
};

const MANUAL_TARGET_FIELDS_BY_ENTITY: Record<string, Array<Pick<Field, 'name' | 'dataType' | 'description'>>> = {
  FinancialAccount: [
    { name: 'FinServ__PaymentAmount__c', dataType: 'decimal', description: 'FSC standard payment amount target for RiskClam loan/payment fields.' },
    { name: 'Monthly_Payment__c', dataType: 'decimal', description: 'Custom monthly payment target used by BOSL RiskClam mappings.' },
    { name: 'FinServ__LoanAmount__c', dataType: 'decimal', description: 'FSC standard loan amount target for original or approved loan amounts.' },
    { name: 'Original_Amount__c', dataType: 'decimal', description: 'Custom original loan amount target used in RiskClam mappings.' },
    { name: 'Original_Loan_Amount__c', dataType: 'decimal', description: 'Alternate original loan amount target used in RiskClam mappings.' },
    { name: 'Date_Credit_Approved__c', dataType: 'date', description: 'Credit approval date target for RiskClam DATE_APPROVAL.' },
    { name: 'Date_Funded__c', dataType: 'date', description: 'Funding date target for RiskClam DATE_FUNDED.' },
    { name: 'Current_Balance__c', dataType: 'decimal', description: 'Current balance target used alongside FSC balance fields.' },
    { name: 'Available_Balance__c', dataType: 'decimal', description: 'Available balance target used alongside FSC balance fields.' },
    { name: 'Current_Balance_of_Existing_Debt__c', dataType: 'decimal', description: 'Existing debt balance target for package debt calculations.' },
    { name: 'Total_Package_Debt__c', dataType: 'decimal', description: 'Aggregate package debt target for total current balance fields.' },
    { name: 'Total_Debt_With_Us__c', dataType: 'decimal', description: 'Total debt with the institution for RiskClam package fields.' },
  ],
  IndividualApplication: [
    { name: 'Approved_New_Debt_1__c', dataType: 'decimal', description: 'Approved payment amount target on application/package records.' },
    { name: 'Package_Total_Indirect_Liabilities__c', dataType: 'decimal', description: 'Indirect liabilities target for RiskClam loan package fields.' },
    { name: 'Debt_To_Income_Ratio__c', dataType: 'decimal', description: 'Debt-to-income ratio target for package underwriting.' },
    { name: 'DIR__c', dataType: 'decimal', description: 'Legacy DIR field used by RiskClam package mappings.' },
    { name: 'Approval_Officer__c', dataType: 'string', description: 'Approval officer target for credit package routing.' },
    { name: 'Credit_Officer__c', dataType: 'string', description: 'Credit officer target for credit package routing.' },
    { name: 'Residual_Income__c', dataType: 'decimal', description: 'Residual income target surfaced from package/PIT mapping intelligence.' },
    { name: 'Total_Annual_Income__c', dataType: 'decimal', description: 'Total annual income target for package-level assessment.' },
    { name: 'Current_Total_Monthly_Debt__c', dataType: 'decimal', description: 'Total monthly debt target for application-level affordability.' },
    { name: 'Total_Debt_With_Us__c', dataType: 'decimal', description: 'Institution debt total target for application/package mappings.' },
    { name: 'Total_Assets__c', dataType: 'decimal', description: 'Total assets target for application/package mappings.' },
  ],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function inferTargetDataTypeFromXmlField(xmlField: string): DataType {
  const upper = xmlField.toUpperCase();
  if (/^(AMT|PERC|PCT)_/.test(upper)) return 'decimal';
  if (/^(DATE|DT)_/.test(upper)) return 'date';
  if (/^Y_/.test(upper) || /^IND_/.test(upper)) return 'boolean';
  if (/^(CODE|CD|TYP)_/.test(upper)) return 'picklist';
  if (/^EMAIL_/.test(upper)) return 'email';
  if (/^PHONE_/.test(upper)) return 'phone';
  if (/^NBR_/.test(upper)) return 'integer';
  return 'string';
}

function resolveAliasEntities(patternObject: string): string[] {
  const normalized = normalize(patternObject);
  return ENTITY_ALIASES[normalized] ?? [patternObject.replace(/\s+/g, '')];
}

function ensureEntity(
  entityName: string,
  systemId: string,
  entities: Entity[],
  entityIdByName: Map<string, string>,
  fields: Field[],
): string {
  const existingId = entityIdByName.get(normalize(entityName));
  if (existingId) return existingId;

  const entityId = randomUUID();
  entities.push({
    id: entityId,
    systemId,
    name: entityName,
    label: entityName,
  });
  entityIdByName.set(normalize(entityName), entityId);

  for (const template of DEFAULT_ENTITY_FIELDS[entityName] ?? []) {
    fields.push({
      id: randomUUID(),
      entityId,
      name: template.name,
      label: template.name,
      dataType: template.dataType,
      required: template.required,
      isKey: template.isKey,
    });
  }

  return entityId;
}

function addFieldIfMissing(
  fields: Field[],
  fieldKeySet: Set<string>,
  entityId: string,
  field: Pick<Field, 'name' | 'dataType' | 'description'>,
) {
  const key = `${entityId}:${normalize(field.name)}`;
  if (fieldKeySet.has(key)) return;
  fields.push({
    id: randomUUID(),
    entityId,
    name: field.name,
    label: field.name,
    description: field.description,
    dataType: field.dataType,
    required: false,
  });
  fieldKeySet.add(key);
}

export function isRiskClamSourceSystem(system: System | undefined): boolean {
  if (!system) return false;
  return system.type === 'riskclam' || /risk\s*clam|bosl/i.test(system.name);
}

export function augmentSalesforceSchemaForRiskClam<T extends SalesforceSchemaLike>(schema: T): T {
  if (schema.mode !== 'mock') return schema;

  const entities = [...schema.entities];
  const fields = [...schema.fields];
  const relationships = [...schema.relationships];
  const systemId = entities[0]?.systemId ?? '';
  const entityIdByName = new Map(entities.map((entity) => [normalize(entity.name), entity.id]));
  const fieldKeySet = new Set(fields.map((field) => `${field.entityId}:${normalize(field.name)}`));

  for (const [entityName, manualFields] of Object.entries(MANUAL_TARGET_FIELDS_BY_ENTITY)) {
    const entityId = ensureEntity(entityName, systemId, entities, entityIdByName, fields);
    for (const field of manualFields) {
      addFieldIfMissing(fields, fieldKeySet, entityId, field);
    }
  }

  for (const patterns of Object.values(CONFIRMED_PATTERNS)) {
    for (const pattern of patterns) {
      const aliasEntities = resolveAliasEntities(pattern.sfObject);
      for (const entityName of aliasEntities) {
        const entityId = ensureEntity(entityName, systemId, entities, entityIdByName, fields);
        for (const apiName of pattern.sfApiNames) {
          addFieldIfMissing(fields, fieldKeySet, entityId, {
            name: apiName,
            description: pattern.notes,
            dataType: inferTargetDataTypeFromXmlField(pattern.xmlField),
          });
        }
      }
    }
  }

  return {
    ...schema,
    entities,
    fields,
    relationships,
  };
}
