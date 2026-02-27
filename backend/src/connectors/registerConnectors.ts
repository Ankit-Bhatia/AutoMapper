/**
 * registerConnectors — side-effect module that populates the defaultRegistry
 * with every built-in connector.
 *
 * Import this module once (in index.ts) before any connector lookups are made.
 */
import { defaultRegistry } from './ConnectorRegistry.js';
import { SilverLakeConnector } from './jackhenry/SilverLakeConnector.js';
import { CoreDirectorConnector } from './jackhenry/CoreDirectorConnector.js';
import { SymitarConnector } from './jackhenry/SymitarConnector.js';
import { JXchangeMCPConnector } from './jackhenry/JXchangeMCPConnector.js';
import { SalesforceConnector } from './SalesforceConnector.js';
import { SAPConnector } from './SAPConnector.js';

// ─── Jack Henry SilverLake (commercial banks) ─────────────────────────────────
defaultRegistry.register(
  'jackhenry-silverlake',
  {
    id: 'jackhenry-silverlake',
    displayName: 'Jack Henry SilverLake',
    category: 'banking',
    description:
      'Jack Henry SilverLake core banking platform for commercial banks. ' +
      'Connects via jXchange SOAP/XML with OAuth 2.0 authentication.',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'clientId', 'clientSecret'],
    protocol: 'SOAP/jXchange',
  },
  (credentials) => new SilverLakeConnector(credentials),
);

// ─── Jack Henry Core Director (community banks) ───────────────────────────────
// Same jXchange SOAP protocol as SilverLake but with numeric AcctType codes:
//   AcctType "10" = Deposit  (SilverLake uses "D")
//   AcctType "40" = Loan     (SilverLake uses "L")
// DMZ test InstRtId: 11111900  (SilverLake: 011001276)
defaultRegistry.register(
  'jackhenry-coredirector',
  {
    id: 'jackhenry-coredirector',
    displayName: 'Jack Henry Core Director',
    category: 'banking',
    description:
      'Jack Henry Core Director core banking platform for community banks. ' +
      'Connects via jXchange SOAP/XML with OAuth 2.0 authentication. ' +
      'Uses numeric AcctType codes (10=deposit, 40=loan) distinct from SilverLake.',
    hasMockMode: true,
    requiredCredentials: ['instanceUrl', 'clientId', 'clientSecret'],
    protocol: 'SOAP/jXchange',
  },
  (credentials) => new CoreDirectorConnector(credentials),
);

// ─── Jack Henry Symitar / Episys (credit unions) ──────────────────────────────
defaultRegistry.register(
  'jackhenry-symitar',
  {
    id: 'jackhenry-symitar',
    displayName: 'Jack Henry Symitar (Episys)',
    category: 'banking',
    description:
      'Jack Henry Symitar / Episys core banking platform for credit unions. ' +
      'Connects via SymXchange REST API with OAuth 2.0 authentication.',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'clientId', 'clientSecret', 'institutionId'],
    protocol: 'REST/SymXchange',
  },
  (credentials) => new SymitarConnector(credentials),
);

// ─── Jack Henry jXchange via MCP (Model Context Protocol) ─────────────────────
//
// This connector delegates all operations to an external MCP server that
// exposes jXchange operations as standardized MCP tools.
//
// In mock/dev mode it points at the AutoMapper MCP server itself (port 4001)
// so you can test the round-trip locally. In production, set JH_MCP_SERVER_URL
// to the Jack Henry-hosted MCP endpoint when it becomes available.
//
// To activate: set JH_MCP_SERVER_URL=https://api.jackhenry.dev/mcp
defaultRegistry.register(
  'jackhenry-mcp',
  {
    id: 'jackhenry-mcp',
    displayName: 'Jack Henry jXchange (MCP)',
    category: 'banking',
    description:
      'Jack Henry jXchange API via Model Context Protocol (MCP). ' +
      'Set JH_MCP_SERVER_URL to a jXchange MCP server endpoint. ' +
      'Falls back gracefully to mock mode if the server is unreachable.',
    hasMockMode: true,
    requiredCredentials: ['mcpServerUrl'],
    protocol: 'MCP → SOAP/jXchange',
  },
  (credentials) => new JXchangeMCPConnector(credentials),
);

// ─── Salesforce CRM ───────────────────────────────────────────────────────────
// Cloud-based CRM for sales, service, and marketing. Connects via REST API
// with OAuth 2.0 Web Server Flow authentication.
defaultRegistry.register(
  'salesforce',
  {
    id: 'salesforce',
    displayName: 'Salesforce CRM',
    category: 'crm',
    description:
      'Salesforce Cloud CRM platform for sales, service, and marketing operations. ' +
      'Connects via REST API with OAuth 2.0 authentication.',
    hasMockMode: true,
    requiredCredentials: ['accessToken', 'instanceUrl'],
    protocol: 'REST/jsforce',
  },
  (credentials) => new SalesforceConnector(credentials),
);

// ─── SAP S/4HANA ──────────────────────────────────────────────────────────────
// Enterprise ERP system with OData v4 API for real-time data access.
// Authenticates with Basic Auth or OAuth 2.0.
defaultRegistry.register(
  'sap',
  {
    id: 'sap',
    displayName: 'SAP S/4HANA',
    category: 'erp',
    description:
      'SAP S/4HANA enterprise resource planning system. ' +
      'Connects via OData v4 API with Basic Auth or OAuth 2.0 authentication.',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'username', 'password'],
    protocol: 'OData v4',
  },
  (credentials) => new SAPConnector(credentials),
);
