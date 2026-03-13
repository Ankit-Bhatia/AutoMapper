# Confirmed Mapping Patterns — FSC ↔ Jack Henry / RiskClam

Source: BOSL (Bank of Saint Lucia / First National Bank) implementation.
Total confirmed mappings: 212 field-level mappings across 10 Salesforce objects.

---

## Amount Mappings (AMT_* → currency fields)

### Direct Matches (High Confidence)
| XML Field | SF API Name | SF Object | Notes |
|---|---|---|---|
| AMT_NET_WORTH | FinServ__NetWorth__c | Account | FSC standard |
| AMT_TOTAL_ASSETS | Total_Assets__c | Account | Direct match |
| AMT_TOTAL_LIABILITIES | Total_Liabilities__c | Account, PIT | Exists on both objects |
| AMT_REAL_ESTATE | Real_State__c | Account | Note: SF has typo "State" |
| AMT_STOCKS | Stock_Bonds__c | Account | Stocks includes bonds |
| AMT_UNPAID_TAXES | Unpaid_Taxes__c | Account | Direct match |
| AMT_CREDIT_LIFE | Credit_Life_Amount__c | Financial Account | Insurance amount |
| AMT_ESCROW | Escrow_Amount__c / Escrow_Balance__c | FA / Loans | Different objects by lifecycle |
| AMT_PAST_DUE | Amount_Past_Due__c | Financial Account | Direct match |
| AMT_CURRENT_BALANCE | FinServ__Balance__c | Financial Account | FSC standard field |
| AMT_ORIGINAL_BALANCE | FinServ__LoanAmount__c | Financial Account | Also Original_Amount__c, Original_Loan_Amount__c |
| AMT_PAYMENT | FinServ__PaymentAmount__c | Financial Account | Also Monthly_Payment__c |
| AMT_SECURED | Secured_Amount__c | Financial Account | Individual account |
| AMT_LIMIT | Credit_Card_3_Limit__c / Credit_Limit__c | FA / Loans | Object depends on product |
| AMT_TOTAL_FEE | Total_Fee_Amount__c / totalFeeToPaid__c | Loans / FEE | |
| AMT_TOTAL_INTEREST | Total_Interest__c | Loans | |
| AMT_TOTAL_PREMIUM | Total_Credit_Life_Premium__c / Monthly_Premium__c | Loans / FEE | |
| AMT_FINANCED | Amount_Financed__c | Collateral | |
| AMT_GUARANTEES | Guarantee_Amount__c | Collateral | |

### Semantic Matches (Medium Confidence — Domain Knowledge Required)
| XML Field | SF API Name | SF Object | Why Non-Obvious |
|---|---|---|---|
| AMT_TOTAL_BOSL | Total_Debt_With_Us__c | Loan Package | BOSL = Bank of Saint Lucia = "with us" |
| AMT_TOTAL_CURRENT_BALANCE | Total_Package_Debt__c | Loan Package | "Current balance" = total package debt |
| AMT_TOTAL_DEBT_PAYOFF | Loan_Payoff_Amount__c | Loans | Also: Total_Pay_Off_Amount__c, Total_Payoff_Amount__c (3 targets!) |
| AMT_TOTAL_DISBURSEMENTS | Disbursement_Amount__c | Loans | Plural to singular |
| AMT_TOTAL_EXISTING_DEBT | Current_Balance_of_Existing_Debt__c | Loan Package | "Existing" = "current balance of existing" |
| AMT_TOTAL_HP_MO_PAYMENTS | Preclosing_Hire_Purchase_Monthly__c | PIT | HP = Hire Purchase (Caribbean lending term) |
| AMT_TOTAL_PAR_BSL_INDIRECT | Total_Amount_of_our_Indirect_Loans__c | PIT | PAR_BSL = bank-specific indirect |
| AMT_MO_RESIDUAL_INCOME | Residual_Income__c | PIT | Monthly residual income |
| AMT_APPROVED_LOAN | Loan_Amount_formula__c | Loans | Approved amount is a formula field! |
| AMT_TO_BE_DISBURSED | Amount_to_be_Posted__c | Loans | "Disbursed" = "posted" |
| AMT_TOTAL_FORCE_XVALUE | Forced_Sale_Value_Calculated__c | Collateral | FORCE_XVALUE = forced sale cross value |
| AMT_OVERDRAFT_ACCTS | Existing_Overdrafts__c | Loan Package | |
| CUSTOMER_AUS_MESSAGE | Core_Error_Message__c | Loans | AUS = Automated Underwriting System |

