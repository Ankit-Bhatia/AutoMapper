# Sprint 1 — Codex Technical Spec

**Assigned to:** Codex  
**Written by:** Claude (PM / Tech Lead)  
**Sprint goal:** Make the standalone demo reliable end-to-end — connector selection → agent pipeline → export  
**Tickets:** AM-001, AM-002, AM-003

---

## Context

The standalone `AutoMapper-demo.html` (244KB) currently breaks at two points:

1. **Schema step** — `demo-server.mjs` Salesforce schema only returns 3 objects (Account, Contact, Opportunity). The frontend ConnectorGrid now shows 8 FSC objects. The gap means mapping suggestions are thin and the "Salesforce FSC" connector looks incomplete vs. what's advertised.

2. **Export step** — `ExportPanel.tsx` calls `GET /api/projects/:id/export?format=...` against the backend. In standalone demo mode there is no backend, so this call silently fails. The user hits a dead end.

---

## AM-001 — Expand demo-server.mjs with full FSC + SAP schemas

**File:** `demo-server.mjs`

### Salesforce schema — replace the current `'salesforce'` entry

The new schema must return **8 entities** with the fields listed below. Keep the existing Account/Contact/Opportunity fields; add the 5 new FSC objects.

#### New entities to add (with their required fields):

**FinancialAccount** (id variable: `faId`)
```
Id            string  isKey required
Name          string  required
FinancialAccountNumber  string
Status        picklist  ['Active','Inactive','Closed','Pending']
Balance       decimal   complianceTags: ['SOX_FINANCIAL']
Type          picklist  ['Checking','Savings','Loan','CD','Investment','LineOfCredit']
PrimaryOwnerId  string  (lookup to Account)
OpenDate      date
CloseDate     date
InterestRate  decimal
```

**IndividualApplication** (id variable: `iaId`)
```
Id            string  isKey required
Name          string  required
Status        picklist  ['Draft','Submitted','InReview','Approved','Declined','Withdrawn']
ProductType   picklist  ['Checking','Savings','Loan','CD','CreditCard','Mortgage']
RequestedAmount  decimal
ApplicantId   string  (lookup to Account)
SubmittedDate datetime
DecisionDate  date
```

**FinancialGoal** (id variable: `fgId`)
```
Id            string  isKey required
Name          string  required
Type          picklist  ['Retirement','Education','HomePurchase','Emergency','Vacation','Other']
TargetAmount  decimal
CurrentAmount decimal  complianceTags: ['SOX_FINANCIAL']
TargetDate    date
Status        picklist  ['OnTrack','AtRisk','Achieved','Abandoned']
OwnerId       string  (lookup to Account)
```

**AccountParticipant** (id variable: `apId`)
```
Id            string  isKey required
FinancialAccountId  string  required  (lookup to FinancialAccount)
AccountId     string  required  (lookup to Account)
Role          picklist  ['PrimaryOwner','JointOwner','Beneficiary','PowerOfAttorney','Trustee']
```

**PartyProfile** (id variable: `ppId`)
```
Id            string  isKey required
AccountId     string  required  (lookup to Account)
TaxId         string  complianceTags: ['GLBA_NPI']
DateOfBirth   date    complianceTags: ['GLBA_NPI']
MaritalStatus picklist  ['Single','Married','Divorced','Widowed']
EmploymentStatus  picklist  ['Employed','SelfEmployed','Retired','Unemployed','Student']
AnnualIncome  decimal  complianceTags: ['GLBA_NPI','SOX_FINANCIAL']
NetWorth      decimal  complianceTags: ['GLBA_NPI','SOX_FINANCIAL']
```

#### Relationships to add:
```js
{ fromEntityId: faId, toEntityId: accId, type: 'lookup', viaField: 'PrimaryOwnerId' }
{ fromEntityId: iaId, toEntityId: accId, type: 'lookup', viaField: 'ApplicantId' }
{ fromEntityId: fgId, toEntityId: accId, type: 'lookup', viaField: 'OwnerId' }
{ fromEntityId: apId, toEntityId: faId, type: 'lookup', viaField: 'FinancialAccountId' }
{ fromEntityId: apId, toEntityId: accId, type: 'lookup', viaField: 'AccountId' }
{ fromEntityId: ppId, toEntityId: accId, type: 'lookup', viaField: 'AccountId' }
```
(Keep the 2 existing Account/Contact/Opportunity relationships.)

### SAP schema — replace the current `'sap'` entry

The new schema must return **5 entities**.

Keep the existing BusinessPartner and GLAccount entities with their fields.

#### New entities to add:

