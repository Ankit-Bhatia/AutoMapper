# Salesforce Financial Services Cloud — Data Model Reference

## Object Hierarchy for Banking / Lending

### Core Object Relationships

```
Account (Person Account)
  ├── Financial Account (FinServ__FinancialAccount__c)
  │     ├── Financial Account Role (junction to Account)
  │     └── Financial Account Transaction
  ├── Loan Package (custom: LoanPackage__c or similar)
  │     ├── Loan (custom: Loan__c)
  │     │     ├── Fee (custom: Fee__c)
  │     │     └── Collateral Loan Application
  │     ├── Application Team Member
  │     └── Credit Risk Assessment (CRA)
  ├── Party Involved in Transaction (PIT) — junction: Account ↔ Loan
  ├── Party Liabilities (FinServ__AssetsAndLiabilities__c)
  └── Assets & Liabilities (FinServ__AssetsAndLiabilities__c)
```

### Object Descriptions

#### Account (Person Account)
- **Business Role:** The customer entity. In Caribbean banking, this holds KYC data, demographics, regulatory identifiers (ECCB codes, FATCA/CRS flags), and net worth calculations.
- **Person Account Implications:** Uses PersonAccount record type. Person-specific fields use `__pc` suffix (e.g., `Age__pc`, `FinServ__Citizenship__pc`). Standard Contact fields surface as `PersonHomePhone`, `PersonMobilePhone`, `PersonMailingAddress`.
- **Typical Field Count:** 300-400+ fields in a mature FSC banking org.
- **Key Standard Fields:** `FinServ__Age__pc`, `FinServ__NetWorth__c`, `FinServ__BranchCode__c`, `FinServ__BranchName__c`, `FinServ__CountryOfResidence__pc`, `FinServ__Citizenship__pc`, `FinServ__MaritalStatus__pc`.
- **Common Custom Fields:** `ECCB_Code__c` (regulatory), `Entity_Type__c`, `Attorney_Code__c`, `Total_Assets__c`, `Total_Liabilities__c`, `SIN_SSN__pc` (social security / national ID).
- **Integration Keys:** AccountNumber, CIF Number (Customer Information File — core banking ID).

#### Loan Package
- **Business Role:** Aggregates one or more loans into a credit submission. This is the unit that goes through credit approval. Holds combined ratios (debt-to-income, LTV, residual income) and package-level totals.
- **Lifecycle:** Created during origination → goes through approval workflow → individual loans within it get boarded to core banking.
- **Key Fields:** Combined debt-to-income ratios, total secured/unsecured amounts, total new debt, approval officer, originating/closing branch, number of borrowers.
- **Relationship:** Parent of Loan__c records. Related to Application Team Member for tracking officers involved.

#### Loan (Loan__c)
- **Business Role:** Individual loan facility within a package. Contains loan-specific terms: interest rate, maturity date, payment schedule, disbursement details, risk classification.
- **Lifecycle Overlap:** During origination, loan data lives here. After boarding (posting to core banking), some data migrates to Financial Account. This creates a dual-mapping challenge where the same external field may target either object depending on lifecycle stage.
- **Key Fields:** `AnnualInterestRate__c`, `MaturityDate__c`, `Number_of_Payments__c`, `TermInMonth__c`, `Loan_Amount_formula__c`, `Scheduled_Payment__c`, `Credit_Limit__c`, `Loan_Purpose__c`, `Risk_Code__c`, `GL_Code__c`.
- **Integration Points:** Loan_Number__c (links to core banking), DATE_BOARDING / Inserted_In_Core__c (marks core banking posting).

#### Financial Account (FinServ__FinancialAccount__c)
- **Business Role:** The active account record post-boarding. Tracks live balances, payment history, account status, and ongoing financial metrics.
- **FSC Standard Object:** This is a managed FSC object with many standard fields.
- **Key Standard Fields:** `FinServ__Balance__c`, `FinServ__PrincipalBalance__c`, `FinServ__InterestRate__c`, `FinServ__PaymentAmount__c`, `FinServ__PaymentFrequency__c`, `FinServ__LoanAmount__c`, `FinServ__LoanEndDate__c`, `FinServ__OpenDate__c`, `FinServ__CloseDate__c`, `FinServ__ApplicationDate__c`, `FinServ__FinancialAccountNumber__c`.
- **Common Custom Fields:** `Account_Status__c`, `GL_Code__c`, `Escrow_Amount__c`, `Credit_Life_Amount__c`, `Secured_Amount__c`.

