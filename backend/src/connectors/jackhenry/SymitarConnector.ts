/**
 * Jack Henry Symitar / Episys Connector
 *
 * Connects to Jack Henry Symitar core banking (used by credit unions).
 * Protocol: SymXchange REST API (21 service groups).
 * Auth: OAuth 2.0 (client_credentials grant).
 *
 * CRITICAL credit-union terminology differences vs. commercial banking:
 *   Member     ≠ Customer      (credit union members own the institution)
 *   Share      ≠ Deposit       (savings/checking are "shares" in a CU)
 *   ShareType  ≠ AccountType
 *   DividendRate ≠ InterestRate (CUs pay dividends, not interest on savings)
 *   MemberNumber ≠ CustomerNumber
 *   ShareID    ≠ AccountNumber
 *
 * SymXchange service groups (21 total):
 *   Account, AccountHistory, Card, Collateral, ExternalLoan, GL, Hold,
 *   IRS, Lookup, Member, MemberPersonalInfo, Name, Note, Participation,
 *   Pledge, Portfolio, PowerOfAttorney, Rate, Roster, Share, Tracking
 *
 * Compliance: Same regulatory framework as banks (GLBA, FFIEC, SOX, PCI-DSS, BSA/AML)
 * plus NCUA (National Credit Union Administration) examination requirements.
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

interface SymitarCredentials {
  instanceUrl?: string;
  clientId?: string;
  clientSecret?: string;
  sytemNumber?: string; // Symitar institution number (1–9999)
}

/** SymXchange service group → primary entities mapping */
const SYMXCHANGE_SERVICE_GROUPS: Record<string, string[]> = {
  Account: ['Share', 'Loan'],
  AccountHistory: ['ShareHistory', 'LoanHistory'],
  Card: ['Card'],
  Collateral: ['Collateral'],
  GL: ['GLTransaction'],
  IRS: ['IRS'],
  Member: ['Member'],
  MemberPersonalInfo: ['Member'],
  Name: ['MemberName'],
  Note: ['Note'],
  Participation: ['Participation'],
  Portfolio: ['Portfolio'],
  Rate: ['DividendRate'],
  Share: ['Share'],
  Tracking: ['Tracking'],
};

export class SymitarConnector implements IConnector {
  private mode: 'live' | 'mock' = 'mock';
  private credentials: SymitarCredentials = {};
  private accessToken: string | null = null;

