# Caribbean / LATAM Banking Domain Glossary

## Banking Terminology

| Term | Meaning | Integration Impact |
|---|---|---|
| **Hire Purchase (HP)** | Caribbean term for installment lending, especially vehicles/equipment. Equivalent to "installment loan" in US banking. | XML: `AMT_TOTAL_HP_MO_PAYMENTS`. SF: `Preclosing_Hire_Purchase_Monthly__c` |
| **Boarding** | The process of posting an approved loan into the core banking system. Jack Henry-specific terminology. | XML: `DATE_BOARDING`. SF: `Inserted_In_Core__c` |
| **BOSL** | Bank of Saint Lucia. Used as prefix/qualifier in system fields to mean "with this bank" or "internal exposure." | XML: `AMT_TOTAL_BOSL` = total debt with us. `AMT_TOTAL_BSL_*` variants. |
| **CIF** | Customer Information File. The core banking system's unique customer identifier. Every customer has a CIF number. | XML: `CIF_NUMBER`. SF: `Account_CIF__c` (formula/calculated). Critical integration key. |
| **Blanket Insurance** | Bank-provided insurance product that covers the entire loan, often mandatory for unsecured lending. | XML: `AMT_MO_BLANKET_PREMIUM`. SF: `Total_Blanket_Insurance_Fee_Amount__c`, `Total_Credit_Insurance_Premium__c` |
| **BS Code** | Banking Sector classification code used for regulatory reporting to ECCB. | XML: `CODE_NEW_BS`. SF: `BS_1_Code__pc` |
| **Forced Sale Value** | Estimated value of collateral if sold under distressed/forced conditions. Typically 60-80% of market value. | XML: `AMT_TOTAL_FORCE_XVALUE`. SF: `Forced_Sale_Value_Calculated__c` |
| **Pronote** | Promissory note. A legal document where borrower promises to repay. | SF: `Add_Pronote__c` on Fee object |
| **Credit Life** | Life insurance tied to the loan that pays off the balance if the borrower dies. Mandatory in many Caribbean jurisdictions. | XML: `AMT_CREDIT_LIFE`. SF: `Credit_Life_Amount__c`, `Credit_Life_Monthly_Premium__c` |
| **Standing Order** | Automatic recurring payment instruction. Caribbean equivalent of US autopay/ACH. | XML: `Y_STANDING_ORDER`. SF: `Standing_Order_to_Pay_US_Maintained_Acct__pc` |

## Regulatory Framework

### ECCB (Eastern Caribbean Central Bank)
- **Jurisdiction:** OECS member states — Antigua, Dominica, Grenada, Saint Kitts, Saint Lucia, Saint Vincent, Montserrat, Anguilla
- **Currency:** Eastern Caribbean Dollar (XCD)
- **Relevance:** Banking sector classification codes, prudential reporting requirements, loan classification standards
- **XML Fields:** `CODE_ECCB` (maps to `ECCB_1_Code__c`, `ECCB_2_Code__c` — primary and secondary classification)
- **BS Codes:** Banking sector codes used in ECCB regulatory returns (`CODE_NEW_BS` → `BS_1_Code__pc`)

### FATCA / CRS
- **FATCA:** Foreign Account Tax Compliance Act (US). Requires foreign financial institutions to report US persons' accounts to IRS.
- **CRS:** Common Reporting Standard (OECD). Broader than FATCA — requires automatic exchange of financial account information between participating countries.
- **Caribbean Impact:** All Caribbean banks must identify US persons and CRS-reportable accounts. Saint Lucia is a CRS-participating jurisdiction.
- **XML Fields:** `Y_FATCA_PERSON` → SF: `US_CRS__c`. The SF field uses the broader CRS terminology.
- **Related Fields:** `Y_US_STAY_` → `Stayed_in_US_for_183_days_this_year__pc` (183-day substantial presence test for US tax residency)

