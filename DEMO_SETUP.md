# AutoMapper — Demo Setup Guide

This guide covers everything needed to run a live customer demo. Two paths are available:

- **Demo mode** — zero setup, no database, in-memory state (`demo-server.mjs`)
- **Production mode** — PostgreSQL + JWT auth, full persistence, all features

---

## Quick Start (Demo Mode)

The demo server runs with `node demo-server.mjs` — no build step, no database, no `.env` file.

```bash
# From the project root:
node demo-server.mjs
# → ✅  AutoMapper Demo Server running on http://localhost:4000
```

Then open `demo.html` in your browser, or point the React frontend at `http://localhost:4000`.

### What the demo server includes

- **5 connectors** with full mock schemas:
  - Jack Henry SilverLake (commercial banks) — CIF, DDA, LoanAccount with jXchange XPaths and ISO 20022 names
  - Jack Henry Core Director (community banks) — CIF with `Indv/Bus` short codes, DDA/Loan with numeric AcctType codes `"10"`/`"40"`, GLAccount
  - Jack Henry Symitar/Episys (credit unions) — Member, Share, Loan, Card with PCI-DSS tags
  - Salesforce CRM — Account, Contact, Opportunity
  - SAP S/4HANA — BusinessPartner, GLAccount
- **7-agent orchestration** (SSE stream): SchemaDiscovery → Compliance → BankingDomain → CRMDomain → MappingProposal → MappingRationale → Validation
- **6 export formats**: JSON, YAML, CSV, MuleSoft DataWeave, Dell Boomi XML, Workato recipe

### Demo scenario: Jack Henry Core Director → Salesforce

This is the highest-impact scenario — Core Director uses numeric AcctType codes and short CustomerType codes that silently break direct mappings.

1. POST `/api/projects` — create a project
2. POST `/api/projects/:id/schema/jackhenry-coredirector` with `{ "side": "source" }` — ingest Core Director schema
3. POST `/api/projects/:id/schema/salesforce` with `{ "side": "target" }` — ingest Salesforce schema
4. POST `/api/projects/:id/suggest-mappings` — run heuristic mapping
5. POST `/api/projects/:id/orchestrate` — stream 7 agent steps (BankingDomainAgent will flag the numeric AcctType codes and `Indv/Bus` CustomerType short codes)
6. GET `/api/projects/:id/export?format=dataweave` — download a ready-to-import DataWeave script

---

## Production Mode Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ (or Docker)
- npm

### 1. Start PostgreSQL

```bash
docker run -d \
  --name automapper-pg \
  -e POSTGRES_PASSWORD=automapper \
  -e POSTGRES_DB=automapper \
  -p 5432:5432 \
  postgres:16-alpine
```

### 2. Configure environment

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your values. Minimum required for basic operation:

```env
DATABASE_URL=postgresql://postgres:automapper@localhost:5432/automapper
JWT_SECRET=change-this-to-a-random-32-char-secret
REQUIRE_AUTH=true
PORT=4000
```

### 3. Install dependencies and run migrations

```bash
cd backend
npm install

# First-time setup — push schema and generate Prisma client:
npx prisma db push

# If you already have a database and are adding the connector metadata columns:
psql $DATABASE_URL -f prisma/migrations/20250225000000_add_field_connector_metadata/migration.sql
```

### 4. Start the backend

```bash
# Development (auto-reload):
npm run dev

# Production:
npm run build && npm start
```

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev          # development server on http://localhost:5173
# or
npm run build        # build to frontend/dist/ for production serving
```

---

## Salesforce Connected App Setup

To connect to a real Salesforce org (not mock mode):

1. In Salesforce Setup → App Manager → New Connected App
2. Enable OAuth Settings:
   - Callback URL: `http://localhost:4000/api/oauth/salesforce/callback`
   - Scopes: `api`, `refresh_token`
3. Copy the Consumer Key and Consumer Secret
4. Add to `.env`:

```env
SF_APP_CLIENT_ID=your_consumer_key
SF_APP_CLIENT_SECRET=your_consumer_secret
SF_APP_REDIRECT_URI=http://localhost:4000/api/oauth/salesforce/callback
SF_APP_LOGIN_URL=https://login.salesforce.com
```

Then the OAuth flow works: frontend redirects to `/api/oauth/salesforce/authorize`, user logs in, callback stores the access token, and subsequent schema fetches use it automatically.

---

## Jack Henry Connector Setup