---

## Percentage Mappings (PERC_* → percent fields)

| XML Field | SF API Name | SF Object | Notes |
|---|---|---|---|
| PERC_INTEREST | FinServ__InterestRate__c / AnnualInterestRate__c | FA / Loans | Lifecycle-dependent |
| PERC_LTV | Loan_to_Value_Ratio__c / Combined_LTV__c | Loans / LP | Individual vs combined |
| PERC_DI_CURRENT | Current_Debt_to_Income__c | PIT | DI = Debt to Income |
| PERC_INC_EXP_CURRENT | Current_Expense_to_Income_Formula__c | PIT | INC_EXP = Income/Expense |
| PERC_RESIDUAL_CURRENT | Current_Budgetary_Residual_Income__c | PIT | |
| PERC_DEFAULT_INTEREST | Default_Rate__c | Loans | |
| PERC_LOAN_VARIABLE_RATE | Loan_Variable_Rate__c | Loans | |
| PERC_FEE | Fee_Percent__c | FEE | |

---

## Code Mappings (CODE_* → picklist fields)

**Important:** CODE fields require a value translation matrix. The XML numeric/alpha code must be translated to the Salesforce picklist value.

| XML Field | SF API Name | SF Object | Notes |
|---|---|---|---|
| CODE_ENTITY_TYPE | Entity_Type__c + 3 variants | Account | 4 target fields (legacy duplication) |
| CODE_COUNTRY | BillingCountryCode / PersonMailingCountryCode | Account | ISO country codes |
| CODE_ECCB | ECCB_1_Code__c / ECCB_2_Code__c | Account | Eastern Caribbean Central Bank |
| CODE_NEW_BS | BS_1_Code__pc | Account | Banking Sector classification |
| CODE_STATUS | Account_Status__c | Financial Account | |
| CODE_CLOSING_BRANCH | FinServ__BranchCode__c | Financial Account | |
| CODE_GL | GL_Code__c | Financial Account | General Ledger |
| CODE_LOAN_TYPE | General_Ledger_Code__c / Type_Code__c | Loans | GL-based type |
| CODE_CURRENCY | Currency__c / Foreign_Currency_Code__c | Loans | |
| CODE_RISK_RATING | Risk_Code__c / Risk_Code_Number__c | Loans | Code + numeric |
| CODE_PROD_CLASSIFICATION | Classification__c | Loans | |
| CODE_WATCH_LIST | Watchlist_Category__c | Loans | |
| CODE_DISBURSEMENT_TYPE | Disbursement_Type__c | Loans | |
| CODE_TYPE_OF_SALE | Type_of_Sale__c | Loans | |
| CODE_LOAN_VARIABLE_RATE | Loan_Variable_Rate_Code__c | Loans | |
| CODE_ATTORNEYS | Attorney_Code__c | Account | |

---

## Date Mappings (DATE_* → date/datetime fields)

| XML Field | SF API Name | SF Object | Notes |
|---|---|---|---|
| DATE_APPLICATION | Application_Date__c / FinServ__ApplicationDate__c | Loans / FA | Also maps to CreatedDate on Loans |
| DATE_APPROVAL | Date_Credit_Approved__c | FA / Loans | Same field name, two objects |
| DATE_CLOSING | FinServ__CloseDate__c / Closing_Date__c | FA / Loans | |
| DATE_FUNDED | Date_Funded__c | Loans | |
| DATE_MATURITY | MaturityDate__c / FinServ__LoanEndDate__c / End_Date__c | Loans / FA | 3 targets |
| DATE_OPEN | FinServ__OpenDate__c | Financial Account | |
| DATE_BOARDING | Inserted_In_Core__c | Loans | Boarding = core banking posting |
| DATE_INTEREST_START | InterestStartDate__c | Loans | |
| DATE_PAYMENT_START | PaymentStartDate__c | Loans | |
| DATE_SCHEDULED_CLOSING | Expected_Disbursement_Date__c | Loans | Scheduled closing = expected disbursement |
| DATE_LAST_UPDATE | FinServ__LastReview__c / FinServ__LastUpdated__c / LastModifiedDate / Last_Updated_Amount_Time__c | Acct / FA / Loans | 4 targets across 3 objects |
| DATE_NEXT_REVIEW | FinServ__NextReview__c | Account | |
| DATE_APPLIED | CreatedDate | Loan Package | Application date = creation date |

