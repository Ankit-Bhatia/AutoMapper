/**
 * AutoMapper MCP Server (Standalone)
 * ====================================
 * Exposes AutoMapper's connector schema and mapping capabilities as
 * Model Context Protocol tools — so Claude, Cursor, Claude Code, and
 * any other MCP-compatible AI agent can call them directly.
 *
 * Transport: StreamableHTTP (MCP 2025-03 spec, recommended in 2026)
 * Port:      4001  (demo REST API runs on 4000)
 *
 * Add to Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "automapper": {
 *       "command": "node",
 *       "args": ["/path/to/AutoMapper-main/mcp-server.mjs"]
 *     }
 *   }
 * }
 *
 * Or call directly via StreamableHTTP at http://localhost:4001/mcp
 *
 * Exposed tools:
 *   automapper_list_connectors   — list available connectors + metadata
 *   automapper_get_system_info   — get system metadata for a connector
 *   automapper_fetch_schema      — get full entity/field schema from connector
 *   automapper_get_sample_data   — get sample rows for an entity
 *   automapper_test_connection   — test a connector's connection health
 *   automapper_suggest_mappings  — Jaccard-based field mapping between two connectors
 *   automapper_analyze_compliance — flag GLBA/PCI/SOX/FFIEC/BSA issues in a mapping
 */

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';

const PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 4001;
const USE_STDIO = process.argv.includes('--stdio');

// ─── Inline connector registry (mirrors demo-server.mjs schemas) ───────────────

const CONNECTORS = {
  'jackhenry-silverlake': {
    id: 'jackhenry-silverlake',
    displayName: 'Jack Henry SilverLake',
    category: 'banking',
    description: 'Core banking for commercial banks. jXchange SOAP/XML + OAuth 2.0.',
    protocol: 'SOAP/jXchange (ISO 20022)',
    systemType: 'jackhenry',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'clientId', 'clientSecret'],
    docsUrl: 'https://jackhenry.dev/jxchange-soap/',
    metadata: {
      targetMarket: 'Commercial Banks',
      iso20022MigrationComplete: 'July 14, 2025',
      oauthTokenExpirySecs: 600,
      oauthMandatoryDate: 'April 2028',
      acctTypeCodes: { deposit: 'D', loan: 'L', timeDeposit: 'T', safeDepositBox: 'B' },
      jxchangeOperations: ['CustInq', 'AcctInq', 'AcctSrch', 'CustSrch', 'AddrSrch', 'LnInq', 'LnBilSrch', 'GlInq', 'SvcDictSrch'],
    },
  },
  'jackhenry-coredirector': {
    id: 'jackhenry-coredirector',
    displayName: 'Jack Henry Core Director',
    category: 'banking',
    description: 'Core banking for community banks. jXchange SOAP/XML + OAuth 2.0.',
    protocol: 'SOAP/jXchange (ISO 20022)',
    systemType: 'jackhenry',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'clientId', 'clientSecret'],
    docsUrl: 'https://jackhenry.dev/jxchange-soap/api-provider/core-director/',
    metadata: {
      targetMarket: 'Community Banks',
      iso20022MigrationComplete: 'July 14, 2025',
      oauthTokenExpirySecs: 600,
      oauthMandatoryDate: 'April 2028',
      acctTypeCodes: { deposit: '10', loan: '40', lineOfCredit: '60', mortgage: '70' },
      jxchangeOperations: ['CustInq', 'AcctInq', 'AcctSrch', 'CustSrch', 'AddrSrch', 'LnInq', 'LnBilSrch', 'GlInq', 'SvcDictSrch'],
    },
  },
  'jackhenry-symitar': {
    id: 'jackhenry-symitar',
    displayName: 'Jack Henry Symitar (Episys)',
    category: 'banking',
    description: 'Core banking for credit unions. SymXchange REST API + OAuth 2.0.',
    protocol: 'REST/SymXchange',
    systemType: 'jackhenry',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'clientId', 'clientSecret', 'institutionId'],
    docsUrl: 'https://jackhenry.dev/symxchange/',
    metadata: { targetMarket: 'Credit Unions' },
  },
  salesforce: {
    id: 'salesforce',
    displayName: 'Salesforce CRM',
    category: 'crm',
    description: 'Salesforce platform via REST API + jsforce.',
    protocol: 'REST/jsforce',
    systemType: 'salesforce',
    hasMockMode: true,
    requiredCredentials: ['loginUrl', 'username', 'password', 'securityToken'],
    docsUrl: 'https://developer.salesforce.com/',
  },
  sap: {
    id: 'sap',
    displayName: 'SAP S/4HANA',
    category: 'erp',
    description: 'SAP S/4HANA ERP via OData v4.',
    protocol: 'OData v4',
    systemType: 'sap',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'username', 'password', 'client'],
    docsUrl: 'https://api.sap.com/',
  },
};

