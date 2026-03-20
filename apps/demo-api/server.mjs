/**
 * AutoMapper Demo Server (apps/demo-api/server.mjs)
 *
 * Standalone Express server with in-memory state — no database, no compile step.
 * Exposes the same API surface as the full production backend so demo.html works live.
 *
 * Start: node apps/demo-api/server.mjs
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

const app = express();
// Reflect the request origin (never '*') so credentials: 'include' works in the browser.
// cors() without options sets Access-Control-Allow-Origin: * which the browser rejects
// when fetch is called with credentials: 'include', producing "Failed to fetch".
app.use(cors({
  origin: (origin, cb) => cb(null, origin || 'http://localhost:5173'),
  credentials: true,
}));
app.use(express.json({ limit: '4mb' }));

const PORT = Number(process.env.PORT || 4000);

// ─── In-memory state ──────────────────────────────────────────────────────────
let projectIdCounter = 1;
const projects = new Map();
const systemSchemas = new Map(); // systemId → { entities, fields, relationships }

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'demo' }));

// ─── Connectors list ──────────────────────────────────────────────────────────
const CONNECTORS = [
  {
    id: 'jackhenry-silverlake',
    displayName: 'Jack Henry SilverLake',
    category: 'banking',
    description: 'Jack Henry SilverLake core banking for commercial banks. jXchange SOAP/ISO 20022.',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'clientId', 'clientSecret'],
    protocol: 'SOAP/jXchange',
  },
  {
    id: 'jackhenry-coredirector',
    displayName: 'Jack Henry Core Director',
    category: 'banking',
    description: 'Jack Henry Core Director core banking for community banks. Uses numeric AcctType codes (10=deposit, 40=loan). jXchange SOAP.',
    hasMockMode: true,
    requiredCredentials: ['instanceUrl', 'clientId', 'clientSecret'],
    protocol: 'SOAP/jXchange',
  },
  {
    id: 'jackhenry-symitar',
    displayName: 'Jack Henry Symitar (Episys)',
    category: 'banking',
    description: 'Jack Henry Symitar core banking for credit unions. SymXchange REST.',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'clientId', 'clientSecret', 'institutionId'],
    protocol: 'REST/SymXchange',
  },
  {
    id: 'salesforce',
    displayName: 'Salesforce CRM',
    category: 'crm',
    description: 'Salesforce Sales Cloud. REST/jsforce.',
    hasMockMode: true,
    requiredCredentials: ['username', 'password', 'securityToken'],
    protocol: 'REST/jsforce',
  },
  {
    id: 'sap',
    displayName: 'SAP S/4HANA',
    category: 'erp',
    description: 'SAP S/4HANA ERP. OData v4 / BAPI.',
    hasMockMode: true,
    requiredCredentials: ['baseUrl', 'username', 'password'],
    protocol: 'OData/BAPI',
  },
];

app.get('/api/connectors', (_req, res) => res.json({ connectors: CONNECTORS }));

// ─── Mock schemas ──────────────────────────────────────────────────────────────

const CUSTOM_CONNECTOR_REDACTED_KEYS = new Set([
  'bearerToken',
  'clientSecret',
  'password',
  'basicPassword',
  'apiKey',
  'basicUsername',
]);

function sanitizeCustomConnectionConfig(connectionConfig = {}) {
  if (!connectionConfig || typeof connectionConfig !== 'object' || Array.isArray(connectionConfig)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(connectionConfig).filter(([key]) => !CUSTOM_CONNECTOR_REDACTED_KEYS.has(key)),
  );
}

function normalizeCustomEntities(entities) {
  if (!Array.isArray(entities)) return [];
  return entities
    .map((entity) => {
      if (!entity || typeof entity !== 'object') return null;
      const name = typeof entity.name === 'string' ? entity.name.trim() : '';
      if (!name) return null;
      const fields = Array.isArray(entity.fields)
        ? entity.fields
            .map((field) => {
              if (!field || typeof field !== 'object') return null;
              const fieldName = typeof field.name === 'string' ? field.name.trim() : '';
              if (!fieldName) return null;
              const dataType =
                typeof field.dataType === 'string' && field.dataType.trim()
                  ? field.dataType.trim()
                  : typeof field.type === 'string' && field.type.trim()
                    ? field.type.trim()
                    : 'string';
              return { name: fieldName, dataType };
            })
            .filter(Boolean)
        : [];
      if (!fields.length) return null;
      return { name, fields };
    })
    .filter(Boolean);
}

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function buildCustomSchema(systemId, entities) {
  const schemaEntities = entities.map((entity) => ({
    id: uuid(),
    systemId,
    name: entity.name,
    label: entity.name,
    description: 'Custom uploaded entity',
  }));

  const entityIdByName = new Map(schemaEntities.map((entity) => [entity.name, entity.id]));
  const fields = entities.flatMap((entity) =>
    entity.fields.map((field) => ({
      id: uuid(),
      entityId: entityIdByName.get(entity.name),
      name: field.name,
      label: field.name,
      dataType: field.dataType || 'string',
      required: false,
    })),
  );

  return {
    entities: schemaEntities,
    fields,
    relationships: [],
    mode: 'uploaded',
  };
}

const SCHEMAS = {
  'jackhenry-silverlake': (systemId) => {
    const cifId = uuid(), ddaId = uuid(), loanId = uuid();
    const entities = [
      { id: cifId, systemId, name: 'CIF', label: 'Customer Information File', description: 'Master record for each customer. ISO 20022: Party.' },
      { id: ddaId, systemId, name: 'DDA', label: 'Demand Deposit Account', description: 'Checking/savings accounts.' },
      { id: loanId, systemId, name: 'LoanAccount', label: 'Loan Account', description: 'Commercial and consumer loans.' },
    ];
    const fields = [
      // CIF
      { id: uuid(), entityId: cifId, name: 'CIFNumber', label: 'CIF Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'PartyIdentification' },
      { id: uuid(), entityId: cifId, name: 'TaxID', label: 'Tax ID (SSN/EIN)', dataType: 'string', required: true, complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT', 'BSA_AML'], complianceNote: 'Must be masked in non-production', iso20022Name: 'TaxIdentification' },
      { id: uuid(), entityId: cifId, name: 'LegalName', label: 'Legal Name', dataType: 'string', required: true, complianceTags: ['GLBA_NPI'], iso20022Name: 'Name' },
      { id: uuid(), entityId: cifId, name: 'CustomerType', label: 'Customer Type', dataType: 'picklist', picklistValues: ['Individual','Business','Trust','Government'], required: true },
      { id: uuid(), entityId: cifId, name: 'CustomerStatus', label: 'Customer Status', dataType: 'picklist', picklistValues: ['Active','Inactive','Deceased','Blocked'], complianceTags: ['BSA_AML'] },
      { id: uuid(), entityId: cifId, name: 'PrimaryEmail', label: 'Primary Email', dataType: 'email', complianceTags: ['GLBA_NPI'], iso20022Name: 'EmailAddress' },
      { id: uuid(), entityId: cifId, name: 'PrimaryPhone', label: 'Primary Phone', dataType: 'phone', complianceTags: ['GLBA_NPI'], iso20022Name: 'PhoneNumber' },
      { id: uuid(), entityId: cifId, name: 'AddressLine1', label: 'Address Line 1', dataType: 'string', complianceTags: ['GLBA_NPI'], iso20022Name: 'StrtNm' },
      { id: uuid(), entityId: cifId, name: 'City', label: 'City', dataType: 'string', iso20022Name: 'TwnNm' },
      { id: uuid(), entityId: cifId, name: 'StateCode', label: 'State Code', dataType: 'string', iso20022Name: 'CtrySubDvsn' },
      { id: uuid(), entityId: cifId, name: 'PostalCode', label: 'Postal Code', dataType: 'string', iso20022Name: 'PstCd' },
      { id: uuid(), entityId: cifId, name: 'DateOfBirth', label: 'Date of Birth', dataType: 'date', complianceTags: ['GLBA_NPI'], iso20022Name: 'BirthDate' },
      { id: uuid(), entityId: cifId, name: 'RiskRating', label: 'Risk Rating', dataType: 'picklist', picklistValues: ['Low','Medium','High','Prohibited'], complianceTags: ['BSA_AML', 'FFIEC_AUDIT'] },
      // DDA
      { id: uuid(), entityId: ddaId, name: 'AccountNumber', label: 'Account Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: ddaId, name: 'CIFNumber', label: 'CIF Number (Owner)', dataType: 'string', required: true, complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: ddaId, name: 'AcctType', label: 'Account Type', dataType: 'picklist', picklistValues: ['D','S','M'], complianceTags: ['FFIEC_AUDIT'], complianceNote: 'SilverLake: D=Demand, S=Savings, M=Money Market' },
      { id: uuid(), entityId: ddaId, name: 'CurrentBalance', label: 'Current Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: ddaId, name: 'AvailableBalance', label: 'Available Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: ddaId, name: 'AccountStatus', label: 'Account Status', dataType: 'picklist', picklistValues: ['Active','Inactive','Frozen','Closed'], complianceTags: ['BSA_AML'] },
      // Loan
      { id: uuid(), entityId: loanId, name: 'LoanNumber', label: 'Loan Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: loanId, name: 'CIFNumber', label: 'CIF Number (Borrower)', dataType: 'string', required: true, complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: loanId, name: 'AcctType', label: 'Account Type', dataType: 'picklist', picklistValues: ['L'], complianceTags: ['FFIEC_AUDIT'], complianceNote: 'SilverLake: L=Loan' },
      { id: uuid(), entityId: loanId, name: 'OriginalBalance', label: 'Original Balance', dataType: 'decimal', required: true, complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: loanId, name: 'InterestRate', label: 'Interest Rate', dataType: 'decimal', required: true, complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: loanId, name: 'LoanStatus', label: 'Loan Status', dataType: 'picklist', picklistValues: ['Current','Delinquent30','Delinquent60','Default','PaidOff'], required: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'] },
    ];
    const relationships = [
      { fromEntityId: ddaId, toEntityId: cifId, type: 'lookup', viaField: 'CIFNumber' },
      { fromEntityId: loanId, toEntityId: cifId, type: 'lookup', viaField: 'CIFNumber' },
    ];
    return { entities, fields, relationships, mode: 'mock' };
  },

  // ─── Jack Henry Core Director (community banks) ───────────────────────────────
  // AcctType uses NUMERIC codes: "10"=deposit, "40"=loan  (distinct from SilverLake "D"/"L")
  // CustomerType uses SHORT CODES: Indv, Bus, Trust, Govt
  // DMZ test InstRtId: 11111900
  'jackhenry-coredirector': (systemId) => {
    const cifId = uuid(), ddaId = uuid(), loanId = uuid(), glId = uuid();
    const entities = [
      { id: cifId, systemId, name: 'CIF', label: 'Customer Information File', description: 'Core Director customer master. CustomerType uses short codes (Indv, Bus, Trust, Govt).' },
      { id: ddaId, systemId, name: 'DDA', label: 'Demand Deposit Account', description: 'Core Director deposit account. AcctType="10" for deposit (not "D" as in SilverLake).' },
      { id: loanId, systemId, name: 'LoanAccount', label: 'Loan Account', description: 'Core Director loan. AcctType="40" for loan (not "L" as in SilverLake).' },
      { id: glId, systemId, name: 'GLAccount', label: 'General Ledger Account', description: 'Core Director general ledger account.' },
    ];
    const fields = [
      // CIF — CustomerType uses Indv/Bus short codes, requires lookup transform for targets expecting full labels
      { id: uuid(), entityId: cifId, name: 'CIFNumber', label: 'CIF Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'PartyIdentification' },
      { id: uuid(), entityId: cifId, name: 'TaxID', label: 'Tax ID (SSN/EIN)', dataType: 'string', required: true, complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT', 'BSA_AML'], complianceNote: 'Must be masked in non-production', iso20022Name: 'TaxIdentification' },
      { id: uuid(), entityId: cifId, name: 'LegalName', label: 'Legal Name', dataType: 'string', required: true, complianceTags: ['GLBA_NPI'], iso20022Name: 'Name' },
      {
        id: uuid(), entityId: cifId, name: 'CustomerType', label: 'Customer Type', dataType: 'picklist',
        picklistValues: ['Indv', 'Bus', 'Trust', 'Govt'],  // SHORT CODES — requires lookup transform
        required: true,
        complianceNote: 'Core Director short codes: Indv=Individual, Bus=Business, Trust=Trust, Govt=Government. Lookup transform required.',
      },
      { id: uuid(), entityId: cifId, name: 'CustomerStatus', label: 'Customer Status', dataType: 'picklist', picklistValues: ['Active','Inactive','Deceased','Blocked'], complianceTags: ['BSA_AML'] },
      { id: uuid(), entityId: cifId, name: 'PrimaryEmail', label: 'Primary Email', dataType: 'email', complianceTags: ['GLBA_NPI'], iso20022Name: 'EmailAddress' },
      { id: uuid(), entityId: cifId, name: 'PrimaryPhone', label: 'Primary Phone', dataType: 'phone', complianceTags: ['GLBA_NPI'], iso20022Name: 'PhoneNumber' },
      { id: uuid(), entityId: cifId, name: 'AddressLine1', label: 'Address Line 1', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: cifId, name: 'City', label: 'City', dataType: 'string' },
      { id: uuid(), entityId: cifId, name: 'StateCode', label: 'State Code', dataType: 'string' },
      { id: uuid(), entityId: cifId, name: 'PostalCode', label: 'Postal Code', dataType: 'string' },
      { id: uuid(), entityId: cifId, name: 'RiskRating', label: 'Risk Rating', dataType: 'picklist', picklistValues: ['Low','Medium','High','Prohibited'], complianceTags: ['BSA_AML', 'FFIEC_AUDIT'] },
      { id: uuid(), entityId: cifId, name: 'RoutingTransitNumber', label: 'Routing Transit Number', dataType: 'string', complianceTags: ['FFIEC_AUDIT'], complianceNote: 'Core Director InstRtId. DMZ test value: 11111900' },
      // DDA — AcctType NUMERIC CODE "10" = deposit (requires value-level lookup transform)
      { id: uuid(), entityId: ddaId, name: 'AccountNumber', label: 'Account Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: ddaId, name: 'CIFNumber', label: 'CIF Number (Owner)', dataType: 'string', required: true, complianceTags: ['FFIEC_AUDIT'] },
      {
        id: uuid(), entityId: ddaId, name: 'AcctType', label: 'Account Type', dataType: 'picklist',
        picklistValues: ['10', '50', '60'],  // NUMERIC CODES: 10=deposit, 50=certificate, 60=line of credit
        complianceTags: ['FFIEC_AUDIT'],
        complianceNote: 'Core Director NUMERIC codes: "10"=deposit, "50"=certificate, "60"=line of credit. Lookup transform required — direct mapping to text labels will fail.',
      },
      { id: uuid(), entityId: ddaId, name: 'CurrentBalance', label: 'Current Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: ddaId, name: 'AvailableBalance', label: 'Available Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: ddaId, name: 'AccountStatus', label: 'Account Status', dataType: 'picklist', picklistValues: ['Active','Inactive','Frozen','Closed'], complianceTags: ['BSA_AML'] },
      // LoanAccount — AcctType NUMERIC CODE "40" = loan
      { id: uuid(), entityId: loanId, name: 'LoanNumber', label: 'Loan Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: loanId, name: 'CIFNumber', label: 'CIF Number (Borrower)', dataType: 'string', required: true, complianceTags: ['FFIEC_AUDIT'] },
      {
        id: uuid(), entityId: loanId, name: 'AcctType', label: 'Account Type', dataType: 'picklist',
        picklistValues: ['40'],  // NUMERIC CODE: 40=loan
        complianceTags: ['FFIEC_AUDIT'],
        complianceNote: 'Core Director NUMERIC code: "40"=loan. Lookup transform required.',
      },
      { id: uuid(), entityId: loanId, name: 'OriginalBalance', label: 'Original Balance', dataType: 'decimal', required: true, complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: loanId, name: 'CurrentBalance', label: 'Current Principal Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: loanId, name: 'InterestRate', label: 'Interest Rate', dataType: 'decimal', required: true, complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: loanId, name: 'MaturityDate', label: 'Maturity Date', dataType: 'date', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: loanId, name: 'LoanStatus', label: 'Loan Status', dataType: 'picklist', picklistValues: ['Current','Delinquent30','Delinquent60','Default','PaidOff'], required: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'] },
      // GLAccount
      { id: uuid(), entityId: glId, name: 'GLAccountNumber', label: 'G/L Account Number', dataType: 'string', isKey: true, required: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'] },
      { id: uuid(), entityId: glId, name: 'AccountDescription', label: 'Account Description', dataType: 'string' },
      { id: uuid(), entityId: glId, name: 'DebitBalance', label: 'Debit Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: glId, name: 'CreditBalance', label: 'Credit Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: glId, name: 'AccountType', label: 'GL Account Type', dataType: 'picklist', picklistValues: ['Asset','Liability','Equity','Revenue','Expense'], complianceTags: ['SOX_FINANCIAL'] },
    ];
    const relationships = [
      { fromEntityId: ddaId, toEntityId: cifId, type: 'lookup', viaField: 'CIFNumber' },
      { fromEntityId: loanId, toEntityId: cifId, type: 'lookup', viaField: 'CIFNumber' },
    ];
    return { entities, fields, relationships, mode: 'mock' };
  },

  'jackhenry-symitar': (systemId) => {
    const memberId = uuid(), shareId = uuid(), loanId = uuid(), cardId = uuid();
    const entities = [
      { id: memberId, systemId, name: 'Member', label: 'Member', description: 'Credit union member (NOT Customer). Members own the institution.' },
      { id: shareId, systemId, name: 'Share', label: 'Share Account', description: 'Savings/checking (NOT Deposit). DividendRate NOT InterestRate.' },
      { id: loanId, systemId, name: 'Loan', label: 'Loan Account', description: 'Member loans.' },
      { id: cardId, systemId, name: 'Card', label: 'Debit / Credit Card', description: 'PCI-DSS governed payment cards.' },
    ];
    const fields = [
      { id: uuid(), entityId: memberId, name: 'MemberNumber', label: 'Member Number', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'], complianceNote: 'NOT CustomerNumber — credit union terminology' },
      { id: uuid(), entityId: memberId, name: 'SSN', label: 'Social Security Number', dataType: 'string', required: true, complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT', 'BSA_AML'], complianceNote: 'Must be masked (***-**-XXXX) in non-production' },
      { id: uuid(), entityId: memberId, name: 'FirstName', label: 'First Name', dataType: 'string', required: true, complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: memberId, name: 'LastName', label: 'Last Name', dataType: 'string', required: true, complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: memberId, name: 'EmailAddress', label: 'Email Address', dataType: 'email', complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: memberId, name: 'MobilePhone', label: 'Mobile Phone', dataType: 'phone', complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: memberId, name: 'MemberStatus', label: 'Member Status', dataType: 'picklist', picklistValues: ['Active','Inactive','Suspended','Deceased'], complianceTags: ['BSA_AML'] },
      { id: uuid(), entityId: shareId, name: 'ShareID', label: 'Share ID', dataType: 'string', isKey: true, required: true, complianceTags: ['FFIEC_AUDIT'], complianceNote: 'NOT AccountNumber' },
      { id: uuid(), entityId: shareId, name: 'MemberNumber', label: 'Member Number (Owner)', dataType: 'string', required: true, complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: shareId, name: 'Balance', label: 'Current Balance', dataType: 'decimal', required: true, complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: shareId, name: 'DividendRate', label: 'Dividend Rate', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'], complianceNote: 'DividendRate ≠ InterestRate. CUs pay dividends on savings.' },
      { id: uuid(), entityId: shareId, name: 'ShareStatus', label: 'Share Status', dataType: 'picklist', picklistValues: ['Active','Inactive','Closed','Frozen'], complianceTags: ['BSA_AML'] },
      { id: uuid(), entityId: cardId, name: 'CardID', label: 'Card Record ID', dataType: 'string', isKey: true, required: true, complianceTags: ['PCI_CARD', 'FFIEC_AUDIT'], complianceNote: 'PCI-DSS: card data must never appear in plain text' },
      { id: uuid(), entityId: cardId, name: 'CardStatus', label: 'Card Status', dataType: 'picklist', picklistValues: ['Active','Inactive','Lost','Stolen','Expired'], complianceTags: ['PCI_CARD'] },
      { id: uuid(), entityId: cardId, name: 'ExpirationDate', label: 'Expiration Date', dataType: 'string', complianceTags: ['PCI_CARD'], complianceNote: 'MM/YY format. Never store CVV.' },
    ];
    const relationships = [
      { fromEntityId: shareId, toEntityId: memberId, type: 'lookup', viaField: 'MemberNumber' },
      { fromEntityId: loanId, toEntityId: memberId, type: 'lookup', viaField: 'MemberNumber' },
    ];
    return { entities, fields, relationships, mode: 'mock' };
  },

  // ─── Salesforce Financial Services Cloud (FSC) ───────────────────────────────
  // Includes 3 standard CRM objects + 5 FSC-specific objects.
  // FSC custom fields use the __c suffix — normName() strips this for heuristic matching.
  'salesforce': (systemId) => {
    const accId  = uuid(), conId  = uuid(), oppId  = uuid();
    const faId   = uuid(), iaId   = uuid(), goalId = uuid();
    const aprId  = uuid(), ppId   = uuid();
    const entities = [
      // Standard CRM objects
      { id: accId,  systemId, name: 'Account',               label: 'Account',                      description: 'Organisation or individual customer record. Maps to CIF (business/entity level).' },
      { id: conId,  systemId, name: 'Contact',               label: 'Contact',                      description: 'Individual person record. Maps to CIF where CustomerType=Indv/Individual.' },
      { id: oppId,  systemId, name: 'Opportunity',           label: 'Opportunity',                  description: 'Sales deal / credit opportunity. Maps to LoanAccount for CRM pipeline view.' },
      // FSC-specific objects
      { id: faId,   systemId, name: 'FinancialAccount',      label: 'FSC Financial Account',        description: 'FSC: Financial product record (Checking, Savings, CD, MoneyMarket, Loan, HELOC, Mortgage). Primary target for DDA and LoanAccount.' },
      { id: iaId,   systemId, name: 'IndividualApplication', label: 'FSC Individual Application',   description: 'FSC: Personal loan or account application. Captures PII for individual applicants. Maps to CIF (Indv) + LoanAccount.' },
      { id: goalId, systemId, name: 'FinancialGoal',         label: 'FSC Financial Goal',           description: 'FSC: Customer savings / financial target linked to a FinancialAccount (e.g. CD savings goal).' },
      { id: aprId,  systemId, name: 'AccountParticipant',    label: 'FSC Account Participant',      description: 'FSC: Junction linking a Contact (party) to a FinancialAccount with a role (Primary Owner, Co-Owner, Beneficiary).' },
      { id: ppId,   systemId, name: 'PartyProfile',          label: 'FSC Party Profile',            description: 'FSC: Extended profile for a party (individual or business). Maps to CIF Party/Relationship records.' },
    ];
    const fields = [
      // ── Account (standard CRM — CIF business-level data) ──────────────────────
      { id: uuid(), entityId: accId, name: 'Id',                  label: 'Account ID',           dataType: 'string',   isKey: true, required: true },
      { id: uuid(), entityId: accId, name: 'Name',                label: 'Account Name',         dataType: 'string',   required: true },
      { id: uuid(), entityId: accId, name: 'TaxId__c',            label: 'Tax ID (Custom)',      dataType: 'string',   complianceTags: ['GLBA_NPI','BSA_AML'], complianceNote: 'Custom encrypted field — SSN/EIN. Never log in plaintext.' },
      { id: uuid(), entityId: accId, name: 'Type',                label: 'Account Type',         dataType: 'picklist', picklistValues: ['Prospect','Customer','Partner','Competitor','Other'] },
      { id: uuid(), entityId: accId, name: 'Phone',               label: 'Phone',                dataType: 'phone',    complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: accId, name: 'BillingStreet',       label: 'Billing Street',       dataType: 'string',   complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: accId, name: 'BillingCity',         label: 'Billing City',         dataType: 'string' },
      { id: uuid(), entityId: accId, name: 'BillingState',        label: 'Billing State',        dataType: 'string' },
      { id: uuid(), entityId: accId, name: 'BillingPostalCode',   label: 'Billing Postal Code',  dataType: 'string' },
      { id: uuid(), entityId: accId, name: 'AnnualRevenue',       label: 'Annual Revenue',       dataType: 'currency', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: accId, name: 'Rating',              label: 'Rating',               dataType: 'picklist', picklistValues: ['Hot','Warm','Cold'] },
      { id: uuid(), entityId: accId, name: 'Industry',            label: 'Industry',             dataType: 'picklist' },
      { id: uuid(), entityId: accId, name: 'AccountNumber',       label: 'Account Number',       dataType: 'string',   complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: accId, name: 'CreatedDate',         label: 'Created Date',         dataType: 'datetime' },

      // ── Contact (standard CRM — CIF individual-level data) ────────────────────
      { id: uuid(), entityId: conId, name: 'Id',                  label: 'Contact ID',           dataType: 'string',   isKey: true, required: true },
      { id: uuid(), entityId: conId, name: 'LastName',            label: 'Last Name',            dataType: 'string',   required: true, complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: conId, name: 'FirstName',           label: 'First Name',           dataType: 'string',   complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: conId, name: 'Email',               label: 'Email',                dataType: 'email',    complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: conId, name: 'Phone',               label: 'Phone',                dataType: 'phone',    complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: conId, name: 'MobilePhone',         label: 'Mobile Phone',         dataType: 'phone',    complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: conId, name: 'Birthdate',           label: 'Birthdate',            dataType: 'date',     complianceTags: ['GLBA_NPI'], complianceNote: 'PII — only map when CustomerType=Indv/Individual.' },
      { id: uuid(), entityId: conId, name: 'SSN__c',              label: 'SSN (Custom)',         dataType: 'string',   complianceTags: ['GLBA_NPI','BSA_AML'], complianceNote: 'Custom encrypted field. Never store plain SSN.' },
      { id: uuid(), entityId: conId, name: 'AccountId',           label: 'Account (Parent)',     dataType: 'string' },

      // ── Opportunity (standard CRM — LoanAccount as credit pipeline deal) ─────
      { id: uuid(), entityId: oppId, name: 'Id',                  label: 'Opportunity ID',       dataType: 'string',   isKey: true, required: true },
      { id: uuid(), entityId: oppId, name: 'Name',                label: 'Opportunity Name',     dataType: 'string',   required: true },
      { id: uuid(), entityId: oppId, name: 'Amount',              label: 'Amount',               dataType: 'currency', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: oppId, name: 'CloseDate',           label: 'Close Date',           dataType: 'date',     required: true },
      { id: uuid(), entityId: oppId, name: 'StageName',           label: 'Stage',                dataType: 'picklist', picklistValues: ['Prospecting','Qualification','Proposal','Negotiation','Closed Won','Closed Lost'], required: true },
      { id: uuid(), entityId: oppId, name: 'Type',                label: 'Opportunity Type',     dataType: 'picklist', picklistValues: ['Personal Loan','Mortgage','Auto Loan','Commercial','HELOC'] },
      { id: uuid(), entityId: oppId, name: 'Description',         label: 'Description',          dataType: 'string' },
      { id: uuid(), entityId: oppId, name: 'AccountId',           label: 'Account',              dataType: 'string',   required: true },

      // ── FSC FinancialAccount — primary target for DDA and LoanAccount ─────────
      { id: uuid(), entityId: faId,  name: 'Id',                        label: 'FA ID',                     dataType: 'string',   isKey: true, required: true },
      { id: uuid(), entityId: faId,  name: 'FinancialAccountNumber',    label: 'Financial Account Number',  dataType: 'string',   required: true, complianceTags: ['FFIEC_AUDIT'] },
      { id: uuid(), entityId: faId,  name: 'Name',                      label: 'Account Name',              dataType: 'string',   required: true },
      { id: uuid(), entityId: faId,  name: 'Balance__c',                label: 'Balance (Custom)',          dataType: 'currency', complianceTags: ['SOX_FINANCIAL','FFIEC_AUDIT'] },
      { id: uuid(), entityId: faId,  name: 'OpenDate__c',               label: 'Open Date (Custom)',        dataType: 'date' },
      { id: uuid(), entityId: faId,  name: 'Status__c',                 label: 'Status (Custom)',           dataType: 'picklist', picklistValues: ['Open','Closed','Dormant','Frozen'] },
      { id: uuid(), entityId: faId,  name: 'FinancialAccountType',      label: 'Account Type',              dataType: 'picklist', picklistValues: ['Checking','Savings','CD','MoneyMarket','Loan','HELOC','Mortgage'] },
      { id: uuid(), entityId: faId,  name: 'InterestRate__c',           label: 'Interest Rate (Custom)',    dataType: 'decimal' },
      { id: uuid(), entityId: faId,  name: 'MaturityDate__c',           label: 'Maturity Date (Custom)',    dataType: 'date' },
      { id: uuid(), entityId: faId,  name: 'PrimaryOwnerID__c',         label: 'Primary Owner ID (Custom)', dataType: 'string',   complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: faId,  name: 'RoutingNumber__c',          label: 'Routing Number (Custom)',   dataType: 'string',   complianceTags: ['FFIEC_AUDIT'] },

      // ── FSC IndividualApplication — CIF Indv + application data ──────────────
      { id: uuid(), entityId: iaId,  name: 'Id',                        label: 'IA ID',                     dataType: 'string',   isKey: true, required: true },
      { id: uuid(), entityId: iaId,  name: 'LastName',                  label: 'Last Name',                 dataType: 'string',   required: true, complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: iaId,  name: 'FirstName',                 label: 'First Name',                dataType: 'string',   complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: iaId,  name: 'TaxId__c',                  label: 'Tax ID (Custom)',           dataType: 'string',   complianceTags: ['GLBA_NPI','BSA_AML'] },
      { id: uuid(), entityId: iaId,  name: 'Birthdate',                 label: 'Birthdate',                 dataType: 'date',     complianceTags: ['GLBA_NPI'] },
      { id: uuid(), entityId: iaId,  name: 'AMLRiskScore__c',           label: 'AML Risk Score (Custom)',   dataType: 'picklist', picklistValues: ['Low','Medium','High'], complianceTags: ['BSA_AML'] },

      // ── FSC FinancialGoal — CD / savings goal linked to FinancialAccount ──────
      { id: uuid(), entityId: goalId,name: 'Id',                        label: 'Goal ID',                   dataType: 'string',   isKey: true, required: true },
      { id: uuid(), entityId: goalId,name: 'Name',                      label: 'Goal Name',                 dataType: 'string',   required: true },
      { id: uuid(), entityId: goalId,name: 'TargetValue__c',            label: 'Target Value (Custom)',     dataType: 'currency', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: goalId,name: 'ActualValue__c',            label: 'Actual Value (Custom)',     dataType: 'currency', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: goalId,name: 'TargetDate__c',             label: 'Target Date (Custom)',      dataType: 'date' },
      { id: uuid(), entityId: goalId,name: 'Status__c',                 label: 'Status (Custom)',           dataType: 'picklist', picklistValues: ['Active','Achieved','Abandoned'] },

      // ── FSC AccountParticipant — party-to-account junction ───────────────────
      { id: uuid(), entityId: aprId, name: 'Id',                        label: 'AP ID',                     dataType: 'string',   isKey: true, required: true },
      { id: uuid(), entityId: aprId, name: 'FinancialAccountId',        label: 'Financial Account',         dataType: 'string',   required: true },
      { id: uuid(), entityId: aprId, name: 'ContactId',                 label: 'Contact',                   dataType: 'string',   required: true },
      { id: uuid(), entityId: aprId, name: 'Role__c',                   label: 'Role (Custom)',             dataType: 'picklist', picklistValues: ['Primary Owner','Co-Owner','Beneficiary','Power of Attorney','Trustee'] },

      // ── FSC PartyProfile — extended CIF Party / Relationship record ───────────
      { id: uuid(), entityId: ppId,  name: 'Id',                        label: 'PP ID',                     dataType: 'string',   isKey: true, required: true },
      { id: uuid(), entityId: ppId,  name: 'Name',                      label: 'Party Name',                dataType: 'string',   required: true },
      { id: uuid(), entityId: ppId,  name: 'PartyType__c',              label: 'Party Type (Custom)',       dataType: 'picklist', picklistValues: ['Individual','Business','Trust','Government'] },
      { id: uuid(), entityId: ppId,  name: 'RelationshipType__c',       label: 'Relationship Type (Custom)',dataType: 'picklist', picklistValues: ['Customer','Prospect','Beneficiary','Guarantor'] },
    ];
    const relationships = [
      { fromEntityId: conId,  toEntityId: accId, type: 'lookup', viaField: 'AccountId' },
      { fromEntityId: oppId,  toEntityId: accId, type: 'lookup', viaField: 'AccountId' },
      { fromEntityId: aprId,  toEntityId: faId,  type: 'lookup', viaField: 'FinancialAccountId' },
      { fromEntityId: aprId,  toEntityId: conId, type: 'lookup', viaField: 'ContactId' },
    ];
    return { entities, fields, relationships, mode: 'mock' };
  },

  'sap': (systemId) => {
    const bpId = uuid(), glId = uuid();
    const entities = [
      { id: bpId, systemId, name: 'BusinessPartner', label: 'Business Partner', description: 'SAP Business Partner (replaces KNA1/LFA1).' },
      { id: glId, systemId, name: 'GLAccount', label: 'G/L Account', description: 'General Ledger account.' },
    ];
    const fields = [
      { id: uuid(), entityId: bpId, name: 'PARTNER', label: 'BP Number', dataType: 'string', isKey: true, required: true },
      { id: uuid(), entityId: bpId, name: 'NAME1', label: 'Name 1', dataType: 'string', required: true },
      { id: uuid(), entityId: bpId, name: 'SMTP_ADDR', label: 'Email Address', dataType: 'email' },
      { id: uuid(), entityId: bpId, name: 'TELF1', label: 'Phone', dataType: 'phone' },
      { id: uuid(), entityId: bpId, name: 'STRAS', label: 'Street/House No.', dataType: 'string' },
      { id: uuid(), entityId: bpId, name: 'ORT01', label: 'City', dataType: 'string' },
      { id: uuid(), entityId: bpId, name: 'PSTLZ', label: 'Postal Code', dataType: 'string' },
      { id: uuid(), entityId: bpId, name: 'LAND1', label: 'Country Key', dataType: 'string' },
      { id: uuid(), entityId: glId, name: 'HKONT', label: 'G/L Account', dataType: 'string', isKey: true, required: true },
      { id: uuid(), entityId: glId, name: 'DMBTR', label: 'Amount in Local Currency', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { id: uuid(), entityId: glId, name: 'WAERS', label: 'Currency', dataType: 'string' },
      { id: uuid(), entityId: glId, name: 'BLDAT', label: 'Document Date', dataType: 'date' },
    ];
    return { entities, fields, relationships: [], mode: 'mock' };
  },
};

// ─── POST /api/connectors/custom ─────────────────────────────────────────────
app.post('/api/connectors/custom', (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const vendor = typeof body.vendor === 'string' && body.vendor.trim() ? body.vendor.trim() : 'Custom';
  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'custom';
  const description =
    typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : 'Custom connector';
  const entities = normalizeCustomEntities(body.entities);

  if (!name) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'name is required' } });
  }
  if (!entities.length) {
    return res
      .status(400)
      .json({ error: { code: 'INVALID_INPUT', message: 'entities must be a non-empty array' } });
  }

  const connectionConfig = sanitizeCustomConnectionConfig(body.connectionConfig);
  const id = `custom-${uuid().slice(0, 8)}`;
  const entityNames = entities.map((entity) => entity.name);

  const connectorDef = {
    id,
    displayName: name,
    name,
    vendor,
    category,
    description,
    entities: entityNames,
    hasMockMode: true,
    requiredCredentials: [],
    protocol: 'Custom',
    connectionConfig,
  };

  CONNECTORS.push(connectorDef);
  SCHEMAS[id] = (systemId) => buildCustomSchema(systemId, entities);

  return res.status(201).json({
    id,
    connector: connectorDef,
  });
});

// ─── POST /api/connectors/:id/schema ─────────────────────────────────────────
app.post('/api/connectors/:id/schema', (req, res) => {
  const { id } = req.params;
  const schemaFn = SCHEMAS[id];
  if (!schemaFn) {
    return res.status(404).json({ error: { code: 'CONNECTOR_NOT_FOUND', message: `Unknown connector: ${id}` } });
  }
  const schema = schemaFn('sys-' + id);
  res.json({ ...schema, entityCount: schema.entities.length, fieldCount: schema.fields.length });
});

// ─── POST /api/connectors/:id/test ───────────────────────────────────────────
app.post('/api/connectors/:id/test', (req, res) => {
  const connector = CONNECTORS.find((c) => c.id === req.params.id);
  if (!connector) return res.status(404).json({ error: { code: 'CONNECTOR_NOT_FOUND', message: 'Not found' } });
  res.json({ connected: true, latencyMs: 0, systemInfo: { mode: 'mock', displayName: connector.displayName, protocol: connector.protocol } });
});

// ─── POST /api/connectors/:id/objects ────────────────────────────────────────
app.post('/api/connectors/:id/objects', (req, res) => {
  const schemaFn = SCHEMAS[req.params.id];
  if (!schemaFn) return res.status(404).json({ error: { code: 'CONNECTOR_NOT_FOUND', message: 'Not found' } });
  const schema = schemaFn('sys-temp');
  res.json({ objects: schema.entities.map((e) => e.name), mode: 'mock', total: schema.entities.length });
});

// ─── Projects ─────────────────────────────────────────────────────────────────
app.post('/api/projects', (req, res) => {
  const { name, sourceSystemName, targetSystemName } = req.body;
  const id = 'proj-' + (projectIdCounter++);
  const srcId = 'sys-src-' + id;
  const tgtId = 'sys-tgt-' + id;
  const project = { id, name: name || 'Demo Project', sourceSystemId: srcId, targetSystemId: tgtId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  projects.set(id, { project, sourceSystemId: srcId, targetSystemId: tgtId });
  res.status(201).json({ project });
});

// ─── Ingest schema into a project ────────────────────────────────────────────
app.post('/api/projects/:projectId/schema/:connectorId', (req, res) => {
  const { projectId, connectorId } = req.params;
  const proj = projects.get(projectId);
  if (!proj) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Not found' } });

  const schemaFn = SCHEMAS[connectorId];
  if (!schemaFn) return res.status(404).json({ error: { code: 'CONNECTOR_NOT_FOUND', message: `Unknown connector: ${connectorId}` } });

  const side = req.body.side === 'target' ? 'target' : 'source';
  const systemId = side === 'source' ? proj.sourceSystemId : proj.targetSystemId;
  const schema = schemaFn(systemId);

  systemSchemas.set(systemId, schema);
  res.json({ ...schema, side, systemId, message: `${side} schema ingested via ${connectorId}` });
});

// ─── GET /api/projects/:id ───────────────────────────────────────────────────
app.get('/api/projects/:id', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Not found' } });
  const srcSchema = systemSchemas.get(p.sourceSystemId) || { entities: [], fields: [], relationships: [] };
  const tgtSchema = systemSchemas.get(p.targetSystemId) || { entities: [], fields: [], relationships: [] };
  const allFields = [...(srcSchema.fields || []), ...(tgtSchema.fields || [])];
  const entityMappings = p.entityMappings || [];
  const fieldMappings = p.fieldMappings || [];
  res.json({ project: p.project, sourceEntities: srcSchema.entities, targetEntities: tgtSchema.entities, fields: allFields, relationships: [...srcSchema.relationships, ...tgtSchema.relationships], entityMappings, fieldMappings });
});

// ─── Domain-aware heuristic helpers ──────────────────────────────────────────
// Strips Salesforce custom field suffix and lowercases for fair name comparison.
const normName = (n) => n.replace(/__c$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

// Financial domain entity synonym pairs (bidirectional).
// Allows DDA→FinancialAccount, LoanAccount→FinancialAccount etc. to score well
// even when pure Jaccard similarity is low.
const DOMAIN_ENTITY_SYNONYMS = new Map([
  ['dda',               ['financialaccount', 'bankaccount', 'depositaccount']],
  ['ddaaccount',        ['financialaccount']],
  ['loanaccount',       ['financialaccount', 'opportunity']],
  ['loan',              ['financialaccount', 'opportunity']],
  ['share',             ['financialaccount']],
  ['shareaccount',      ['financialaccount']],
  ['member',            ['contact', 'account']],
  ['cif',               ['account', 'contact', 'partyprofile', 'individualapplication']],
  ['party',             ['partyprofile', 'account', 'contact']],
  ['glaccount',         ['financialgoal']],
  ['cdaccount',         ['financialaccount', 'financialgoal']],
  ['businesspartner',   ['account', 'contact']],
  ['customer',          ['account', 'contact']],
]);

function entityNameSim(srcName, tgtName) {
  const src = normName(srcName);
  const tgt = normName(tgtName);
  const base = jaccardSim(src, tgt);
  const synonyms = DOMAIN_ENTITY_SYNONYMS.get(src) || [];
  if (synonyms.includes(tgt)) return Math.max(base, 0.55);
  return base;
}

// Curated financial field synonym pairs (bidirectional).
// Each entry: [normalised source field name, normalised target field name].
const FIELD_SYNONYMS = [
  // Account / CIF identifiers
  ['cifnumber',           'primaryownerid'],
  ['ciflink',             'primaryownerid'],
  ['accountnumber',       'financialaccountnumber'],
  ['ddanum',              'financialaccountnumber'],
  ['loannumber',          'financialaccountnumber'],
  ['loannum',             'financialaccountnumber'],
  ['membernumber',        'accountnumber'],
  // Balances
  ['currentbalance',      'balance'],
  ['ledgerbal',           'balance'],
  ['availablebalance',    'balance'],
  ['curbal',              'balance'],
  ['curbbal',             'balance'],
  ['originalbalance',     'amount'],
  ['origamt',             'amount'],
  // Dates
  ['opendate',            'opendate'],
  ['opendt',              'opendate'],
  ['maturitydate',        'maturitydate'],
  ['maturitydt',          'maturitydate'],
  ['dateofbirth',         'birthdate'],
  ['birthdt',             'birthdate'],
  // Rates
  ['interestrate',        'interestrate'],
  ['rate',                'interestrate'],
  ['dividendrate',        'interestrate'],
  // Status
  ['loanstatus',          'status'],
  ['acctstatus',          'status'],
  ['ddastatus',           'status'],
  ['accountstatus',       'status'],
  ['customerstatus',      'status'],
  ['memberstatus',        'status'],
  // Type
  ['accttype',            'financialaccounttype'],
  ['loantype',            'financialaccounttype'],
  ['accounttype',         'financialaccounttype'],
  // Loan pipeline → Opportunity
  ['loanstatus',          'stagename'],
  ['maturitydate',        'closedate'],
  ['maturitydt',          'closedate'],
  // Name
  ['legalname',           'name'],
  ['shortname',           'name'],
  ['membernumber',        'name'],
  // Contact / identity
  ['taxid',               'taxid'],
  ['taxid',               'ssn'],
  ['ssn',                 'ssn'],
  ['emailaddr',           'email'],
  ['primaryemail',        'email'],
  ['emailaddress',        'email'],
  ['phonenum',            'phone'],
  ['primaryphone',        'phone'],
  // Address
  ['addr1',               'billingstreet'],
  ['addressline1',        'billingstreet'],
  ['stateprov',           'billingstate'],
  ['statecode',           'billingstate'],
  ['postalcode',          'billingpostalcode'],
  // Compliance
  ['riskrating',          'amlriskscore'],
  ['riskrating',          'rating'],
  // Routing
  ['routingnum',          'routingnumber'],
  ['routingtransitnumber','routingnumber'],
];

function fieldNameSim(sfName, tfName) {
  const src = normName(sfName);
  const tgt = normName(tfName);
  const base = jaccardSim(src, tgt);
  for (const [a, b] of FIELD_SYNONYMS) {
    if ((src === a && tgt === b) || (src === b && tgt === a)) {
      return Math.max(base, 0.72); // synonym pair — guaranteed good score
    }
  }
  return base;
}

// ─── Suggest mappings ─────────────────────────────────────────────────────────
app.post('/api/projects/:id/suggest-mappings', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Not found' } });

  const srcSchema = systemSchemas.get(p.sourceSystemId);
  const tgtSchema = systemSchemas.get(p.targetSystemId);
  if (!srcSchema || !tgtSchema) return res.status(400).json({ error: { code: 'MISSING_SCHEMAS', message: 'Load source and target schemas first' } });

  const entityMappings = [];
  const fieldMappings = [];

  for (const srcEnt of srcSchema.entities) {
    for (const tgtEnt of tgtSchema.entities) {
      // Use domain-aware entity similarity (includes synonym boosts for DDA→FinancialAccount etc.)
      const entSim = entityNameSim(srcEnt.name, tgtEnt.name);
      if (entSim < 0.2) continue;

      const emId = uuid();
      entityMappings.push({
        id: emId,
        projectId: req.params.id,
        sourceEntityId: srcEnt.id,
        targetEntityId: tgtEnt.id,
        confidence: Math.min(1, entSim + 0.15),
        status: 'suggested',
        notes: null,
      });

      const srcFields = (srcSchema.fields || []).filter((f) => f.entityId === srcEnt.id);
      const tgtFields = (tgtSchema.fields || []).filter((f) => f.entityId === tgtEnt.id);

      for (const sf of srcFields) {
        let bestMatch = null, bestScore = 0;
        for (const tf of tgtFields) {
          // Compute domain-aware name similarity (strips __c, applies FIELD_SYNONYMS)
          const nameSim = fieldNameSim(sf.name, tf.name);

          // CRITICAL FIX: require minimum name similarity before type bonus applies.
          // Without this guard, score = 0*0.6 + 0.3 = 0.3 > 0.2 makes every
          // string→string pair a valid match, causing garbage like LoanNum→BillingCity.
          if (nameSim < 0.08) continue;

          const score = nameSim * 0.6 + (sf.dataType === tf.dataType ? 0.25 : 0);
          if (score > bestScore && score > 0.25) { bestScore = score; bestMatch = tf; }
        }
        if (bestMatch) {
          const isLookup = sf.picklistValues && bestMatch.picklistValues && sf.picklistValues.join() !== bestMatch.picklistValues.join();
          fieldMappings.push({
            id: uuid(),
            entityMappingId: emId,
            sourceFieldId: sf.id,
            targetFieldId: bestMatch.id,
            confidence: Math.min(1, bestScore + 0.05),
            status: 'suggested',
            transform: { type: isLookup ? 'lookup' : 'direct', config: {} },
            rationale: `Domain-aware match — name similarity ${Math.round(fieldNameSim(sf.name, bestMatch.name) * 100)}%, type ${sf.dataType === bestMatch.dataType ? 'exact' : 'mismatch'}.`,
          });
        }
      }
    }
  }

  p.entityMappings = entityMappings;
  p.fieldMappings = fieldMappings;

  res.json({ entityMappings, fieldMappings, mode: 'heuristic', validation: { totalMappings: fieldMappings.length, confirmed: 0, suggested: fieldMappings.length } });
});

// ─── Orchestrate (SSE) ────────────────────────────────────────────────────────
const AGENT_STEPS = [
  { agentName: 'SchemaDiscoveryAgent', action: 'schema_discovery_complete', detail: 'Schema analysis complete' },
  { agentName: 'ComplianceAgent', action: 'compliance_scan_complete', detail: 'Compliance scan complete' },
  { agentName: 'BankingDomainAgent', action: 'banking_domain_complete', detail: 'Banking domain heuristics applied' },
  { agentName: 'CRMDomainAgent', action: 'crm_domain_complete', detail: 'Salesforce CRM rules applied' },
  { agentName: 'MappingProposalAgent', action: 'mapping_proposal_complete', detail: 'No LLM provider — heuristic mode' },
  { agentName: 'MappingRationaleAgent', action: 'rationale_complete', detail: 'Human-readable rationale generated for all mappings' },
  { agentName: 'ValidationAgent', action: 'validation_complete', detail: 'Validation complete' },
];

app.post('/api/projects/:id/orchestrate', async (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Not found' } });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const write = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  write({ type: 'start', projectId: req.params.id, totalMappings: (p.fieldMappings || []).length, hasLLM: false });

  const srcSchema = systemSchemas.get(p.sourceSystemId);
  const tgtSchema = systemSchemas.get(p.targetSystemId);

  const complianceTags = [];
  for (const f of [...(srcSchema?.fields || [])]) {
    for (const t of (f.complianceTags || [])) if (!complianceTags.includes(t)) complianceTags.push(t);
  }

  // Detect Core Director (numeric AcctType codes)
  const hasCoreDirectorCodes = (srcSchema?.fields || []).some(
    (f) => f.name === 'AcctType' && (f.picklistValues || []).some((v) => ['10','40','50','60'].includes(v)),
  );

  const steps = [
    { ...AGENT_STEPS[0], detail: `Classified ${(srcSchema?.fields?.length || 0) + (tgtSchema?.fields?.length || 0)} fields across ${(srcSchema?.entities?.length || 0) + (tgtSchema?.entities?.length || 0)} entities`, durationMs: 12 },
    { ...AGENT_STEPS[1], detail: `Found compliance tags: ${complianceTags.join(', ')}. ${(srcSchema?.fields || []).filter((f) => (f.complianceTags || []).includes('GLBA_NPI')).length} GLBA_NPI, ${(srcSchema?.fields || []).filter((f) => (f.complianceTags || []).includes('PCI_CARD')).length} PCI_CARD fields`, durationMs: 8 },
    { ...AGENT_STEPS[2], detail: hasCoreDirectorCodes
        ? 'Core Director detected — AcctType numeric codes ("10","40") flagged for lookup transform. CustomerType short codes (Indv/Bus) flagged.'
        : 'Applied Jack Henry SilverLake synonym boosts (LegalName→Name, PrimaryEmail→Email)', durationMs: 5 },
    { ...AGENT_STEPS[3], detail: 'Salesforce FSC schema analysed: FinancialAccount is preferred target for DDA/Loan over generic Account. IndividualApplication for CIF Indv. AccountParticipant links parties to accounts. FinancialGoal for CD/savings. PartyProfile for relationship records.', durationMs: 4 },
    { ...AGENT_STEPS[4], detail: 'No LLM provider configured (OPENAI_API_KEY / ANTHROPIC_API_KEY) — running heuristic mode', durationMs: 2 },
    { ...AGENT_STEPS[5], detail: `Generated intent rationale for ${(p.fieldMappings || []).length} mappings — explains why each field was matched`, durationMs: 3 },
    { ...AGENT_STEPS[6], detail: `${(p.fieldMappings || []).length} mappings validated. ${(p.fieldMappings || []).filter((m) => m.confidence < 0.4).length} low-confidence flagged for review`, durationMs: 6 },
  ];

  for (const step of steps) {
    await new Promise((r) => setTimeout(r, 300));
    write({ type: 'step', ...step });
  }

  write({ type: 'complete', totalImproved: Math.floor((p.fieldMappings || []).length * 0.4), agentsRun: steps.map((s) => s.agentName), durationMs: 40, complianceSummary: { errors: 0, warnings: complianceTags.includes('BSA_AML') ? 1 : 0, piiFields: (srcSchema?.fields || []).filter((f) => (f.complianceTags || []).includes('GLBA_NPI')).length } });

  res.end();
});

// ─── Export format metadata ───────────────────────────────────────────────────
const EXPORT_FORMATS = {
  json: { label: 'Canonical JSON', mime: 'application/json', ext: 'json', description: 'Point-to-point integration. Full mapping spec with compliance metadata.' },
  yaml: { label: 'YAML', mime: 'application/x-yaml', ext: 'yaml', description: 'Human-readable diff-friendly format. Ideal for Git-based reviews.' },
  csv: { label: 'CSV', mime: 'text/csv', ext: 'csv', description: 'Spreadsheet-compatible. Share with business analysts for field-by-field review.' },
  dataweave: { label: 'MuleSoft DataWeave', mime: 'application/octet-stream', ext: 'dwl', description: 'DataWeave 2.0 transform script. Drop into a MuleSoft Transform Message component.' },
  boomi: { label: 'Dell Boomi XML', mime: 'application/xml', ext: 'xml', description: 'Boomi Process XML with Map component field definitions.' },
  workato: { label: 'Workato Recipe', mime: 'application/json', ext: 'json', description: 'Workato recipe JSON with datapill expressions and lookup tables.' },
};

app.get('/api/projects/:id/export/formats', (_req, res) => {
  res.json({ formats: EXPORT_FORMATS });
});

// ─── Export ───────────────────────────────────────────────────────────────────
app.get('/api/projects/:id/export', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Not found' } });

  const format = String(req.query.format || 'json');
  if (!(format in EXPORT_FORMATS)) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `format must be one of: ${Object.keys(EXPORT_FORMATS).join(', ')}` } });
  }

  const srcSchema = systemSchemas.get(p.sourceSystemId) || { entities: [], fields: [] };
  const tgtSchema = systemSchemas.get(p.targetSystemId) || { entities: [], fields: [] };

  const allFields = [...(srcSchema.fields || []), ...(tgtSchema.fields || [])];
  const allEntities = [...(srcSchema.entities || []), ...(tgtSchema.entities || [])];
  const fieldById = (id) => allFields.find((f) => f.id === id);
  const entityById = (id) => allEntities.find((e) => e.id === id);

  const mappingSpec = (p.fieldMappings || []).map((fm) => {
    const sf = fieldById(fm.sourceFieldId);
    const tf = fieldById(fm.targetFieldId);
    return {
      sourceEntity: entityById(sf?.entityId)?.name || '?',
      sourceField: sf?.name || '?',
      sourceDataType: sf?.dataType || 'string',
      sourceRequired: sf?.required || false,
      targetEntity: entityById(tf?.entityId)?.name || '?',
      targetField: tf?.name || '?',
      targetDataType: tf?.dataType || 'string',
      confidence: Math.round((fm.confidence || 0) * 100) / 100,
      status: fm.status || 'suggested',
      transform: fm.transform || { type: 'direct', config: {} },
      rationale: fm.rationale || '',
      complianceTags: sf?.complianceTags || [],
      complianceNote: sf?.complianceNote || null,
      iso20022Name: sf?.iso20022Name || null,
    };
  });

  const validation = {
    totalMappings: mappingSpec.length,
    confirmed: mappingSpec.filter((m) => m.status === 'confirmed').length,
    suggested: mappingSpec.filter((m) => m.status === 'suggested').length,
    lowConfidence: mappingSpec.filter((m) => m.confidence < 0.5).length,
  };

  const projectName = p.project?.name || 'AutoMapper';
  const fmt = EXPORT_FORMATS[format];
  const ts = new Date().toISOString();

  let content, mime, filename;

  if (format === 'json') {
    content = { version: '1.0', exportedAt: ts, project: p.project, mappings: mappingSpec, validation };
    mime = fmt.mime;
    filename = `${projectName.replace(/\s+/g,'_')}_mapping.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.json(content);
  }

  if (format === 'yaml') {
    const lines = [
      `# AutoMapper Export — ${projectName}`,
      `# Exported: ${ts}`,
      `version: "1.0"`,
      `project:`,
      `  name: "${projectName}"`,
      `  id: "${p.project?.id || ''}"`,
      `mappings:`,
    ];
    for (const m of mappingSpec) {
      lines.push(`  - sourceEntity: "${m.sourceEntity}"`);
      lines.push(`    sourceField: "${m.sourceField}"`);
      lines.push(`    targetEntity: "${m.targetEntity}"`);
      lines.push(`    targetField: "${m.targetField}"`);
      lines.push(`    confidence: ${m.confidence}`);
      lines.push(`    status: "${m.status}"`);
      lines.push(`    transform: "${m.transform?.type || 'direct'}"`);
      if (m.complianceTags.length) lines.push(`    complianceTags: [${m.complianceTags.map((t) => `"${t}"`).join(', ')}]`);
      if (m.iso20022Name) lines.push(`    iso20022Name: "${m.iso20022Name}"`);
    }
    content = lines.join('\n');
    mime = fmt.mime;
    filename = `${projectName.replace(/\s+/g,'_')}_mapping.yaml`;
  } else if (format === 'csv') {
    const rows = [
      ['sourceEntity','sourceField','sourceDataType','sourceRequired','targetEntity','targetField','targetDataType','confidence','status','transform','complianceTags','iso20022Name','rationale'],
    ];
    for (const m of mappingSpec) {
      rows.push([
        m.sourceEntity, m.sourceField, m.sourceDataType, String(m.sourceRequired),
        m.targetEntity, m.targetField, m.targetDataType,
        String(m.confidence), m.status, m.transform?.type || 'direct',
        m.complianceTags.join('|'), m.iso20022Name || '', m.rationale || '',
      ]);
    }
    content = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    mime = fmt.mime;
    filename = `${projectName.replace(/\s+/g,'_')}_mapping.csv`;
  } else if (format === 'dataweave') {
    const lines = [
      `// AutoMapper — MuleSoft DataWeave 2.0 Transform`,
      `// Project: ${projectName}  |  Exported: ${ts}`,
      `// Paste into a Transform Message component in Anypoint Studio`,
      `%dw 2.0`,
      `output application/json`,
      `---`,
      `{`,
    ];
    const byTarget = {};
    for (const m of mappingSpec) {
      if (!byTarget[m.targetEntity]) byTarget[m.targetEntity] = [];
      byTarget[m.targetEntity].push(m);
    }
    for (const [tgtEnt, maps] of Object.entries(byTarget)) {
      lines.push(`  "${tgtEnt}": {`);
      for (const m of maps) {
        let expr;
        const t = m.transform?.type || 'direct';
        if (t === 'direct') {
          if (m.sourceDataType === 'date' && m.targetDataType === 'string') {
            expr = `payload.${m.sourceField} as String {format: "yyyy-MM-dd"}`;
          } else if (m.sourceDataType === 'decimal' && m.targetDataType === 'string') {
            expr = `payload.${m.sourceField} as String`;
          } else {
            expr = `payload.${m.sourceField}`;
          }
        } else if (t === 'lookup') {
          expr = `lookupTable_${m.sourceField}[payload.${m.sourceField}]  // TODO: define lookup table`;
        } else if (t === 'trim') {
          expr = `trim(payload.${m.sourceField})`;
        } else {
          expr = `payload.${m.sourceField}  // transform: ${t}`;
        }
        lines.push(`    "${m.targetField}": ${expr},  // ${m.rationale || 'auto-mapped'}`);
      }
      lines.push(`  },`);
    }
    lines.push(`}`);
    content = lines.join('\n');
    mime = fmt.mime;
    filename = `${projectName.replace(/\s+/g,'_')}_transform.dwl`;
  } else if (format === 'boomi') {
    const mapFields = mappingSpec.map((m, i) => {
      const t = m.transform?.type || 'direct';
      let mapType = 'SetValue';
      if (t === 'concat') mapType = 'Concatenate';
      else if (t === 'lookup') mapType = 'CrossReference';
      else if (t === 'trim') mapType = 'SetValue';
      return `    <mapField index="${i}" sourceField="${m.sourceField}" targetField="${m.targetField}" mapType="${mapType}" confidence="${m.confidence}" status="${m.status}">\n      <!-- ${m.rationale || 'auto-mapped'} -->\n    </mapField>`;
    }).join('\n');
    content = `<?xml version="1.0" encoding="UTF-8"?>
<!-- AutoMapper Export for Dell Boomi — ${projectName} -->
<!-- Exported: ${ts} -->
<boomiMapping version="1.0" projectName="${projectName}">
  <source type="json"/>
  <destination type="json"/>
  <maps>
${mapFields}
  </maps>
  <validation totalMappings="${validation.totalMappings}" confirmed="${validation.confirmed}" suggested="${validation.suggested}"/>
</boomiMapping>`;
    mime = fmt.mime;
    filename = `${projectName.replace(/\s+/g,'_')}_boomi.xml`;
  } else if (format === 'workato') {
    const steps = mappingSpec.map((m) => {
      const t = m.transform?.type || 'direct';
      let datapill;
      if (t === 'direct') datapill = `{{source.${m.sourceField}}}`;
      else if (t === 'trim') datapill = `{{source.${m.sourceField} | strip}}`;
      else if (t === 'lookup') datapill = `{{lookup("${m.sourceField}_table", source.${m.sourceField})}}`;
      else datapill = `{{source.${m.sourceField}}}`;
      return { sourceField: m.sourceField, targetField: m.targetField, datapill, confidence: m.confidence, status: m.status };
    });
    content = JSON.stringify({
      name: `${projectName} Field Mapping`,
      version: 1,
      exportedAt: ts,
      recipe: {
        steps: [{
          app: 'variables',
          action: 'set_variables',
          title: `Map ${projectName} fields`,
          input: Object.fromEntries(steps.map((s) => [s.targetField, s.datapill])),
        }],
      },
      mappingSummary: steps,
      validation,
    }, null, 2);
    mime = fmt.mime;
    filename = `${projectName.replace(/\s+/g,'_')}_workato_recipe.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.json(JSON.parse(content));
  }

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tokenize(str) {
  return str.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/\W+/).filter(Boolean);
}
function jaccardSim(a, b) {
  const ta = new Set(tokenize(a)), tb = new Set(tokenize(b));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : inter / union;
}

// ─── Start ────────────────────────────────────────────────────────────────────
createServer(app).listen(PORT, () => {
  console.log(`\n✅  AutoMapper Demo Server running on http://localhost:${PORT}`);
  console.log(`   Open demo.html in your browser to use the visual interface`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   GET  http://localhost:${PORT}/api/connectors`);
  console.log(`   GET  http://localhost:${PORT}/api/projects/:id/export/formats\n`);
});
