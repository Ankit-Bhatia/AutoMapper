import { v4 as uuidv4 } from 'uuid';
import jsforce from 'jsforce';
import type { Entity, Field, Relationship } from '../types.js';
import { normalizeSalesforceType } from '../utils/typeUtils.js';

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
    const relationships: Relationship[] = [];

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
          relationships.push({
            fromEntityId: entityId,
            toEntityId: entityId,
            type: 'lookup',
            viaField: f.name,
          });
        }
      }
    }

    return { entities, fields, relationships, mode: 'live' };
  } catch {
    return buildMockSalesforceSchema(systemId, input.objects);
  }
}

function buildMockSalesforceSchema(
  systemId: string,
  objects: string[],
): { entities: Entity[]; fields: Field[]; relationships: Relationship[]; mode: 'mock' } {
  const templates: Record<string, Array<Omit<Field, 'id' | 'entityId'>>> = {
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
