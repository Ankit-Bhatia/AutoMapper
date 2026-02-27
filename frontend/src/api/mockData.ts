/**
 * Self-contained mock data for standalone / offline demo mode.
 * Used when VITE_STANDALONE=true or when the API server is unreachable.
 */
import type { Entity, Field, EntityMapping, FieldMapping, ValidationReport, ProjectPayload } from '../types';

// ── Shared IDs ──────────────────────────────────────────────────────────────
const P = 'demo-project-1';
const SYS_SRC = 'jackhenry-coredirector';
const SYS_TGT = 'salesforce';

// ── Source entities – Jack Henry Core Director ────────────────────────────────
export const srcEntities: Entity[] = [
  { id: 'se-cif',   systemId: SYS_SRC, name: 'CIF',         label: 'Customer Information File' },
  { id: 'se-dda',   systemId: SYS_SRC, name: 'DDA',         label: 'Demand Deposit Account' },
  { id: 'se-loan',  systemId: SYS_SRC, name: 'LoanAccount', label: 'Loan Account' },
  { id: 'se-gl',    systemId: SYS_SRC, name: 'GLAccount',   label: 'General Ledger Account' },
  { id: 'se-cd',    systemId: SYS_SRC, name: 'CDAccount',   label: 'Certificate of Deposit' },
  { id: 'se-party', systemId: SYS_SRC, name: 'Party',       label: 'Party / Relationship Record' },
];

// ── Target entities – Salesforce Financial Services Cloud ────────────────────
export const tgtEntities: Entity[] = [
  { id: 'te-acct',  systemId: SYS_TGT, name: 'Account',               label: 'Salesforce Account' },
  { id: 'te-cont',  systemId: SYS_TGT, name: 'Contact',               label: 'Salesforce Contact' },
  { id: 'te-opp',   systemId: SYS_TGT, name: 'Opportunity',           label: 'Salesforce Opportunity' },
  { id: 'te-fa',    systemId: SYS_TGT, name: 'FinancialAccount',      label: 'FSC Financial Account' },
  { id: 'te-ip',    systemId: SYS_TGT, name: 'IndividualApplication', label: 'FSC Individual Application' },
  { id: 'te-goal',  systemId: SYS_TGT, name: 'FinancialGoal',         label: 'FSC Financial Goal' },
  { id: 'te-apr',   systemId: SYS_TGT, name: 'AccountParticipant',    label: 'FSC Account Participant' },
  { id: 'te-pp',    systemId: SYS_TGT, name: 'PartyProfile',          label: 'FSC Party Profile' },
];

