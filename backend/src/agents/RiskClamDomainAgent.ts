/**
 * RiskClamDomainAgent — BOSL RiskClam XML → Salesforce FSC mapping intelligence.
 *
 * RiskClam is a Caribbean core banking platform used by institutions like
 * Bank of Saint Lucia (BOSL). Its XML export uses a structured field naming
 * convention that encodes semantic category in the field prefix:
 *
 *   AMT_*     = monetary / amount fields   → map to currency/decimal SF fields
 *   DATE_*    = date fields                → map to Date/DateTime SF fields
 *   CODE_*    = picklist / classification  → map to picklist SF fields
 *   NAME_*    = name / label fields        → map to text SF fields
 *   NBR_*     = numeric count/identifier   → map to number SF fields
 *   Y_*       = boolean yes/no flags       → map to Checkbox SF fields
 *   PHONE_*   = phone numbers              → map to Phone SF fields
 *   ADDRESS_* = address components         → map to address/text SF fields
 *   PERC_*    = percentage values          → map to Percent SF fields
 *   DESC_*    = free-text descriptions     → map to TextArea SF fields
 *
 * This agent fires when sourceSystemType === 'riskclam' and applies three
 * layers of confidence adjustment:
 *   1. Field synonym boost (+0.20) for known RiskClam → FSC field pairs
 *   2. Prefix-type validation boost (+0.10) / penalty (−0.20) based on whether
 *      the source prefix is semantically compatible with the target data type
 *   3. Strong boost (+0.30) for exact RISKCLAM_TO_SF_FIELD_PREFS matches
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { ConnectorField } from '../../../packages/connectors/IConnector.js';
import type { Field, FieldMapping } from '../types.js';

// ─── Field synonym table (RiskClam source name → preferred SF target names) ──
// Derived from BOSL Mapping Salesforce to XML.xlsx
const RISKCLAM_SF_SYNONYMS: Record<string, string[]> = {
  // Account / Party / CIF
  CIF_NUMBER: ['CIF_Number__c', 'AccountNumber'],
  AMT_ANNUAL_INCOME: ['Annual_Income__c', 'AnnualRevenue', 'FinServ__AnnualIncome__c'],
  AMT_NET_WORTH: ['FinServ__NetWorth__c'],
  AMT_TOTAL_ASSETS: ['Asset_Total_Amount__c', 'FinServ__TotalAssets__c'],
  DATE_BIRTH: ['PersonBirthdate', 'Birthdate__pc', 'FinServ__DateOfBirth__pc'],
  DATE_OF_BIRTH: ['PersonBirthdate'],
  AGE: ['Age__pc', 'FinServ__Age__pc'],
  PHONE_HOME: ['PersonHomePhone', 'Phone'],
  PHONE_CELL: ['PersonMobilePhone', 'MobilePhone'],
  PHONE_WORK: ['WorkPhone__pc', 'FinServ__WorkPhone__pc'],
  PHONE_FAX: ['Fax', 'PersonFax'],
  EMAIL: ['PersonEmail', 'Email'],
  ADDRESS1: ['FinServ__MailingAddress__pc', 'PersonMailingStreet'],
  ADDRESS1_MAILING: ['FinServ__BillingAddress__pc', 'PersonMailingAddress'],
  NBR_DEPENDENTS: ['FinServ__NumberOfDependents__pc'],
  NATIONALITY: ['Nationality__c'],
  PASSPORT: ['Passport_Number__pc'],
  DESC_MARITAL_STATUS: ['FinServ__MaritalStatus__pc', 'Marital_Status__c'],
  DATE_LAST_UPDATE: ['FinServ__LastReview__c'],
  DATE_NEXT_REVIEW: ['FinServ__NextReview__c'],
  CODE_ENTITY_TYPE: ['Entity_Type__c', 'BOSL_EType__c'],
  CODE_GENDER: ['FinServ__Gender__pc'],
  TAX_ID: ['Tax_ID_Number__c'],
  NAME_EMPLOYER: ['Employer_Name__c', 'Current_Employer__pc'],

  // Financial Account
  ACCOUNT_NUMBER: ['FinServ__FinancialAccountNumber__c', 'Name'],
  CODE_STATUS: ['Account_Status__c', 'Status'],
  AMT_PAST_DUE: ['Amount_Past_Due__c'],
  AMT_LIMIT: ['Credit_Limit__c'],
  DATE_MATURITY: ['FinServ__LoanEndDate__c', 'Maturity_Date__c'],
  DATE_CLOSING: ['FinServ__CloseDate__c', 'Closing_Date__c'],
  AMT_SECURED: ['Secured_Amount__c'],
  AMT_LIFE_PREMIUM: ['FinServ__Premium__c', 'Credit_Life_Monthly_Premium__c'],
  DATE_APPROVAL: ['Date_Credit_Approved__c'],
  CODE_GL: ['GL_Code__c'],
  AMT_ESCROW: ['Escrow_Amount__c'],
  AMT_CURRENT_BALANCE: ['Current_Balance__c', 'FinServ__CurrentBalance__c'],
  AMT_AVAILABLE_BALANCE: ['Available_Balance__c', 'FinServ__AvailableBalance__c'],
  DATE_OPEN_ACCOUNT: ['FinServ__OpenDate__c'],

  // Loan
  AMT_TOTAL_DISBURSEMENTS: ['Disbursement_Amount__c'],
  NBR_CREDIT_SCORE: ['Credit_Score__c', 'FinServ__CreditScore__c'],
  CODE_CURRENCY: ['Currency__c'],
  DATE_FUNDED: ['Date_Funded__c'],
  NBR_DEPOSIT_ACCOUNT: ['Deposit_Account_Number__c'],
  CODE_PRODUCT_CLASSIFICATION: ['Classification__c', 'Loan_Type__c'],
  CODE_DISBURSEMENT_TYPE: ['Disbursement_Type__c'],
  AMT_TO_BE_DISBURSED: ['Amount_To_Be_Posted__c'],
  LOAN_NUMBER: ['Name'],
  AMT_PRINCIPAL: ['Original_Amount__c', 'Principal_Amount__c'],
  AMT_PAYMENT: ['Monthly_Payment__c'],
  PERC_INTEREST_RATE: ['Interest_Rate__c'],

  // Loan Package
  AMT_APPROVED_PAYMENT: ['Approved_New_Debt_1__c'],
  AMT_TOTAL_INDIRECT_LIABILITIES: ['Package_Total_Indirect_Liabilities__c'],
  NAME_ALL_BORROWERS: ['Primary_Borrower__c'],
  NAME_CREDIT_OFFICER: ['Approval_Officer__c', 'Credit_Officer__c'],
  PERC_DEBT_INCOME: ['Debt_To_Income_Ratio__c', 'DIR__c'],

  // Party Liabilities (use AMT_BALANCE as alias since AMT_CURRENT_BALANCE already defined above)
  AMT_ORIGINAL_BALANCE: ['Original_Loan_Balance__c'],
  AMT_BALANCE: ['Amount_Owed__c', 'Balance__c', 'Current_Balance__c'],
  AMT_OWED: ['Amount_Owed__c', 'Balance__c'],
  NAME_ON_ACCOUNT: ['Account_Name__c'],

  // Party Involved in Transaction
  AMT_TOTAL_ANNUAL_INCOME: ['Total_Annual_Income__c'],
  AMT_TOTAL_PAYMENTS: ['Current_Total_Monthly_Debt__c'],
  AMT_RESIDUAL_INCOME: ['Residual_Income__c'],
  AMT_TOTAL_INSTALLMENT: ['Total_Installment_Debt__c'],
  NBR_TOTAL_MORTGAGE: ['Number_of_Mortgages__c'],
  NBR_TOTAL_OTHER: ['Number_of_Other_Debts__c'],
};

// ─── Prefix → expected SF data type compatibility ─────────────────────────────
const RISKCLAM_PREFIX_TYPE_MAP: Record<string, string[]> = {
  AMT_: ['currency', 'double', 'percent', 'integer', 'number'],
  DATE_: ['date', 'datetime'],
  CODE_: ['picklist', 'multipicklist', 'string', 'text', 'varchar'],
  NAME_: ['string', 'text', 'varchar'],
  NBR_: ['integer', 'double', 'number', 'string', 'id', 'text'],
  Y_: ['boolean', 'checkbox'],
  PHONE_: ['phone', 'string', 'text'],
  ADDRESS_: ['string', 'text', 'address', 'textarea'],
  PERC_: ['percent', 'double', 'currency', 'number'],
  DESC_: ['textarea', 'string', 'text', 'longtextarea'],
};

/**
 * Decode the RiskClam field prefix for display in rationale.
 */
