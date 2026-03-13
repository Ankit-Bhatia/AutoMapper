/**
 * schemaIntelligenceData.ts
 *
 * Compiled knowledge base for the SchemaIntelligenceAgent.
 * Derived from the automapper-schema-intelligence skill reference files:
 *
 *   • mapping-patterns.md  — 212 confirmed BOSL → Salesforce FSC field mappings
 *   • fsc-data-model.md    — FSC object hierarchy and field semantics
 *   • domain-glossary.md   — Caribbean / LATAM banking terminology
 *
 * Update this file whenever the skill reference files are updated.
 * Source of truth: .skills/skills/automapper-schema-intelligence/
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfirmedPattern {
  /** Canonical XML field name (original casing from the reference doc) */
  xmlField: string;
  /** One or more SF API name candidates. The first is the preferred target. */
  sfApiNames: string[];
  /** Target Salesforce object name */
  sfObject: string;
  /** Confidence tier derived from the pattern type */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Human-readable explanation for the agent rationale */
  notes: string;
  /**
   * True if this XML field maps to multiple Salesforce fields — human routing
   * is required. The agent flags these rather than auto-selecting a target.
   */
  isOneToMany: boolean;
  /**
   * True if the target SF field is a formula / calculated field.
   * Formula fields cannot receive inbound data and must be handled by mapping
   * the source fields that feed the formula instead.
   */
  isFormulaTarget: boolean;
  /**
   * True if the target SF field is a Person Account field (__pc suffix).
   * These fields only exist when the Account is a Person Account; business
   * accounts do not have them.
   */
  isPersonAccountOnly: boolean;
}

// ─── Confirmed Mapping Patterns ───────────────────────────────────────────────
// Indexed by normalized(xmlField).  normalize(s) = s.toLowerCase().replace(/[^a-z0-9]/g, '')