// ── Fields ────────────────────────────────────────────────────────────────────
export const mockFields: Field[] = [
  // ── CIF source fields ──────────────────────────────────────────────────────
  { id: 'sf-cif-id',     entityId: 'se-cif', name: 'CIFNum',       dataType: 'string',   required: true,  jxchangeXPath: '/CIF/CIFNum',        iso20022Name: 'pty.id',      complianceTags: ['GLBA_NPI','BSA_AML'], complianceNote: 'Primary customer identifier. Must be masked at rest.' },
  { id: 'sf-taxid',      entityId: 'se-cif', name: 'TaxId',        dataType: 'string',   required: true,  jxchangeXPath: '/CIF/TaxId',         iso20022Name: 'pty.taxId',   complianceTags: ['GLBA_NPI','BSA_AML'], complianceNote: 'SSN/EIN. AES-256 encryption required. Never log in plaintext.' },
  { id: 'sf-custtype',   entityId: 'se-cif', name: 'CustomerType', dataType: 'picklist', required: true,  picklistValues: ['Indv','Bus','Org','Gov'], jxchangeXPath: '/CIF/CustomerType', iso20022Name: 'pty.tp', complianceTags: ['GLBA_NPI'] },
  { id: 'sf-shortname',  entityId: 'se-cif', name: 'ShortName',    dataType: 'string',   required: true,  jxchangeXPath: '/CIF/ShortName',     iso20022Name: 'pty.nm' },
  { id: 'sf-legalname',  entityId: 'se-cif', name: 'LegalName',    dataType: 'string',   required: false, jxchangeXPath: '/CIF/LegalName' },
  { id: 'sf-firstname',  entityId: 'se-cif', name: 'FirstName',    dataType: 'string',   required: false, jxchangeXPath: '/CIF/Name/First',    complianceTags: ['GLBA_NPI'] },
  { id: 'sf-lastname',   entityId: 'se-cif', name: 'LastName',     dataType: 'string',   required: false, jxchangeXPath: '/CIF/Name/Last',     complianceTags: ['GLBA_NPI'] },
  { id: 'sf-dob',        entityId: 'se-cif', name: 'BirthDt',      dataType: 'date',     required: false, jxchangeXPath: '/CIF/BirthDt',       complianceTags: ['GLBA_NPI'], complianceNote: 'Date of birth — GLBA NPI. Treat as sensitive PII.' },
  { id: 'sf-opendt',     entityId: 'se-cif', name: 'OpenDt',       dataType: 'date',     required: false, jxchangeXPath: '/CIF/OpenDt' },
  { id: 'sf-phone',      entityId: 'se-cif', name: 'PhoneNum',     dataType: 'string',   required: false, jxchangeXPath: '/CIF/PhoneNum',      complianceTags: ['GLBA_NPI'] },
  { id: 'sf-email',      entityId: 'se-cif', name: 'EmailAddr',    dataType: 'string',   required: false, jxchangeXPath: '/CIF/EmailAddr',     complianceTags: ['GLBA_NPI'] },
  { id: 'sf-addr1',      entityId: 'se-cif', name: 'Addr1',        dataType: 'string',   required: false, jxchangeXPath: '/CIF/Addr/Addr1',    complianceTags: ['GLBA_NPI'] },
  { id: 'sf-city',       entityId: 'se-cif', name: 'City',         dataType: 'string',   required: false, jxchangeXPath: '/CIF/Addr/City' },
  { id: 'sf-state',      entityId: 'se-cif', name: 'StateProv',    dataType: 'string',   required: false, jxchangeXPath: '/CIF/Addr/StateProv' },
  { id: 'sf-zip',        entityId: 'se-cif', name: 'PostalCode',   dataType: 'string',   required: false, jxchangeXPath: '/CIF/Addr/PostalCode' },
  { id: 'sf-country',    entityId: 'se-cif', name: 'Country',      dataType: 'string',   required: false, jxchangeXPath: '/CIF/Addr/Country' },
  { id: 'sf-cifstatus',  entityId: 'se-cif', name: 'CIFStatus',    dataType: 'picklist', required: false, picklistValues: ['A','I','D'], jxchangeXPath: '/CIF/CIFStatus' },
  { id: 'sf-riskrating', entityId: 'se-cif', name: 'RiskRating',   dataType: 'picklist', required: false, picklistValues: ['Low','Medium','High'], jxchangeXPath: '/CIF/RiskRating', complianceTags: ['BSA_AML'], complianceNote: 'BSA/AML risk tier. Must be reviewed annually per FinCEN guidelines.' },

  // ── DDA source fields ──────────────────────────────────────────────────────
  { id: 'sf-ddanum',     entityId: 'se-dda', name: 'DDANum',      dataType: 'string',   required: true,  jxchangeXPath: '/DDA/DDANum',        iso20022Name: 'acct.id',  complianceTags: ['FFIEC_AUDIT'] },
  { id: 'sf-accttype',   entityId: 'se-dda', name: 'AcctType',    dataType: 'picklist', required: true,  picklistValues: ['10','40','50','60'], jxchangeXPath: '/DDA/AcctType', iso20022Name: 'acct.tp', complianceTags: ['SOX_FINANCIAL'], complianceNote: '10=Checking, 40=Savings, 50=MMA, 60=CD.' },
  { id: 'sf-bal',        entityId: 'se-dda', name: 'LedgerBal',   dataType: 'decimal',  required: true,  jxchangeXPath: '/DDA/LedgerBal',     iso20022Name: 'bal.amt',  complianceTags: ['SOX_FINANCIAL','FFIEC_AUDIT'] },
  { id: 'sf-avail',      entityId: 'se-dda', name: 'AvailBal',    dataType: 'decimal',  required: false, jxchangeXPath: '/DDA/AvailBal',      complianceTags: ['SOX_FINANCIAL'] },
  { id: 'sf-opendate',   entityId: 'se-dda', name: 'OpenDate',    dataType: 'date',     required: false, jxchangeXPath: '/DDA/OpenDate' },
  { id: 'sf-ddastatus',  entityId: 'se-dda', name: 'AcctStatus',  dataType: 'picklist', required: false, picklistValues: ['Open','Closed','Frozen'], jxchangeXPath: '/DDA/AcctStatus' },
  { id: 'sf-ciflink',    entityId: 'se-dda', name: 'CIFLink',     dataType: 'string',   required: true,  jxchangeXPath: '/DDA/CIFLink',       complianceTags: ['GLBA_NPI'] },
  { id: 'sf-branch',     entityId: 'se-dda', name: 'BranchNum',   dataType: 'string',   required: false, jxchangeXPath: '/DDA/BranchNum' },
  { id: 'sf-rtn',        entityId: 'se-dda', name: 'RoutingNum',  dataType: 'string',   required: false, jxchangeXPath: '/DDA/RoutingNum',    complianceTags: ['FFIEC_AUDIT'] },

  // ── LoanAccount source fields ──────────────────────────────────────────────
  { id: 'sf-loannum',    entityId: 'se-loan', name: 'LoanNum',      dataType: 'string',   required: true,  jxchangeXPath: '/Loan/LoanNum',      iso20022Name: 'cdt.id',        complianceTags: ['FFIEC_AUDIT'] },
  { id: 'sf-loantype',   entityId: 'se-loan', name: 'LoanType',     dataType: 'picklist', required: true,  picklistValues: ['10','20','30','40','50'], jxchangeXPath: '/Loan/LoanType', iso20022Name: 'cdt.tp', complianceTags: ['SOX_FINANCIAL'], complianceNote: '10=Personal, 20=Mortgage, 30=Auto, 40=Commercial, 50=HELOC.' },
  { id: 'sf-origamt',    entityId: 'se-loan', name: 'OrigAmt',      dataType: 'decimal',  required: true,  jxchangeXPath: '/Loan/OrigAmt',      iso20022Name: 'cdt.amt',       complianceTags: ['SOX_FINANCIAL'] },
  { id: 'sf-curbbal',    entityId: 'se-loan', name: 'CurBal',       dataType: 'decimal',  required: true,  jxchangeXPath: '/Loan/CurBal',       complianceTags: ['SOX_FINANCIAL','FFIEC_AUDIT'] },
  { id: 'sf-rate',       entityId: 'se-loan', name: 'Rate',         dataType: 'decimal',  required: true,  jxchangeXPath: '/Loan/Rate',         iso20022Name: 'cdt.intrstRate' },
  { id: 'sf-maturitydt', entityId: 'se-loan', name: 'MaturityDt',   dataType: 'date',     required: true,  jxchangeXPath: '/Loan/MaturityDt',   iso20022Name: 'cdt.mtrtyDt' },
  { id: 'sf-paymentamt', entityId: 'se-loan', name: 'PaymentAmt',   dataType: 'decimal',  required: false, jxchangeXPath: '/Loan/PaymentAmt' },
  { id: 'sf-payfreq',    entityId: 'se-loan', name: 'PayFreq',      dataType: 'picklist', required: false, picklistValues: ['M','B','W','A'],    jxchangeXPath: '/Loan/PayFreq',  complianceTags: ['SOX_FINANCIAL'] },
  { id: 'sf-loanstatus', entityId: 'se-loan', name: 'LoanStatus',   dataType: 'picklist', required: false, picklistValues: ['Active','Closed','Delinquent','ChargedOff','Matured'], jxchangeXPath: '/Loan/LoanStatus' },
  { id: 'sf-collateral', entityId: 'se-loan', name: 'CollateralCode',dataType: 'picklist',required: false, picklistValues: ['RE','AUTO','UNSEC','CD'], jxchangeXPath: '/Loan/CollateralCode' },
  { id: 'sf-loancif',    entityId: 'se-loan', name: 'CIFLink',      dataType: 'string',   required: true,  jxchangeXPath: '/Loan/CIFLink',      complianceTags: ['GLBA_NPI'] },
  { id: 'sf-loanopendt', entityId: 'se-loan', name: 'OpenDt',       dataType: 'date',     required: false, jxchangeXPath: '/Loan/OpenDt' },

  // ── Salesforce Account target fields ────────────────────────────────────────
  { id: 'tf-taxid',      entityId: 'te-acct', name: 'TaxId__c',          dataType: 'string',   required: false, complianceTags: ['GLBA_NPI','BSA_AML'] },
  { id: 'tf-type',       entityId: 'te-acct', name: 'Type',              dataType: 'picklist', required: false, picklistValues: ['Prospect','Customer','Partner','Competitor','Other'] },
  { id: 'tf-name',       entityId: 'te-acct', name: 'Name',              dataType: 'string',   required: true },
  { id: 'tf-created',    entityId: 'te-acct', name: 'CreatedDate',       dataType: 'datetime', required: false },
  { id: 'tf-phone',      entityId: 'te-acct', name: 'Phone',             dataType: 'string',   required: false, complianceTags: ['GLBA_NPI'] },
  { id: 'tf-bill-st',    entityId: 'te-acct', name: 'BillingStreet',     dataType: 'string',   required: false, complianceTags: ['GLBA_NPI'] },
  { id: 'tf-bill-city',  entityId: 'te-acct', name: 'BillingCity',       dataType: 'string',   required: false },
  { id: 'tf-bill-state', entityId: 'te-acct', name: 'BillingState',      dataType: 'string',   required: false },
  { id: 'tf-bill-zip',   entityId: 'te-acct', name: 'BillingPostalCode', dataType: 'string',   required: false },
  { id: 'tf-acctnum',    entityId: 'te-acct', name: 'AccountNumber',     dataType: 'string',   required: false, complianceTags: ['FFIEC_AUDIT'] },
  { id: 'tf-annrev',     entityId: 'te-acct', name: 'AnnualRevenue',     dataType: 'currency', required: false, complianceTags: ['SOX_FINANCIAL'] },
  { id: 'tf-rating',     entityId: 'te-acct', name: 'Rating',            dataType: 'picklist', required: false, picklistValues: ['Hot','Warm','Cold'] },
  { id: 'tf-industry',   entityId: 'te-acct', name: 'Industry',          dataType: 'picklist', required: false },

  // ── Salesforce Contact target fields ─────────────────────────────────────
  { id: 'tc-lastname',   entityId: 'te-cont', name: 'LastName',        dataType: 'string',   required: true },
  { id: 'tc-firstname',  entityId: 'te-cont', name: 'FirstName',       dataType: 'string',   required: false, complianceTags: ['GLBA_NPI'] },
  { id: 'tc-phone',      entityId: 'te-cont', name: 'Phone',           dataType: 'string',   required: false, complianceTags: ['GLBA_NPI'] },
  { id: 'tc-email',      entityId: 'te-cont', name: 'Email',           dataType: 'string',   required: false, complianceTags: ['GLBA_NPI'] },
  { id: 'tc-birthdate',  entityId: 'te-cont', name: 'Birthdate',       dataType: 'date',     required: false, complianceTags: ['GLBA_NPI'], complianceNote: 'PII — map only when CustomerType=Indv.' },
  { id: 'tc-taxid',      entityId: 'te-cont', name: 'SSN__c',          dataType: 'string',   required: false, complianceTags: ['GLBA_NPI','BSA_AML'], complianceNote: 'Custom encrypted field. Never plain SSN.' },

  // ── Salesforce Opportunity target fields ──────────────────────────────────
  { id: 'to-name',       entityId: 'te-opp', name: 'Name',         dataType: 'string',   required: true },
  { id: 'to-amount',     entityId: 'te-opp', name: 'Amount',       dataType: 'currency', required: false, complianceTags: ['SOX_FINANCIAL'] },
  { id: 'to-closedate',  entityId: 'te-opp', name: 'CloseDate',    dataType: 'date',     required: true },
  { id: 'to-stage',      entityId: 'te-opp', name: 'StageName',    dataType: 'picklist', required: true,  picklistValues: ['Prospecting','Qualification','Proposal','Closed Won','Closed Lost'] },
  { id: 'to-type',       entityId: 'te-opp', name: 'Type',         dataType: 'picklist', required: false, picklistValues: ['Personal Loan','Mortgage','Auto Loan','Commercial','HELOC'] },
  { id: 'to-desc',       entityId: 'te-opp', name: 'Description',  dataType: 'string',   required: false },

  // ── FSC FinancialAccount target fields ───────────────────────────────────
  { id: 'tfa-num',       entityId: 'te-fa', name: 'FinancialAccountNumber', dataType: 'string',   required: true,  complianceTags: ['FFIEC_AUDIT'] },
  { id: 'tfa-name',      entityId: 'te-fa', name: 'Name',                   dataType: 'string',   required: true },
  { id: 'tfa-balance',   entityId: 'te-fa', name: 'Balance__c',             dataType: 'currency', required: false, complianceTags: ['SOX_FINANCIAL','FFIEC_AUDIT'] },
  { id: 'tfa-opendate',  entityId: 'te-fa', name: 'OpenDate__c',            dataType: 'date',     required: false },
  { id: 'tfa-status',    entityId: 'te-fa', name: 'Status__c',              dataType: 'picklist', required: false, picklistValues: ['Open','Closed','Dormant','Frozen'] },
  { id: 'tfa-type',      entityId: 'te-fa', name: 'FinancialAccountType',   dataType: 'picklist', required: false, picklistValues: ['Checking','Savings','CD','MoneyMarket','Loan','HELOC','Mortgage'] },
  { id: 'tfa-rate',      entityId: 'te-fa', name: 'InterestRate__c',        dataType: 'decimal',  required: false },
  { id: 'tfa-maturity',  entityId: 'te-fa', name: 'MaturityDate__c',        dataType: 'date',     required: false },
  { id: 'tfa-owner',     entityId: 'te-fa', name: 'PrimaryOwnerID__c',      dataType: 'string',   required: false, complianceTags: ['GLBA_NPI'] },
  { id: 'tfa-routing',   entityId: 'te-fa', name: 'RoutingNumber__c',       dataType: 'string',   required: false, complianceTags: ['FFIEC_AUDIT'] },

  // ── FSC IndividualApplication target fields ──────────────────────────────
  { id: 'tip-lastname',  entityId: 'te-ip', name: 'LastName',          dataType: 'string',   required: true,  complianceTags: ['GLBA_NPI'] },
  { id: 'tip-firstname', entityId: 'te-ip', name: 'FirstName',         dataType: 'string',   required: false, complianceTags: ['GLBA_NPI'] },
  { id: 'tip-taxid',     entityId: 'te-ip', name: 'TaxId__c',          dataType: 'string',   required: false, complianceTags: ['GLBA_NPI','BSA_AML'] },
  { id: 'tip-dob',       entityId: 'te-ip', name: 'Birthdate',         dataType: 'date',     required: false, complianceTags: ['GLBA_NPI'] },
  { id: 'tip-risk',      entityId: 'te-ip', name: 'AMLRiskScore__c',   dataType: 'picklist', required: false, picklistValues: ['Low','Medium','High'], complianceTags: ['BSA_AML'] },
];

