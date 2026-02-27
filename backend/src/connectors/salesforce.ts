import { v4 as uuidv4 } from 'uuid';
import jsforce from 'jsforce';
import type { Entity, Field, Relationship } from '../types.js';
import { normalizeSalesforceType } from '../utils/typeUtils.js';
import { getSalesforceMockObjectTemplates } from './salesforceMockCatalog.js';

export interface SalesforceConnectionInput {
  objects: string[];
  credentials?: {
    loginUrl?: string;
    username?: string;
    password?: string;
    securityToken?: string;
    accessToken?: string;
    instanceUrl?: string;
  };
}

export async function fetchSalesforceSchema(
  systemId: string,
  input: SalesforceConnectionInput,
): Promise<{ entities: Entity[]; fields: Field[]; relationships: Relationship[]; mode: 'live' | 'mock' }> {
  const creds = {
    loginUrl: input.credentials?.loginUrl || process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
    username: input.credentials?.username || process.env.SF_USERNAME,
    password: input.credentials?.password || process.env.SF_PASSWORD,
    securityToken: input.credentials?.securityToken || process.env.SF_SECURITY_TOKEN,
    accessToken: input.credentials?.accessToken || process.env.SF_ACCESS_TOKEN,
    instanceUrl: input.credentials?.instanceUrl || process.env.SF_INSTANCE_URL,
  };

  try {
    const conn = new jsforce.Connection(
      creds.accessToken && creds.instanceUrl
        ? { accessToken: creds.accessToken, instanceUrl: creds.instanceUrl }
        : { loginUrl: creds.loginUrl },
    );

    if (!creds.accessToken && creds.username && creds.password) {
      await conn.login(creds.username, `${creds.password}${creds.securityToken ?? ''}`);
    }

    const entities: Entity[] = [];
    const fields: Field[] = [];
    // Collect pending relationships to resolve after all entities are known
    const pendingRelationships: Array<{ fromEntityId: string; referenceTo: string; viaField: string }> = [];

    for (const objectName of input.objects) {
      const desc = await conn.sobject(objectName).describe();
      const entityId = uuidv4();
      entities.push({
        id: entityId,
        systemId,
        name: desc.name,
        label: desc.label,
        description: desc.labelPlural,
      });

      for (const f of desc.fields) {
        fields.push({
          id: uuidv4(),
          entityId,
          name: f.name,
          label: f.label,
          dataType: normalizeSalesforceType(f.type),
          length: f.length,
          precision: f.precision,
          scale: f.scale,
          required: !f.nillable && !f.defaultedOnCreate,
          isExternalId: !!f.externalId,
          picklistValues: f.picklistValues?.map((p) => p.value).filter(Boolean),
        });

        if (f.referenceTo?.length) {
          pendingRelationships.push({
            fromEntityId: entityId,
            referenceTo: String(f.referenceTo[0]),
            viaField: f.name,
          });
        }
      }
    }

    // Build name → id map after all entities have been collected
    const nameToEntityId = new Map(entities.map((e) => [e.name, e.id]));

    const relationships: Relationship[] = pendingRelationships.map((pr) => ({
      fromEntityId: pr.fromEntityId,
      toEntityId: nameToEntityId.get(pr.referenceTo) ?? pr.fromEntityId,
      type: 'lookup',
      viaField: pr.viaField,
    }));

    return { entities, fields, relationships, mode: 'live' };
  } catch {
    return buildMockSalesforceSchema(systemId, input.objects);
  }
}

function buildMockSalesforceSchema(
  systemId: string,
  objects: string[],
): { entities: Entity[]; fields: Field[]; relationships: Relationship[]; mode: 'mock' } {
  const seededTemplates: Record<string, Array<Omit<Field, 'id' | 'entityId'>>> = {
    Account: [
      { name: 'External_ID__c', dataType: 'string', isExternalId: true },
      { name: 'Name', dataType: 'string', required: true },
      { name: 'BillingStreet', dataType: 'string' },
      { name: 'BillingCity', dataType: 'string' },
      { name: 'BillingPostalCode', dataType: 'string' },
      { name: 'BillingCountry', dataType: 'string' },
    ],
    Contact: [
      { name: 'FirstName', dataType: 'string' },
      { name: 'LastName', dataType: 'string', required: true },
      { name: 'Email', dataType: 'email' },
      { name: 'Phone', dataType: 'phone' },
      { name: 'AccountId', dataType: 'reference' },
    ],
    Sales_Area__c: [
      {
        name: 'Sales_Org__c',
        dataType: 'picklist',
        picklistValues: ['1000', '2000', '3000'],
      },
      { name: 'Account__c', dataType: 'reference' },
    ],
    FinancialAccount: [
      { name: 'FinancialAccountNumber', dataType: 'string', required: true },
      { name: 'CurrentBalance', dataType: 'decimal' },
      { name: 'AvailableBalance', dataType: 'decimal' },
      { name: 'OpenDate', dataType: 'date' },
      { name: 'Status', dataType: 'picklist', picklistValues: ['Open', 'Inactive', 'Closed'] },
      { name: 'FinancialAccountType', dataType: 'picklist', picklistValues: ['Checking', 'Savings', 'Loan', 'Certificate', 'Line of Credit'] },
    ],
    PartyProfile: [
      { name: 'CIFNumber', dataType: 'string', isExternalId: true },
      { name: 'LegalName', dataType: 'string', required: true },
      { name: 'TaxId', dataType: 'string' },
      { name: 'BirthDate', dataType: 'date' },
      { name: 'PrimaryEmail', dataType: 'email' },
      { name: 'PrimaryPhone', dataType: 'phone' },
      { name: 'AddressLine1', dataType: 'string' },
      { name: 'City', dataType: 'string' },
      { name: 'StateCode', dataType: 'string' },
      { name: 'PostalCode', dataType: 'string' },
      { name: 'CountryCode', dataType: 'string' },
    ],
    AccountParticipant: [
      { name: 'FinancialAccountId', dataType: 'reference', required: true },
      { name: 'PartyProfileId', dataType: 'reference', required: true },
      { name: 'ParticipantRole', dataType: 'picklist', picklistValues: ['Primary Owner', 'Joint Owner', 'Authorized Signer', 'Beneficiary'] },
      { name: 'StartDate', dataType: 'date' },
      { name: 'EndDate', dataType: 'date' },
    ],
  };

  const templates = {
    ...seededTemplates,
    ...getSalesforceMockObjectTemplates(objects),
  };

  const entities: Entity[] = [];
  const fields: Field[] = [];

  for (const objectName of objects) {
    const entityId = uuidv4();
    entities.push({ id: entityId, systemId, name: objectName, label: objectName });
    for (const template of templates[objectName] ?? []) {
      fields.push({ id: uuidv4(), entityId, ...template });
    }
  }

  return { entities, fields, relationships: [], mode: 'mock' };
}
