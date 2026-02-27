/**
 * SAP S/4HANA Connector
 *
 * Implements IConnector for SAP S/4HANA via OData v4 API.
 * Protocol: OData v4 with Basic Authentication
 *
 * In live mode (valid credentials): connects to a real SAP instance
 * In mock mode (no credentials): returns representative BusinessPartner, Customer, Supplier, GLAccount, CostCenter objects
 *
 * Fetches metadata from the Business Partner API ($metadata endpoint) and extracts
 * EntityType definitions and Property signatures.
 */

import { v4 as uuidv4 } from 'uuid';
import { XMLParser } from 'fast-xml-parser';
import type {
  IConnector,
  ConnectorCredentials,
  ConnectorField,
  ConnectorSchema,
  ConnectorSystemInfo,
  ComplianceTag,
  SampleRow,
} from '../connectors/IConnector.js';
import type { Entity, Relationship } from '../types.js';
import { normalizeODataType } from '../utils/typeUtils.js';

interface SAPCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  client?: string;
  language?: string;
}

export class SAPConnector implements IConnector {
  private mode: 'live' | 'mock' = 'mock';
  private credentials: SAPCredentials = {};

  constructor(credentials?: ConnectorCredentials) {
    if (credentials) {
      this.credentials = {
        baseUrl: credentials.baseUrl,
        username: credentials.username,
        password: credentials.password,
        client: credentials.client,
        language: credentials.language,
      };
    }
  }

  async connect(credentials?: ConnectorCredentials): Promise<void> {
    const creds: SAPCredentials = {
      baseUrl: credentials?.baseUrl || this.credentials.baseUrl || process.env.SAP_BASE_URL,
      username: credentials?.username || this.credentials.username || process.env.SAP_USERNAME,
      password: credentials?.password || this.credentials.password || process.env.SAP_PASSWORD,
      client: credentials?.client || this.credentials.client || process.env.SAP_CLIENT,
      language: credentials?.language || this.credentials.language || process.env.SAP_LANGUAGE || 'EN',
    };

    const hasValidCredentials = creds.baseUrl && creds.username && creds.password;

    if (!hasValidCredentials) {
      this.mode = 'mock';
      return;
    }

    try {
      // Test connection to $metadata endpoint
      await this.fetchMetadata(creds);
      this.mode = 'live';
      this.credentials = creds;
    } catch {
      this.mode = 'mock';
    }
  }

  async listObjects(): Promise<string[]> {
    if (this.mode === 'live' && this.credentials.baseUrl) {
      try {
        const metadata = await this.fetchMetadata(this.credentials);
        const parser = new XMLParser();
        const parsed = parser.parse(metadata);

        // Navigate to EntityType definitions
        const schema = parsed['edmx:Edmx']?.['edmx:DataServices']?.Schema;
        if (!schema) {
          return ['BusinessPartner', 'Customer', 'Supplier', 'GLAccount', 'CostCenter'];
        }

        // Handle single or multiple Schema elements
        const schemas = Array.isArray(schema) ? schema : [schema];
        const entityTypes = new Set<string>();

        for (const s of schemas) {
          const entities = s.EntityType;
          if (entities) {
            const entityArray = Array.isArray(entities) ? entities : [entities];
            for (const entity of entityArray) {
              if (entity.Name) {
                entityTypes.add(entity.Name);
              }
            }
          }
        }

        return Array.from(entityTypes).sort();
      } catch {
        return ['BusinessPartner', 'Customer', 'Supplier', 'GLAccount', 'CostCenter'];
      }
    }

    return ['BusinessPartner', 'Customer', 'Supplier', 'GLAccount', 'CostCenter'];
  }

  async fetchSchema(objectNames?: string[]): Promise<ConnectorSchema> {
    const objects = objectNames && objectNames.length > 0
      ? objectNames
      : await this.listObjects();

    const entities: Entity[] = [];
    const fields: ConnectorField[] = [];
    const relationships: Relationship[] = [];

    if (this.mode === 'live' && this.credentials.baseUrl) {
      try {
        const metadata = await this.fetchMetadata(this.credentials);
        const parser = new XMLParser();
        const parsed = parser.parse(metadata);

        const schema = parsed['edmx:Edmx']?.['edmx:DataServices']?.Schema;
        if (!schema) {
          return buildMockSAPSchema(objects);
        }

        // Handle single or multiple Schema elements
        const schemas = Array.isArray(schema) ? schema : [schema];
        const entityTypeMap = new Map<string, { properties: Array<{ Name: string; Type: string }> }>();

        for (const s of schemas) {
          const entityTypes = s.EntityType;
          if (entityTypes) {
            const entityArray = Array.isArray(entityTypes) ? entityTypes : [entityTypes];
            for (const et of entityArray) {
              if (et.Name && et.Property) {
                const props = Array.isArray(et.Property) ? et.Property : [et.Property];
                entityTypeMap.set(et.Name, { properties: props });
              }
            }
          }
        }

        // Build entities and fields from requested objects
        for (const objectName of objects) {
          const entityDef = entityTypeMap.get(objectName);
          if (!entityDef) continue;

          const entityId = uuidv4();
          entities.push({
            id: entityId,
            systemId: '', // Set by route handler
            name: objectName,
            label: objectName,
            description: `SAP ${objectName} entity`,
          });

          for (const prop of entityDef.properties) {
            const field: ConnectorField = {
              id: uuidv4(),
              entityId,
              name: prop.Name,
              label: prop.Name,
              dataType: normalizeODataType(prop.Type),
            };

            // Add compliance tags for financial fields
            if (this.isFinancialField(objectName, prop.Name)) {
              field.complianceTags = ['SOX_FINANCIAL'];
              field.complianceNote = 'Financial field requiring SOX change control';
            }

            fields.push(field);
          }
        }

        return { entities, fields, relationships, mode: 'live' };
      } catch {
        // Fall through to mock
      }
    }

    return buildMockSAPSchema(objects);
  }