**Customer** (id variable: `custId`)
```
KUNNR   string  isKey required  label:'Customer Number'
NAME1   string  required        label:'Customer Name'
LAND1   string                  label:'Country'
WAERS   string                  label:'Currency'
KDGRP   string                  label:'Customer Group'  complianceTags:['FFIEC_AUDIT']
KLIMK   decimal                 label:'Credit Limit'    complianceTags:['SOX_FINANCIAL']
```

**Supplier** (id variable: `suppId`)
```
LIFNR   string  isKey required  label:'Supplier Number'
NAME1   string  required        label:'Supplier Name'
LAND1   string                  label:'Country'
WAERS   string                  label:'Currency'
ZTERM   string                  label:'Payment Terms'
BANKS   string                  label:'Bank Key'         complianceTags:['PCI_CARD']
```

**CostCenter** (id variable: `ccId`)
```
KOSTL   string  isKey required  label:'Cost Center'
KTEXT   string  required        label:'Cost Center Name'
BUKRS   string                  label:'Company Code'    complianceTags:['SOX_FINANCIAL']
KOSAR   string                  label:'Cost Center Category'
DATAB   date                    label:'Valid From'
DATBI   date                    label:'Valid To'
```

---

## AM-002 — Deterministic mapping suggestions in demo-server.mjs

**File:** `demo-server.mjs`

**Problem:** The current mapping engine in `suggestMappings` (around line 376) iterates all source×target entity pairs and calls a generic string-similarity function. It produces random-quality suggestions that don't reflect the domain expertise AutoMapper claims to have.

**Requirement:** When source is `jackhenry-silverlake` and target is `salesforce`, the `POST /api/projects/:id/suggest-mappings` endpoint must return the **exact entity and field mappings** defined in `frontend/src/api/mockData.ts`. This is the canonical "hero demo" path.

### Implementation approach

Add a `CANONICAL_MAPPINGS` constant at the top of demo-server.mjs that maps `"sourceConnectorId→targetConnectorId"` to a function that generates the mapping suggestions using the live UUIDs for the project's entities and fields.

**Logic:**
1. At suggest-mappings time, look up the project to get sourceSystemId and targetSystemId
2. Look up the schemas stored for both systems
3. Build a lookup: `entityName → entity object` and `fieldName → field object` for both sides
4. For the canonical `silverlake→salesforce` path, emit the 6 entity mappings and 33 field mappings from mockData.ts, resolved against the live UUIDs from step 3
5. For all other paths, keep the existing heuristic engine as fallback

**The 6 entity mappings (from mockData.ts):**
```
CIF           → Account         confidence: 0.94
CIF           → Contact         confidence: 0.89
DDA           → FinancialAccount confidence: 0.87
DDA           → Account         confidence: 0.71
LoanAccount   → Opportunity     confidence: 0.74
LoanAccount   → FinancialAccount confidence: 0.82
```

**Key field mappings to include (representative set — include all 33 from mockData.ts):**
```
CIF.TaxId           → Account.Name            confidence: 0.71
CIF.LastName        → Account.Name            confidence: 0.91
CIF.FirstName       → Contact.FirstName       confidence: 0.97
CIF.LastName        → Contact.LastName        confidence: 0.97
CIF.EmailAddr       → Contact.Email           confidence: 0.95
CIF.PhoneNum        → Contact.Phone           confidence: 0.93
CIF.TaxId           → PartyProfile.TaxId      confidence: 0.98  complianceTags:['GLBA_NPI']
CIF.BirthDt         → PartyProfile.DateOfBirth confidence:0.97  complianceTags:['GLBA_NPI']
DDA.AcctNum         → FinancialAccount.FinancialAccountNumber  confidence: 0.96
DDA.CurBal          → FinancialAccount.Balance confidence: 0.95 complianceTags:['SOX_FINANCIAL']
DDA.AcctType        → FinancialAccount.Type   confidence: 0.82
LoanAccount.LoanNum → Opportunity.Name        confidence: 0.88
LoanAccount.OrigAmt → Opportunity.Amount      confidence: 0.91
LoanAccount.MaturityDt → Opportunity.CloseDate confidence: 0.78
LoanAccount.LoanNum → FinancialAccount.FinancialAccountNumber  confidence: 0.92
LoanAccount.CurBal  → FinancialAccount.Balance confidence: 0.89 complianceTags:['SOX_FINANCIAL']
LoanAccount.Rate    → FinancialAccount.InterestRate  confidence: 0.95
```

Each field mapping must include:
- `id`: new UUID
- `entityMappingId`: reference to the correct entity mapping
- `sourceFieldId`: looked up from live schema
- `targetFieldId`: looked up from live schema
- `confidence`: as listed
- `status`: `'pending'`
- `transform`: `{ type: 'direct', config: {} }`
- `rationale`: brief string (e.g., `"ISO 20022 BirthDate matches Salesforce FSC DateOfBirth"`)
- `complianceTags`: as listed (where applicable)

