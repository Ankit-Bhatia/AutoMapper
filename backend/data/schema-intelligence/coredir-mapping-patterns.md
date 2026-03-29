# Confirmed Mapping Patterns — CoreDirector ↔ Salesforce FSC

Source: Jack Henry CoreDirector implementations.
Purpose: companion corpus for section-prefixed CoreDirector schemas (`CUST_`, `CIF_`, `LOAN_`, `ACCT_`, `COL_`, `EMPL_`, `LIAB_`).

---

## CoreDirector Field Naming Conventions

CoreDirector source schemas use business-section prefixes rather than BOSL/RiskClam type prefixes.

| Prefix | Meaning | Typical FSC landing area |
|---|---|---|
| `CIF_`, `CUST_` | customer / demographic | `Account` (person account fields where applicable) |
| `ADDR_` | address fragments | `Account` billing or mailing fields |
| `EMPL_` | employment and income | `Account`, `PIT` |
| `LOAN_` | loan account servicing and origination | `FinancialAccount`, `Loan` |
| `ACCT_`, `DEP_` | deposit / general account servicing | `FinancialAccount` |
| `COL_`, `COLL_` | collateral | `Collateral` |
| `LIAB_` | liabilities held elsewhere | `PartyLiabilities` |

---

## Customer / CIF Mappings

| CoreDirector Field | FSC Target | Object | Notes |
|---|---|---|---|
| `CIF_NBR` | `AccountNumber` | `Account` | Core banking CIF number = SF `AccountNumber` |
| `CUST_LAST_NAME` | `LastName` | `Account` | Direct person-account name mapping |
| `CUST_FIRST_NAME` | `FirstName` | `Account` | Direct person-account name mapping |
| `CUST_MID_NAME` | `MiddleName` | `Account` | Middle name component |
| `CUST_FULL_NAME` | `Name` | `Account` | Full display name |
| `CUST_SUFFIX` | `Suffix__pc` | `Account` | Person-account suffix |
| `CUST_DOB`, `CUST_DATE_OF_BIRTH` | `PersonBirthdate` | `Account` | DOB = Date of Birth |
| `CUST_SSN`, `CUST_SSN_TIN` | `SIN_SSN__pc` | `Account` | PII / compliance-sensitive |
| `CUST_TYPE` | `FinServ__IndividualType__c` | `Account` | Picklist translation required |
| `CUST_MARITAL_STATUS` | `FinServ__MaritalStatus__pc` | `Account` | Picklist translation required |
| `CUST_EMAIL`, `CUST_EMAIL_ADDR` | `PersonEmail` | `Account` | Primary email |
| `CUST_HOME_PHONE` | `PersonHomePhone` | `Account` | Home phone |
| `CUST_WORK_PHONE` | `PersonOtherPhone` | `Account` | Work phone lands in `OtherPhone` |
| `CUST_CELL_PHONE` | `PersonMobilePhone` | `Account` | Mobile phone |
| `CUST_FAX` | `Fax` | `Account` | Fax number |

---

## Address Mappings

| CoreDirector Field | FSC Target | Object | Notes |
|---|---|---|---|
| `ADDR_LINE1` | `BillingStreet` | `Account` | Also candidates for person mailing fields; one-to-many review required |
| `ADDR_LINE2` | `BillingStreet` | `Account` | Append to line 1 with newline |
| `CUST_CITY` | `BillingCity` | `Account` | Direct match |
| `CUST_STATE` | `BillingState` | `Account` | Direct match |
| `CUST_ZIP`, `CUST_ZIP_CODE` | `BillingPostalCode` | `Account` | Direct match |
| `CUST_COUNTRY_CODE` | `BillingCountryCode` | `Account` | Country code |
| `CUST_COUNTRY` | `FinServ__CountryOfResidence__pc` | `Account` | Residence/citizenship context |

---

## Employment Mappings