// ── Entity mappings ────────────────────────────────────────────────────────────
export const mockEntityMappings: EntityMapping[] = [
  { id: 'em-cif-acct', projectId: P, sourceEntityId: 'se-cif',  targetEntityId: 'te-acct', confidence: 0.91, rationale: 'CIF records map to Salesforce Account — both represent organisational or individual customer profiles with identity and address data.' },
  { id: 'em-cif-cont', projectId: P, sourceEntityId: 'se-cif',  targetEntityId: 'te-cont', confidence: 0.87, rationale: 'CIF individual records (CustomerType=Indv) map to Salesforce Contact for person-level data: name, phone, email, birthdate.' },
  { id: 'em-dda-fa',   projectId: P, sourceEntityId: 'se-dda',  targetEntityId: 'te-fa',   confidence: 0.88, rationale: 'DDA records are the primary source for FSC FinancialAccount objects — account number, balance, type, and status align precisely.' },
  { id: 'em-dda-acct', projectId: P, sourceEntityId: 'se-dda',  targetEntityId: 'te-acct', confidence: 0.62, rationale: 'DDA Accounts carry secondary Account-level financials. Lower confidence — FinancialAccount (em-dda-fa) is the preferred target.' },
  { id: 'em-loan-opp', projectId: P, sourceEntityId: 'se-loan', targetEntityId: 'te-opp',  confidence: 0.74, rationale: 'Loan products represent credit opportunities in CRM — OrigAmt→Amount, MaturityDt→CloseDate, LoanType→Opportunity Type align well.' },
  { id: 'em-loan-fa',  projectId: P, sourceEntityId: 'se-loan', targetEntityId: 'te-fa',   confidence: 0.82, rationale: 'Loans are financial accounts in the FSC model — FinancialAccountType=Loan/Mortgage/HELOC, balance, rate and maturity date map directly.' },
];