### SilverLake (commercial banks)

```env
JH_SL_INSTANCE_URL=https://your-silverlake-instance.jackhenry.com
JH_SL_CLIENT_ID=your_client_id
JH_SL_CLIENT_SECRET=your_client_secret
JH_SL_TOKEN_URL=https://auth.jackhenry.com/oauth2/token
```

> **DMZ test routing number:** `011001276`

### Core Director (community banks)

```env
JH_CD_INSTANCE_URL=https://your-coredirector-instance.jackhenry.com
JH_CD_CLIENT_ID=your_client_id
JH_CD_CLIENT_SECRET=your_client_secret
JH_CD_TOKEN_URL=https://auth.jackhenry.com/oauth2/token
```

> **DMZ test InstRtId:** `11111900`
>
> **Important:** Core Director uses numeric AcctType codes (`"10"`=deposit, `"40"`=loan) and short CustomerType codes (`Indv`, `Bus`, `Trust`, `Govt`). The BankingDomainAgent automatically detects these and flags the mappings as requiring a lookup transform.

### Symitar/Episys (credit unions)

```env
JH_SL_INSTANCE_URL=https://your-symitar-instance.jackhenry.com
JH_SL_CLIENT_ID=your_client_id
JH_SL_CLIENT_SECRET=your_client_secret
# institutionId is passed per-request via connector credentials
```

### jXchange via MCP (future)

When Jack Henry ships an official MCP server:

```env
JH_MCP_SERVER_URL=https://api.jackhenry.dev/mcp
JH_MCP_TOOL_PREFIX=jxchange
```

Until then, the connector falls back to mock mode automatically.

---

## Export Formats Reference

| Format | Query param | Use case |
|--------|-------------|----------|
| Canonical JSON | `?format=json` | Point-to-point integration, REST payloads |
| YAML | `?format=yaml` | Git-based review, human-readable diffs |
| CSV | `?format=csv` | Business analyst review in Excel |
| MuleSoft DataWeave | `?format=dataweave` | Drop into Transform Message in Anypoint Studio |
| Dell Boomi XML | `?format=boomi` | Import into Boomi Process as a Map component |
| Workato Recipe | `?format=workato` | Import as Workato recipe with datapill expressions |

```bash
# List available formats:
GET /api/projects/:id/export/formats

# Download a specific format:
GET /api/projects/:id/export?format=dataweave
```

---

## AI Enhancement (Optional)

Without an API key the system runs fully in heuristic mode (still useful for demos).

```env
# OpenAI:
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini   # optional, default gpt-4o-mini

# Anthropic (Claude):
ANTHROPIC_API_KEY=sk-ant-...
```

With a key set, MappingProposalAgent sends ambiguous field pairs to the LLM for semantic scoring and MappingRationaleAgent generates detailed natural-language intent summaries.

---

## MCP Server (for Claude Desktop integration)

AutoMapper includes an MCP server that exposes the mapping engine as Claude tools:

```bash
cd backend
node mcp-server.mjs
# → AutoMapper MCP server running on http://localhost:4001/mcp
```

To register in Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "automapper": {
      "command": "node",
      "args": ["/path/to/AutoMapper-main/backend/mcp-server.mjs"],
      "env": { "PORT": "4001" }
    }
  }
}
```

---

## Key Demo Talking Points

**Why not just export from SAP/Jack Henry and import to Salesforce manually?**
Manual mapping takes 3–6 weeks per integration and breaks silently when schemas change. AutoMapper generates the spec in under 60 seconds and flags compliance risks automatically.

**Core Director numeric codes — what's the risk?**
If a developer directly maps AcctType `"10"` to a Salesforce Type field expecting `"Checking"`, every account in Salesforce gets the string `"10"` as its type. Silent data corruption. AutoMapper's BankingDomainAgent catches this at mapping time and requires an explicit lookup transform.

**How does compliance awareness work?**
Fields are tagged at ingestion (GLBA_NPI, BSA_AML, PCI_CARD, SOX_FINANCIAL, FFIEC_AUDIT) and persist through the full pipeline. The ComplianceAgent surfaces them in the orchestration stream. The export includes the tags so downstream integration teams know which fields need masking, encryption, or audit logging.

**What happens when schemas change?**
Re-run schema ingestion → suggest-mappings → orchestrate. The agent pipeline re-scores all mappings against the new schema and highlights anything that changed. The YAML export makes schema drift reviewable in a Git pull request.
