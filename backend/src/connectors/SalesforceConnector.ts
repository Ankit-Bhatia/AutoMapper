/**
 * Salesforce Connector
 *
 * Implements IConnector for Salesforce CRM via jsforce library.
 * Protocol: REST API with OAuth 2.0 Web Server Flow authentication
 *
 * In live mode (valid credentials): connects to a real Salesforce org
 * In mock mode (no credentials): returns representative Account, Contact, Opportunity, Lead, Case objects
 */

import { v4 as uuidv4 } from 'uuid';
import jsforce from 'jsforce';
import type {
  IConnector,
  ConnectorCredentials,
  ConnectorField,
  ConnectorSchema,
  ConnectorSystemInfo,
  SampleRow,
} from '../connectors/IConnector.js';
import type { Entity, Relationship } from '../types.js';
import { normalizeSalesforceType } from '../utils/typeUtils.js';
import {
  getSalesforceMockObjectTemplatesForConnector,
  listSalesforceMockObjectNames,
} from '../connectors/salesforceMockCatalog.js';

interface SalesforceCredentials {
  accessToken?: string;
  instanceUrl?: string;
  refreshToken?: string;
  username?: string;
  password?: string;
  securityToken?: string;
  loginUrl?: string;
}

export class SalesforceConnector implements IConnector {
  private mode: 'live' | 'mock' = 'mock';
  private credentials: SalesforceCredentials = {};
  private conn: jsforce.Connection | null = null;
  private static readonly DEFAULT_MOCK_OBJECTS = ['Account', 'Contact', 'Opportunity', 'Lead', 'Case'];

  constructor(credentials?: ConnectorCredentials) {
    if (credentials) {
      this.credentials = {
        accessToken: credentials.accessToken,
        instanceUrl: credentials.instanceUrl,
        refreshToken: credentials.refreshToken,
        username: credentials.username,
        password: credentials.password,
        securityToken: credentials.securityToken,
        loginUrl: credentials.loginUrl,
      };
    }
  }

  async connect(credentials?: ConnectorCredentials): Promise<void> {
    const creds: SalesforceCredentials = {
      accessToken: credentials?.accessToken || this.credentials.accessToken || process.env.SF_ACCESS_TOKEN,
      instanceUrl: credentials?.instanceUrl || this.credentials.instanceUrl || process.env.SF_INSTANCE_URL,
      refreshToken: credentials?.refreshToken || this.credentials.refreshToken || process.env.SF_REFRESH_TOKEN,
      username: credentials?.username || this.credentials.username || process.env.SF_USERNAME,
      password: credentials?.password || this.credentials.password || process.env.SF_PASSWORD,
      securityToken: credentials?.securityToken || this.credentials.securityToken || process.env.SF_SECURITY_TOKEN,
      loginUrl: credentials?.loginUrl || this.credentials.loginUrl || process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
    };

    // Determine if we can run in live mode
    const hasOAuthToken = creds.accessToken && creds.instanceUrl;
    const hasUserPass = creds.username && creds.password;

    if (!hasOAuthToken && !hasUserPass) {
      this.mode = 'mock';
      return;
    }

    try {
      if (hasOAuthToken) {
        this.conn = new jsforce.Connection({
          accessToken: creds.accessToken,
          instanceUrl: creds.instanceUrl,
          refreshToken: creds.refreshToken,
        });
      } else if (hasUserPass) {
        this.conn = new jsforce.Connection({
          loginUrl: creds.loginUrl,
        });
        await this.conn.login(creds.username, `${creds.password}${creds.securityToken || ''}`);
      }

      this.mode = 'live';
      this.credentials = creds;
    } catch {
      this.mode = 'mock';
      this.conn = null;
    }
  }

  async listObjects(): Promise<string[]> {
    if (this.mode === 'live' && this.conn) {
      try {
        const result = await this.conn.describeGlobal();
        // Filter to queryable objects
        return result.sobjects
          .filter((obj) => obj.queryable)
          .map((obj) => obj.name);
      } catch {
        // Fallback to mock on error
        return this.getMockObjectList();
      }
    }
    return this.getMockObjectList();
  }

  private getMockObjectList(): string[] {
    const catalogObjects = listSalesforceMockObjectNames();
    if (catalogObjects.length === 0) return SalesforceConnector.DEFAULT_MOCK_OBJECTS;
    return Array.from(new Set([...catalogObjects, ...SalesforceConnector.DEFAULT_MOCK_OBJECTS])).sort((a, b) =>
      a.localeCompare(b)
    );
  }