// ── Field mappings ─────────────────────────────────────────────────────────────
export const mockFieldMappings: FieldMapping[] = [
  // CIF → Account (10 mappings)
  { id: 'fm-1',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-taxid',     targetFieldId: 'tf-taxid',     transform: { type: 'direct',     config: {} }, confidence: 0.95, status: 'accepted',  rationale: 'Direct identifier match. GLBA/BSA compliance tags must propagate — never log in plaintext.' },
  { id: 'fm-2',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-custtype',  targetFieldId: 'tf-type',      transform: { type: 'lookup',     config: { Indv:'Customer', Bus:'Partner', Org:'Partner', Gov:'Other' } }, confidence: 0.68, status: 'suggested', rationale: 'Core Director uses short codes (Indv/Bus/Org/Gov); Salesforce expects long-form picklist values. A lookup transform is required.' },
  { id: 'fm-3',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-shortname', targetFieldId: 'tf-name',      transform: { type: 'direct',     config: {} }, confidence: 0.91, status: 'accepted',  rationale: 'ShortName is the primary CIF display label — maps directly to Salesforce Account Name.' },
  { id: 'fm-4',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-opendt',    targetFieldId: 'tf-created',   transform: { type: 'formatDate', config: { from:'YYYY-MM-DD', to:'ISO8601' } }, confidence: 0.88, status: 'accepted',  rationale: 'OpenDt (date) requires ISO 8601 datetime conversion for Salesforce CreatedDate.' },
  { id: 'fm-5',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-phone',     targetFieldId: 'tf-phone',     transform: { type: 'direct',     config: {} }, confidence: 0.83, status: 'accepted',  rationale: 'Phone direct mapping. GLBA NPI tag propagates — must not appear in debug logs.' },
  { id: 'fm-6',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-addr1',     targetFieldId: 'tf-bill-st',   transform: { type: 'direct',     config: {} }, confidence: 0.79, status: 'suggested', rationale: 'CIF Addr1 → BillingStreet. GLBA NPI compliance applies.' },
  { id: 'fm-7',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-city',      targetFieldId: 'tf-bill-city', transform: { type: 'direct',     config: {} }, confidence: 0.92, status: 'accepted',  rationale: 'City → BillingCity direct match.' },
  { id: 'fm-8',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-state',     targetFieldId: 'tf-bill-state',transform: { type: 'direct',     config: {} }, confidence: 0.92, status: 'accepted',  rationale: 'StateProv → BillingState direct match.' },
  { id: 'fm-9',  entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-zip',       targetFieldId: 'tf-bill-zip',  transform: { type: 'direct',     config: {} }, confidence: 0.90, status: 'suggested', rationale: 'PostalCode → BillingPostalCode. Validate 5-digit vs ZIP+4 format.' },
  { id: 'fm-10', entityMappingId: 'em-cif-acct', sourceFieldId: 'sf-riskrating',targetFieldId: 'tf-rating',    transform: { type: 'lookup',     config: { Low:'Cold', Medium:'Warm', High:'Hot' } }, confidence: 0.73, status: 'suggested', rationale: 'BSA/AML RiskRating → Account Rating for pipeline prioritisation. Lookup required.' },

  // CIF → Contact (6 mappings)
  { id: 'fm-11', entityMappingId: 'em-cif-cont', sourceFieldId: 'sf-lastname',   targetFieldId: 'tc-lastname',  transform: { type: 'direct',     config: {} }, confidence: 0.97, status: 'accepted',  rationale: 'LastName direct match for individual CIF records.' },
  { id: 'fm-12', entityMappingId: 'em-cif-cont', sourceFieldId: 'sf-firstname',  targetFieldId: 'tc-firstname', transform: { type: 'direct',     config: {} }, confidence: 0.97, status: 'accepted',  rationale: 'FirstName direct match.' },
  { id: 'fm-13', entityMappingId: 'em-cif-cont', sourceFieldId: 'sf-phone',      targetFieldId: 'tc-phone',     transform: { type: 'direct',     config: {} }, confidence: 0.90, status: 'accepted',  rationale: 'Phone → Contact.Phone. GLBA NPI propagates.' },
  { id: 'fm-14', entityMappingId: 'em-cif-cont', sourceFieldId: 'sf-email',      targetFieldId: 'tc-email',     transform: { type: 'direct',     config: {} }, confidence: 0.94, status: 'accepted',  rationale: 'EmailAddr → Contact.Email. GLBA NPI.' },
  { id: 'fm-15', entityMappingId: 'em-cif-cont', sourceFieldId: 'sf-dob',        targetFieldId: 'tc-birthdate', transform: { type: 'formatDate', config: { from:'YYYY-MM-DD', to:'YYYY-MM-DD' } }, confidence: 0.88, status: 'suggested', rationale: 'BirthDt → Birthdate. PII — only map for CustomerType=Indv. Add conditional filter.' },
  { id: 'fm-16', entityMappingId: 'em-cif-cont', sourceFieldId: 'sf-taxid',      targetFieldId: 'tc-taxid',     transform: { type: 'direct',     config: {} }, confidence: 0.85, status: 'suggested', rationale: 'TaxId → SSN__c (encrypted custom field). Verify field-level encryption is enabled in target org.' },

  // DDA → FinancialAccount (6 mappings)
  { id: 'fm-17', entityMappingId: 'em-dda-fa',   sourceFieldId: 'sf-ddanum',     targetFieldId: 'tfa-num',      transform: { type: 'direct',     config: {} }, confidence: 0.97, status: 'accepted',  rationale: 'DDANum → FinancialAccountNumber. Primary identifier. FFIEC audit trail required.' },
  { id: 'fm-18', entityMappingId: 'em-dda-fa',   sourceFieldId: 'sf-bal',        targetFieldId: 'tfa-balance',  transform: { type: 'direct',     config: {} }, confidence: 0.93, status: 'accepted',  rationale: 'LedgerBal → Balance__c. SOX + FFIEC compliance tags propagate.' },
  { id: 'fm-19', entityMappingId: 'em-dda-fa',   sourceFieldId: 'sf-accttype',   targetFieldId: 'tfa-type',     transform: { type: 'lookup',     config: { '10':'Checking', '40':'Savings', '50':'MoneyMarket', '60':'CD' } }, confidence: 0.88, status: 'suggested', rationale: 'AcctType numeric codes require lookup to FSC FinancialAccountType picklist.' },
  { id: 'fm-20', entityMappingId: 'em-dda-fa',   sourceFieldId: 'sf-opendate',   targetFieldId: 'tfa-opendate', transform: { type: 'formatDate', config: { from:'YYYYMMDD', to:'ISO8601' } }, confidence: 0.91, status: 'accepted',  rationale: 'OpenDate (YYYYMMDD integer) requires parsing before mapping to FSC datetime.' },
  { id: 'fm-21', entityMappingId: 'em-dda-fa',   sourceFieldId: 'sf-ddastatus',  targetFieldId: 'tfa-status',   transform: { type: 'direct',     config: {} }, confidence: 0.85, status: 'accepted',  rationale: 'AcctStatus → Status__c. Values align (Open/Closed/Frozen).' },
  { id: 'fm-22', entityMappingId: 'em-dda-fa',   sourceFieldId: 'sf-rtn',        targetFieldId: 'tfa-routing',  transform: { type: 'direct',     config: {} }, confidence: 0.94, status: 'accepted',  rationale: 'RoutingNum → RoutingNumber__c. FFIEC audit trail.' },

  // LoanAccount → Opportunity (5 mappings)
  { id: 'fm-23', entityMappingId: 'em-loan-opp', sourceFieldId: 'sf-loannum',    targetFieldId: 'to-name',      transform: { type: 'concat',     config: { prefix:'Loan #' } }, confidence: 0.84, status: 'accepted',  rationale: 'LoanNum becomes Opportunity Name with "Loan #" prefix for CRM readability.' },
  { id: 'fm-24', entityMappingId: 'em-loan-opp', sourceFieldId: 'sf-origamt',    targetFieldId: 'to-amount',    transform: { type: 'direct',     config: {} }, confidence: 0.92, status: 'accepted',  rationale: 'OrigAmt (original principal) → Opportunity Amount. SOX compliance tag propagates.' },
  { id: 'fm-25', entityMappingId: 'em-loan-opp', sourceFieldId: 'sf-maturitydt', targetFieldId: 'to-closedate', transform: { type: 'formatDate', config: { from:'YYYY-MM-DD', to:'YYYY-MM-DD' } }, confidence: 0.88, status: 'accepted',  rationale: 'MaturityDt → Opportunity CloseDate represents deal horizon.' },
  { id: 'fm-26', entityMappingId: 'em-loan-opp', sourceFieldId: 'sf-loantype',   targetFieldId: 'to-type',      transform: { type: 'lookup',     config: { '10':'Personal Loan', '20':'Mortgage', '30':'Auto Loan', '40':'Commercial', '50':'HELOC' } }, confidence: 0.86, status: 'suggested', rationale: 'LoanType numeric codes require lookup to Opportunity.Type picklist.' },
  { id: 'fm-27', entityMappingId: 'em-loan-opp', sourceFieldId: 'sf-loanstatus', targetFieldId: 'to-stage',     transform: { type: 'lookup',     config: { Active:'Closed Won', Closed:'Closed Lost', Delinquent:'Needs Analysis', ChargedOff:'Closed Lost', Matured:'Closed Won' } }, confidence: 0.71, status: 'suggested', rationale: '⚠️ LoanStatus → StageName has revenue recognition implications. Active/Matured→Closed Won, Delinquent→Needs Analysis. Review ChargedOff→Closed Lost with finance team.' },

  // LoanAccount → FinancialAccount (6 mappings)
  { id: 'fm-28', entityMappingId: 'em-loan-fa',  sourceFieldId: 'sf-loannum',    targetFieldId: 'tfa-num',      transform: { type: 'direct',     config: {} }, confidence: 0.95, status: 'accepted',  rationale: 'LoanNum → FinancialAccountNumber. FFIEC audit trail.' },
  { id: 'fm-29', entityMappingId: 'em-loan-fa',  sourceFieldId: 'sf-curbbal',    targetFieldId: 'tfa-balance',  transform: { type: 'direct',     config: {} }, confidence: 0.90, status: 'accepted',  rationale: 'CurBal (outstanding balance) → Balance__c. SOX + FFIEC.' },
  { id: 'fm-30', entityMappingId: 'em-loan-fa',  sourceFieldId: 'sf-loantype',   targetFieldId: 'tfa-type',     transform: { type: 'lookup',     config: { '10':'Loan', '20':'Mortgage', '30':'Loan', '40':'Loan', '50':'HELOC' } }, confidence: 0.87, status: 'suggested', rationale: 'LoanType → FinancialAccountType. Mortgage and HELOC have direct FSC equivalents.' },
  { id: 'fm-31', entityMappingId: 'em-loan-fa',  sourceFieldId: 'sf-rate',       targetFieldId: 'tfa-rate',     transform: { type: 'direct',     config: {} }, confidence: 0.93, status: 'accepted',  rationale: 'Interest Rate direct match.' },
  { id: 'fm-32', entityMappingId: 'em-loan-fa',  sourceFieldId: 'sf-maturitydt', targetFieldId: 'tfa-maturity', transform: { type: 'formatDate', config: { from:'YYYY-MM-DD', to:'ISO8601' } }, confidence: 0.91, status: 'accepted',  rationale: 'MaturityDt → MaturityDate__c.' },
  { id: 'fm-33', entityMappingId: 'em-loan-fa',  sourceFieldId: 'sf-loanopendt', targetFieldId: 'tfa-opendate', transform: { type: 'formatDate', config: { from:'YYYY-MM-DD', to:'ISO8601' } }, confidence: 0.89, status: 'accepted',  rationale: 'Loan OpenDt → FinancialAccount OpenDate__c.' },
];

// ── Validation report ─────────────────────────────────────────────────────────
export const mockValidation: ValidationReport = {
  warnings: [
    { type: 'type_mismatch',    message: 'AcctType (picklist/int) → FinancialAccountType (string): numeric codes must use lookup transform. Direct mapping will produce corrupt data.' },
    { type: 'type_mismatch',    message: 'LoanStatus → Opportunity.StageName: ChargedOff→Closed Lost has revenue recognition implications. Review with finance team.' },
    { type: 'picklist_gap',     message: 'CustomerType "Gov" has no direct Salesforce Account.Type equivalent — defaults to "Other". Confirm with business stakeholders.' },
    { type: 'missing_required', message: 'Salesforce Account.Name is required. Ensure ShortName is always populated in source CIF records.' },
    { type: 'missing_required', message: 'Opportunity.CloseDate is required. MaturityDt must be present on all LoanAccount records before export.' },
  ],
  summary: { totalWarnings: 5, typeMismatch: 2, missingRequired: 2, picklistCoverage: 1 },
};

// ── Full project payload ───────────────────────────────────────────────────────
export const mockProjectPayload: ProjectPayload = {
  project: {
    id: P,
    name: 'Core Director → Salesforce FSC',
    sourceSystemId: SYS_SRC,
    targetSystemId: SYS_TGT,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  sourceEntities: srcEntities,
  targetEntities: tgtEntities,
  fields: mockFields,
  entityMappings: mockEntityMappings,
  fieldMappings: mockFieldMappings,
};

// ── SSE orchestration events ───────────────────────────────────────────────────
export const mockOrchestrationEvents = [
  { delay: 300,   data: { event: 'agent_start',    agent: 'SchemaDiscoveryAgent',  step: 0 } },
  { delay: 1100,  data: { event: 'agent_complete', agent: 'SchemaDiscoveryAgent',  output: 'Discovered 6 source entities (CIF, DDA, LoanAccount, GLAccount, CDAccount, Party) with 118 fields. Salesforce FSC: 8 objects (Account, Contact, Opportunity, FinancialAccount, IndividualApplication, FinancialGoal, AccountParticipant, PartyProfile), 172 fields.' } },
  { delay: 1300,  data: { event: 'agent_start',    agent: 'ComplianceAgent',       step: 1 } },
  { delay: 2500,  data: { event: 'agent_complete', agent: 'ComplianceAgent',       output: 'Tagged 31 fields: 14× GLBA_NPI, 6× BSA_AML, 6× SOX_FINANCIAL, 5× FFIEC_AUDIT. 3 fields flagged for AES-256 encryption (TaxId, SSN__c). BSA/AML RiskRating requires annual FinCEN review.' } },
  { delay: 2700,  data: { event: 'agent_start',    agent: 'BankingDomainAgent',    step: 2 } },
  { delay: 3900,  data: { event: 'agent_complete', agent: 'BankingDomainAgent',    output: 'Detected Core Director numeric codes: AcctType (10=Checking, 40=Savings, 50=MMA, 60=CD), LoanType (10=Personal, 20=Mortgage, 30=Auto, 40=Commercial, 50=HELOC). LoanStatus has 5 values with revenue recognition implications for ChargedOff state.' } },
  { delay: 4100,  data: { event: 'agent_start',    agent: 'CRMDomainAgent',        step: 3 } },
  { delay: 5200,  data: { event: 'agent_complete', agent: 'CRMDomainAgent',        output: 'Salesforce FSC analysed: FinancialAccount is the preferred target for DDA/Loan over standard Account. IndividualApplication and PartyProfile available for CIF individual records. AccountParticipant links parties to financial accounts. FinancialGoal available for CD/savings objectives.' } },
  { delay: 5400,  data: { event: 'agent_start',    agent: 'MappingProposalAgent',  step: 4 } },
  { delay: 7100,  data: { event: 'agent_complete', agent: 'MappingProposalAgent',  output: 'Proposed 33 field mappings across 6 entity pairs: CIF→Account (10), CIF→Contact (6), DDA→FinancialAccount (6), LoanAccount→Opportunity (5), LoanAccount→FinancialAccount (6). 22 high-confidence (≥0.75), 9 medium, 2 low. 5 lookup transforms generated.' } },
  { delay: 7300,  data: { event: 'agent_start',    agent: 'MappingRationaleAgent', step: 5 } },
  { delay: 9000,  data: { event: 'agent_complete', agent: 'MappingRationaleAgent', output: 'Generated compliance-aware rationale for all 33 mappings. 8 carry mandatory compliance notes. CIF→Contact pathway documented with PII conditional logic for CustomerType=Indv filter.' } },
  { delay: 9200,  data: { event: 'agent_start',    agent: 'ValidationAgent',       step: 6 } },
  { delay: 10400, data: { event: 'agent_complete', agent: 'ValidationAgent',       output: '5 warnings: 2 type mismatches, 2 missing required fields, 1 picklist coverage gap. ChargedOff→StageName flagged for business review. All mappings structurally valid.' } },
  { delay: 10700, data: {
      event: 'pipeline_complete',
      entityMappings: mockEntityMappings,
      fieldMappings: mockFieldMappings,
      validation: mockValidation,
      totalMappings: mockFieldMappings.length,
      complianceFlags: 14,
      processingMs: 10700,
    }
  },
];