// ─── Inline schemas (subset — key entities + fields with compliance metadata) ──

const SCHEMAS = {
  'jackhenry-silverlake': {
    entities: [
      { name: 'CIF', label: 'Customer Information File', description: 'Master customer record. jXchange: CustInq.' },
      { name: 'DDA', label: 'Demand Deposit Account', description: 'Checking/savings. AcctInq, AcctType="D".' },
      { name: 'LoanAccount', label: 'Loan Account', description: 'Loans. LnInq, AcctType="L".' },
      { name: 'GLAccount', label: 'General Ledger Account', description: 'Chart of accounts. GlInq.' },
    ],
    fields: {
      CIF: [
        { name: 'CIFNumber', label: 'CIF Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'PartyIdentification', jxchangeXPath: 'CustInq.Rs.CustRec.CustId' },
        { name: 'TaxID', label: 'Tax Identification Number', dataType: 'string', complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT', 'BSA_AML'], complianceNote: 'SSN/EIN — mask in non-production. TIN codes: SSN|EIN|Forn', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.TaxId', jxchangeXtendElemKey: 'x_TaxDetail' },
        { name: 'LegalName', label: 'Legal Name', dataType: 'string', required: true, complianceTags: ['GLBA_NPI'], iso20022Name: 'Name', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonName.ComName' },
        { name: 'DateOfBirth', label: 'Date of Birth', dataType: 'date', complianceTags: ['GLBA_NPI'], iso20022Name: 'BirthDate', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.BirthDt' },
        { name: 'PrimaryEmail', label: 'Primary Email', dataType: 'email', complianceTags: ['GLBA_NPI'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.EmailArray.EmailInfo.EmailAddr' },
        { name: 'PrimaryPhone', label: 'Primary Phone', dataType: 'phone', complianceTags: ['GLBA_NPI'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PhoneNum' },
        { name: 'AddressLine1', label: 'Address Line 1', dataType: 'string', complianceTags: ['GLBA_NPI'], jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.Addr1' },
        { name: 'City', label: 'City', dataType: 'string', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.City' },
        { name: 'StateCode', label: 'State', dataType: 'string', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.StateProv' },
        { name: 'PostalCode', label: 'Postal Code', dataType: 'string', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.PostalCode' },
        { name: 'CustomerType', label: 'Customer Type', dataType: 'picklist', picklistValues: ['Individual', 'Business', 'Trust', 'Government'] },
        { name: 'CustomerStatus', label: 'Status', dataType: 'picklist', picklistValues: ['Active', 'Inactive', 'Deceased', 'Blocked'], complianceTags: ['BSA_AML'] },
        { name: 'RiskRating', label: 'Risk Rating', dataType: 'picklist', picklistValues: ['Low', 'Medium', 'High', 'Prohibited'], complianceTags: ['BSA_AML', 'FFIEC_AUDIT'] },
        { name: 'OpenDate', label: 'Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'] },
        { name: 'BranchCode', label: 'Branch Code', dataType: 'string', required: true, complianceTags: ['FFIEC_AUDIT'] },
      ],
      DDA: [
        { name: 'AccountNumber', label: 'Account Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.DepAcctId.AcctId' },
        { name: 'CIFNumber', label: 'CIF Number (Owner)', dataType: 'string', required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CustId' },
        { name: 'AccountType', label: 'Account Type', dataType: 'picklist', picklistValues: ['Checking', 'Savings', 'MoneyMarket', 'CDAccount'], complianceNote: 'SilverLake AcctType="D"' },
        { name: 'AccountStatus', label: 'Status', dataType: 'picklist', picklistValues: ['Open', 'Closed', 'Frozen', 'Dormant'], complianceTags: ['BSA_AML'] },
        { name: 'CurrentBalance', label: 'Current Balance (Ledger)', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CurBal' },
        { name: 'CollectedBalance', label: 'Collected Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CollBal' },
        { name: 'AvailableBalance', label: 'Available Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.AvailBal' },
        { name: 'InterestRate', label: 'Interest Rate', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.IntRate' },
        { name: 'OpenDate', label: 'Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'] },
      ],
      LoanAccount: [
        { name: 'LoanNumber', label: 'Loan Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'LnInq.Rs.LnAcctId.AcctId', complianceNote: 'AcctType="L" for SilverLake' },
        { name: 'CIFNumber', label: 'CIF Number (Borrower)', dataType: 'string', required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'LnInq.Rs.LnAcctRec.LnAcctInfo.CustId' },
        { name: 'LoanType', label: 'Loan Type', dataType: 'picklist', picklistValues: ['Mortgage', 'HELOC', 'AutoLoan', 'PersonalLoan', 'CommercialLoan', 'LineOfCredit'], jxchangeXPath: 'LnInq.Rs.LnAcctRec.LnAcctInfo.LnType' },
        { name: 'LoanStatus', label: 'Status', dataType: 'picklist', picklistValues: ['Current', 'Delinquent', 'Default', 'PaidOff', 'ChargedOff'], complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'] },
        { name: 'OriginalPrincipal', label: 'Original Principal', dataType: 'decimal', required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'LnInq.Rs.LnAcctRec.LnAcctInfo.OrigPrinAmt' },
        { name: 'CurrentBalance', label: 'Outstanding Principal', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'LnInq.Rs.LnAcctRec.LnAcctInfo.CurPrinBal' },
        { name: 'InterestRate', label: 'Interest Rate', dataType: 'decimal', required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'LnInq.Rs.LnAcctRec.LnAcctInfo.IntRate' },
        { name: 'MaturityDate', label: 'Maturity Date', dataType: 'date', required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'LnInq.Rs.LnAcctRec.LnAcctInfo.MaturityDt' },
      ],
      GLAccount: [
        { name: 'GLAccountNumber', label: 'GL Account Number', dataType: 'string', isKey: true, required: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'], jxchangeXPath: 'GlInq.Rs.GlAcctId.AcctId' },
        { name: 'AccountDescription', label: 'Description', dataType: 'string', required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GlInq.Rs.GlAcctRec.GlAcctInfo.Desc' },
        { name: 'AccountCategory', label: 'Category', dataType: 'picklist', picklistValues: ['Asset', 'Liability', 'Equity', 'Income', 'Expense'], required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GlInq.Rs.GlAcctRec.GlAcctInfo.AcctType' },
        { name: 'DebitBalance', label: 'Debit Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GlInq.Rs.GlAcctRec.GlAcctInfo.DebitBal' },
        { name: 'CreditBalance', label: 'Credit Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GlInq.Rs.GlAcctRec.GlAcctInfo.CreditBal' },
        { name: 'LastPostingDate', label: 'Last Posting Date', dataType: 'date', complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'GlInq.Rs.GlAcctRec.GlAcctInfo.LastPostDt' },
      ],
    },
  },
  salesforce: {
    entities: [
      { name: 'Account', label: 'Account', description: 'Company or organization.' },
      { name: 'Contact', label: 'Contact', description: 'Individual person.' },
      { name: 'Opportunity', label: 'Opportunity', description: 'Sales deal.' },
    ],
    fields: {
      Account: [
        { name: 'Id', label: 'Salesforce Account ID', dataType: 'string', isKey: true, required: true },
        { name: 'Name', label: 'Account Name', dataType: 'string', required: true },
        { name: 'AccountNumber', label: 'Account Number', dataType: 'string' },
        { name: 'Type', label: 'Account Type', dataType: 'picklist', picklistValues: ['Customer', 'Partner', 'Prospect'] },
        { name: 'BillingStreet', label: 'Billing Street', dataType: 'string' },
        { name: 'BillingCity', label: 'Billing City', dataType: 'string' },
        { name: 'BillingState', label: 'Billing State', dataType: 'string' },
        { name: 'BillingPostalCode', label: 'Billing Postal Code', dataType: 'string' },
        { name: 'Phone', label: 'Phone', dataType: 'phone' },
        { name: 'Website', label: 'Website', dataType: 'url' },
        { name: 'Industry', label: 'Industry', dataType: 'picklist', picklistValues: ['Banking', 'Finance', 'Technology'] },
        { name: 'AnnualRevenue', label: 'Annual Revenue', dataType: 'decimal' },
      ],
      Contact: [
        { name: 'Id', label: 'Salesforce Contact ID', dataType: 'string', isKey: true, required: true },
        { name: 'FirstName', label: 'First Name', dataType: 'string' },
        { name: 'LastName', label: 'Last Name', dataType: 'string', required: true },
        { name: 'Email', label: 'Email', dataType: 'email' },
        { name: 'Phone', label: 'Phone', dataType: 'phone' },
        { name: 'AccountId', label: 'Account (FK)', dataType: 'string' },
        { name: 'Title', label: 'Job Title', dataType: 'string' },
        { name: 'Birthdate', label: 'Birthdate', dataType: 'date' },
      ],
    },
  },
  sap: {
    entities: [
      { name: 'BusinessPartner', label: 'Business Partner', description: 'SAP BP: customer, vendor, or person.' },
      { name: 'GLAccount', label: 'GL Account', description: 'SAP Chart of Accounts entry.' },
    ],
    fields: {
      BusinessPartner: [
        { name: 'BusinessPartner', label: 'BP Number (KUNNR)', dataType: 'string', isKey: true, required: true },
        { name: 'BusinessPartnerName', label: 'BP Name (NAME1)', dataType: 'string', required: true },
        { name: 'SearchTerm1', label: 'Search Term 1', dataType: 'string' },
        { name: 'BusinessPartnerGrouping', label: 'BP Grouping', dataType: 'string' },
        { name: 'FirstName', label: 'First Name', dataType: 'string' },
        { name: 'LastName', label: 'Last Name', dataType: 'string' },
        { name: 'PersonFullName', label: 'Full Name', dataType: 'string' },
        { name: 'Industry', label: 'Industry', dataType: 'string' },
        { name: 'CustomerAccountGroup', label: 'Account Group', dataType: 'string' },
      ],
    },
  },
};

// ─── Compliance analysis helper ────────────────────────────────────────────────

const COMPLIANCE_RULES = [
  {
    id: 'GLBA_NPI_UNENCRYPTED_TARGET',
    regulation: 'GLBA',
    severity: 'error',
    check: (mapping) => mapping.sourceComplianceTags?.includes('GLBA_NPI') && !mapping.targetComplianceTags?.includes('GLBA_NPI'),
    message: (m) => `Field "${m.sourceField}" is GLBA_NPI but target "${m.targetField}" lacks GLBA_NPI tag — ensure target system has equivalent PII controls`,
  },
  {
    id: 'PCI_CARD_INSECURE',
    regulation: 'PCI-DSS',
    severity: 'error',
    check: (mapping) => mapping.sourceComplianceTags?.includes('PCI_CARD'),
    message: (m) => `Field "${m.sourceField}" is PCI_CARD — confirm target "${m.targetField}" is in a PCI-compliant zone with tokenization`,
  },
  {
    id: 'SOX_FINANCIAL_LOW_CONFIDENCE',
    regulation: 'SOX',
    severity: 'warning',
    check: (mapping) => mapping.sourceComplianceTags?.includes('SOX_FINANCIAL') && mapping.confidence !== undefined && mapping.confidence < 0.7,
    message: (m) => `SOX_FINANCIAL field "${m.sourceField}" has confidence ${m.confidence?.toFixed(2)} — manual review required before production deployment`,
  },
  {
    id: 'BSA_AML_AUDIT_TRAIL',
    regulation: 'BSA/AML',
    severity: 'warning',
    check: (mapping) => mapping.sourceComplianceTags?.includes('BSA_AML') && !mapping.targetComplianceTags?.includes('BSA_AML'),
    message: (m) => `BSA_AML field "${m.sourceField}" → "${m.targetField}": confirm target system maintains FinCEN-compliant transaction audit trail`,
  },
  {
    id: 'FFIEC_AUDIT_COVERAGE',
    regulation: 'FFIEC',
    severity: 'warning',
    check: (mapping) => mapping.sourceComplianceTags?.includes('FFIEC_AUDIT') && !mapping.targetField,
    message: (m) => `FFIEC_AUDIT field "${m.sourceField}" has no target mapping — this field must appear in the FFIEC audit trail`,
  },
];

// ─── Jaccard similarity helper ─────────────────────────────────────────────────

function jaccardSimilarity(a, b) {
  const setA = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function suggestMappings(sourceFields, targetFields) {
  return sourceFields.map((sf) => {
    let bestMatch = null;
    let bestScore = 0;
    for (const tf of targetFields) {
      const nameScore = jaccardSimilarity(sf.name, tf.name);
      const labelScore = jaccardSimilarity(sf.label || sf.name, tf.label || tf.name);
      const score = Math.max(nameScore, labelScore * 0.9);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = tf;
      }
    }
    return {
      sourceField: sf.name,
      targetField: bestMatch?.name ?? null,
      confidence: Math.round(bestScore * 100) / 100,
      sourceDataType: sf.dataType,
      targetDataType: bestMatch?.dataType ?? null,
      sourceComplianceTags: sf.complianceTags ?? [],
      targetComplianceTags: bestMatch?.complianceTags ?? [],
      sourceJxchangeXPath: sf.jxchangeXPath ?? null,
    };
  });
}

// ─── MCP Server factory ────────────────────────────────────────────────────────

function createServer() {
  const server = new McpServer({
    name: 'automapper',
    version: '1.0.0',
  });

  // ── Tool: list_connectors ──────────────────────────────────────────────────
  server.tool(
    'automapper_list_connectors',
    'List all available AutoMapper connectors with metadata. Use this to discover which systems can be connected.',
    {},
    async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          connectors: Object.values(CONNECTORS).map(({ id, displayName, category, description, protocol, systemType, hasMockMode, requiredCredentials, docsUrl }) => ({
            id, displayName, category, description, protocol, systemType, hasMockMode, requiredCredentials, docsUrl,
          })),
          total: Object.keys(CONNECTORS).length,
        }, null, 2),
      }],
    }),
  );

  // ── Tool: get_system_info ──────────────────────────────────────────────────
  server.tool(
    'automapper_get_system_info',
    'Get detailed system metadata for a specific connector, including protocol details, AcctType codes, jXchange operations, OAuth configuration, and compliance requirements.',
    { connector_id: z.string().describe('Connector ID from automapper_list_connectors') },
    async ({ connector_id }) => {
      const connector = CONNECTORS[connector_id];
      if (!connector) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Connector "${connector_id}" not found. Available: ${Object.keys(CONNECTORS).join(', ')}` }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(connector, null, 2) }] };
    },
  );

  // ── Tool: fetch_schema ─────────────────────────────────────────────────────
  server.tool(
    'automapper_fetch_schema',
    'Fetch the full data schema from a connector — entities, fields, data types, compliance tags (GLBA_NPI, PCI_CARD, SOX_FINANCIAL, FFIEC_AUDIT, BSA_AML), and jXchange XPath values. Use this before suggesting mappings.',
    {
      connector_id: z.string().describe('Connector ID from automapper_list_connectors'),
      entities: z.array(z.string()).optional().describe('Specific entities to fetch. Omit for all entities.'),
    },
    async ({ connector_id, entities }) => {
      const schema = SCHEMAS[connector_id] ?? SCHEMAS['jackhenry-silverlake'];
      const requestedEntities = entities?.length ? entities : schema.entities.map((e) => e.name);

      const result = {
        connector_id,
        mode: 'mock',
        entities: schema.entities.filter((e) => requestedEntities.includes(e.name)),
        fields: Object.fromEntries(
          requestedEntities.map((name) => [name, schema.fields[name] ?? []]),
        ),
        relationships: [
          ...(requestedEntities.includes('DDA') && requestedEntities.includes('CIF') ? [{ from: 'DDA', to: 'CIF', type: 'lookup', viaField: 'CIFNumber' }] : []),
          ...(requestedEntities.includes('LoanAccount') && requestedEntities.includes('CIF') ? [{ from: 'LoanAccount', to: 'CIF', type: 'lookup', viaField: 'CIFNumber' }] : []),
        ],
        compliancySummary: {
          GLBA_NPI: Object.values(schema.fields).flat().filter((f) => f.complianceTags?.includes('GLBA_NPI')).map((f) => f.name),
          PCI_CARD: Object.values(schema.fields).flat().filter((f) => f.complianceTags?.includes('PCI_CARD')).map((f) => f.name),
          SOX_FINANCIAL: Object.values(schema.fields).flat().filter((f) => f.complianceTags?.includes('SOX_FINANCIAL')).map((f) => f.name),
          FFIEC_AUDIT: Object.values(schema.fields).flat().filter((f) => f.complianceTags?.includes('FFIEC_AUDIT')).map((f) => f.name),
          BSA_AML: Object.values(schema.fields).flat().filter((f) => f.complianceTags?.includes('BSA_AML')).map((f) => f.name),
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── Tool: get_sample_data ──────────────────────────────────────────────────
  server.tool(
    'automapper_get_sample_data',
    'Get sample/synthetic data rows for a specific entity. Useful for understanding data format and patterns. PII fields are automatically masked.',
    {
      connector_id: z.string(),
      entity: z.string().describe('Entity name (e.g. CIF, DDA, LoanAccount)'),
      limit: z.number().int().min(1).max(10).optional().default(3),
    },
    async ({ connector_id, entity, limit }) => {
      const SAMPLES = {
        CIF: [
          { CIFNumber: '100000001', TaxID: '***-**-1234', LegalName: 'Acme Corp', CustomerType: 'Business', CustomerStatus: 'Active', RiskRating: 'Low', BranchCode: 'B001', OpenDate: '2018-03-15' },
          { CIFNumber: '100000002', TaxID: '***-**-5678', LegalName: 'Jane Smith', CustomerType: 'Individual', CustomerStatus: 'Active', RiskRating: 'Low', BranchCode: 'B002', OpenDate: '2020-07-22' },
          { CIFNumber: '100000003', TaxID: '***-**-9012', LegalName: 'Smith Family Trust', CustomerType: 'Trust', CustomerStatus: 'Active', RiskRating: 'Medium', BranchCode: 'B001', OpenDate: '2015-01-01' },
        ],
        DDA: [
          { AccountNumber: '0001234567890', CIFNumber: '100000001', AccountType: 'Checking', CurrentBalance: 15000.00, CollectedBalance: 14500.00, AvailableBalance: 14750.00, AccountStatus: 'Open' },
          { AccountNumber: '0001234567891', CIFNumber: '100000002', AccountType: 'Savings', CurrentBalance: 8250.50, CollectedBalance: 8250.50, AvailableBalance: 8250.50, AccountStatus: 'Open' },
        ],
        LoanAccount: [
          { LoanNumber: 'L2024000001', CIFNumber: '100000001', LoanType: 'CommercialLoan', LoanStatus: 'Current', OriginalPrincipal: 500000.00, CurrentBalance: 487320.00, InterestRate: 0.0625, MaturityDate: '2034-01-01' },
        ],
        GLAccount: [
          { GLAccountNumber: '1001.00.B001', AccountDescription: 'Cash and Due From Banks', AccountCategory: 'Asset', NormalBalance: 'Debit' },
        ],
        Account: [
          { Id: '0015g00000AbCdEfAB', Name: 'Acme Corp', AccountNumber: 'ACC-001', Type: 'Customer', Industry: 'Banking', AnnualRevenue: 5000000 },
        ],
        Contact: [
          { Id: '0035g00000XyZwVuAB', FirstName: 'Jane', LastName: 'Smith', Email: 'jane.smith@acme.com', Phone: '555-0100', AccountId: '0015g00000AbCdEfAB' },
        ],
        BusinessPartner: [
          { BusinessPartner: '1000001', BusinessPartnerName: 'Acme Corp', SearchTerm1: 'ACME', BusinessPartnerGrouping: 'KUNA', Industry: 'Banks' },
        ],
      };
      const rows = (SAMPLES[entity] ?? []).slice(0, limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ connector_id, entity, rows, note: 'Synthetic data — PII fields masked with ***' }, null, 2),
        }],
      };
    },
  );

  // ── Tool: test_connection ──────────────────────────────────────────────────
  server.tool(
    'automapper_test_connection',
    'Test whether a connector can establish a connection. In mock mode (no credentials) always returns connected=true with latencyMs=0.',
    {
      connector_id: z.string(),
      credentials: z.record(z.string()).optional().describe('Optional live credentials to test. Omit for mock mode.'),
    },
    async ({ connector_id }) => {
      const connector = CONNECTORS[connector_id];
      if (!connector) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Connector "${connector_id}" not found` }) }], isError: true };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            connector_id,
            displayName: connector.displayName,
            connected: true,
            latencyMs: 0,
            mode: 'mock',
            message: 'Mock mode — no credentials provided. Pass credentials to test live connection.',
          }, null, 2),
        }],
      };
    },
  );

  // ── Tool: suggest_mappings ─────────────────────────────────────────────────
  server.tool(
    'automapper_suggest_mappings',
    'Generate field-level mappings between a source connector entity and a target connector entity using Jaccard token similarity. Returns confidence scores and flags compliance tag mismatches. Use automapper_fetch_schema first to understand available entities.',
    {
      source_connector_id: z.string().describe('Source connector (e.g. jackhenry-silverlake)'),
      source_entity: z.string().describe('Source entity name (e.g. CIF)'),
      target_connector_id: z.string().describe('Target connector (e.g. salesforce)'),
      target_entity: z.string().describe('Target entity name (e.g. Account)'),
    },
    async ({ source_connector_id, source_entity, target_connector_id, target_entity }) => {
      const sourceSchema = SCHEMAS[source_connector_id] ?? SCHEMAS['jackhenry-silverlake'];
      const targetSchema = SCHEMAS[target_connector_id] ?? SCHEMAS['salesforce'];
      const sourceFields = sourceSchema.fields[source_entity] ?? [];
      const targetFields = targetSchema.fields[target_entity] ?? [];

      if (sourceFields.length === 0) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `No fields found for ${source_connector_id}.${source_entity}` }) }], isError: true };
      }

      const mappings = suggestMappings(sourceFields, targetFields);
      const complianceIssues = [];

      for (const mapping of mappings) {
        for (const rule of COMPLIANCE_RULES) {
          if (rule.check(mapping)) {
            complianceIssues.push({ rule: rule.id, regulation: rule.regulation, severity: rule.severity, message: rule.message(mapping) });
          }
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            source: `${source_connector_id}.${source_entity}`,
            target: `${target_connector_id}.${target_entity}`,
            mappings,
            summary: {
              total: mappings.length,
              highConfidence: mappings.filter((m) => m.confidence >= 0.7).length,
              mediumConfidence: mappings.filter((m) => m.confidence >= 0.4 && m.confidence < 0.7).length,
              lowConfidence: mappings.filter((m) => m.confidence < 0.4).length,
              unmapped: mappings.filter((m) => !m.targetField).length,
            },
            complianceIssues,
            note: 'Run automapper_analyze_compliance for a detailed regulatory analysis of the full mapping set.',
          }, null, 2),
        }],
      };
    },
  );

  // ── Tool: analyze_compliance ───────────────────────────────────────────────
  server.tool(
    'automapper_analyze_compliance',
    'Analyze a set of field mappings for regulatory compliance issues across GLBA, PCI-DSS, SOX, FFIEC, and BSA/AML frameworks. Provide the mappings array from automapper_suggest_mappings.',
    {
      mappings: z.array(z.object({
        sourceField: z.string(),
        targetField: z.string().nullable(),
        sourceComplianceTags: z.array(z.string()).optional(),
        targetComplianceTags: z.array(z.string()).optional(),
        confidence: z.number().optional(),
      })).describe('Mapping array from automapper_suggest_mappings'),
      source_system: z.string().optional().describe('Source system name for context (e.g. "Jack Henry SilverLake")'),
      target_system: z.string().optional().describe('Target system name for context (e.g. "Salesforce CRM")'),
    },
    async ({ mappings, source_system, target_system }) => {
      const issues = [];

      for (const mapping of mappings) {
        for (const rule of COMPLIANCE_RULES) {
          if (rule.check(mapping)) {
            issues.push({ rule: rule.id, regulation: rule.regulation, severity: rule.severity, message: rule.message(mapping), affectedField: mapping.sourceField });
          }
        }
      }

      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');

      const piiFieldCount = mappings.filter((m) => m.sourceComplianceTags?.includes('GLBA_NPI')).length;
      const pciFieldCount = mappings.filter((m) => m.sourceComplianceTags?.includes('PCI_CARD')).length;
      const soxFieldCount = mappings.filter((m) => m.sourceComplianceTags?.includes('SOX_FINANCIAL')).length;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            analysis: {
              source_system,
              target_system,
              totalMappings: mappings.length,
              totalIssues: issues.length,
              errors: errors.length,
              warnings: warnings.length,
              piiFieldCount,
              pciFieldCount,
              soxFieldCount,
            },
            issues,
            verdict: errors.length > 0
              ? '❌ BLOCKED — compliance errors must be resolved before production deployment'
              : warnings.length > 0
                ? '⚠️  CONDITIONAL — warnings require manual review and sign-off'
                : '✅ APPROVED — no compliance issues detected',
            recommendations: [
              ...(piiFieldCount > 0 ? [`Ensure target system for ${piiFieldCount} GLBA_NPI field(s) has equivalent encryption, access controls, and audit logging`] : []),
              ...(pciFieldCount > 0 ? [`Confirm PCI-DSS scope for ${pciFieldCount} card data field(s) — target must be in a tokenized, in-scope environment`] : []),
              ...(soxFieldCount > 0 ? [`Establish SOX change-control workflow for ${soxFieldCount} financial field(s) — document field mapping in system of record`] : []),
            ],
          }, null, 2),
        }],
      };
    },
  );

  return server;
}