---

## Name Mappings (NAME_* → text/lookup fields)

**Important:** NAME fields in XML contain text strings. Salesforce uses lookup relationships to User records. A name-to-ID resolution process is required.

| XML Field | SF API Name | SF Object | Notes |
|---|---|---|---|
| NAME_ALL_BORROWERS | Account__c / Name | PIT | Lookup to Account |
| NAME_ORIGINATING_BRANCH | FinServ__BranchName__c / Originating_Unit__c / Originating_Branch__c | Acct / Loans / LP | 3 objects |
| NAME_CLOSING_BRANCH | FinServ__BranchName__c / Closing_Unit__c / Closing_Branch__c | FA / Loans / LP | 3 objects |
| NAME_CREDIT_OFFICER | ApprovalOfficer__c | Loan Package | User lookup |
| NAME_ORIGINATOR | CreatedById / Originator__c | Loans / LP | System user vs custom field |
| NAME_UNDERWRITER | Underwriter__c | Loan Package | User lookup |
| NAME_ATTORNEYS | Attorney_Contact__c | Collateral | Contact lookup |
| NAME_SUFFIX | Suffix__pc | Account | Person account text |

---

## Boolean Mappings (Y_* → boolean/checkbox fields)

| XML Field | SF API Name | SF Object | Notes |
|---|---|---|---|
| Y_FATCA_PERSON | US_CRS__c | Account | FATCA → CRS terminology |
| Y_EXEMPT_DUE_DILIGENCE | Exempt_from_Due_Dilligence__pc | Account | Note: typo in SF field name |
| Y_STANDING_ORDER | Standing_Order_to_Pay_US_Maintained_Acct__pc | Account | Long descriptive name |
| Y_US_STAY_ | Stayed_in_US_for_183_days_this_year__pc | Account | 183-day substantial presence test |
| Y_INSURED | Insured__c / Disability_Insured__c / Medical_Approval__c | PIT | 1 flag → 3 insurance types |
| Y_FINANCE_INSURANCE | Insurance_Company_Name__c | Loans | Boolean maps to text field! |

---

## One-to-Many Patterns (Critical — Always Flag)

These XML fields map to multiple Salesforce fields. Human decision required for routing:

| XML Field | # SF Targets | Objects | Routing Logic |
|---|---|---|---|
| ADDRESS | 7 | Account | Splits into compound address components |
| AMT_FEE | 4 | FA, FEE | Routes by fee type (commitment, stamp duty, admin, general) |
| CODE_ENTITY_TYPE | 4 | Account | Legacy field duplication — pick primary, deprecate others |
| DATE_LAST_UPDATE | 4 | Acct, FA, Loans | Each object tracks its own update timestamp |
| AMT_ORIGINAL_BALANCE | 3 | FA | FSC standard + 2 custom fields — pick one, deprecate |
| AMT_PAYMENT | 3 | FA, Loans | Lifecycle-dependent routing |
| AMT_TOTAL_DEBT_PAYOFF | 3 | Loans | 3 near-identical custom fields — likely created by different teams |
| AMT_TOTAL_LIABILITIES | 3 | Acct, PIT | Account-level vs party-level totals |
| DATE_MATURITY | 3 | FA, Loans | Standard + custom + FSC standard |
| NAME_CLOSING_BRANCH | 3 | FA, Loans, LP | Branch name replicated per object |
| NAME_ORIGINATING_BRANCH | 3 | Acct, Loans, LP | Same pattern |
| TITLE | 3 | Account | Person account + account + standard |
| Y_INSURED | 3 | PIT | Single flag → 3 insurance types |