#### Party Involved in Transaction (PIT)
- **Business Role:** Junction object connecting borrowers and co-borrowers to loans. Holds per-party financial metrics: income, debt-to-income ratios, residual income, expense ratios, insurance status.
- **Critical for Mapping:** Many XML fields that look like they belong on the Loan actually belong on the PIT because they're per-borrower, not per-loan.
- **Key Fields:** `Salary_Total_Monthly_Amount__c`, `Total_Monthly_Income_Formula__c`, `Current_Debt_to_Income__c`, `Current_Budgetary_Residual_Income__c`, `Total_Liabilities__c`, `Insured__c`, `Client_Type__c`.

#### Party Liabilities
- **Business Role:** Existing debts held at other institutions. Each record = one external liability.
- **Related FSC Object:** Often implemented via `FinServ__AssetsAndLiabilities__c` with custom extensions.
- **Key Fields:** `Account_Number__c`, `Amount_Owed__c`, `Balance__c` (calculated), `Institution_Bank_Held_c__c`, `Exclude__c` (flag to exclude from ratio calculations), `Indirect__c`.

#### Collateral
- **Business Role:** Security items (property, vehicles, deposits, insurance policies) linked to loans.
- **Typically Heavily Customized:** The highest field count relative to mapped fields — suggests extensive org-specific customization for Caribbean property and insurance types.
- **Key Fields:** `Asset_Type__c`, `Amount_Financed__c`, `Guarantee_Amount__c`, `Forced_Sale_Value_Calculated__c`, `Age__c`.

#### Fee (Fee__c)
- **Business Role:** Fee calculations. Mostly internal computation fields.
- **Integration Pattern:** Only totals and specific fee types (administration fee, stamp duty) map to external systems. Most fields are intermediate calculations.
- **Key Fields:** `Administration_Fee__c`, `Fee_Amount__c`, `Fee_Percent__c`, `Total_Fee_Amount__c`, `Monthly_Premium__c`.

#### Credit Risk Assessment (CRA)
- **Business Role:** Narrative risk analysis. Almost entirely rich-text (textarea 32768) fields with no direct external system equivalent.
- **Integration Pattern:** Minimal mapping to external systems. These fields capture qualitative analysis that doesn't exist in core banking XML formats.

#### BranchUnit
- **Business Role:** Reference object for bank branches.
- **Key Fields:** BranchCode, BranchManagerId, AccountId (parent account relationship).
- **Integration Pattern:** Branch codes and names replicate across Loan, Financial Account, and Loan Package objects.

---

## Field Suffix Convention Guide

| Suffix | Meaning | Example |
|---|---|---|
| `__c` | Custom field (account-level or org-wide) | `Total_Assets__c` |
| `__pc` | Person Account field (individual customers only) | `Age__pc`, `FinServ__Citizenship__pc` |
| `FinServ__*__c` | FSC managed package standard field | `FinServ__Balance__c` |
| `FinServ__*__pc` | FSC managed package person account field | `FinServ__Age__pc` |
| No suffix | Standard Salesforce field | `Phone`, `BillingStreet`, `AccountNumber` |
| `__r` | Relationship reference (not a data field) | `Account__r.Name` |

---

## Common Data Flow Patterns in FSC Banking

### Loan Origination Flow
1. Account created/updated (KYC, demographics)
2. Loan Package created (aggregated submission)
3. Loan(s) created within package (individual facilities)
4. Party Involved in Transaction records created (borrower links)
5. Party Liabilities captured (existing debts)
6. Collateral linked
7. Fee calculations run
8. Credit Risk Assessment completed
9. Approval workflow executes
10. Upon approval: Loan data "boarded" to core banking → Financial Account created

### Pre-Boarding vs Post-Boarding Field Targets

| Concept | Pre-Boarding Target | Post-Boarding Target |
|---|---|---|
| Interest Rate | Loan__c.AnnualInterestRate__c | FinServ__FinancialAccount__c.FinServ__InterestRate__c |
| Balance | Loan__c (calculated) | FinServ__FinancialAccount__c.FinServ__Balance__c |
| Maturity Date | Loan__c.MaturityDate__c | FinServ__FinancialAccount__c.FinServ__LoanEndDate__c |
| Application Date | Loan__c.Application_Date__c | FinServ__FinancialAccount__c.FinServ__ApplicationDate__c |
| Escrow | Loan__c.Escrow_Balance__c | FinServ__FinancialAccount__c.Escrow_Amount__c |
| Secured Amount | Loan__c (via Collateral) | FinServ__FinancialAccount__c.Secured_Amount__c |
| Payment Amount | Loan__c.Scheduled_Payment__c | FinServ__FinancialAccount__c.FinServ__PaymentAmount__c |