// ─── Transport: stdio (for Claude Desktop / Claude Code) ──────────────────────

if (USE_STDIO) {
  console.error('[AutoMapper MCP] Starting in stdio mode...');
  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error('[AutoMapper MCP] Ready — listening on stdio');
  });

} else {
  // ─── Transport: StreamableHTTP (for web / REST clients) ─────────────────────
  const app = express();
  app.use(express.json());

  const sessions = new Map();

  async function handleMCPRequest(req, res) {
    const sessionId = req.headers['mcp-session-id'];

    try {
      if (!sessionId) {
        // New session — only valid for POST (initialization)
        if (req.method !== 'POST') {
          res.status(400).json({ error: 'New sessions must be initialized with POST' });
          return;
        }
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        const server = createServer();
        await server.connect(transport);
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await transport.handleRequest(req, res, req.body);
        if (transport.sessionId) sessions.set(transport.sessionId, transport);

      } else if (sessions.has(sessionId)) {
        await sessions.get(sessionId).handleRequest(req, res, req.body);

      } else {
        res.status(404).json({ error: `Session "${sessionId}" not found or expired` });
      }
    } catch (err) {
      console.error('[AutoMapper MCP] Error handling request:', err);
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  }

  app.all('/mcp', handleMCPRequest);

  // Health + capabilities endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      name: 'automapper-mcp',
      version: '1.0.0',
      transport: 'StreamableHTTP',
      endpoint: '/mcp',
      activeSessions: sessions.size,
      tools: [
        'automapper_list_connectors',
        'automapper_get_system_info',
        'automapper_fetch_schema',
        'automapper_get_sample_data',
        'automapper_test_connection',
        'automapper_suggest_mappings',
        'automapper_analyze_compliance',
      ],
    });
  });

  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║       AutoMapper MCP Server  •  v1.0.0                    ║
╠════════════════════════════════════════════════════════════╣
║  StreamableHTTP endpoint:  http://localhost:${PORT}/mcp       ║
║  Health check:             http://localhost:${PORT}/health    ║
║                                                            ║
║  Claude Desktop config:                                    ║
║  {                                                         ║
║    "automapper": {                                         ║
║      "command": "node",                                    ║
║      "args": ["mcp-server.mjs", "--stdio"]                 ║
║    }                                                       ║
║  }                                                         ║
║                                                            ║
║  Tools available:                                          ║
║    • automapper_list_connectors                            ║
║    • automapper_get_system_info                            ║
║    • automapper_fetch_schema                               ║
║    • automapper_get_sample_data                            ║
║    • automapper_test_connection                            ║
║    • automapper_suggest_mappings                           ║
║    • automapper_analyze_compliance                         ║
╚════════════════════════════════════════════════════════════╝
`);
  });
}