  async getSampleData(objectName: string, limit = 5): Promise<SampleRow[]> {
    if (this.mode === 'live' && this.credentials.baseUrl) {
      try {
        const url = `${this.credentials.baseUrl}/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/business_partner/0001/${objectName}?$top=${limit}`;
        const response = await fetch(url, {
          headers: {
            Authorization: this.buildBasicAuth(this.credentials),
            Accept: 'application/json',
            'sap-client': this.credentials.client || '100',
          },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = (await response.json()) as { value: SampleRow[] };
          return (data.value ?? []).slice(0, limit);
        }
      } catch {
        // Fall through to mock
      }
    }

    return buildMockSAPData(objectName, limit);
  }

  async testConnection(): Promise<{ connected: boolean; latencyMs: number; message?: string }> {
    if (this.mode === 'mock') {
      return { connected: true, latencyMs: 0, message: 'Mock mode — no credentials provided' };
    }

    if (!this.credentials.baseUrl) {
      return { connected: false, latencyMs: 0, message: 'No credentials configured' };
    }

    const start = Date.now();
    try {
      await this.fetchMetadata(this.credentials);
      return { connected: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  async getSystemInfo(): Promise<ConnectorSystemInfo> {
    return {
      displayName: 'SAP S/4HANA',
      systemType: 'sap',
      mode: this.mode,
      protocol: 'OData v4',
      version: '1.0.0',
      metadata: {
        targetMarket: 'Enterprise ERP',
        authMethod: 'Basic Auth / OAuth 2.0',
        apiEndpoint: this.credentials.baseUrl || 'Not configured',
        client: this.credentials.client || 'Default',
      },
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────────

  private async fetchMetadata(creds: SAPCredentials): Promise<string> {
    const url = `${creds.baseUrl}/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/business_partner/0001/$metadata`;
    const response = await fetch(url, {
      headers: {
        Authorization: this.buildBasicAuth(creds),
        Accept: 'application/xml',
        'sap-client': creds.client || '100',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`SAP metadata request failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  private buildBasicAuth(creds: SAPCredentials): string {
    const credentials = `${creds.username}:${creds.password}`;
    const encoded = Buffer.from(credentials).toString('base64');
    return `Basic ${encoded}`;
  }

  private isFinancialField(objectName: string, fieldName: string): boolean {
    const financialObjects = ['GLAccount', 'CostCenter', 'ProfitCenter'];
    const financialFields = ['Amount', 'Balance', 'Debit', 'Credit', 'Rate', 'Value', 'Cost'];

    if (!financialObjects.includes(objectName)) {
      return false;
    }

    return financialFields.some((f) => fieldName.includes(f));
  }
}

// ─── Mock Schema and Data ──────────────────────────────────────────────────────

function buildMockSAPSchema(objectNames: string[]): ConnectorSchema {
  const templates: Record<string, Array<Omit<ConnectorField, 'id' | 'entityId'>>> = {
    BusinessPartner: [
      { name: 'Partner', label: 'Partner Number', dataType: 'string', isKey: true, required: true },
      { name: 'Name1', label: 'Name', dataType: 'string', length: 80, required: true },
      { name: 'SearchTerm1', label: 'Search Term', dataType: 'string', length: 20 },
      { name: 'Street', label: 'Street', dataType: 'string', length: 60 },
      { name: 'City', label: 'City', dataType: 'string', length: 40 },
      { name: 'PostalCode', label: 'Postal Code', dataType: 'string', length: 10 },
      { name: 'Country', label: 'Country', dataType: 'string', length: 3 },
      { name: 'Phone', label: 'Phone Number', dataType: 'phone' },
      { name: 'Email', label: 'Email Address', dataType: 'email' },
      { name: 'Industry', label: 'Industry', dataType: 'string', length: 4 },
    ],
    Customer: [
      { name: 'Customer', label: 'Customer Number', dataType: 'string', isKey: true, required: true },
      { name: 'Name', label: 'Customer Name', dataType: 'string', length: 80, required: true },
      { name: 'Currency', label: 'Currency Code', dataType: 'string', length: 5 },
      { name: 'PaymentTerms', label: 'Payment Terms', dataType: 'string', length: 4 },
      { name: 'PriceGroup', label: 'Price Group', dataType: 'string', length: 2 },
    ],
    Supplier: [
      { name: 'Supplier', label: 'Supplier Number', dataType: 'string', isKey: true, required: true },
      { name: 'Name', label: 'Supplier Name', dataType: 'string', length: 80, required: true },
      { name: 'PaymentTerms', label: 'Payment Terms', dataType: 'string', length: 4 },
      { name: 'Currency', label: 'Currency Code', dataType: 'string', length: 5 },
      { name: 'TaxNumber', label: 'Tax Number', dataType: 'string', length: 20 },
    ],
    GLAccount: [
      { name: 'ChartOfAccounts', label: 'Chart of Accounts', dataType: 'string', isKey: true, required: true },
      { name: 'GLAccount', label: 'GL Account Number', dataType: 'string', isKey: true, required: true, complianceTags: ['SOX_FINANCIAL'] as ComplianceTag[] },
      { name: 'AccountName', label: 'Account Name', dataType: 'string', length: 50, complianceTags: ['SOX_FINANCIAL'] as ComplianceTag[] },
      { name: 'AccountType', label: 'Account Type', dataType: 'picklist', picklistValues: ['A', 'B', 'C', 'D', 'E'], complianceTags: ['SOX_FINANCIAL'] as ComplianceTag[] },
      { name: 'Currency', label: 'Currency', dataType: 'string', length: 5, complianceTags: ['SOX_FINANCIAL'] as ComplianceTag[] },
      { name: 'DebitCredit', label: 'Debit/Credit Indicator', dataType: 'string', length: 1, complianceTags: ['SOX_FINANCIAL'] as ComplianceTag[] },
    ],
    CostCenter: [
      { name: 'ControllingArea', label: 'Controlling Area', dataType: 'string', isKey: true, required: true },
      { name: 'CostCenter', label: 'Cost Center', dataType: 'string', isKey: true, required: true, complianceTags: ['SOX_FINANCIAL'] as ComplianceTag[] },
      { name: 'Name', label: 'Cost Center Name', dataType: 'string', length: 50, complianceTags: ['SOX_FINANCIAL'] as ComplianceTag[] },
      { name: 'ResponsiblePerson', label: 'Responsible Person', dataType: 'string', length: 20 },
      { name: 'Department', label: 'Department', dataType: 'string', length: 4 },
    ],
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

function buildMockSAPData(objectName: string, limit: number): SampleRow[] {
  const samples: Record<string, SampleRow[]> = {
    BusinessPartner: [
      { Partner: '0000100001', Name1: 'Acme Manufacturing Ltd', SearchTerm1: 'ACME', Street: '123 Industrial Blvd', City: 'Frankfurt', PostalCode: '60311', Country: 'DE', Phone: '+49-69-123456', Email: 'info@acme.de', Industry: '2824' },
      { Partner: '0000100002', Name1: 'Global Trade Inc', SearchTerm1: 'GLOBAL', Street: '456 Commerce Ave', City: 'Hamburg', PostalCode: '20095', Country: 'DE', Phone: '+49-40-987654', Email: 'sales@global.de', Industry: '5110' },
    ],
    Customer: [
      { Customer: '0000100001', Name: 'Premium Corp', Currency: 'EUR', PaymentTerms: 'Z030', PriceGroup: 'A1' },
      { Customer: '0000100002', Name: 'Standard Ltd', Currency: 'EUR', PaymentTerms: 'Z045', PriceGroup: 'A2' },
    ],
    Supplier: [
      { Supplier: '0000100001', Name: 'Parts & Components GmbH', PaymentTerms: 'Z060', Currency: 'EUR', TaxNumber: 'DE123456789' },
      { Supplier: '0000100002', Name: 'Industrial Supplies AG', PaymentTerms: 'Z030', Currency: 'EUR', TaxNumber: 'DE987654321' },
    ],
    GLAccount: [
      { ChartOfAccounts: 'INT', GLAccount: '110000', AccountName: 'Cash and Cash Equivalents', AccountType: 'A', Currency: 'EUR', DebitCredit: 'D' },
      { ChartOfAccounts: 'INT', GLAccount: '200000', AccountName: 'Accounts Payable', AccountType: 'B', Currency: 'EUR', DebitCredit: 'C' },
    ],
    CostCenter: [
      { ControllingArea: 'A000', CostCenter: 'CC001', Name: 'Manufacturing', ResponsiblePerson: 'MUELLER', Department: '0001' },
      { ControllingArea: 'A000', CostCenter: 'CC002', Name: 'Sales', ResponsiblePerson: 'SCHNEIDER', Department: '0002' },
    ],
  };

  return (samples[objectName] ?? []).slice(0, limit);
}