| CoreDirector Field | FSC Target | Object | Notes |
|---|---|---|---|
| `EMPL_EMPLOYER_NAME` | `FinServ__Employer__pc` | `Account` | Employer name |
| `EMPL_STATUS` | `FinServ__EmploymentStatus__pc` | `Account` | Employment status |
| `EMPL_OCCUPATION` | `FinServ__Occupation__pc` | `Account` | Occupation title |
| `EMPL_ANNUAL_INCOME` | `Annual_Income__c` | `Account` | Annual household/personal income |
| `EMPL_MONTHLY_INCOME` | `Salary_Total_Monthly_Amount__c` | `PIT` | Monthly income often belongs on Party Involved in Transaction |
| `EMPL_YEARS` | `FinServ__YearsAtCurrentEmployer__pc` | `Account` | Tenure with employer |

---

## Loan Account Mappings

| CoreDirector Field | FSC Target | Object | Notes |
|---|---|---|---|
| `LOAN_NBR`, `LOAN_NUMBER` | `Loan_Number__c` | `Loan` | Loan identifier |
| `LOAN_BAL`, `LOAN_BALANCE` | `FinServ__Balance__c` | `FinancialAccount` | Post-boarding balance |
| `LOAN_PRIN_BAL` | `FinServ__PrincipalBalance__c` | `FinancialAccount` | Principal balance |
| `LOAN_ORIG_AMT`, `LOAN_ORIGINAL_AMT` | `FinServ__LoanAmount__c` | `FinancialAccount` | Origination amount |
| `LOAN_INT_RATE` | `FinServ__InterestRate__c` | `FinancialAccount` | One-to-many review: pre-boarding often routes to `AnnualInterestRate__c` on `Loan` |
| `LOAN_MAT_DT` | `FinServ__LoanEndDate__c` | `FinancialAccount` | One-to-many review: maturity is lifecycle-sensitive |
| `LOAN_PYMT_AMT` | `FinServ__PaymentAmount__c` | `FinancialAccount` | Scheduled payment amount |
| `LOAN_PYMT_FREQ` | `FinServ__PaymentFrequency__c` | `FinancialAccount` | Picklist translation required |
| `LOAN_STATUS` | `Account_Status__c` | `FinancialAccount` | Picklist translation required |
| `LOAN_BRANCH_NBR` | `FinServ__BranchCode__c` | `FinancialAccount` | One-to-many review when branch code vs branch name is ambiguous |
| `LOAN_OFFICER_NBR` | `OwnerId` | `FinancialAccount` | One-to-many review; requires number-to-user lookup resolution |
| `LOAN_BOARD_DT`, `LOAN_BOARDED_DT` | `Inserted_In_Core__c` | `Loan` | Same lifecycle challenge as BOSL `DATE_BOARDING` |
| `LOAN_APPRVL_DT`, `LOAN_APPROVAL_DT` | `Date_Credit_Approved__c` | `FinancialAccount` | Credit approval date |

---

## Deposit Account Mappings

| CoreDirector Field | FSC Target | Object | Notes |
|---|---|---|---|
| `ACCT_NBR`, `ACCT_NUMBER` | `FinServ__FinancialAccountNumber__c` | `FinancialAccount` | Deposit account number |
| `ACCT_BAL`, `ACCT_BALANCE` | `FinServ__Balance__c` | `FinancialAccount` | Current balance |
| `ACCT_AVAIL_BAL` | `FinServ__AvailableBalance__c` | `FinancialAccount` | Available balance |
| `ACCT_INT_RATE` | `FinServ__InterestRate__c` | `FinancialAccount` | Interest rate |
| `ACCT_OPEN_DT` | `FinServ__OpenDate__c` | `FinancialAccount` | Open date |
| `ACCT_CLOSE_DT` | `FinServ__CloseDate__c` | `FinancialAccount` | Close date |
| `ACCT_STATUS` | `Account_Status__c` | `FinancialAccount` | Picklist translation required |
| `ACCT_TYPE` | `FinServ__FinancialAccountType__c` | `FinancialAccount` | One-to-many review for product taxonomy and picklist translation |

---

## Collateral Mappings