---

## AM-003 — Client-side export in standalone demo mode

**File:** `frontend/src/components/ExportPanel.tsx`

**Problem:** ExportPanel calls `GET /api/projects/:id/export?format=...` which fails in standalone mode (no backend). The user gets a broken "Export" step with no error message.

**Requirement:** In `STANDALONE` mode (`import.meta.env.VITE_STANDALONE === 'true'`), ExportPanel must generate the export artifact **entirely client-side** from the in-memory mapping data passed in as props.

### Props to add to ExportPanel

```typescript
interface ExportPanelProps {
  projectId: string;
  project?: { name?: string };
  // --- new ---
  standalone?: boolean;
  fieldMappings?: FieldMapping[];   // from MappingTable accepted mappings
  entityMappings?: EntityMapping[];
  sourceEntities?: Entity[];
  targetEntities?: Entity[];
}
```

### Client-side generators (implement in ExportPanel.tsx or a new `src/api/exporters.ts`)

**JSON export** (already straightforward):
```typescript
function generateJson(data: ExportData): string {
  return JSON.stringify({
    version: '1.0',
    generatedAt: new Date().toISOString(),
    entityMappings: data.entityMappings,
    fieldMappings: data.fieldMappings.filter(fm => fm.status === 'accepted'),
  }, null, 2);
}
```

**CSV export:**
Headers: `sourceEntity,sourceField,targetEntity,targetField,confidence,transform,status,rationale`
One row per accepted field mapping.

**YAML export:**
Same structure as JSON but formatted as YAML (use a minimal serializer — no external library; just recursive key: value indentation — or use `JSON.stringify` with custom replacer since the demo doesn't need a full YAML lib).

**DataWeave export:**
```
%dw 2.0
output application/json
---
{
  // one comment block per entity mapping
  // CIF → Account
  name: payload.LastName ++ ", " ++ payload.FirstName,
  // DDA → FinancialAccount
  financialAccountNumber: payload.AcctNum,
  ...
}
```
Generate the `//` comment headers from entity mapping names, and one field line per accepted field mapping using `payload.{sourceFieldName}`.

**Boomi / Workato:** Can be simplified JSON structures for the demo — just needs to look credible. Example Boomi structure:
```json
{
  "boomi_component_type": "DataMap",
  "source_profile": "SilverLake_CIF",
  "target_profile": "Salesforce_Account",
  "mappings": [ { "from": "LastName", "to": "Name", "function": "direct" } ]
}
```

### Download behaviour (unchanged)
Use the same blob + `URL.createObjectURL` + anchor click pattern already in ExportPanel.tsx.

### Error handling
If `standalone` is true and no `fieldMappings` are provided, show an inline error: `"No accepted mappings to export. Go back and accept at least one mapping."`.

---

## Acceptance Criteria (all 3 tickets)

### AM-001
- [ ] `POST /api/connectors/salesforce/schema` returns 8 entities (Account, Contact, Opportunity, FinancialAccount, IndividualApplication, FinancialGoal, AccountParticipant, PartyProfile)
- [ ] `POST /api/connectors/sap/schema` returns 5 entities (BusinessPartner, Customer, Supplier, GLAccount, CostCenter)
- [ ] All new fields include correct `complianceTags` arrays
- [ ] All new relationships present in response

### AM-002
- [ ] `POST /api/projects/:id/suggest-mappings` when source=silverlake, target=salesforce returns exactly 6 entity mappings
- [ ] Returns at least 17 field mappings (all from the spec above)
- [ ] Each field mapping has `confidence`, `rationale`, `transform`, `status: 'pending'`
- [ ] For other connector pairs, heuristic engine still runs

### AM-003
- [ ] In STANDALONE mode, clicking any export format in ExportPanel downloads a non-empty file
- [ ] JSON format produces valid JSON with `version`, `generatedAt`, `fieldMappings`
- [ ] CSV format has correct column headers and one row per accepted mapping
- [ ] DataWeave format starts with `%dw 2.0`
- [ ] No console errors during export

---

## How to deliver

1. Implement AM-001 and AM-002 in `demo-server.mjs`
2. Implement AM-003 in `frontend/src/components/ExportPanel.tsx` (and optionally a new `frontend/src/api/exporters.ts`)
3. Rebuild the standalone demo: run the build + Python post-processing script from README.md
4. Log changes: `npm run log:codex -- --summary "Sprint 1: AM-001 AM-002 AM-003 — full FSC schemas, canonical mappings, client-side export" --files "demo-server.mjs,frontend/src/components/ExportPanel.tsx,AutoMapper-demo.html"`

**Do not change:** `frontend/src/api/mockData.ts`, `ConnectorGrid.tsx`, `styles.css`, `README.md` — these are owned by Claude this sprint.