export const CONFIRMED_PATTERNS: Record<string, ConfirmedPattern[]> = {

  // ── AMT_* — monetary amounts ─────────────────────────────────────────────
  amtnetworth: [{
    xmlField: 'AMT_NET_WORTH', sfApiNames: ['FinServ__NetWorth__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'FSC standard net worth field — direct match',
  }],
  amttotalassets: [{
    xmlField: 'AMT_TOTAL_ASSETS', sfApiNames: ['Total_Assets__c', 'FinServ__TotalAssets__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Direct name match',
  }],
  amttotalliabilities: [
    {
      xmlField: 'AMT_TOTAL_LIABILITIES', sfApiNames: ['Total_Liabilities__c'],
      sfObject: 'Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Customer-level total liabilities. Also maps to PIT for per-borrower total.',
    },
    {
      xmlField: 'AMT_TOTAL_LIABILITIES', sfApiNames: ['Total_Liabilities__c'],
      sfObject: 'PIT', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Per-borrower total liabilities on Party Involved in Transaction.',
    },
  ],
  amtrealestate: [{
    xmlField: 'AMT_REAL_ESTATE', sfApiNames: ['Real_State__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ SF field has typo: Real_State__c (not Real_Estate__c). Confirm API name in your org.',
  }],
  amtstocks: [{
    xmlField: 'AMT_STOCKS', sfApiNames: ['Stock_Bonds__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Stocks field in XML maps to combined stocks+bonds field in SF.',
  }],
  amtunpaidtaxes: [{
    xmlField: 'AMT_UNPAID_TAXES', sfApiNames: ['Unpaid_Taxes__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Direct match',
  }],
  amtcreditlife: [{
    xmlField: 'AMT_CREDIT_LIFE', sfApiNames: ['Credit_Life_Amount__c'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Insurance amount on live account. Mandatory in Caribbean jurisdictions.',
  }],
  amtescrow: [
    {
      xmlField: 'AMT_ESCROW', sfApiNames: ['Escrow_Amount__c'],
      sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Post-boarding escrow balance on Financial Account.',
    },
    {
      xmlField: 'AMT_ESCROW', sfApiNames: ['Escrow_Balance__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Pre-boarding escrow on Loan object. Route by lifecycle stage.',
    },
  ],
  amtpastdue: [{
    xmlField: 'AMT_PAST_DUE', sfApiNames: ['Amount_Past_Due__c'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Direct match',
  }],
  amtcurrentbalance: [{
    xmlField: 'AMT_CURRENT_BALANCE', sfApiNames: ['FinServ__Balance__c', 'Current_Balance__c', 'FinServ__CurrentBalance__c'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'FSC standard balance field is preferred.',
  }],
  amtoriginalbalance: [{
    xmlField: 'AMT_ORIGINAL_BALANCE', sfApiNames: ['FinServ__LoanAmount__c', 'Original_Amount__c', 'Original_Loan_Amount__c'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ 3 near-identical fields. Prefer FSC standard FinServ__LoanAmount__c; deprecate custom variants.',
  }],
  amtpayment: [
    {
      xmlField: 'AMT_PAYMENT', sfApiNames: ['FinServ__PaymentAmount__c'],
      sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Post-boarding payment amount. Also: Monthly_Payment__c on Loan (pre-boarding).',
    },
    {
      xmlField: 'AMT_PAYMENT', sfApiNames: ['Monthly_Payment__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Pre-boarding scheduled payment on Loan. Route by lifecycle stage.',
    },
  ],
  amtsecured: [{
    xmlField: 'AMT_SECURED', sfApiNames: ['Secured_Amount__c'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Secured portion of the loan.',
  }],
  amtlimit: [
    {
      xmlField: 'AMT_LIMIT', sfApiNames: ['Credit_Limit__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Credit limit on Loan during origination.',
    },
    {
      xmlField: 'AMT_LIMIT', sfApiNames: ['Credit_Card_3_Limit__c'],
      sfObject: 'Financial Account', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Credit card limit variant on Financial Account. Route by product type.',
    },
  ],
  amttotalfee: [
    {
      xmlField: 'AMT_TOTAL_FEE', sfApiNames: ['Total_Fee_Amount__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Total fee aggregated at Loan level.',
    },
    {
      xmlField: 'AMT_TOTAL_FEE', sfApiNames: ['totalFeeToPaid__c'],
      sfObject: 'FEE', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Granular total on Fee object.',
    },
  ],
  amttotalinterest: [{
    xmlField: 'AMT_TOTAL_INTEREST', sfApiNames: ['Total_Interest__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Direct match',
  }],
  amttotalpremium: [
    {
      xmlField: 'AMT_TOTAL_PREMIUM', sfApiNames: ['Total_Credit_Life_Premium__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Credit life insurance premium total at Loan level.',
    },
    {
      xmlField: 'AMT_TOTAL_PREMIUM', sfApiNames: ['Monthly_Premium__c'],
      sfObject: 'FEE', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Monthly premium on Fee object.',
    },
  ],
  amtfinanced: [{
    xmlField: 'AMT_FINANCED', sfApiNames: ['Amount_Financed__c'],
    sfObject: 'Collateral', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Amount financed against collateral.',
  }],
  amtguarantees: [{
    xmlField: 'AMT_GUARANTEES', sfApiNames: ['Guarantee_Amount__c'],
    sfObject: 'Collateral', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Guarantee amount on collateral.',
  }],

  // AMT — semantic / domain-knowledge required
  amttotalbosl: [{
    xmlField: 'AMT_TOTAL_BOSL', sfApiNames: ['Total_Debt_With_Us__c'],
    sfObject: 'Loan Package', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'BOSL = Bank of Saint Lucia = "with us". Bank-specific terminology.',
  }],
  amttotalcurrentbalance: [{
    xmlField: 'AMT_TOTAL_CURRENT_BALANCE', sfApiNames: ['Total_Package_Debt__c'],
    sfObject: 'Loan Package', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '"Current balance" = total package debt in BOSL context.',
  }],
  amttotaldebtpayoff: [{
    xmlField: 'AMT_TOTAL_DEBT_PAYOFF', sfApiNames: ['Loan_Payoff_Amount__c', 'Total_Pay_Off_Amount__c', 'Total_Payoff_Amount__c'],
    sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ 3 near-identical custom fields across teams. Pick one canonical field; deprecate others.',
  }],
  amttotaldisbursements: [{
    xmlField: 'AMT_TOTAL_DISBURSEMENTS', sfApiNames: ['Disbursement_Amount__c'],
    sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Plural-to-singular rename.',
  }],
  amttotalexistingdebt: [{
    xmlField: 'AMT_TOTAL_EXISTING_DEBT', sfApiNames: ['Current_Balance_of_Existing_Debt__c'],
    sfObject: 'Loan Package', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '"Existing debt" = "current balance of existing debt".',
  }],
  amttotalhpmopayments: [{
    xmlField: 'AMT_TOTAL_HP_MO_PAYMENTS', sfApiNames: ['Preclosing_Hire_Purchase_Monthly__c'],
    sfObject: 'PIT', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'HP = Hire Purchase — Caribbean term for installment lending (vehicles, equipment).',
  }],
  amtmoresidualincome: [{
    xmlField: 'AMT_MO_RESIDUAL_INCOME', sfApiNames: ['Residual_Income__c'],
    sfObject: 'PIT', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Monthly residual income per borrower on Party Involved in Transaction.',
  }],
  amtapprovedloan: [{
    xmlField: 'AMT_APPROVED_LOAN', sfApiNames: ['Loan_Amount_formula__c'],
    sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: true, isPersonAccountOnly: false,
    notes: '⚠️ FORMULA FIELD — cannot receive inbound data. Map the source components that feed this formula instead.',
  }],
  amttobedisbursed: [{
    xmlField: 'AMT_TO_BE_DISBURSED', sfApiNames: ['Amount_to_be_Posted__c'],
    sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '"Disbursed" = "posted" in Jack Henry / core banking parlance.',
  }],
  amttotalforcexvalue: [{
    xmlField: 'AMT_TOTAL_FORCE_XVALUE', sfApiNames: ['Forced_Sale_Value_Calculated__c'],
    sfObject: 'Collateral', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'FORCE_XVALUE = forced sale cross value (~60-80% of market value).',
  }],
  amtoverdraftaccts: [{
    xmlField: 'AMT_OVERDRAFT_ACCTS', sfApiNames: ['Existing_Overdrafts__c'],
    sfObject: 'Loan Package', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Overdraft accounts aggregated at loan package level.',
  }],
  customerausmessage: [{
    xmlField: 'CUSTOMER_AUS_MESSAGE', sfApiNames: ['Core_Error_Message__c'],
    sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'AUS = Automated Underwriting System error message from core banking.',
  }],

  // ── PERC_* — percentage / rate fields ─────────────────────────────────────
  percinterest: [
    {
      xmlField: 'PERC_INTEREST', sfApiNames: ['FinServ__InterestRate__c'],
      sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Post-boarding interest rate — FSC standard field.',
    },
    {
      xmlField: 'PERC_INTEREST', sfApiNames: ['AnnualInterestRate__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Pre-boarding interest rate on Loan. Route by lifecycle stage.',
    },
  ],
  percltv: [
    {
      xmlField: 'PERC_LTV', sfApiNames: ['Loan_to_Value_Ratio__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Loan-to-Value ratio for individual loan.',
    },
    {
      xmlField: 'PERC_LTV', sfApiNames: ['Combined_LTV__c'],
      sfObject: 'Loan Package', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Combined LTV across all loans in package.',
    },
  ],
  percdicurrent: [{
    xmlField: 'PERC_DI_CURRENT', sfApiNames: ['Current_Debt_to_Income__c'],
    sfObject: 'PIT', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'DI = Debt to Income ratio per borrower.',
  }],
  percincexpcurrent: [{
    xmlField: 'PERC_INC_EXP_CURRENT', sfApiNames: ['Current_Expense_to_Income_Formula__c'],
    sfObject: 'PIT', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: true, isPersonAccountOnly: false,
    notes: '⚠️ Field name contains "Formula" — verify if this is a data field or calculated. Confirm writability.',
  }],
  percresidualcurrent: [{
    xmlField: 'PERC_RESIDUAL_CURRENT', sfApiNames: ['Current_Budgetary_Residual_Income__c'],
    sfObject: 'PIT', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Residual income as percentage per borrower.',
  }],
  percdefaultinterest: [{
    xmlField: 'PERC_DEFAULT_INTEREST', sfApiNames: ['Default_Rate__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Default / penalty interest rate.',
  }],
  percloanvariablerate: [{
    xmlField: 'PERC_LOAN_VARIABLE_RATE', sfApiNames: ['Loan_Variable_Rate__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Variable rate component. Paired with CODE_LOAN_VARIABLE_RATE.',
  }],
  percfee: [{
    xmlField: 'PERC_FEE', sfApiNames: ['Fee_Percent__c'],
    sfObject: 'FEE', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Fee expressed as a percentage.',
  }],

  // ── CODE_* — code / picklist fields ───────────────────────────────────────
  codeentitytype: [{
    xmlField: 'CODE_ENTITY_TYPE', sfApiNames: ['Entity_Type__c', 'BOSL_EType__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ 4 legacy duplicate fields. Prefer Entity_Type__c as canonical; deprecate others. Picklist value translation required.',
  }],
  codecountry: [{
    xmlField: 'CODE_COUNTRY', sfApiNames: ['BillingCountryCode', 'PersonMailingCountryCode'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'ISO 3166-1 alpha-2 country codes. Billing vs mailing depends on address context.',
  }],
  codeeccb: [{
    xmlField: 'CODE_ECCB', sfApiNames: ['ECCB_1_Code__c', 'ECCB_2_Code__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'ECCB = Eastern Caribbean Central Bank banking sector code. Required for regulatory returns.',
  }],
  codenewbs: [{
    xmlField: 'CODE_NEW_BS', sfApiNames: ['BS_1_Code__pc'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: true,
    notes: '⚠️ Person Account field (__pc). Banking Sector classification for ECCB reporting.',
  }],
  codestatus: [{
    xmlField: 'CODE_STATUS', sfApiNames: ['Account_Status__c', 'Status'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Account status picklist. Requires value translation matrix.',
  }],
  codeclosingbranch: [{
    xmlField: 'CODE_CLOSING_BRANCH', sfApiNames: ['FinServ__BranchCode__c'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Branch code on live account — FSC standard.',
  }],
  codegl: [{
    xmlField: 'CODE_GL', sfApiNames: ['GL_Code__c'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'General Ledger code.',
  }],
  codeloantype: [{
    xmlField: 'CODE_LOAN_TYPE', sfApiNames: ['General_Ledger_Code__c', 'Type_Code__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'GL-based loan type code.',
  }],
  codecurrency: [{
    xmlField: 'CODE_CURRENCY', sfApiNames: ['Currency__c', 'Foreign_Currency_Code__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Currency of loan. XCD (EC Dollar) or USD common in Caribbean.',
  }],
  coderiskrating: [{
    xmlField: 'CODE_RISK_RATING', sfApiNames: ['Risk_Code__c', 'Risk_Code_Number__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'ECCB risk classification. Maps to both code and numeric fields.',
  }],
  codeprodclassification: [{
    xmlField: 'CODE_PROD_CLASSIFICATION', sfApiNames: ['Classification__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Product classification code.',
  }],
  codewatchlist: [{
    xmlField: 'CODE_WATCH_LIST', sfApiNames: ['Watchlist_Category__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Watchlist monitoring category.',
  }],
  codedisbursementtype: [{
    xmlField: 'CODE_DISBURSEMENT_TYPE', sfApiNames: ['Disbursement_Type__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Type of disbursement.',
  }],
  codetypeofsale: [{
    xmlField: 'CODE_TYPE_OF_SALE', sfApiNames: ['Type_of_Sale__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Sale type code.',
  }],
  codeloanvariablerate: [{
    xmlField: 'CODE_LOAN_VARIABLE_RATE', sfApiNames: ['Loan_Variable_Rate_Code__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Variable rate code. Paired with PERC_LOAN_VARIABLE_RATE.',
  }],
  codeattorneys: [{
    xmlField: 'CODE_ATTORNEYS', sfApiNames: ['Attorney_Code__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Attorney reference code.',
  }],

  // ── DATE_* — date / datetime fields ───────────────────────────────────────
  dateapplication: [
    {
      xmlField: 'DATE_APPLICATION', sfApiNames: ['Application_Date__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Application date on Loan (pre-boarding).',
    },
    {
      xmlField: 'DATE_APPLICATION', sfApiNames: ['FinServ__ApplicationDate__c'],
      sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Application date carried to Financial Account (post-boarding) — FSC standard.',
    },
  ],
  dateapproval: [{
    xmlField: 'DATE_APPROVAL', sfApiNames: ['Date_Credit_Approved__c'],
    sfObject: 'FA / Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Same field name exists on both Loan and Financial Account.',
  }],
  dateclosing: [
    {
      xmlField: 'DATE_CLOSING', sfApiNames: ['Closing_Date__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Closing date on Loan (pre-boarding).',
    },
    {
      xmlField: 'DATE_CLOSING', sfApiNames: ['FinServ__CloseDate__c'],
      sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Close date on Financial Account (post-boarding) — FSC standard.',
    },
  ],
  datefunded: [{
    xmlField: 'DATE_FUNDED', sfApiNames: ['Date_Funded__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Date funds were disbursed.',
  }],
  datematurity: [
    {
      xmlField: 'DATE_MATURITY', sfApiNames: ['MaturityDate__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Loan maturity date — pre-boarding custom field.',
    },
    {
      xmlField: 'DATE_MATURITY', sfApiNames: ['FinServ__LoanEndDate__c'],
      sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Loan end date — post-boarding FSC standard.',
    },
    {
      xmlField: 'DATE_MATURITY', sfApiNames: ['End_Date__c'],
      sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Alternative maturity date custom field.',
    },
  ],
  dateopen: [{
    xmlField: 'DATE_OPEN', sfApiNames: ['FinServ__OpenDate__c'],
    sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Account open date — FSC standard.',
  }],
  dateboardin: [{
    xmlField: 'DATE_BOARDING', sfApiNames: ['Inserted_In_Core__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Boarding = posting to core banking system (Jack Henry). Critical lifecycle marker.',
  }],
  dateintereststart: [{
    xmlField: 'DATE_INTEREST_START', sfApiNames: ['InterestStartDate__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Date interest begins accruing.',
  }],
  datepaymentstart: [{
    xmlField: 'DATE_PAYMENT_START', sfApiNames: ['PaymentStartDate__c'],
    sfObject: 'Loan', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Date first payment is due.',
  }],
  datescheduledclosing: [{
    xmlField: 'DATE_SCHEDULED_CLOSING', sfApiNames: ['Expected_Disbursement_Date__c'],
    sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '"Scheduled closing" = "expected disbursement" — confirm business meaning.',
  }],
  datelastupdate: [
    {
      xmlField: 'DATE_LAST_UPDATE', sfApiNames: ['FinServ__LastReview__c'],
      sfObject: 'Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Last review date on Account — FSC standard.',
    },
    {
      xmlField: 'DATE_LAST_UPDATE', sfApiNames: ['Last_Updated_Amount_Time__c'],
      sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Last update timestamp on Financial Account.',
    },
    {
      xmlField: 'DATE_LAST_UPDATE', sfApiNames: ['LastModifiedDate'],
      sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'System last-modified date on Loan — standard SF field (read-only).',
    },
  ],
  datenextreview: [{
    xmlField: 'DATE_NEXT_REVIEW', sfApiNames: ['FinServ__NextReview__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Next scheduled review date — FSC standard.',
  }],
  dateapplied: [{
    xmlField: 'DATE_APPLIED', sfApiNames: ['CreatedDate'],
    sfObject: 'Loan Package', confidence: 'MEDIUM', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'Application date = package creation date. Standard SF field (set on record creation).',
  }],

  // ── NAME_* — name / lookup fields ─────────────────────────────────────────
  nameallborrowers: [{
    xmlField: 'NAME_ALL_BORROWERS', sfApiNames: ['Account__c'],
    sfObject: 'PIT', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ Lookup to Account. XML has text name — name-to-ID resolution required.',
  }],
  nameoriginatingbranch: [
    {
      xmlField: 'NAME_ORIGINATING_BRANCH', sfApiNames: ['FinServ__BranchName__c'],
      sfObject: 'Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Branch name on Account.',
    },
    {
      xmlField: 'NAME_ORIGINATING_BRANCH', sfApiNames: ['Originating_Branch__c'],
      sfObject: 'Loan Package', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Branch name on Loan Package.',
    },
    {
      xmlField: 'NAME_ORIGINATING_BRANCH', sfApiNames: ['Originating_Unit__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Originating unit on Loan.',
    },
  ],
  nameclosingbranch: [
    {
      xmlField: 'NAME_CLOSING_BRANCH', sfApiNames: ['FinServ__BranchName__c'],
      sfObject: 'Financial Account', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Closing branch name on Financial Account.',
    },
    {
      xmlField: 'NAME_CLOSING_BRANCH', sfApiNames: ['Closing_Unit__c'],
      sfObject: 'Loan', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Closing unit on Loan.',
    },
    {
      xmlField: 'NAME_CLOSING_BRANCH', sfApiNames: ['Closing_Branch__c'],
      sfObject: 'Loan Package', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Closing branch on Loan Package.',
    },
  ],
  namecreditofficer: [{
    xmlField: 'NAME_CREDIT_OFFICER', sfApiNames: ['ApprovalOfficer__c', 'Approval_Officer__c', 'Credit_Officer__c'],
    sfObject: 'Loan Package', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ User lookup — name-to-ID resolution required.',
  }],
  nameoriginator: [
    {
      xmlField: 'NAME_ORIGINATOR', sfApiNames: ['Originator__c'],
      sfObject: 'Loan Package', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Custom originator field on Loan Package.',
    },
    {
      xmlField: 'NAME_ORIGINATOR', sfApiNames: ['CreatedById'],
      sfObject: 'Loan', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'System user who created the loan — standard SF field.',
    },
  ],
  nameunderwriter: [{
    xmlField: 'NAME_UNDERWRITER', sfApiNames: ['Underwriter__c'],
    sfObject: 'Loan Package', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ User lookup — name-to-ID resolution required.',
  }],
  nameattorneys: [{
    xmlField: 'NAME_ATTORNEYS', sfApiNames: ['Attorney_Contact__c'],
    sfObject: 'Collateral', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ Contact lookup — name-to-ID resolution required.',
  }],
  namesuffix: [{
    xmlField: 'NAME_SUFFIX', sfApiNames: ['Suffix__pc'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: true,
    notes: '⚠️ Person Account field only (__pc). Not available on business accounts.',
  }],

  // ── Y_* — boolean flag fields ─────────────────────────────────────────────
  yfatcaperson: [{
    xmlField: 'Y_FATCA_PERSON', sfApiNames: ['US_CRS__c'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: 'FATCA maps to CRS terminology in SF. ⚠️ XML Y/N string → SF true/false boolean transform required.',
  }],
  yexemptduediligence: [{
    xmlField: 'Y_EXEMPT_DUE_DILIGENCE', sfApiNames: ['Exempt_from_Due_Dilligence__pc'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: true,
    notes: '⚠️ Person Account field. Note: SF field name has intentional typo "Dilligence". ⚠️ Y/N → boolean transform required.',
  }],
  ystandingorder: [{
    xmlField: 'Y_STANDING_ORDER', sfApiNames: ['Standing_Order_to_Pay_US_Maintained_Acct__pc'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: true,
    notes: '⚠️ Person Account field. Autopay / standing order instruction. Y/N → boolean transform required.',
  }],
  yusstay: [{
    xmlField: 'Y_US_STAY_', sfApiNames: ['Stayed_in_US_for_183_days_this_year__pc'],
    sfObject: 'Account', confidence: 'HIGH', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: true,
    notes: '⚠️ Person Account field. 183-day substantial presence test for FATCA compliance. Y/N → boolean transform required.',
  }],
  yinsured: [
    {
      xmlField: 'Y_INSURED', sfApiNames: ['Insured__c'],
      sfObject: 'PIT', confidence: 'HIGH', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Primary insured flag. ⚠️ 1 boolean maps to 3 insurance type fields — routing logic required.',
    },
    {
      xmlField: 'Y_INSURED', sfApiNames: ['Disability_Insured__c'],
      sfObject: 'PIT', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Disability insurance flag. Route by insurance_type value.',
    },
    {
      xmlField: 'Y_INSURED', sfApiNames: ['Medical_Approval__c'],
      sfObject: 'PIT', confidence: 'MEDIUM', isOneToMany: true, isFormulaTarget: false, isPersonAccountOnly: false,
      notes: 'Medical approval flag. Route by insurance_type value.',
    },
  ],
  yfinanceinsurance: [{
    xmlField: 'Y_FINANCE_INSURANCE', sfApiNames: ['Insurance_Company_Name__c'],
    sfObject: 'Loan', confidence: 'LOW', isOneToMany: false, isFormulaTarget: false, isPersonAccountOnly: false,
    notes: '⚠️ Unusual pattern: boolean source → text target. Confirm intended mapping; may need special handling.',
  }],
};

// ─── One-to-Many Field Set ─────────────────────────────────────────────────────
// Normalized XML field names that are known to map to multiple SF targets.
// These are flagged for human routing — the agent cannot auto-select a target.
export const ONE_TO_MANY_FIELDS = new Set<string>([
  'address',
  'amtfee',
  'amtpayment',
  'amtescrow',
  'amttotalliabilities',
  'amtoriginalbalance',
  'amttotaldebtpayoff',
  'amttotalfee',
  'amttotalpremium',
  'amtlimit',
  'codeentitytype',
  'codecountry',
  'codeeccb',
  'coderiskrating',
  'percinterest',
  'percltv',
  'dateapplication',
  'dateclosing',
  'datematurity',
  'datelastupdate',
  'nameoriginatingbranch',
  'nameclosingbranch',
  'yinsured',
  'title',
]);

// ─── Formula / Calculated Field Targets ──────────────────────────────────────
// Normalized SF API names that are formula/calculated fields.
// Mapping to these as targets will not work — inbound data cannot be written.
export const FORMULA_FIELD_TARGETS = new Set<string>([
  'loanamountformulac',          // Loan_Amount_formula__c
  'currentexpensetoincomeformulac', // Current_Expense_to_Income_Formula__c
  'approvedloanformulac',
]);

// ─── System Audit Fields (never map as targets) ────────────────────────────────
export const SYSTEM_AUDIT_FIELDS = new Set<string>([
  'id',
  'createdbyid',
  'lastmodifiedbyid',
  'lastmodifieddate',
  'createddate',
  'systemmodstamp',
  'isdeleted',
  'ownerid',
]);

// ─── Person Account Only Fields ────────────────────────────────────────────────
// SF fields with __pc suffix — only exist on Person Account records.
// Flag if the implementation may serve business (non-person) accounts.
export const PERSON_ACCOUNT_FIELD_SUFFIX = '__pc';

// ─── FSC Standard Fields — known confirmed FSC API name prefixes ──────────────
export const FSC_NAMESPACE_PREFIX = 'FinServ__';

// ─── Caribbean Domain Glossary Tokens ────────────────────────────────────────
// XML field name fragments that indicate Caribbean / BOSL domain context.
// Used to add domain familiarity annotation to rationale.
export const CARIBBEAN_DOMAIN_TOKENS = new Map<string, string>([
  ['bosl',     'BOSL = Bank of Saint Lucia'],
  ['cif',      'CIF = Customer Information File (core banking unique customer ID)'],
  ['hp',       'HP = Hire Purchase (Caribbean installment lending)'],
  ['boarding', 'Boarding = posting to core banking system (Jack Henry/RiskClam)'],
  ['eccb',     'ECCB = Eastern Caribbean Central Bank regulatory code'],
  ['fatca',    'FATCA = Foreign Account Tax Compliance Act (US)'],
  ['crs',      'CRS = Common Reporting Standard (OECD)'],
  ['bsl',      'BSL = Bank of Saint Lucia'],
  ['par',      'PAR = Participating (indirect bank exposure)'],
  ['aus',      'AUS = Automated Underwriting System'],
  ['pronote',  'Pronote = Promissory Note'],
]);
