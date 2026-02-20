# Auto Mapper - Phase 1 MVP (Backend-First)

Phase 1 backend prototype for mapping SAP source schema to Salesforce target schema with heuristic suggestions, optional AI refinement, validation, and JSON/CSV export.

## Repo Structure

- `/backend` - Express + TypeScript API
- `/docs/api-contract.md` - frozen API contract for parallel UI work
- `/samples/sap` - sample SAP metadata inputs
- `/samples/mock-responses` - frozen mock API payloads for UI development
- `/samples/output` - example exported mapping specs

## Backend Run Steps

```bash
cd /Users/ankitbhatia/Documents/New\ project/backend
npm install
cp .env.example .env
npm run dev
```

API base URL: `http://localhost:4000`

Health check:
```bash
curl http://localhost:4000/api/health
```

## Environment Variables

Set in `/Users/ankitbhatia/Documents/New project/backend/.env`:

- `PORT=4000`
- `DATA_DIR=./src/data`
- `OPENAI_API_KEY=` (optional)
- `OPENAI_BASE_URL=https://api.openai.com/v1`
- `OPENAI_MODEL=gpt-4o-mini`
- `SF_LOGIN_URL=https://login.salesforce.com`
- `SF_USERNAME=` (optional)
- `SF_PASSWORD=` (optional)
- `SF_SECURITY_TOKEN=` (optional)
- `SF_ACCESS_TOKEN=` (optional)
- `SF_INSTANCE_URL=` (optional)

Salesforce metadata mode:
- If valid Salesforce creds are present: `mode=live`
- Otherwise fallback: `mode=mock` (for local demos)

## API Endpoints

See full request/response examples in:
- `/Users/ankitbhatia/Documents/New project/docs/api-contract.md`

Implemented:
- `POST /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects/:id/source-schema`
- `POST /api/projects/:id/target-schema/salesforce`
- `POST /api/projects/:id/suggest-mappings`
- `PATCH /api/field-mappings/:id`
- `GET /api/projects/:id/export?format=json|csv`

## Quick Demo with curl

1. Create project:
```bash
curl -s -X POST http://localhost:4000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"SAP to Salesforce Demo"}'
```

2. Upload SAP schema (JSON sample):
```bash
curl -s -X POST http://localhost:4000/api/projects/<PROJECT_ID>/source-schema \
  -F 'file=@/Users/ankitbhatia/Documents/New project/samples/sap/sap-schema.json'
```

3. Load Salesforce target metadata:
```bash
curl -s -X POST http://localhost:4000/api/projects/<PROJECT_ID>/target-schema/salesforce \
  -H 'Content-Type: application/json' \
  -d '{"objects":["Account","Contact","Sales_Area__c"]}'
```

4. Generate suggestions:
```bash
curl -s -X POST http://localhost:4000/api/projects/<PROJECT_ID>/suggest-mappings \
  -H 'Content-Type: application/json' \
  -d '{}'
```

5. Export JSON:
```bash
curl -s "http://localhost:4000/api/projects/<PROJECT_ID>/export?format=json"
```

6. Export CSV:
```bash
curl -s "http://localhost:4000/api/projects/<PROJECT_ID>/export?format=csv"
```

## SAP Input Files

- JSON sample: `/Users/ankitbhatia/Documents/New project/samples/sap/sap-schema.json`
- OData XML sample: `/Users/ankitbhatia/Documents/New project/samples/sap/odata-metadata.xml`

## Mock Responses for UI Team

Stable contract fixtures are under:
- `/Users/ankitbhatia/Documents/New project/samples/mock-responses/project.json`
- `/Users/ankitbhatia/Documents/New project/samples/mock-responses/source-schema.json`
- `/Users/ankitbhatia/Documents/New project/samples/mock-responses/target-schema-salesforce.json`
- `/Users/ankitbhatia/Documents/New project/samples/mock-responses/suggested-mappings.json`
- `/Users/ankitbhatia/Documents/New project/samples/mock-responses/validation-report.json`

All include stable IDs, confidence, and rationale where applicable.