function decodePrefix(fieldName: string): { prefix: string; category: string } | null {
  const upper = fieldName.toUpperCase();
  for (const prefix of Object.keys(RISKCLAM_PREFIX_TYPE_MAP)) {
    if (upper.startsWith(prefix)) {
      const categoryMap: Record<string, string> = {
        'AMT_': 'monetary amount',
        'DATE_': 'date',
        'CODE_': 'code/picklist',
        'NAME_': 'name/label',
        'NBR_': 'number/count',
        'Y_': 'boolean flag',
        'PHONE_': 'phone number',
        'ADDRESS_': 'address',
        'PERC_': 'percentage',
        'DESC_': 'free-text description',
      };
      return { prefix, category: categoryMap[prefix] ?? prefix };
    }
  }
  return null;
}

/**
 * Check whether the RiskClam prefix type is compatible with the target SF field type.
 */
function isPrefixTypeCompatible(srcFieldName: string, tgtDataType: string): boolean | null {
  const upper = srcFieldName.toUpperCase();
  for (const [prefix, compatTypes] of Object.entries(RISKCLAM_PREFIX_TYPE_MAP)) {
    if (upper.startsWith(prefix)) {
      return compatTypes.includes(tgtDataType.toLowerCase());
    }
  }
  return null; // no prefix match — no opinion
}

