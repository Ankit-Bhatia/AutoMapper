# Auto Mapper Phase 1 API Contract

This contract is frozen for parallel frontend work.
Base URL: `http://localhost:4000`

## Error Response Shape (all non-2xx)

```json
{
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "Project not found",
    "details": null
  }
}
```

- `code`: stable machine-readable code
- `message`: human-readable message
- `details`: optional object/string/null

## 1) Create Project

`POST /api/projects`

Request:
```json
{
  "name": "SAP to Salesforce Demo"
}
```

Response `201`:
```json
{
  "project": {
    "id": "proj_demo_001",
    "name": "SAP to Salesforce Demo",
    "sourceSystemId": "sys_sap_001",
    "targetSystemId": "sys_sf_001",
    "createdAt": "2026-02-20T10:00:00.000Z",
    "updatedAt": "2026-02-20T10:00:00.000Z"
  }
}
```

## 2) Get Project Snapshot

`GET /api/projects/:id`

Response `200`:
```json
{
  "project": { "id": "proj_demo_001", "name": "SAP to Salesforce Demo", "sourceSystemId": "sys_sap_001", "targetSystemId": "sys_sf_001", "createdAt": "2026-02-20T10:00:00.000Z", "updatedAt": "2026-02-20T10:05:00.000Z" },
  "systems": [
    { "id": "sys_sap_001", "name": "SAP", "type": "sap" },
    { "id": "sys_sf_001", "name": "Salesforce", "type": "salesforce" }
  ],
  "sourceEntities": [],
  "targetEntities": [],
  "fields": [],
  "relationships": [],
  "entityMappings": [],
  "fieldMappings": []
}
```

## 3) Upload Source Schema (SAP)

`POST /api/projects/:id/source-schema` (multipart form-data, key: `file`)

Supported file types:
- `.json` (custom schema format)
- `.xml` (OData metadata)
- `.csv` (entity/field rows)

Response `200`:
```json
{
  "entities": [
    { "id": "ent_sap_customer", "systemId": "sys_sap_001", "name": "SAP.Customer", "label": "Customer Master" }
  ],
  "fields": [
    { "id": "fld_sap_customer_number", "entityId": "ent_sap_customer", "name": "CustomerNumber", "dataType": "string", "required": true, "isKey": true }
  ],
  "relationships": [],
  "message": "SAP schema ingested"
}
```

## 4) Load Target Schema (Salesforce)

`POST /api/projects/:id/target-schema/salesforce`

Request:
```json
{
  "objects": ["Account", "Contact", "Sales_Area__c"],
  "credentials": {
    "loginUrl": "https://login.salesforce.com",
    "username": "optional",
    "password": "optional",
    "securityToken": "optional",
    "accessToken": "optional",
    "instanceUrl": "optional"
  }
}
```

Response `200`:
```json
{
  "entities": [
    { "id": "ent_sf_account", "systemId": "sys_sf_001", "name": "Account", "label": "Account" }
  ],
  "fields": [
    { "id": "fld_sf_external_id", "entityId": "ent_sf_account", "name": "External_ID__c", "dataType": "string", "isExternalId": true },
    { "id": "fld_sf_account_name", "entityId": "ent_sf_account", "name": "Name", "dataType": "string", "required": true }
  ],
  "relationships": [],
  "mode": "live"
}
```

`mode` can be `live` or `mock`.

## 5) Suggest Mappings

`POST /api/projects/:id/suggest-mappings`

Request:
```json
{}
```

Response `200`:
```json
{
  "entityMappings": [
    {
      "id": "emap_001",
      "projectId": "proj_demo_001",
      "sourceEntityId": "ent_sap_customer",
      "targetEntityId": "ent_sf_account",
      "confidence": 0.93,
      "rationale": "Customer and Account represent business master records"
    }
  ],
  "fieldMappings": [
    {
      "id": "fmap_001",
      "entityMappingId": "emap_001",
      "sourceFieldId": "fld_sap_customer_number",
      "targetFieldId": "fld_sf_external_id",
      "transform": { "type": "direct", "config": {} },
      "confidence": 0.95,
      "rationale": "Identifier mapping with compatible text type",
      "status": "suggested"
    }
  ],
  "validation": {
    "warnings": [],
    "summary": {
      "totalWarnings": 0,
      "typeMismatch": 0,
      "missingRequired": 0,
      "picklistCoverage": 0
    }
  },
  "mode": "heuristic"
}
```

## 6) Patch Field Mapping

`PATCH /api/field-mappings/:id`

Request:
```json
{
  "status": "accepted",
  "transform": {
    "type": "concat",
    "config": { "separator": " ", "sourceFields": ["Name1", "Name2"] }
  },
  "confidence": 0.9,
  "rationale": "User-approved concatenation"
}
```

Response `200`:
```json
{
  "fieldMapping": {
    "id": "fmap_001",
    "entityMappingId": "emap_001",
    "sourceFieldId": "fld_sap_name1",
    "targetFieldId": "fld_sf_account_name",
    "transform": { "type": "concat", "config": { "separator": " ", "sourceFields": ["Name1", "Name2"] } },
    "confidence": 0.9,
    "rationale": "User-approved concatenation",
    "status": "accepted"
  }
}
```

## 7) Export Mapping Spec

`GET /api/projects/:id/export?format=json|csv`

### JSON response `200`
```json
{
  "project": { "id": "proj_demo_001", "name": "SAP to Salesforce Demo", "sourceSystemId": "sys_sap_001", "targetSystemId": "sys_sf_001", "createdAt": "2026-02-20T10:00:00.000Z", "updatedAt": "2026-02-20T10:10:00.000Z" },
  "entityMappings": [
    {
      "sourceEntity": "SAP.Customer",
      "targetEntity": "Account",
      "confidence": 0.93,
      "rationale": "Customer and Account represent business master records",
      "fieldMappings": [
        {
          "sourceField": "CustomerNumber",
          "targetField": "External_ID__c",
          "transform": { "type": "direct", "config": {} },
          "confidence": 0.95,
          "rationale": "Identifier mapping with compatible text type",
          "status": "accepted"
        }
      ]
    }
  ],
  "validation": {
    "warnings": [],
    "summary": {
      "totalWarnings": 0,
      "typeMismatch": 0,
      "missingRequired": 0,
      "picklistCoverage": 0
    }
  }
}
```

### CSV response `200`
Columns:
`project,sourceEntity,sourceField,targetEntity,targetField,transformType,transformConfig,confidence,status,rationale`

## Source Schema JSON Format (SAP)

```json
{
  "entities": [
    {
      "name": "SAP.Customer",
      "label": "Customer Master",
      "fields": [
        { "name": "CustomerNumber", "dataType": "string", "required": true, "isKey": true },
        { "name": "Name1", "dataType": "string" },
        { "name": "Name2", "dataType": "string" }
      ]
    }
  ],
  "relationships": [
    { "fromEntity": "SAP.Customer", "toEntity": "SAP.Contact", "type": "parentchild" }
  ]
}
```