  async connect(credentials?: ConnectorCredentials): Promise<void> {
    const creds: SymitarCredentials = {
      instanceUrl: credentials?.instanceUrl || process.env.JH_SYM_INSTANCE_URL,
      clientId: credentials?.clientId || process.env.JH_SYM_CLIENT_ID,
      clientSecret: credentials?.clientSecret || process.env.JH_SYM_CLIENT_SECRET,
      sytemNumber: credentials?.institutionNumber || process.env.JH_SYM_INSTITUTION_NUMBER,
    };

    if (!creds.instanceUrl || !creds.clientId || !creds.clientSecret) {
      this.mode = 'mock';
      return;
    }

    try {
      const tokenUrl = `${creds.instanceUrl}/oauth/token`;
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: 'symxchange:read',
      });
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!response.ok) throw new Error(`OAuth failed: ${response.status}`);
      const data = (await response.json()) as { access_token: string };
      this.accessToken = data.access_token;
      this.credentials = creds;
      this.mode = 'live';
    } catch {
      this.mode = 'mock';
    }
  }

  async listObjects(): Promise<string[]> {
    // Primary objects relevant for Salesforce/SAP integration
    return ['Member', 'Share', 'Loan', 'IRS', 'Card', 'Collateral'];
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
      const schema = buildSymitarSchema(objectName, entityId);
      if (!schema) continue;

      entities.push({
        id: entityId,
        systemId: '',
        name: objectName,
        label: schema.label,
        description: schema.description,
      });
      fields.push(...schema.fields.map((f) => ({ ...f, entityId })));
    }

    // Build Member → Share and Member → Loan relationships
    const memberEntity = entities.find((e) => e.name === 'Member');
    const shareEntity = entities.find((e) => e.name === 'Share');
    const loanEntity = entities.find((e) => e.name === 'Loan');
    if (memberEntity && shareEntity) {
      relationships.push({ fromEntityId: shareEntity.id, toEntityId: memberEntity.id, type: 'lookup', viaField: 'MemberNumber' });
    }
    if (memberEntity && loanEntity) {
      relationships.push({ fromEntityId: loanEntity.id, toEntityId: memberEntity.id, type: 'lookup', viaField: 'MemberNumber' });
    }

    return { entities, fields, relationships, mode: this.mode };
  }

  async getSampleData(objectName: string, limit = 5): Promise<SampleRow[]> {
    return buildSymitarSamples(objectName, limit);
  }

  async testConnection(): Promise<{ connected: boolean; latencyMs: number; message?: string }> {
    if (this.mode === 'mock') {
      return { connected: true, latencyMs: 0, message: 'Mock mode — no credentials provided' };
    }

    const start = Date.now();
    try {
      const url = `${this.credentials.instanceUrl}/symxchange/v1/health`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      return { connected: resp.ok, latencyMs: Date.now() - start };
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, message: String(err) };
    }
  }

  async getSystemInfo(): Promise<ConnectorSystemInfo> {
    return {
      displayName: 'Jack Henry Symitar (Episys)',
      systemType: 'jackhenry',
      mode: this.mode,
      protocol: 'REST/SymXchange',
      version: '2024.1',
      metadata: {
        targetMarket: 'Credit Unions',
        serviceGroups: Object.keys(SYMXCHANGE_SERVICE_GROUPS),
        totalServiceGroups: 21,
        authMethod: 'OAuth 2.0 client_credentials',
        implementationSurveyRequired: true,
        note: 'SymXchange Implementation Survey must be submitted to Jack Henry before production access is granted',
        apiSpec: 'https://developer.jackhenry.com/apis/symxchange',
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

function buildSymitarSchema(objectName: string, _entityId: string): ObjectSchema | null {
  const id = () => uuidv4();

  const schemas: Record<string, ObjectSchema> = {
    Member: {
      label: 'Member',
      description: 'A credit union member (owner). NOTE: This is "Member", NOT "Customer" — credit union members own the institution. SymXchange service group: Member + MemberPersonalInfo.',
      fields: [
        { id: id(), name: 'MemberNumber', label: 'Member Number', dataType: 'string', length: 10, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'], complianceNote: 'Primary member identifier — NOT called CustomerNumber in credit unions' },
        { id: id(), name: 'SSN', label: 'Social Security Number', dataType: 'string', length: 11, required: true, complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT', 'BSA_AML'], complianceNote: 'Must be masked (***-**-XXXX) in non-production. Never send to LLM.' },
        { id: id(), name: 'BirthDate', label: 'Date of Birth', dataType: 'date', complianceTags: ['GLBA_NPI'] },
        { id: id(), name: 'FirstName', label: 'First Name', dataType: 'string', length: 20, required: true, complianceTags: ['GLBA_NPI'] },
        { id: id(), name: 'LastName', label: 'Last Name', dataType: 'string', length: 40, required: true, complianceTags: ['GLBA_NPI'] },
        { id: id(), name: 'MemberType', label: 'Member Type', dataType: 'picklist', picklistValues: ['Primary', 'Joint', 'Beneficiary', 'Minor', 'Business'], required: true },
        { id: id(), name: 'MemberStatus', label: 'Member Status', dataType: 'picklist', picklistValues: ['Active', 'Inactive', 'Suspended', 'Deceased'], required: true, complianceTags: ['BSA_AML'] },
        { id: id(), name: 'EmailAddress', label: 'Email Address', dataType: 'email', complianceTags: ['GLBA_NPI'] },
        { id: id(), name: 'HomePhone', label: 'Home Phone', dataType: 'phone', complianceTags: ['GLBA_NPI'] },
        { id: id(), name: 'MobilePhone', label: 'Mobile Phone', dataType: 'phone', complianceTags: ['GLBA_NPI'] },
        { id: id(), name: 'AddressLine1', label: 'Address Line 1', dataType: 'string', length: 40, complianceTags: ['GLBA_NPI'] },
        { id: id(), name: 'City', label: 'City', dataType: 'string', length: 28 },
        { id: id(), name: 'StateCode', label: 'State Code', dataType: 'string', length: 2 },
        { id: id(), name: 'PostalCode', label: 'Postal Code', dataType: 'string', length: 10 },
        { id: id(), name: 'BranchID', label: 'Branch ID', dataType: 'string', length: 6, required: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'OpenDate', label: 'Membership Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'RiskScore', label: 'Risk Score', dataType: 'integer', complianceTags: ['BSA_AML', 'FFIEC_AUDIT'] },
      ],
    },

    Share: {
      label: 'Share Account',
      description: 'A savings or checking account in a credit union. NOTE: This is "Share", NOT "Deposit". Credit union members hold "shares". DividendRate is used instead of InterestRate. SymXchange service group: Share.',
      fields: [
        { id: id(), name: 'ShareID', label: 'Share ID', dataType: 'string', length: 4, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'], complianceNote: 'Combined with MemberNumber for unique account key. NOT called AccountNumber.' },
        { id: id(), name: 'MemberNumber', label: 'Member Number (Owner)', dataType: 'string', length: 10, required: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'ShareType', label: 'Share Type Code', dataType: 'picklist', picklistValues: ['RegularSavings', 'Checking', 'MoneyMarket', 'CDShare', 'HSA', 'IRA'], required: true, complianceNote: 'ShareType ≠ AccountType (banking terminology)' },
        { id: id(), name: 'ShareDescription', label: 'Share Description', dataType: 'string', length: 24 },
        { id: id(), name: 'Balance', label: 'Current Balance', dataType: 'decimal', precision: 18, scale: 2, required: true, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'AvailableBalance', label: 'Available Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'DividendRate', label: 'Dividend Rate (Annual)', dataType: 'decimal', precision: 8, scale: 6, complianceTags: ['SOX_FINANCIAL'], complianceNote: 'DividendRate ≠ InterestRate. Credit unions pay dividends, not interest, on savings.' },
        { id: id(), name: 'DividendYTD', label: 'Dividends Paid Year-to-Date', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'OpenDate', label: 'Share Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'MaturityDate', label: 'Share Maturity Date (CD)', dataType: 'date', complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'ShareStatus', label: 'Share Status', dataType: 'picklist', picklistValues: ['Active', 'Inactive', 'Closed', 'Frozen'], required: true, complianceTags: ['BSA_AML'] },
        { id: id(), name: 'LastTransactionDate', label: 'Last Transaction Date', dataType: 'date', complianceTags: ['BSA_AML'] },
        { id: id(), name: 'MinimumBalance', label: 'Minimum Balance Requirement', dataType: 'decimal', precision: 18, scale: 2 },
      ],
    },

    Loan: {
      label: 'Loan Account',
      description: 'Consumer and business loans held by credit union members. SymXchange service group: Account (loan).',
      fields: [
        { id: id(), name: 'LoanID', label: 'Loan ID', dataType: 'string', length: 4, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'MemberNumber', label: 'Member Number (Borrower)', dataType: 'string', length: 10, required: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'LoanType', label: 'Loan Type Code', dataType: 'picklist', picklistValues: ['AutoLoan', 'PersonalLoan', 'Mortgage', 'HELOC', 'CreditCard', 'StudentLoan', 'ShareSecured'], required: true },
        { id: id(), name: 'LoanStatus', label: 'Loan Status', dataType: 'picklist', picklistValues: ['Current', 'Delinquent30', 'Delinquent60', 'Delinquent90', 'Default', 'PaidOff', 'ChargedOff'], required: true, complianceTags: ['SOX_FINANCIAL', 'FFIEC_AUDIT'] },
        { id: id(), name: 'OriginalBalance', label: 'Original Loan Balance', dataType: 'decimal', precision: 18, scale: 2, required: true, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'CurrentBalance', label: 'Outstanding Balance', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'InterestRate', label: 'Interest Rate (Annual)', dataType: 'decimal', precision: 8, scale: 6, required: true, complianceTags: ['SOX_FINANCIAL'], complianceNote: 'Loans use InterestRate (not DividendRate). Shares use DividendRate.' },
        { id: id(), name: 'APR', label: 'Annual Percentage Rate', dataType: 'decimal', precision: 8, scale: 6, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'PaymentAmount', label: 'Scheduled Payment Amount', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'PaymentFrequency', label: 'Payment Frequency', dataType: 'picklist', picklistValues: ['Monthly', 'BiWeekly', 'Weekly', 'SemiMonthly'] },
        { id: id(), name: 'OpenDate', label: 'Loan Open Date', dataType: 'date', required: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'MaturityDate', label: 'Loan Maturity Date', dataType: 'date', required: true, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'NextPaymentDate', label: 'Next Payment Due Date', dataType: 'date' },
        { id: id(), name: 'CollateralCode', label: 'Collateral Type', dataType: 'picklist', picklistValues: ['Vehicle', 'RealEstate', 'ShareSecured', 'Unsecured'] },
      ],
    },

    IRS: {
      label: 'IRS Tax Reporting Record',
      description: 'IRS tax reporting data per member per tax year. Covers 1099-INT, 1099-DIV, 1098-MORT. SymXchange service group: IRS.',
      fields: [
        { id: id(), name: 'TaxReportingID', label: 'Tax Reporting Record ID', dataType: 'string', length: 20, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT', 'SOX_FINANCIAL'] },
        { id: id(), name: 'MemberNumber', label: 'Member Number', dataType: 'string', length: 10, required: true, complianceTags: ['FFIEC_AUDIT', 'GLBA_NPI'] },
        { id: id(), name: 'TaxYear', label: 'Tax Year', dataType: 'string', length: 4, required: true, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'Form1099Type', label: '1099 Form Type', dataType: 'picklist', picklistValues: ['1099-INT', '1099-DIV', '1099-R', '1099-MISC', '1098'], required: true, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'ReportableAmount', label: 'Reportable Amount', dataType: 'decimal', precision: 18, scale: 2, required: true, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'FederalWithheld', label: 'Federal Tax Withheld', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'StateWithheld', label: 'State Tax Withheld', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'TINStatus', label: 'TIN Certification Status', dataType: 'picklist', picklistValues: ['Certified', 'NotCertified', 'B-Notice'], complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT'] },
        { id: id(), name: 'FiledDate', label: 'IRS Filing Date', dataType: 'date', complianceTags: ['FFIEC_AUDIT'] },
      ],
    },

    Card: {
      label: 'Debit / Credit Card',
      description: 'Payment card issued to a member. PCI-DSS governed. SymXchange service group: Card.',
      fields: [
        { id: id(), name: 'CardID', label: 'Card Record ID', dataType: 'string', length: 20, isKey: true, required: true, isExternalId: true, complianceTags: ['PCI_CARD', 'FFIEC_AUDIT'] },
        { id: id(), name: 'MemberNumber', label: 'Member Number', dataType: 'string', length: 10, required: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'CardType', label: 'Card Type', dataType: 'picklist', picklistValues: ['Visa_Debit', 'Mastercard_Debit', 'Visa_Credit', 'Mastercard_Credit'], required: true },
        { id: id(), name: 'CardStatus', label: 'Card Status', dataType: 'picklist', picklistValues: ['Active', 'Inactive', 'Lost', 'Stolen', 'Expired', 'Blocked'], required: true, complianceTags: ['PCI_CARD'] },
        { id: id(), name: 'ExpirationDate', label: 'Card Expiration Date', dataType: 'string', length: 5, required: true, complianceTags: ['PCI_CARD'], complianceNote: 'MM/YY format. Never store CVV/CVV2.' },
        { id: id(), name: 'EmbossedName', label: 'Name Embossed on Card', dataType: 'string', length: 26, complianceTags: ['GLBA_NPI', 'PCI_CARD'] },
        { id: id(), name: 'CreditLimit', label: 'Credit Card Limit', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'] },
      ],
    },

    Collateral: {
      label: 'Loan Collateral',
      description: 'Assets pledged as security for a loan. SymXchange service group: Collateral.',
      fields: [
        { id: id(), name: 'CollateralID', label: 'Collateral Record ID', dataType: 'string', length: 20, isKey: true, required: true, isExternalId: true, complianceTags: ['FFIEC_AUDIT'] },
        { id: id(), name: 'MemberNumber', label: 'Member Number', dataType: 'string', length: 10, required: true },
        { id: id(), name: 'CollateralType', label: 'Collateral Type', dataType: 'picklist', picklistValues: ['Vehicle', 'RealEstate', 'Boat', 'RV', 'Equipment', 'Securities'], required: true },
        { id: id(), name: 'CollateralValue', label: 'Appraised Value', dataType: 'decimal', precision: 18, scale: 2, complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'LienPosition', label: 'Lien Position', dataType: 'picklist', picklistValues: ['First', 'Second', 'Third'], complianceTags: ['SOX_FINANCIAL'] },
        { id: id(), name: 'Description', label: 'Collateral Description', dataType: 'text' },
        { id: id(), name: 'AppraisalDate', label: 'Appraisal Date', dataType: 'date', complianceTags: ['FFIEC_AUDIT'] },
      ],
    },
  };

  return schemas[objectName] ?? null;
}

function buildSymitarSamples(objectName: string, limit: number): SampleRow[] {
  const samples: Record<string, SampleRow[]> = {
    Member: [
      { MemberNumber: '0000012345', SSN: '***-**-1234', FirstName: 'Maria', LastName: 'Garcia', MemberType: 'Primary', BranchID: 'BR01', MemberStatus: 'Active' },
      { MemberNumber: '0000067890', SSN: '***-**-5678', FirstName: 'James', LastName: 'Wilson', MemberType: 'Primary', BranchID: 'BR02', MemberStatus: 'Active' },
    ],
    Share: [
      { ShareID: '0001', MemberNumber: '0000012345', ShareType: 'RegularSavings', Balance: 5250.00, DividendRate: 0.0050, ShareStatus: 'Active' },
      { ShareID: '0010', MemberNumber: '0000012345', ShareType: 'Checking', Balance: 2100.50, DividendRate: 0.0000, ShareStatus: 'Active' },
    ],
    Loan: [
      { LoanID: '0001', MemberNumber: '0000012345', LoanType: 'AutoLoan', LoanStatus: 'Current', OriginalBalance: 28000.00, CurrentBalance: 22450.00, InterestRate: 0.0499 },
    ],
    IRS: [
      { TaxReportingID: 'IRS-2024-0000012345-INT', MemberNumber: '0000012345', TaxYear: '2024', Form1099Type: '1099-INT', ReportableAmount: 127.50 },
    ],
    Card: [
      { CardID: 'CRD-0000012345-001', MemberNumber: '0000012345', CardType: 'Visa_Debit', CardStatus: 'Active', ExpirationDate: '12/27' },
    ],
    Collateral: [],
  };
  return (samples[objectName] ?? []).slice(0, limit);
}