function clamp(v: number): number {
  return Math.min(1.0, Math.max(0.0, v));
}

function getFieldName(id: string, fields: (Field | ConnectorField)[]): string | undefined {
  return fields.find((f) => f.id === id)?.name;
}

function getFieldDataType(id: string, fields: (Field | ConnectorField)[]): string | undefined {
  return (fields.find((f) => f.id === id) as Field | undefined)?.dataType;
}

export class RiskClamDomainAgent extends AgentBase {
  readonly name = 'RiskClamDomainAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, sourceSystemType } = context;

    if (sourceSystemType !== 'riskclam') {
      this.info(context, 'skip', `Source system is '${sourceSystemType}' — RiskClamDomainAgent not applicable`);
      return this.noOp(fieldMappings);
    }

    this.info(
      context,
      'start',
      'Applying RiskClam XML → Salesforce FSC domain heuristics (BOSL RISKCLAM_TO_SF_FIELD_PREFS)…',
    );

    const updatedMappings: FieldMapping[] = [];
    let improved = 0;
    const steps: AgentStep[] = [];

    for (const mapping of fieldMappings) {
      if (!mapping.sourceFieldId || !mapping.targetFieldId) {
        updatedMappings.push(mapping);
        continue;
      }

      const srcName = getFieldName(mapping.sourceFieldId, fields);
      const tgtName = getFieldName(mapping.targetFieldId, fields);
      const tgtType = getFieldDataType(mapping.targetFieldId, fields);

      if (!srcName || !tgtName) {
        updatedMappings.push(mapping);
        continue;
      }

      let delta = 0;
      const reasons: string[] = [];

      // ── Layer 1: Exact synonym match ──────────────────────────────────────
      const srcUpper = srcName.toUpperCase().replace(/ /g, '_');
      const synonyms = RISKCLAM_SF_SYNONYMS[srcUpper] ?? [];
      const isSynonymMatch = synonyms.some(
        (s) => s.toLowerCase().replace(/_/g, '') === tgtName.toLowerCase().replace(/_/g, ''),
      );

      if (isSynonymMatch) {
        delta += 0.22;
        reasons.push(`RiskClam→FSC synonym match: ${srcName} → ${tgtName} (BOSL mapping table)`);
      }

      // ── Layer 2: Prefix-type compatibility ────────────────────────────────
      const prefixInfo = decodePrefix(srcName);
      if (prefixInfo && tgtType) {
        const compatible = isPrefixTypeCompatible(srcName, tgtType);
        if (compatible === true) {
          delta += 0.10;
          reasons.push(
            `RiskClam prefix '${prefixInfo.prefix}' (${prefixInfo.category}) is type-compatible with SF field type '${tgtType}'`,
          );
        } else if (compatible === false) {
          delta -= 0.20;
          reasons.push(
            `TYPE MISMATCH: RiskClam prefix '${prefixInfo.prefix}' (${prefixInfo.category}) is not compatible with SF field type '${tgtType}' — transform likely required`,
          );
        }
      }

      // ── Layer 3: FSC namespace bonus ──────────────────────────────────────
      // If the source has AMT_ / DATE_ / CODE_ prefix and the target uses the FinServ__
      // namespace, it's almost certainly an intentional FSC integration mapping.
      if (
        prefixInfo &&
        (tgtName.toLowerCase().includes('finserv') || tgtName.toLowerCase().includes('__pc'))
      ) {
        delta += 0.06;
        reasons.push(`Target '${tgtName}' is in the Salesforce FSC namespace — consistent with RiskClam→FSC integration`);
      }

      // ── Apply and emit ─────────────────────────────────────────────────────
      if (delta !== 0 && reasons.length > 0) {
        const newConfidence = clamp(mapping.confidence + delta);

        if (newConfidence !== mapping.confidence) {
          const step: Omit<AgentStep, 'agentName'> = {
            action: newConfidence > mapping.confidence ? 'rescore_up' : 'rescore_down',
            detail: reasons.join(' | '),
            fieldMappingId: mapping.id,
            before: { confidence: mapping.confidence },
            after: { confidence: newConfidence },
            durationMs: 0,
            metadata: { srcName, tgtName, tgtType, prefixCategory: prefixInfo?.category },
          };
          this.emit(context, step);
          steps.push({ agentName: this.name, ...step });
          updatedMappings.push({ ...mapping, confidence: newConfidence });
          if (newConfidence > mapping.confidence) improved++;
          continue;
        }
      }

      updatedMappings.push(mapping);
    }

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'riskclam_domain_complete',
      detail: `Applied RiskClam XML → FSC heuristics — ${improved} mappings improved (synonym matches, prefix-type validation, FSC namespace bonus)`,
      durationMs: Date.now() - start,
      metadata: { improved },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return { agentName: this.name, updatedFieldMappings: updatedMappings, steps, totalImproved: improved };
  }
}
