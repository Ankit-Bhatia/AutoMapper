/**
 * Jack Henry Core Director Connector
 *
 * Connects to Jack Henry Core Director — the core banking platform for community banks.
 * Protocol: jXchange SOAP/XML API, ISO 20022 field naming.
 * Auth: OAuth 2.0 (client_credentials grant).
 *
 * KEY DIFFERENCE FROM SILVERLAKE:
 *   Core Director uses numeric AcctType codes instead of letter codes:
 *     AcctType "10" = Deposit/DDA  (SilverLake uses "D")
 *     AcctType "40" = Loan         (SilverLake uses "L")
 *     AcctType "50" = Certificate  (SilverLake uses "T")
 *     AcctType "60" = Line         (SilverLake uses line-of-credit subtype)
 *   The DMZ test InstRtId for Core Director is 11111900
 *   (SilverLake DMZ uses 011001276).
 *
 * jXchange operations covered:
 *   CustInq    — customer demographics (same operation, slightly different XPaths)
 *   AcctInq    — account inquiries (same operation, AcctType codes differ)
 *   LnBilSrch  — loan billing records
 *   GLInq      — general ledger balances
 *
 * Data model: CIF (Party) / DDA / LoanAccount / GLAccount — same domain as
 * SilverLake but with numeric AcctType codes and minor XPath variations.
 *
 * Compliance tags used throughout:
 *   GLBA_NPI      — Non-Public Personal Information
 *   FFIEC_AUDIT   — must appear in FFIEC audit trail
 *   SOX_FINANCIAL — financial field requiring SOX change control
 *   BSA_AML       — Bank Secrecy Act / Anti-Money Laundering
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
import {
  buildSvcDictSrchEnvelope,
  mergeConnectorFields,
  objectToSvcName,
  parseSvcDictSrchFields,
  postServiceGatewaySoap,
  toServiceGatewayCredentials,
  type SvcDictFieldCandidate,
} from './jxchangeSoap.js';

interface CoreDirectorCredentials {
  authMode?: 'oauth-client-credentials' | 'service-gateway';
  instanceUrl?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  endpoint?: string;
  username?: string;
  password?: string;
  instRtId?: string;
  instEnv?: string;
  validConsmName?: string;
  validConsmProd?: string;
}

export class CoreDirectorConnector implements IConnector {
  private mode: 'live' | 'mock' = 'mock';
  private credentials: CoreDirectorCredentials = {};
  private accessToken: string | null = null;

  async connect(credentials?: ConnectorCredentials): Promise<void> {
    const creds: CoreDirectorCredentials = {
      authMode:
        credentials?.authMode === 'service-gateway' || credentials?.authMode === 'oauth-client-credentials'
          ? credentials.authMode
          : undefined,
      instanceUrl: credentials?.instanceUrl || process.env.JH_CD_INSTANCE_URL,
      clientId: credentials?.clientId || process.env.JH_CD_CLIENT_ID,
      clientSecret: credentials?.clientSecret || process.env.JH_CD_CLIENT_SECRET,
      tokenUrl: credentials?.tokenUrl || process.env.JH_CD_TOKEN_URL,
      endpoint: credentials?.endpoint || process.env.JH_CD_SG_ENDPOINT,
      username: credentials?.username || process.env.JH_CD_SG_USERNAME,
      password: credentials?.password || process.env.JH_CD_SG_PASSWORD,
      instRtId: credentials?.instRtId || process.env.JH_CD_INST_RT_ID,
      instEnv: credentials?.instEnv || process.env.JH_CD_INST_ENV,
      validConsmName: credentials?.validConsmName || process.env.JH_CD_VALID_CONSM_NAME,
      validConsmProd: credentials?.validConsmProd || process.env.JH_CD_VALID_CONSM_PROD,
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
        const response = await fetch(creds.endpoint!, {
          method: 'GET',
          headers: {
            Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`,
            Accept: '*/*',
          },
          signal: AbortSignal.timeout(5000),
        });
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
      // Core Director exposes same logical objects, different AcctType codes
      return ['CIF', 'DDA', 'LoanAccount', 'GLAccount', 'Certificate', 'LineOfCredit'];
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
    const liveSvcDictCache = new Map<string, SvcDictFieldCandidate[]>();
    const sgCreds = this.mode === 'live' ? toServiceGatewayCredentials(this.credentials) : null;

    for (const objectName of objects) {
      const entityId = uuidv4();
      let schema = buildCoreDirectorSchema(objectName, entityId);
      if (!schema) continue;

      if (sgCreds) {
        const svcName = objectToSvcName(objectName);
        if (svcName) {
          try {
            let liveFields = liveSvcDictCache.get(svcName);
            if (!liveFields) {
              const envelope = buildSvcDictSrchEnvelope(sgCreds, svcName);
              const xml = await postServiceGatewaySoap(sgCreds, envelope, 'SvcDictSrch');
              liveFields = parseSvcDictSrchFields(xml, svcName);
              liveSvcDictCache.set(svcName, liveFields);
            }
            if (liveFields.length > 0) {
              schema = {
                ...schema,
                fields: mergeConnectorFields(schema.fields, liveFields) as typeof schema.fields,
              };
            }
          } catch {
            // Keep deterministic built-in schema as fallback when live metadata discovery fails.
          }
        }
      }

      entities.push({
        id: entityId,
        systemId: '', // set by route handler after system creation
        name: objectName,
        label: schema.label,
        description: schema.description,
      });
      fields.push(...schema.fields.map((f) => ({ ...f, entityId })));
    }

    // Build CIF → DDA and CIF → Loan relationships
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
    return buildCoreDirectorSamples(objectName, limit);
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

      return { connected: false, latencyMs: Date.now() - start, message: 'No valid Core Director credentials configured' };
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, message: String(err) };
    }
  }

  async getSystemInfo(): Promise<ConnectorSystemInfo> {
    return {
      displayName: 'Jack Henry Core Director',
      systemType: 'jackhenry',
      mode: this.mode,
      protocol: 'SOAP/jXchange (ISO 20022)',
      version: '2024.3',
      metadata: {
        targetMarket: 'Community Banks',
        /**
         * Core Director is the community bank core (smaller institutions).
         * SilverLake is the commercial bank core (larger institutions).
         * Both use jXchange SOAP, but AcctType codes differ:
         *   Core Director: "10"=Deposit, "40"=Loan, "50"=Certificate, "60"=Line
         *   SilverLake:    "D"=Deposit, "L"=Loan, "T"=TimeDeposit, "B"=SafeDepositBox
         */
        productLine: 'Core Director',
        acctTypeCodes: { deposit: '10', loan: '40', certificate: '50', lineOfCredit: '60' },
        /**
         * Core Director DMZ test credentials:
         *   InstRtId: 11111900
         *   InstEnv:  TEST
         * Compare: SilverLake DMZ uses InstRtId 011001276
         */
        dmzInstRtId: '11111900',
        dmzInstEnv: 'TEST',
        authMethod: 'OAuth 2.0 client_credentials',
        supportedAuthModes: ['OAuth 2.0 client_credentials', 'jXchange Service Gateway (Basic Auth)'],
        oauthTokenExpirySecs: 600,
        oauthMandatoryDate: 'April 2028',
        /**
         * jXchange core inquiry operations for Core Director:
         *   CustInq    — customer demographics (same as SilverLake, minor XPath differences)
         *   AcctInq    — account data (AcctType codes differ — see acctTypeCodes above)
         *   LnBilSrch  — loan billing/payment schedule
         *   GLInq      — general ledger inquiries
         *   SvcDictSrch — discover mapped elements and allowed values
         */
        jxchangeOperations: ['CustInq', 'AcctInq', 'AcctSrch', 'CustSrch', 'AddrSrch', 'LnBilSrch', 'GLInq', 'SvcDictSrch'],
        apiSpec: 'https://jackhenry.dev/jxchange-soap/',
        iso20022MigrationComplete: 'July 14, 2025',
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

function buildCoreDirectorSchema(objectName: string, _entityId: string): ObjectSchema | null {
  const id = () => uuidv4();

  const schemas: Record<string, ObjectSchema> = {
    CIF: {
      label: 'Customer Information File',
      description:
        'Master record for each customer relationship. ISO 20022: Party. ' +
        'jXchange operation: CustInq — same as SilverLake but Core Director returns ' +
        'slightly different XPath variants for some fields. ' +
        'CustomerType picklist values differ from SilverLake ("Indv" vs "Individual").',
      fields: [
        { id: id(), name: 'CIFNumber', label: 'CIF Number', dataType: 'string', length: 12, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'PartyIdentification', jxchangeXPath: 'CustInq.Rs.CustRec.CustId' },
        { id: id(), name: 'TaxID', label: 'Tax Identification Number', dataType: 'string', length: 11, required: true, complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT', 'BSA_AML'], complianceNote: 'SSN/EIN. Core Director masks TIN in response unless explicitly requested. TIN type: SSN | EIN | Forn.', iso20022Name: 'TaxIdentification', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.TaxId' },
        { id: id(), name: 'DateOfBirth', label: 'Date of Birth', dataType: 'date', complianceTags: ['GLBA_NPI'], iso20022Name: 'BirthDate', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.BirthDt' },
        { id: id(), name: 'LegalName', label: 'Legal Name', dataType: 'string', length: 60, required: true, complianceTags: ['GLBA_NPI'], iso20022Name: 'Name', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonName.ComName' },
        { id: id(), name: 'ShortName', label: 'Short Name (AbbName)', dataType: 'string', length: 24, iso20022Name: 'ShortName', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonName.AbbName' },
        {
          id: id(), name: 'CustomerType', label: 'Customer Type', dataType: 'picklist',
          picklistValues: ['Indv', 'Bus', 'Trust', 'Govt'],
          required: true,
          jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonType',
          complianceNote: 'Core Director uses short codes: Indv=Individual, Bus=Business, Trust=Trust, Govt=Government. Different from SilverLake which uses full words.',
        },
        { id: id(), name: 'CustomerStatus', label: 'Customer Status', dataType: 'picklist', picklistValues: ['Active', 'Inactive', 'Deceased', 'Blocked'], complianceTags: ['BSA_AML'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PersonStatus' },
        { id: id(), name: 'PrimaryEmail', label: 'Primary Email Address', dataType: 'email', complianceTags: ['GLBA_NPI'], iso20022Name: 'EmailAddress', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.EmailArray.EmailInfo.EmailAddr' },
        { id: id(), name: 'PrimaryPhone', label: 'Primary Phone Number', dataType: 'phone', complianceTags: ['GLBA_NPI'], iso20022Name: 'PhoneNumber', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.PhoneNum' },
        { id: id(), name: 'AddressLine1', label: 'Address Line 1', dataType: 'string', length: 40, complianceTags: ['GLBA_NPI'], iso20022Name: 'StrtNm', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.Addr1' },
        { id: id(), name: 'AddressLine2', label: 'Address Line 2', dataType: 'string', length: 40, iso20022Name: 'BldgNb', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.Addr2' },
        { id: id(), name: 'City', label: 'City', dataType: 'string', length: 28, iso20022Name: 'TwnNm', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.City' },
        { id: id(), name: 'StateCode', label: 'State Code', dataType: 'string', length: 2, iso20022Name: 'CtrySubDvsn', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.StateProv' },
        { id: id(), name: 'PostalCode', label: 'Postal Code', dataType: 'string', length: 10, iso20022Name: 'PstCd', jxchangeXPath: 'CustInq.Rs.CustRec.PostAddr.PostalCode' },
        { id: id(), name: 'BranchCode', label: 'Branch Code', dataType: 'string', length: 6, required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.BranchId' },
        { id: id(), name: 'OpenDate', label: 'Relationship Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'OpngDt', jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.OpenDt' },
        { id: id(), name: 'RiskRating', label: 'Risk Rating', dataType: 'picklist', picklistValues: ['Low', 'Medium', 'High', 'Prohibited'], complianceTags: ['BSA_AML', 'FFIEC_AUDIT'], jxchangeXPath: 'CustInq.Rs.CustRec.PersonInfo.RiskRating' },
      ],
    },

    DDA: {
      label: 'Demand Deposit Account',
      description:
        'Checking and savings accounts. ISO 20022: CashAccount. ' +
        'jXchange operation: AcctInq with AcctType="10" (Core Director deposit identifier). ' +
        'IMPORTANT: Core Director uses numeric AcctType "10" for deposits, NOT the letter "D" used by SilverLake. ' +
        'This distinction is critical when writing jXchange integrations that span both platforms.',
      fields: [
        { id: id(), name: 'AccountNumber', label: 'Account Number', dataType: 'string', length: 16, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'Acct.Id', jxchangeXPath: 'AcctInq.Rs.DepAcctId.AcctId', complianceNote: 'Core Director AcctType="10" (vs SilverLake AcctType="D"). Always include AcctType in AcctInq request or response may be misrouted.' },
        { id: id(), name: 'CIFNumber', label: 'CIF Number (Owner)', dataType: 'string', length: 12, required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CustId' },
        { id: id(), name: 'RoutingTransitNumber', label: 'Routing Transit Number', dataType: 'string', length: 9, required: true, iso20022Name: 'ClrSysMmbId', jxchangeXPath: 'AcctInq.Rs.DepAcctId.InstRtId', complianceNote: 'DMZ testing: use InstRtId 11111900 (Core Director test routing number). Different from SilverLake DMZ 011001276.' },
        { id: id(), name: 'AccountType', label: 'Account Type', dataType: 'picklist', picklistValues: ['Checking', 'Savings', 'MoneyMarket', 'CDAccount'], required: true, jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.AcctType' },
        { id: id(), name: 'AccountStatus', label: 'Account Status', dataType: 'picklist', picklistValues: ['Open', 'Closed', 'Frozen', 'Dormant'], required: true, complianceTags: ['BSA_AML'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.AcctStatus' },
        { id: id(), name: 'CurrentBalance', label: 'Current Balance (Ledger)', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'Bal.Amt', jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CurBal' },
        { id: id(), name: 'CollectedBalance', label: 'Collected Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.CollBal' },
        { id: id(), name: 'AvailableBalance', label: 'Available Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'AvlblBal.Amt', jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.AvailBal' },
        { id: id(), name: 'InterestRate', label: 'Interest Rate', dataType: 'decimal', precision: 8, scale: 6, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'IntrstRate', jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.IntRate' },
        { id: id(), name: 'OpenDate', label: 'Account Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.OpenDt' },
        { id: id(), name: 'LastTransactionDate', label: 'Last Transaction Date', dataType: 'date', complianceTags: ['BSA_AML'], jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.LastXactDt' },
        { id: id(), name: 'BranchCode', label: 'Branch Code', dataType: 'string', length: 6, required: true, jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.BranchId' },
        { id: id(), name: 'ProductCode', label: 'Product Code', dataType: 'string', length: 8, required: true, jxchangeXPath: 'AcctInq.Rs.DepAcctRec.DepAcctInfo.ProdCode' },
      ],
    },

    LoanAccount: {
      label: 'Loan Account',
      description:
        'Consumer and commercial loans. ISO 20022: Loan. ' +
        'jXchange operation: AcctInq with AcctType="40" (Core Director loan identifier). ' +
        'IMPORTANT: Core Director uses numeric AcctType "40" for loans, NOT the letter "L" used by SilverLake. ' +
        'Use LnBilSrch to retrieve billing schedule records.',
      fields: [
        { id: id(), name: 'LoanNumber', label: 'Loan Number', dataType: 'string', length: 16, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'], iso20022Name: 'LoanId', jxchangeXPath: 'AcctInq.Rs.LnAcctId.AcctId', complianceNote: 'Core Director AcctType="40" (vs SilverLake AcctType="L"). Must specify AcctType in every AcctInq loan request.' },
        { id: id(), name: 'CIFNumber', label: 'CIF Number (Borrower)', dataType: 'string', length: 12, required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.CustId' },
        { id: id(), name: 'LoanType', label: 'Loan Type', dataType: 'picklist', picklistValues: ['Mortgage', 'HELOC', 'AutoLoan', 'PersonalLoan', 'CommercialLoan', 'LineOfCredit'], required: true, jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.LnType' },
        { id: id(), name: 'LoanStatus', label: 'Loan Status', dataType: 'picklist', picklistValues: ['Current', 'Delinquent', 'Default', 'PaidOff', 'ChargedOff'], required: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.AcctStatus' },
        { id: id(), name: 'OriginalPrincipal', label: 'Original Principal Amount', dataType: 'decimal', precision: 18, scale: 2, required: true, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'OrigPrnclAmt', jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.OrigPrinBal' },
        { id: id(), name: 'CurrentBalance', label: 'Outstanding Principal Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'OutsdngBal', jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.CurPrinBal' },
        { id: id(), name: 'InterestRate', label: 'Interest Rate (Annual)', dataType: 'decimal', precision: 8, scale: 6, required: true, complianceTags: ['SOX_FINANCIAL'], iso20022Name: 'NmnlIntrstRate', jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.IntRate' },
        { id: id(), name: 'RateType', label: 'Rate Type', dataType: 'picklist', picklistValues: ['Fixed', 'Variable', 'ARM'], required: true, jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.IntRateType' },
        { id: id(), name: 'OriginationDate', label: 'Origination Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.OrigDt' },
        { id: id(), name: 'MaturityDate', label: 'Maturity Date', dataType: 'date', required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.MatDt' },
        { id: id(), name: 'NextPaymentDate', label: 'Next Payment Due Date', dataType: 'date', jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.NxtPmtDueDt' },
        { id: id(), name: 'PaymentAmount', label: 'Scheduled Payment Amount', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.PmtAmt' },
        { id: id(), name: 'CollateralCode', label: 'Collateral Type Code', dataType: 'picklist', picklistValues: ['RealEstate', 'Vehicle', 'Equipment', 'Unsecured'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.CollateralCode' },
        { id: id(), name: 'LoanOfficerID', label: 'Loan Officer Employee ID', dataType: 'string', length: 8, complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.OffCode' },
        { id: id(), name: 'BranchCode', label: 'Originating Branch Code', dataType: 'string', length: 6, required: true, jxchangeXPath: 'AcctInq.Rs.LnAcctRec.LnAcctInfo.BranchId' },
      ],
    },

    GLAccount: {
      label: 'General Ledger Account',
      description:
        'Chart of accounts entries. ISO 20022: Account. ' +
        'jXchange operation: GLInq — same XPaths as SilverLake. ' +
        'All GL fields are SOX-controlled; modifications require change-control documentation.',
      fields: [
        { id: id(), name: 'GLAccountNumber', label: 'GL Account Number', dataType: 'string', length: 20, isKey: true, required: true, isExternalId: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'], jxchangeXPath: 'GLInq.Rs.GLAcctId.GLAcctNum' },
        { id: id(), name: 'AccountDescription', label: 'Account Description', dataType: 'string', length: 60, required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.Desc' },
        { id: id(), name: 'AccountCategory', label: 'Account Category', dataType: 'picklist', picklistValues: ['Asset', 'Liability', 'Equity', 'Income', 'Expense'], required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.AcctCatg' },
        { id: id(), name: 'NormalBalance', label: 'Normal Balance Side', dataType: 'picklist', picklistValues: ['Debit', 'Credit'], required: true, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.NrmBal' },
        { id: id(), name: 'DebitBalance', label: 'Debit Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.DbtBal' },
        { id: id(), name: 'CreditBalance', label: 'Credit Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.CrdBal' },
        { id: id(), name: 'CostCenter', label: 'Cost Center Code', dataType: 'string', length: 8, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.CostCenter' },
        { id: id(), name: 'LastPostingDate', label: 'Last Posting Date', dataType: 'date', complianceTags: ['FFIEC_AUDIT'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.LastPostDt' },
        { id: id(), name: 'FiscalYear', label: 'Fiscal Year', dataType: 'string', length: 4, complianceTags: ['SOX_FINANCIAL'], jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.FiscalYr' },
        { id: id(), name: 'BranchCode', label: 'Branch Code', dataType: 'string', length: 6, jxchangeXPath: 'GLInq.Rs.GLAcctRec.GLAcctInfo.BranchId' },
      ],
    },
  };

  return schemas[objectName] ?? null;
}

function buildCoreDirectorSamples(objectName: string, limit: number): SampleRow[] {
  const samples: Record<string, SampleRow[]> = {
    CIF: [
      { CIFNumber: '200000001', TaxID: '***-**-4321', LegalName: 'Sunrise Community Credit', CustomerType: 'Bus', BranchCode: 'CD001', CustomerStatus: 'Active', RiskRating: 'Low' },
      { CIFNumber: '200000002', TaxID: '***-**-8765', LegalName: 'Robert Johnson', CustomerType: 'Indv', BranchCode: 'CD001', CustomerStatus: 'Active', RiskRating: 'Low' },
    ],
    DDA: [
      { AccountNumber: '0002001001001', CIFNumber: '200000001', AccountType: 'Checking', CurrentBalance: 32500.00, AvailableBalance: 32000.00, BranchCode: 'CD001', AccountStatus: 'Open', RoutingTransitNumber: '11111900' },
      { AccountNumber: '0002001001002', CIFNumber: '200000002', AccountType: 'Savings', CurrentBalance: 5800.00, AvailableBalance: 5800.00, BranchCode: 'CD001', AccountStatus: 'Open', RoutingTransitNumber: '11111900' },
    ],
    LoanAccount: [
      { LoanNumber: 'CD2024000001', CIFNumber: '200000001', LoanType: 'CommercialLoan', LoanStatus: 'Current', OriginalPrincipal: 250000.00, CurrentBalance: 238500.00, InterestRate: 0.0575, MaturityDate: '2031-06-01' },
    ],
    GLAccount: [
      { GLAccountNumber: '1001.CD001', AccountDescription: 'Cash - Main Vault', AccountCategory: 'Asset', NormalBalance: 'Debit', CostCenter: 'CD001' },
    ],
  };
  return (samples[objectName] ?? []).slice(0, limit);
}