| CoreDirector Field | FSC Target | Object | Notes |
|---|---|---|---|
| `COL_TYPE`, `COL_TYPE_CD` | `Asset_Type__c` | `Collateral` | Collateral type |
| `COL_VALUE`, `COL_APPRAISED_VALUE` | `Amount_Financed__c` | `Collateral` | Appraised/finance value |
| `COL_FORCED_VALUE` | `Forced_Sale_Value_Calculated__c` | `Collateral` | Forced-sale value |
| `COL_DESC` | `Name` | `Collateral` | Description collapses into the record name |
| `COL_LIEN_POS` | `Lien_Position__c` | `Collateral` | Lien position |

---

## Party Liabilities Mappings

| CoreDirector Field | FSC Target | Object | Notes |
|---|---|---|---|
| `LIAB_INSTITUTION` | `Institution_Bank_Held_c__c` | `PartyLiabilities` | Institution / bank name |
| `LIAB_BALANCE` | `Amount_Owed__c` | `PartyLiabilities` | Liability balance |
| `LIAB_MONTHLY_PYMT` | `Monthly_Payment_Amount__c` | `PartyLiabilities` | Monthly payment |
| `LIAB_ACCT_NBR` | `Account_Number__c` | `PartyLiabilities` | External liability account number |

---

## Picklist Translation Tables

### `LOAN_STATUS`
| CoreDirector | FSC |
|---|---|
| `A` | Active |
| `C` | Closed |
| `D` | Delinquent |
| `P` | Paid Off |
| `W` | Charged Off |
| `F` | Foreclosure |

### `ACCT_STATUS`
| CoreDirector | FSC |
|---|---|
| `A` | Active |
| `C` | Closed |
| `D` | Dormant |
| `F` | Frozen |
| `O` | Overdrawn |

### `ACCT_TYPE`
| CoreDirector | FSC |
|---|---|
| `CK` | Checking |
| `SV` | Savings |
| `CD` | Certificate of Deposit |
| `MM` | Money Market |
| `IRA` | IRA |

### `LOAN_PYMT_FREQ`
| CoreDirector | FSC |
|---|---|
| `M` | Monthly |
| `W` | Weekly |
| `B` | Bi-Weekly |
| `S` | Semi-Monthly |
| `Q` | Quarterly |
| `A` | Annually |

### `CUST_TYPE`
| CoreDirector | FSC |
|---|---|
| `I` | Individual |
| `B` | Business |
| `T` | Trust |
| `G` | Government |

### `CUST_MARITAL_STATUS`
| CoreDirector | FSC |
|---|---|
| `S` | Single |
| `M` | Married |
| `D` | Divorced |
| `W` | Widowed |
| `P` | Separated |

---

## One-to-Many Patterns

| CoreDirector Field | Why it routes |
|---|---|
| `ADDR_LINE1` | Billing vs person mailing address |
| `CUST_NAME` | Full name vs decomposed first/last name targets |
| `LOAN_MAT_DT` | Pre-boarding vs post-boarding maturity fields |
| `LOAN_INT_RATE` | `AnnualInterestRate__c` on `Loan` vs `FinServ__InterestRate__c` on `FinancialAccount` |
| `LOAN_OFFICER_NBR` | Officer number must resolve to a Salesforce user lookup |
| `LOAN_TYPE` | Product taxonomy differs between origination and boarding objects |
| `LOAN_BRANCH_NBR` | Branch code vs branch name / lookup resolution |
| `ACCT_TYPE` | Product-type translation and lifecycle-specific financial account typing |

---

## Pre-Boarding vs Post-Boarding

CoreDirector has the same lifecycle split as BOSL/RiskClam. Some fields are captured during origination on `Loan`, then represented after boarding on `FinancialAccount`.

The clearest CoreDirector example is `LOAN_BOARD_DT` / `LOAN_BOARDED_DT` → `Inserted_In_Core__c`.
Treat these as lifecycle-sensitive fields during routing and review rather than assuming a single immutable target.