### KYC / AML
- **Due Diligence:** Caribbean AML regulations require Customer Due Diligence (CDD) and Enhanced Due Diligence (EDD) for higher-risk customers.
- **Exemptions:** Certain customer categories may be exempt from full due diligence (`Y_EXEMPT_DUE_DILIGENCE` → `Exempt_from_Due_Dilligence__pc`)
- **Entity Types:** `CODE_ENTITY_TYPE` classifies customers as Individual, Joint, Corporate, Trust, etc. Maps to multiple SF fields due to legacy duplication.

### Risk Rating
- **ECCB Risk Classification:** Banks must classify loans by risk category for provisioning.
- **XML Fields:** `CODE_RISK_RATING` → `Risk_Code__c` + `Risk_Code_Number__c` (both a category code and numeric score)
- **Watch List:** `CODE_WATCH_LIST` → `Watchlist_Category__c` (loans requiring special monitoring)

## System-Specific Conventions

### Jack Henry / RiskClam XML
- **Flat structure:** All fields are siblings under section nodes. No nesting. Contrasts with Salesforce's relational model.
- **Section hierarchy:** LOAN (top-level) → LOAN.DEBT, LOAN.SIGNER, LOAN.DECLARATIONS, LOAN.GROUP, LOAN.PRODUCT.RISK, LOAN.INCOME, LOAN.PRI
- **Aggregation at source:** `AMT_TOTAL_*` fields are pre-calculated totals. In SF, these are often roll-up summaries or formula fields.
- **Paired fields:** CODE_* + DESC_* pairs (e.g., CODE_LOAN_TYPE + DESC_LOAN_TYPE). Code = system value, Desc = human label. SF picklist handles both.
- **Boolean convention:** Y_* fields use Y/N text values. SF uses true/false boolean.
- **Empty tags:** `<FIELD_NAME></FIELD_NAME>` means the field exists but has no value. Not the same as the field being absent.

### Salesforce FSC for Caribbean Banking
- **Person Accounts required:** Individual customers use Person Account record type. `__pc` suffix fields only available on person accounts.
- **Multi-currency:** Caribbean implementations often handle XCD (EC Dollar) and USD. `CODE_CURRENCY` / `Foreign_Currency_Code__c` tracks per-loan currency.
- **Branch-centric:** Caribbean banks are heavily branch-oriented. Branch codes and names replicate across multiple objects (Account, Loan, Financial Account, Loan Package).
- **Dual-field patterns:** Legacy implementations often have the same data stored in multiple custom fields created at different times by different teams (e.g., 3 separate "total payoff amount" fields on Loans).

## Common Integration Pitfalls

1. **CIF as integration key:** CIF_NUMBER is the critical link between Salesforce and core banking. It's often a calculated field in SF (`Account_CIF__c`) derived from Account external ID. Ensure bidirectional sync.

2. **Branch code proliferation:** The same branch appears as a code (NBR_CLOSING_BRANCH), name (NAME_CLOSING_BRANCH), and manager (NAME_BRANCH_MGR) in XML. In SF, these may be separate fields on separate objects or a single lookup to BranchUnit.

3. **Approval vs Current values:** Many financial metrics exist in both "approved" and "current" versions (e.g., `Approved_Debt_to_Income__c` vs `Current_Debt_to_Income__c`). The XML may have both or only one. Mapping must distinguish lifecycle stage.

4. **Person Account vs Account fields:** The same concept may have both `__c` and `__pc` versions (e.g., `Place_of_Birth__c` and `Place_of_Birth__pc`). The XML has only one value. Determine which SF field is authoritative.

5. **Formula fields as targets:** Many SF fields are calculated (formulas, roll-ups). These cannot receive inbound data. Map the source component fields instead and let SF compute the formula.

6. **Picklist value translation:** XML CODE_ values are numeric/alphanumeric. SF picklists use text labels. A translation matrix (mapping table or custom metadata type) is required for every picklist mapping.
