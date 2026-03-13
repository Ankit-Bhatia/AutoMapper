import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type DomainSeed = {
  name: string;
  description: string;
  concepts: Array<{
    conceptName: string;
    displayLabel: string;
    dataType: string;
    complianceTags?: string[];
  }>;
};

const DOMAIN_SEEDS: DomainSeed[] = [
  {
    name: 'customer',
    description: 'Customer profile and identity concepts.',
    concepts: [
      { conceptName: 'customer_id', displayLabel: 'Customer Identifier', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'first_name', displayLabel: 'First Name', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'last_name', displayLabel: 'Last Name', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'middle_name', displayLabel: 'Middle Name', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'full_name', displayLabel: 'Full Name', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'tax_id', displayLabel: 'Tax Identifier', dataType: 'string', complianceTags: ['GLBA_NPI', 'BSA_AML'] },
      { conceptName: 'date_of_birth', displayLabel: 'Date of Birth', dataType: 'date', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'email', displayLabel: 'Email Address', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'phone', displayLabel: 'Phone Number', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'address_line_1', displayLabel: 'Address Line 1', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'address_line_2', displayLabel: 'Address Line 2', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'city', displayLabel: 'City', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'state', displayLabel: 'State', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'postal_code', displayLabel: 'Postal Code', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'country', displayLabel: 'Country', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'risk_rating', displayLabel: 'Risk Rating', dataType: 'string', complianceTags: ['BSA_AML'] },
    ],
  },
  {
    name: 'account',
    description: 'Deposit and account master concepts.',
    concepts: [
      { conceptName: 'account_id', displayLabel: 'Account Identifier', dataType: 'string', complianceTags: ['FFIEC_AUDIT'] },
      { conceptName: 'account_number', displayLabel: 'Account Number', dataType: 'string', complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT'] },
      { conceptName: 'routing_number', displayLabel: 'Routing Number', dataType: 'string', complianceTags: ['FFIEC_AUDIT'] },
      { conceptName: 'account_type', displayLabel: 'Account Type', dataType: 'string' },
      { conceptName: 'account_status', displayLabel: 'Account Status', dataType: 'string' },
      { conceptName: 'open_date', displayLabel: 'Open Date', dataType: 'date' },
      { conceptName: 'close_date', displayLabel: 'Close Date', dataType: 'date' },
      { conceptName: 'currency', displayLabel: 'Currency', dataType: 'string' },
      { conceptName: 'available_balance', displayLabel: 'Available Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { conceptName: 'ledger_balance', displayLabel: 'Ledger Balance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { conceptName: 'interest_rate', displayLabel: 'Interest Rate', dataType: 'decimal' },
      { conceptName: 'product_code', displayLabel: 'Product Code', dataType: 'string' },
      { conceptName: 'branch_id', displayLabel: 'Branch Identifier', dataType: 'string' },
      { conceptName: 'officer_id', displayLabel: 'Officer Identifier', dataType: 'string' },
      { conceptName: 'ownership_type', displayLabel: 'Ownership Type', dataType: 'string' },
      { conceptName: 'statement_cycle', displayLabel: 'Statement Cycle', dataType: 'string' },
    ],
  },
  {
    name: 'loan',
    description: 'Loan contract and payment concepts.',
    concepts: [
      { conceptName: 'loan_id', displayLabel: 'Loan Identifier', dataType: 'string', complianceTags: ['FFIEC_AUDIT'] },
      { conceptName: 'loan_number', displayLabel: 'Loan Number', dataType: 'string', complianceTags: ['FFIEC_AUDIT'] },
      { conceptName: 'loan_type', displayLabel: 'Loan Type', dataType: 'string' },
      { conceptName: 'loan_status', displayLabel: 'Loan Status', dataType: 'string' },
      { conceptName: 'original_principal', displayLabel: 'Original Principal', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { conceptName: 'current_principal', displayLabel: 'Current Principal', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { conceptName: 'interest_rate', displayLabel: 'Interest Rate', dataType: 'decimal' },
      { conceptName: 'apr', displayLabel: 'Annual Percentage Rate', dataType: 'decimal' },
      { conceptName: 'term_months', displayLabel: 'Term Months', dataType: 'integer' },
      { conceptName: 'maturity_date', displayLabel: 'Maturity Date', dataType: 'date' },
      { conceptName: 'next_due_date', displayLabel: 'Next Due Date', dataType: 'date' },
      { conceptName: 'payment_amount', displayLabel: 'Payment Amount', dataType: 'decimal' },
      { conceptName: 'payment_frequency', displayLabel: 'Payment Frequency', dataType: 'string' },
      { conceptName: 'collateral_type', displayLabel: 'Collateral Type', dataType: 'string' },
      { conceptName: 'delinquency_days', displayLabel: 'Delinquency Days', dataType: 'integer' },
      { conceptName: 'charge_off_date', displayLabel: 'Charge Off Date', dataType: 'date' },
    ],
  },
  {
    name: 'transaction',
    description: 'Financial movement and posting concepts.',
    concepts: [
      { conceptName: 'transaction_id', displayLabel: 'Transaction Identifier', dataType: 'string', complianceTags: ['FFIEC_AUDIT'] },
      { conceptName: 'transaction_type', displayLabel: 'Transaction Type', dataType: 'string' },
      { conceptName: 'transaction_code', displayLabel: 'Transaction Code', dataType: 'string' },
      { conceptName: 'transaction_date', displayLabel: 'Transaction Date', dataType: 'datetime', complianceTags: ['FFIEC_AUDIT'] },
      { conceptName: 'posting_date', displayLabel: 'Posting Date', dataType: 'datetime', complianceTags: ['FFIEC_AUDIT'] },
      { conceptName: 'amount', displayLabel: 'Amount', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
      { conceptName: 'currency', displayLabel: 'Currency', dataType: 'string' },
      { conceptName: 'debit_credit_indicator', displayLabel: 'Debit/Credit Indicator', dataType: 'string' },
      { conceptName: 'memo', displayLabel: 'Memo', dataType: 'string' },
      { conceptName: 'channel', displayLabel: 'Channel', dataType: 'string' },
      { conceptName: 'merchant_name', displayLabel: 'Merchant Name', dataType: 'string' },
      { conceptName: 'counterparty_account', displayLabel: 'Counterparty Account', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'counterparty_name', displayLabel: 'Counterparty Name', dataType: 'string', complianceTags: ['GLBA_NPI'] },
      { conceptName: 'balance_after', displayLabel: 'Balance After Transaction', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] },
    ],
  },
];

const FIELD_ALIAS_TO_CANONICAL: Record<string, string> = {
  accountid: 'account_id',
  accountnumber: 'account_number',
  ddanum: 'account_number',
  routingnum: 'routing_number',
  routingnumber: 'routing_number',
  accountstatus: 'account_status',
  accounttype: 'account_type',
  branchid: 'branch_id',
  productcode: 'product_code',
  balance: 'available_balance',
  availablebalance: 'available_balance',
  ledgerbalance: 'ledger_balance',
  customerid: 'customer_id',
  firstname: 'first_name',
  lastname: 'last_name',
  fullname: 'full_name',
  taxid: 'tax_id',
  ssn: 'tax_id',
  dob: 'date_of_birth',
  email: 'email',
  phone: 'phone',
  city: 'city',
  state: 'state',
  postalcode: 'postal_code',
  zipcode: 'postal_code',
  country: 'country',
  riskrating: 'risk_rating',
  loanid: 'loan_id',
  loannum: 'loan_number',
  loannumber: 'loan_number',
  loanstatus: 'loan_status',
  loantype: 'loan_type',
  originalprincipal: 'original_principal',
  currentprincipal: 'current_principal',
  apr: 'apr',
  maturitydate: 'maturity_date',
  nextduedate: 'next_due_date',
  paymentamount: 'payment_amount',
  delinquencydays: 'delinquency_days',
  chargeoffdate: 'charge_off_date',
  transactionid: 'transaction_id',
  transactioncode: 'transaction_code',
  transactiontype: 'transaction_type',
  transactiondate: 'transaction_date',
  postingdate: 'posting_date',
  amount: 'amount',
  currency: 'currency',
  drcr: 'debit_credit_indicator',
  memo: 'memo',
  merchantname: 'merchant_name',
  counterpartyname: 'counterparty_name',
  counterpartyaccount: 'counterparty_account',
  balanceafter: 'balance_after',
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main(): Promise<void> {
  console.log('🌱  Seeding canonical ontology…');

  let canonicalFieldCount = 0;
  for (const domainSeed of DOMAIN_SEEDS) {
    const domain = await prisma.canonicalDomain.upsert({
      where: { name: domainSeed.name },
      update: {
        description: domainSeed.description,
      },
      create: {
        name: domainSeed.name,
        description: domainSeed.description,
      },
    });

    for (const concept of domainSeed.concepts) {
      await prisma.canonicalField.upsert({
        where: {
          domainId_conceptName: {
            domainId: domain.id,
            conceptName: concept.conceptName,
          },
        },
        update: {
          displayLabel: concept.displayLabel,
          dataType: concept.dataType,
          complianceTags: concept.complianceTags ?? [],
          isDeprecated: false,
        },
        create: {
          domainId: domain.id,
          conceptName: concept.conceptName,
          displayLabel: concept.displayLabel,
          dataType: concept.dataType,
          complianceTags: concept.complianceTags ?? [],
        },
      });
      canonicalFieldCount += 1;
    }
  }

  const canonicalFields = await prisma.canonicalField.findMany({
    select: { id: true, conceptName: true },
  });
  const canonicalByConcept = new Map(canonicalFields.map((field) => [field.conceptName, field.id]));

  const fields = await prisma.field.findMany({
    select: { id: true, name: true },
  });

  let mappedCount = 0;
  let skippedCount = 0;

  for (const field of fields) {
    const normalizedName = normalize(field.name);
    const mappedConcept = FIELD_ALIAS_TO_CANONICAL[normalizedName]
      ?? FIELD_ALIAS_TO_CANONICAL[normalizedName.replace(/id$/, 'id')]
      ?? null;

    if (!mappedConcept) {
      skippedCount += 1;
      continue;
    }

    const canonicalId = canonicalByConcept.get(mappedConcept);
    if (!canonicalId) {
      skippedCount += 1;
      continue;
    }

    await prisma.fieldCanonicalMap.upsert({
      where: {
        fieldId_canonicalFieldId: {
          fieldId: field.id,
          canonicalFieldId: canonicalId,
        },
      },
      update: {
        confidence: 1,
        mappedBy: 'seed',
      },
      create: {
        fieldId: field.id,
        canonicalFieldId: canonicalId,
        confidence: 1,
        mappedBy: 'seed',
      },
    });

    mappedCount += 1;
  }

  console.log(`   ✓ ${canonicalFieldCount} canonical fields across ${DOMAIN_SEEDS.length} domains`);
  console.log(`   ✓ ${mappedCount} field→canonical maps written (${skippedCount} skipped — system not yet loaded)`);
  console.log('🌱  Canonical seed complete.');
}

main()
  .catch((error) => {
    console.error('❌ Canonical seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
