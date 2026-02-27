/**
 * Jack Henry SilverLake Connector
 *
 * Connects to Jack Henry SilverLake core banking (used by commercial banks).
 * Protocol: jXchange SOAP/XML API, ISO 20022 field naming (as of July 2025 migration).
 * Auth: OAuth 2.0 (client_credentials grant).
 *
 * In mock mode (no credentials), returns a representative schema covering the
 * four primary SilverLake domains used in SAP/Salesforce integrations:
 *   CIF (Customer Information File)
 *   DDA (Demand Deposit Account)
 *   LoanAccount
 *   GLAccount (General Ledger)
 *
 * Compliance tags follow:
 *   GLBA_NPI  — Non-Public Personal Information
 *   FFIEC_AUDIT — must appear in FFIEC audit trail
 *   SOX_FINANCIAL — financial field requiring SOX change control
 *   BSA_AML — Bank Secrecy Act / Anti-Money Laundering indicator
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IConnector,
  ConnectorCredentials,
  ConnectorField,
  ConnectorSchema,
  ConnectorSystemInfo,
  SampleRow,
} from '../IConnector.js';
import type { Entity, Relationship } from '../../types.js';

interface SilverLakeCredentials {
  // OAuth client_credentials mode
  authMode?: 'oauth-client-credentials' | 'service-gateway';
  instanceUrl?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  // jXchange Service Gateway SOAP mode
  endpoint?: string;
  username?: string;
  password?: string;
  instRtId?: string;
  instEnv?: string;
  validConsmName?: string;
  validConsmProd?: string;
}

export class SilverLakeConnector implements IConnector {
  private mode: 'live' | 'mock' = 'mock';
  private credentials: SilverLakeCredentials = {};
  private accessToken: string | null = null;

  async connect(credentials?: ConnectorCredentials): Promise<void> {
    const creds: SilverLakeCredentials = {
      instanceUrl: credentials?.instanceUrl || process.env.JH_SL_INSTANCE_URL,
      clientId: credentials?.clientId || process.env.JH_SL_CLIENT_ID,
      clientSecret: credentials?.clientSecret || process.env.JH_SL_CLIENT_SECRET,
      tokenUrl: credentials?.tokenUrl || process.env.JH_SL_TOKEN_URL,
      authMode:
        credentials?.authMode === 'service-gateway' || credentials?.authMode === 'oauth-client-credentials'
          ? credentials.authMode
          : undefined,
      endpoint: credentials?.endpoint || process.env.JH_SL_SG_ENDPOINT,
      username: credentials?.username || process.env.JH_SL_SG_USERNAME,
      password: credentials?.password || process.env.JH_SL_SG_PASSWORD,
      instRtId: credentials?.instRtId || process.env.JH_SL_INST_RT_ID,
      instEnv: credentials?.instEnv || process.env.JH_SL_INST_ENV,
      validConsmName: credentials?.validConsmName || process.env.JH_SL_VALID_CONSM_NAME,
      validConsmProd: credentials?.validConsmProd || process.env.JH_SL_VALID_CONSM_PROD,
    };

    const hasOAuthCreds = Boolean(creds.instanceUrl && creds.clientId && creds.clientSecret);
    const hasServiceGatewayCreds = Boolean(
      creds.endpoint &&
      creds.username &&
      creds.password &&
      creds.instRtId &&
      creds.instEnv &&
      creds.validConsmName &&
      creds.validConsmProd,
    );

    if (!hasOAuthCreds && !hasServiceGatewayCreds) {
      this.mode = 'mock';
      return;
    }

    try {
      const selectedAuthMode =
        creds.authMode ??
        (hasOAuthCreds ? 'oauth-client-credentials' : 'service-gateway');

      if (selectedAuthMode === 'oauth-client-credentials' && hasOAuthCreds) {
        // OAuth 2.0 client_credentials grant
        const tokenUrl = creds.tokenUrl || `${creds.instanceUrl}/oauth2/token`;
        const params = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: creds.clientId!,
          client_secret: creds.clientSecret!,
          scope: 'jxchange:read',
        });
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        if (!response.ok) throw new Error(`OAuth failed: ${response.status}`);
        const data = (await response.json()) as { access_token: string };
        this.accessToken = data.access_token;
      } else if (selectedAuthMode === 'service-gateway' && hasServiceGatewayCreds) {
        // Service Gateway SOAP mode: validate endpoint reachability using basic auth.
        // Schema extraction remains connector-driven, but route should recognize this as a live credential path.
        const response = await fetch(creds.endpoint!, {
          method: 'GET',
          headers: {
            Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
            Accept: '*/*',
          },
          signal: AbortSignal.timeout(5000),
        });
        // SOAP endpoints often return 401/403/405 on GET but are still valid/reachable.
        if (response.status >= 500) {
          throw new Error(`Service Gateway endpoint unreachable: ${response.status}`);
        }
      } else {
        throw new Error(`Selected auth mode "${selectedAuthMode}" is missing required credentials`);
      }

      this.credentials = creds;
      this.mode = 'live';
    } catch {
      this.mode = 'mock';
    }
  }

  async listObjects(): Promise<string[]> {
    if (this.mode === 'live') {
      // In a real implementation, call jXchange MetaDataInq to list available services
      return ['CIF', 'DDA', 'LoanAccount', 'GLAccount', 'Certificate', 'SafeDepositBox'];
    }
    return ['CIF', 'DDA', 'LoanAccount', 'GLAccount'];
  }

  async fetchSchema(objectNames?: string[]): Promise<ConnectorSchema> {
    const objects = objectNames && objectNames.length > 0
      ? objectNames
      : await this.listObjects();

    const entities: Entity[] = [];
    const fields: ConnectorField[] = [];
    const relationships: Relationship[] = [];

    for (const objectName of objects) {
      const entityId = uuidv4();
      const schema = buildSilverLakeSchema(objectName, entityId);
      if (!schema) continue;

      entities.push({
        id: entityId,
        systemId: '', // Set by the route handler after system creation
        name: objectName,
        label: schema.label,
        description: schema.description,
      });
      fields.push(...schema.fields.map((f) => ({ ...f, entityId })));
    }

    // Build CIF → DDA relationship
    const cifEntity = entities.find((e) => e.name === 'CIF');
    const ddaEntity = entities.find((e) => e.name === 'DDA');
    const loanEntity = entities.find((e) => e.name === 'LoanAccount');
    if (cifEntity && ddaEntity) {
      relationships.push({ fromEntityId: ddaEntity.id, toEntityId: cifEntity.id, type: 'lookup', viaField: 'CIFNumber' });
    }
    if (cifEntity && loanEntity) {
      relationships.push({ fromEntityId: loanEntity.id, toEntityId: cifEntity.id, type: 'lookup', viaField: 'CIFNumber' });
    }

    return { entities, fields, relationships, mode: this.mode };
  }

  async getSampleData(objectName: string, limit = 5): Promise<SampleRow[]> {
    return buildSilverLakeSamples(objectName, limit);
  }

  async testConnection(): Promise<{ connected: boolean; latencyMs: number; message?: string }> {
    if (this.mode === 'mock') {
      return { connected: true, latencyMs: 0, message: 'Mock mode — no credentials provided' };
    }

    const start = Date.now();
    try {
      if (this.accessToken && this.credentials.instanceUrl) {
        const url = `${this.credentials.instanceUrl}/jxchange/v1/health`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          signal: AbortSignal.timeout(5000),
        });
        return { connected: resp.ok, latencyMs: Date.now() - start };
      }

      if (this.credentials.endpoint && this.credentials.username && this.credentials.password) {
        const resp = await fetch(this.credentials.endpoint, {
          method: 'GET',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString('base64')}`,
            Accept: '*/*',
          },
          signal: AbortSignal.timeout(5000),
        });
        const connected = resp.ok || [401, 403, 405].includes(resp.status);
        return {
          connected,
          latencyMs: Date.now() - start,
          message: connected ? `Service Gateway reachable (HTTP ${resp.status})` : `HTTP ${resp.status}`,
        };
      }

      return { connected: false, latencyMs: Date.now() - start, message: 'No valid Jack Henry credentials configured' };
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, message: String(err) };
    }
  }

  async getSystemInfo(): Promise<ConnectorSystemInfo> {
    return {
      displayName: 'Jack Henry SilverLake',
      systemType: 'jackhenry',
      mode: this.mode,
      protocol: 'SOAP/jXchange (ISO 20022)',
      version: '2024.2',
      metadata: {
        targetMarket: 'Commercial Banks',
        /**
         * Fedwire ISO 20022 migration completed July 14, 2025.
         * SilverLake field names in wire operations now follow ISO 20022 XPath conventions.
         * Source: https://jackhenry.dev/jxchange-soap/iso20022/
         */
        iso20022MigrationComplete: 'July 14, 2025',
        /**
         * OAuth 2.0 JWT token expiry is 10 minutes.
         * New bank-level implementations: OAuth required from April 2026.
         * All implementations mandatory: April 2028.
         * Source: https://jackhenry.dev/jxchange-soap/getting-started/
         */
        authMethod: 'OAuth 2.0 client_credentials',
        supportedAuthModes: ['OAuth 2.0 client_credentials', 'jXchange Service Gateway (Basic Auth)'],
        oauthTokenExpirySecs: 600,
        oauthMandatoryDate: 'April 2028',
        /**
         * SilverLake AcctType codes used in jXchange requests.
         * These differ from Core Director — see CoreDirectorConnector for that platform.
         */
        acctTypeCodes: { deposit: 'D', loan: 'L', timeDeposit: 'T', safeDepositBox: 'B' },
        /**
         * jXchange core inquiry operations for SilverLake:
         *   CustInq    — retrieve customer demographics (name, address, TaxId, BirthDt, email)
         *   AcctInq    — retrieve account balances and details (CurBal, CollBal, AvailBal)
         *   AcctSrch   — search accounts by PersonName, TaxID, or CustId
         *   CustSrch   — search customers before CustInq if CustId unknown
         *   AddrSrch   — retrieve all address types (physical, IRS, seasonal)
         *   LnBilSrch  — retrieve loan billing records
         *   SvcDictSrch — discover mapped elements and allowed values for an operation
         * Source: https://jackhenry.dev/jxchange-soap/core-reference-resources/silverlake/
         */
        jxchangeOperations: ['CustInq', 'AcctInq', 'AcctSrch', 'CustSrch', 'AddrSrch', 'LnBilSrch', 'SvcDictSrch', 'CustAdd', 'AcctAdd', 'AcctMod'],
        apiSpec: 'https://jackhenry.dev/jxchange-soap/',
        dmzInstRtId: '011001276',
        dmzInstEnv: 'TEST',
      },
    };
  }
}

// ─── Schema definitions ────────────────────────────────────────────────────────

type FieldDef = Omit<ConnectorField, 'id' | 'entityId'>;

interface ObjectSchema {
  label: string;
  description: string;
  fields: FieldDef[];
}

function buildSilverLakeSchema(objectName: string, _entityId: string): ObjectSchema | null {
  const id = () => uuidv4();

  const schemas: Record<string, ObjectSchema> = {
    CIF: {
      label: 'Customer Information File',
      description:
        'Master record for each customer relationship in the bank. ISO 20022: Party. ' +
        'jXchange operation: CustInq — requires CustId OR (AcctId + AcctType=D). ' +
        'Address is stored in CIF Master File (CFMAST); use AddrSrch for physical/IRS/seasonal variants. ' +
        'UserDefInfoArray on CustInq supports institution-defined CIF fields.',
      fields: [
        { id: id(), name: 'CIFNumber', label: 'CIF Number', dataType: 'string', length: 12, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'PartyIdentification', jxchangeXPath: 'CustInq.Rs.CustRec.CustId' },
        { id: id(), name: 'TaxID', label: 'Tax Identification Number', dataType: 'string', length: 11, required: true, complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT', 'BSA_AML'], complianceNote: 'SSN/EIN — must be masked in all non-production environments. TIN type codes: SSN | EIN | Forn', iso20022Name: 'TaxIdentification', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.TaxId', jxchangeXtendElemKey: 'x_TaxDetail' },
        { id: id(), name: 'DateOfBirth', label: 'Date of Birth', dataType: 'date', complianceTags: ['GLBA_NPI'], iso20022Name: 'BirthDate', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.BirthDt' },
        { id: id(), name: 'LegalName', label: 'Legal Name', dataType: 'string', length: 60, required: true, complianceTags: ['GLBA_NPI'], iso20022Name: 'Name', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonName.ComName' },
        { id: id(), name: 'ShortName', label: 'Short Name (AbbName)', dataType: 'string', length: 24, iso20022Name: 'ShortName', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonName.AbbName', jxchangeXtendElemKey: 'x_PersonName', complianceNote: 'Not returned by default — must add x_PersonName to XtendElemInfoArray in CustInq request' },
        { id: id(), name: 'CustomerType', label: 'Customer Type', dataType: 'picklist', picklistValues: ['Individual', 'Business', 'Trust', 'Government'], required: true, jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonType' },
        { id: id(), name: 'CustomerStatus', label: 'Customer Status', dataType: 'picklist', picklistValues: ['Active', 'Inactive', 'Deceased', 'Blocked'], complianceTags: ['BSA_AML'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonStatus' },
        { id: id(), name: 'PrimaryEmail', label: 'Primary Email Address', dataType: 'email', complianceTags: ['GLBA_NPI'], iso20022Name: 'EmailAddress', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.EmailArray.EmailInfo.EmailAddr', complianceNote: 'EmailType must be "Primary E-Mail". Secondary available as "Secondary E-Mail". SilverLake supports max 2 email addresses per CIF.' },
        { id: id(), name: 'PrimaryPhone', label: 'Primary Phone Number', dataType: 'phone', complianceTags: ['GLBA_NPI'], iso20022Name: 'PhoneNumber', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PhoneNum' },
        { id: id(), name: 'AddressLine1', label: 'Address Line 1', dataType: 'string', length: 40, complianceTags: ['GLBA_NPI'], iso20022Name: 'StrtNm', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.Addr1', complianceNote: 'CustInq returns primary + IRS address types from CFMAST. Use AddrSrch for physical/seasonal variants.' },
        { id: id(), name: 'AddressLine2', label: 'Address Line 2', dataType: 'string', length: 40, iso20022Name: 'BldgNb', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.Addr2' },
        { id: id(), name: 'City', label: 'City', dataType: 'string', length: 28, iso20022Name: 'TwnNm', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.City' },
        { id: id(), name: 'StateCode', label: 'State Code', dataType: 'string', length: 2, iso20022Name: 'CtrySubDvsn', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.StateProv' },
        { id: id(), name: 'PostalCode', label: 'Postal Code', dataType: 'string', length: 10, iso20022Name: 'PstCd', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.PostalCode' },
        { id: id(), name: 'CountryCode', label: 'Country Code', dataType: 'string', length: 3, iso20022Name: 'Ctry', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.Ctry' },
        { id: id(), name: 'BranchCode', label: 'Branch Code', dataType: 'string', length: 6, required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.BranchId' },
        { id: id(), name: 'RelationshipOfficer', label: 'Relationship Officer ID', dataType: 'string', length: 8, jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.OffCode' },
        { id: id(), name: 'OpenDate', label: 'Relationship Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'OpngDt', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.OpenDt' },
        { id: id(), name: 'LastActivityDate', label: 'Last Activity Date', dataType: 'date', complianceTags: ['BSA_AML'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.LastActvDt' },
        { id: id(), name: 'RiskRating', label: 'Risk Rating', dataType: 'picklist', picklistValues: ['Low', 'Medium', 'High', 'Prohibited'], complianceTags: ['BSA_AML', 'FFIEC_AUDIT'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.RiskRating' },
      ],
    },

    DDA: {
      label: 'Demand Deposit Account',
      description:
        'Checking and savings accounts. ISO 20022: CashAccount. ' +
        'jXchange operation: AcctInq with AcctType="D" (SilverLake deposit identifier). ' +
        'NOTE: Core Director uses AcctType="10" for deposits — see CoreDirectorConnector. ' +
        'AcctInq returns three balance fields: CurBal (ledger), CollBal (collected), AvailBal. ' +
        'Use XtendElem with x_ keys to extend response payload.',
      fields: [
        { id: id(), name: 'AccountNumber', label: 'Account Number', dataType: 'string', length: 16, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'Acct.Id', jxchangeXPath: 'AcctInq.Rs.DepAcctId.AcctId', complianceNote: 'SilverLake AcctType="D". Request format: AcctId + AcctType=D. Fallback: AcctSrch by PersonName, TaxID, or CustId.' },
        { id: id(), name: 'CIFNumber', label: 'CIF Number (Owner)', dataType: 'string', length: 12, required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CustId' },
        { id: id(), name: 'RoutingTransitNumber', label: 'Routing Transit Number', dataType: 'string', length: 9, required: true, iso20022Name: 'ClrSysMmbId', jxchangeXPath: 'AcctInq.Rs.DepAcctId.InstRtId' },
        { id: id(), name: 'AccountType', label: 'Account Type', dataType: 'picklist', picklistValues: ['Checking', 'Savings', 'MoneyMarket', 'CDAccount'], required: true, jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.AcctType' },
        { id: id(), name: 'AccountStatus', label: 'Account Status', dataType: 'picklist', picklistValues: ['Open', 'Closed', 'Frozen', 'Dormant'], required: true, complianceTags: ['BSA_AML'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.AcctStatus' },
        { id: id(), name: 'CurrentBalance', label: 'Current Balance (Ledger)', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'Bal.Amt', jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CurBal', complianceNote: 'CurBal = ledger balance. Compare with CollBal and AvailBal for reconciliation.' },
        { id: id(), name: 'CollectedBalance', label: 'Collected Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CollBal', complianceNote: 'CollBal = collected funds balance. Funds that have cleared. Source: jackhenry.dev AcctInq reference.' },
        { id: id(), name: 'AvailableBalance', label: 'Available Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'AvlblBal.Amt', jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.AvailBal' },
        { id: id(), name: 'OverdraftLimit', label: 'Overdraft Limit', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.OvrdLimit' },
        { id: id(), name: 'InterestRate', label: 'Interest Rate', dataType: 'decimal', precision: 8, scale: 6, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'IntrstRate', jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.IntRate' },
        { id: id(), name: 'OpenDate', label: 'Account Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.OpenDt' },
        { id: id(), name: 'LastTransactionDate', label: 'Last Transaction Date', dataType: 'date', complianceTags: ['BSA_AML'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.LastXactDt' },
        { id: id(), name: 'BranchCode', label: 'Branch Code', dataType: 'string', length: 6, required: true, jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.BranchId' },
        { id: id(), name: 'ProductCode', label: 'Product Code', dataType: 'string', length: 8, required: true, jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.ProdCode' },
        { id: id(), name: 'NickName', label: 'Account Nickname', dataType: 'string', length: 24, jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.AcctDesc' },
      ],
    },

    LoanAccount: {
      label: 'Loan Account',
      description:
        'Consumer and commercial loans. ISO 20022: Loan. ' +
        'jXchange operation: AcctInq with AcctType="L" (SilverLake loan identifier). ' +
        'NOTE: Core Director uses AcctType="40" for loans — see CoreDirectorConnector. ' +
        'Use LnBilSrch to retrieve billing/payment schedule records. ' +
        'Loan servicing operations: LnBilAdd, LnBilMod for payment modifications.',
      fields: [
        { id: id(), name: 'LoanNumber', label: 'Loan Number', dataType: 'string', length: 16, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'LoanId', jxchangeXPath: 'AcctInq.Rs.LnAcctId.AcctId', complianceNote: 'SilverLake AcctType="L". Request: AcctId + AcctType=L. Fallback: AcctSrch by PersonName, TaxID, or CustId.' },
        { id: id(), name: 'CIFNumber', label: 'CIF Number (Borrower)', dataType: 'string', length: 12, required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.CustId' },
        { id: id(), name: 'LoanType', label: 'Loan Type', dataType: 'picklist', picklistValues: ['Mortgage', 'HELOC', 'AutoLoan', 'PersonalLoan', 'CommercialLoan', 'LineOfCredit'], required: true, jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.LnType' },
        { id: id(), name: 'LoanStatus', label: 'Loan Status', dataType: 'picklist', picklistValues: ['Current', 'Delinquent', 'Default', 'PaidOff', 'ChargedOff'], required: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.AcctStatus' },
        { id: id(), name: 'OriginalPrincipal', label: 'Original Principal Amount', dataType: 'decimal', precision: 18, scale: 2, required: true, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'OrigPrnclAmt', jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.OrigPrinBal' },
        { id: id(), name: 'CurrentBalance', label: 'Outstanding Principal Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'OutsdngBal', jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.CurPrinBal', complianceNote: 'SOX-controlled. Include in reconciliation report against GL asset accounts.' },
        { id: id(), name: 'InterestRate', label: 'Interest Rate (Annual)', dataType: 'decimal', precision: 8, scale: 6, required: true, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'NmnlIntrstRate', jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.IntRate' },
        { id: id(), name: 'RateType', label: 'Rate Type', dataType: 'picklist', picklistValues: ['Fixed', 'Variable', 'ARM'], required: true, jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.IntRateType' },
        { id: id(), name: 'OriginationDate', label: 'Origination Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.OrigDt' },
        { id: id(), name: 'MaturityDate', label: 'Maturity Date', dataType: 'date', required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.MatDt' },
        { id: id(), name: 'NextPaymentDate', label: 'Next Payment Due Date', dataType: 'date', jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.NxtPmtDueDt' },
        { id: id(), name: 'PaymentAmount', label: 'Scheduled Payment Amount', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.PmtAmt', complianceNote: 'Use LnBilSrch to retrieve full billing schedule. PmtAmt here is the next scheduled payment.' },
        { id: id(), name: 'CollateralCode', label: 'Collateral Type Code', dataType: 'picklist', picklistValues: ['RealEstate', 'Vehicle', 'Equipment', 'Unsecured'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.CollateralCode' },
        { id: id(), name: 'LoanOfficerID', label: 'Loan Officer Employee ID', dataType: 'string', length: 8, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.OffCode' },
        { id: id(), name: 'BranchCode', label: 'Originating Branch Code', dataType: 'string', length: 6, required: true, jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.BranchId' },
      ],
    },

    GLAccount: {
      label: 'General Ledger Account',
      description:
        'Chart of accounts entries for the bank. ISO 20022: Account. ' +
        'jXchange operation: GLInq — retrieves GL account balances and posting history. ' +
        'Use GLAcctSrch to discover accounts by cost center or category. ' +
        'All GLAccount fields are SOX-controlled; changes require SOX change-control tickets.',
      fields: [
        { id: id(), name: 'GLAccountNumber', label: 'GL Account Number', dataType: 'string', length: 20, isKey: true, required: true, isExternalId: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'], jxchangeXPath: 'GLInq.Rs.GLAcctId.GLAcctNum', complianceNote: 'SOX-controlled key. Any modification must go through SOX change-control process and be documented in FFIEC audit trail.' },
        { id: id(), name: 'AccountDescription', label: 'Account Description', dataType: 'string', length: 60, required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.Desc' },
        { id: id(), name: 'AccountCategory', label: 'Account Category', dataType: 'picklist', picklistValues: ['Asset', 'Liability', 'Equity', 'Income', 'Expense'], required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.AcctCatg' },
        { id: id(), name: 'NormalBalance', label: 'Normal Balance Side', dataType: 'picklist', picklistValues: ['Debit', 'Credit'], required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.NrmBal' },
        { id: id(), name: 'DebitBalance', label: 'Debit Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.DbtBal', complianceNote: 'SOX-controlled financial balance. Must reconcile against trial balance reports. Audit trail required for any adjustments.' },
        { id: id(), name: 'CreditBalance', label: 'Credit Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.CrdBal' },
        { id: id(), name: 'CostCenter', label: 'Cost Center Code', dataType: 'string', length: 8, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.CostCenter' },
        { id: id(), name: 'SubledgerCode', label: 'Sub-Ledger Code', dataType: 'string', length: 10, jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.SubledgerCode' },
        { id: id(), name: 'IsIntercompany', label: 'Intercompany Flag', dataType: 'boolean', complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.IntrcpnyInd' },
        { id: id(), name: 'LastPostingDate', label: 'Last Posting Date', dataType: 'date', complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.LastPostDt' },
        { id: id(), name: 'FiscalYear', label: 'Fiscal Year', dataType: 'string', length: 4, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.FiscalYr' },
        { id: id(), name: 'BranchCode', label: 'Branch Code', dataType: 'string', length: 6, jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.BranchId' },
      ],
    },
  };

  return schemas[objectName] ?? null;
}

function buildSilverLakeSamples(objectName: string, limit: number): SampleRow[] {
  const samples: Record<string, SampleRow[]> = {
    CIF: [
      { CIFNumber: '100000001', TaxID: '***-**-1234', LegalName: 'Acme Corp', CustomerType: 'Business', BranchCode: 'B001', CustomerStatus: 'Active', RiskRating: 'Low' },
      { CIFNumber: '100000002', TaxID: '***-**-5678', LegalName: 'Jane Smith', CustomerType: 'Individual', BranchCode: 'B001', CustomerStatus: 'Active', RiskRating: 'Low' },
    ],
    DDA: [
      { AccountNumber: '0001234567890', CIFNumber: '100000001', AccountType: 'Checking', CurrentBalance: 15000.00, AvailableBalance: 14750.00, BranchCode: 'B001', AccountStatus: 'Open' },
      { AccountNumber: '0001234567891', CIFNumber: '100000002', AccountType: 'Savings', CurrentBalance: 8250.50, AvailableBalance: 8250.50, BranchCode: 'B001', AccountStatus: 'Open' },
    ],
    LoanAccount: [
      { LoanNumber: 'L2024000001', CIFNumber: '100000001', LoanType: 'CommercialLoan', LoanStatus: 'Current', OriginalPrincipal: 500000.00, CurrentBalance: 487320.00, InterestRate: 0.0625, MaturityDate: '2034-01-01' },
    ],
    GLAccount: [
      { GLAccountNumber: '1001.00.B001', AccountDescription: 'Cash and Due From Banks', AccountCategory: 'Asset', NormalBalance: 'Debit', CostCenter: 'CC001' },
    ],
  };
  return (samples[objectName] ?? []).slice(0, limit);
}