  async fetchSchema(objectNames?: string[]): Promise<ConnectorSchema> {
    const objects = objectNames && objectNames.length > 0
      ? objectNames
      : await this.listObjects();

    const entities: Entity[] = [];
    const fields: ConnectorField[] = [];
    const pendingRelationships: Array<{ fromEntityId: string; referenceTo: string; viaField: string }> = [];

    if (this.mode === 'live' && this.conn) {
      try {
        for (const objectName of objects) {
          const desc = await this.conn.sobject(objectName).describe();
          const entityId = uuidv4();
          entities.push({
            id: entityId,
            systemId: '', // Set by the route handler
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
              isKey: f.type === 'id',
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

        // Build name → id map for relationships
        const nameToEntityId = new Map(entities.map((e) => [e.name, e.id]));
        const relationships: Relationship[] = pendingRelationships.map((pr) => ({
          fromEntityId: pr.fromEntityId,
          toEntityId: nameToEntityId.get(pr.referenceTo) ?? pr.fromEntityId,
          type: 'lookup',
          viaField: pr.viaField,
        }));

        return { entities, fields, relationships, mode: 'live' };
      } catch {
        // Fall through to mock
      }
    }

    // Mock schema
    return buildMockSalesforceSchema(objects);
  }

  async getSampleData(objectName: string, limit = 5): Promise<SampleRow[]> {
    if (this.mode === 'live' && this.conn) {
      try {
        const result = await this.conn.query(`SELECT * FROM ${objectName} LIMIT ${limit}`);
        return result.records.map((rec) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r: any = rec;
          delete r.attributes; // Remove Salesforce metadata
          return r;
        });
      } catch {
        // Fall through to mock
      }
    }

    // Mock data
    return buildMockSalesforceData(objectName, limit);
  }

  async testConnection(): Promise<{ connected: boolean; latencyMs: number; message?: string }> {
    if (this.mode === 'mock') {
      return { connected: true, latencyMs: 0, message: 'Mock mode — no credentials provided' };
    }

    if (!this.conn) {
      return { connected: false, latencyMs: 0, message: 'Not connected' };
    }

    const start = Date.now();
    try {
      await this.conn.identity();
      return { connected: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async getSystemInfo(): Promise<ConnectorSystemInfo> {
    return {
      displayName: 'Salesforce CRM',
      systemType: 'salesforce',
      mode: this.mode,
      protocol: 'REST/jsforce',
      version: '1.0.0',
      metadata: {
        apiVersion: 'v60.0',
        authMethod: this.credentials.accessToken ? 'OAuth 2.0' : 'Username/Password',
      },
    };
  }
}

// ─── Mock Schema and Data ──────────────────────────────────────────────────────

function buildMockSalesforceSchema(objectNames: string[]): ConnectorSchema {
  const seededTemplates: Record<string, Array<Omit<ConnectorField, 'id' | 'entityId'>>> = {
    Account: [
      { name: 'Id', label: 'ID', dataType: 'id', isKey: true, required: true },
      { name: 'Name', label: 'Account Name', dataType: 'string', length: 255, required: true, isExternalId: false },
      { name: 'BillingStreet', label: 'Billing Street', dataType: 'string', length: 255 },
      { name: 'BillingCity', label: 'Billing City', dataType: 'string', length: 40 },
      { name: 'BillingState', label: 'Billing State', dataType: 'string', length: 20 },
      { name: 'BillingPostalCode', label: 'Billing Zip/Postal Code', dataType: 'string', length: 20 },
      { name: 'BillingCountry', label: 'Billing Country', dataType: 'string', length: 40 },
      { name: 'Phone', label: 'Account Phone', dataType: 'phone' },
      { name: 'Fax', label: 'Account Fax', dataType: 'phone' },
      { name: 'Website', label: 'Website', dataType: 'string', length: 255 },
    ],
    Contact: [
      { name: 'Id', label: 'ID', dataType: 'id', isKey: true, required: true },
      { name: 'FirstName', label: 'First Name', dataType: 'string', length: 40 },
      { name: 'LastName', label: 'Last Name', dataType: 'string', length: 80, required: true },
      { name: 'Email', label: 'Email', dataType: 'email' },
      { name: 'Phone', label: 'Phone', dataType: 'phone' },
      { name: 'Title', label: 'Title', dataType: 'string', length: 128 },
      { name: 'Department', label: 'Department', dataType: 'string', length: 80 },
      { name: 'AccountId', label: 'Account ID', dataType: 'reference' },
    ],
    Opportunity: [
      { name: 'Id', label: 'ID', dataType: 'id', isKey: true, required: true },
      { name: 'Name', label: 'Opportunity Name', dataType: 'string', length: 120, required: true },
      { name: 'Amount', label: 'Amount', dataType: 'decimal', precision: 18, scale: 2 },
      { name: 'StageName', label: 'Stage', dataType: 'picklist', picklistValues: ['Prospecting', 'Qualification', 'Negotiation/Review', 'Closed Won', 'Closed Lost'], required: true },
      { name: 'CloseDate', label: 'Close Date', dataType: 'date', required: true },
      { name: 'Probability', label: 'Probability', dataType: 'number' },
      { name: 'AccountId', label: 'Account ID', dataType: 'reference', required: true },
    ],
    Lead: [
      { name: 'Id', label: 'ID', dataType: 'id', isKey: true, required: true },
      { name: 'FirstName', label: 'First Name', dataType: 'string', length: 40 },
      { name: 'LastName', label: 'Last Name', dataType: 'string', length: 80, required: true },
      { name: 'Email', label: 'Email', dataType: 'email' },
      { name: 'Phone', label: 'Phone', dataType: 'phone' },
      { name: 'Company', label: 'Company', dataType: 'string', length: 255, required: true },
      { name: 'Title', label: 'Title', dataType: 'string', length: 128 },
      { name: 'Status', label: 'Status', dataType: 'picklist', picklistValues: ['Open', 'Contacted', 'Qualified', 'Unqualified'], required: true },
    ],
    Case: [
      { name: 'Id', label: 'ID', dataType: 'id', isKey: true, required: true },
      { name: 'CaseNumber', label: 'Case Number', dataType: 'string', length: 255, required: true },
      { name: 'Subject', label: 'Subject', dataType: 'string', length: 255 },
      { name: 'Description', label: 'Description', dataType: 'text' },
      { name: 'Status', label: 'Status', dataType: 'picklist', picklistValues: ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed'], required: true },
      { name: 'Priority', label: 'Priority', dataType: 'picklist', picklistValues: ['Low', 'Medium', 'High'], required: true },
      { name: 'AccountId', label: 'Account ID', dataType: 'reference' },
      { name: 'ContactId', label: 'Contact ID', dataType: 'reference' },
    ],
  };

  const templates = {
    ...seededTemplates,
    ...getSalesforceMockObjectTemplatesForConnector(objectNames),
  };

  const entities: Entity[] = [];
  const fields: ConnectorField[] = [];

  for (const objectName of objectNames) {
    const entityId = uuidv4();
    entities.push({ id: entityId, systemId: '', name: objectName, label: objectName });
    for (const template of templates[objectName] ?? []) {
      fields.push({ id: uuidv4(), entityId, ...template });
    }
  }

  return { entities, fields, relationships: [], mode: 'mock' };
}

function buildMockSalesforceData(objectName: string, limit: number): SampleRow[] {
  const samples: Record<string, SampleRow[]> = {
    Account: [
      { Id: '001D000000IRFmaIAH', Name: 'Acme Corp', BillingCity: 'San Francisco', BillingCountry: 'USA', Phone: '415-555-1234' },
      { Id: '001D000000IRFmbIAH', Name: 'Global Tech Inc', BillingCity: 'New York', BillingCountry: 'USA', Phone: '212-555-5678' },
    ],
    Contact: [
      { Id: '003D000000IZ3SIAW1', FirstName: 'Jane', LastName: 'Smith', Email: 'jane@acme.com', Phone: '415-555-1234' },
      { Id: '003D000000IZ3SJAW1', FirstName: 'John', LastName: 'Doe', Email: 'john@tech.com', Phone: '212-555-5678' },
    ],
    Opportunity: [
      { Id: '006D000000I0OcIAV', Name: 'Enterprise License Agreement', Amount: 250000, StageName: 'Negotiation/Review', CloseDate: '2026-03-31' },
      { Id: '006D000000I0OdIAV', Name: 'SMB Package Deal', Amount: 50000, StageName: 'Prospecting', CloseDate: '2026-04-15' },
    ],
    Lead: [
      { Id: '00QD0000002STQKMA4', FirstName: 'Sarah', LastName: 'Johnson', Company: 'TechStart Inc', Email: 'sarah@techstart.com', Status: 'Open' },
      { Id: '00QD0000002STQLMA4', FirstName: 'Michael', LastName: 'Chen', Company: 'Finance Corp', Email: 'michael@finance.com', Status: 'Contacted' },
    ],
    Case: [
      { Id: '500D0000003BVfIAW', CaseNumber: 'CS-00001', Subject: 'License activation issue', Status: 'Open', Priority: 'High', Description: 'Customer cannot activate license' },
      { Id: '500D0000003BVgIAW', CaseNumber: 'CS-00002', Subject: 'Billing question', Status: 'Resolved', Priority: 'Medium', Description: 'Inquiry about renewal pricing' },
    ],
  };

  return (samples[objectName] ?? []).slice(0, limit);
}
