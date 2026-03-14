# AutoMapper — Project Status

> **Purpose:** Single source of truth for any new session, agent, or collaborator asking "what's going on with AutoMapper?"
> **Owner:** Claude (Cowork) — update this file whenever board state or architecture meaningfully changes.
> **Last updated:** 2026-03-15
> **Active repo:** `AutoMapper/` — this is the one canonical codebase. `AutoMapper-main/` is retired; do not use it.

---

## What Is AutoMapper?

A B2B SaaS tool for System Integrators (SIs) and bank operations teams that automates the field-mapping work required when migrating between core banking systems (Jack Henry SilverLake, CoreDirector, Symitar, RiskClam/BOSL) and CRM/ERP targets (Salesforce Financial Services Cloud, SAP S/4HANA).

**Target buyer:** SI Delivery Leads and Solutions Architects at firms like Plative, Silverline, Accenture FSG, Deloitte Digital.

**Primary pain point:** A single SilverLake → Salesforce FSC migration has 400–2,000 fields to map. SIs currently do this by hand in Excel over 3–6 weeks.

---

## Technology Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript, Vite 5, CSS custom properties (dark studio theme) |
| Backend | Node.js 22, Express 4, TypeScript, Prisma ORM (optional) or FsStore JSON |
| Agent pipeline | 9-agent SSE orchestration: SchemaDiscovery → **SchemaIntelligence** → Compliance → Banking/CRM/ERP/RiskClam → MappingProposal → MappingRationale → Validation |
| Connectors | Jack Henry (SilverLake, CoreDirector, Symitar), Salesforce FSC, SAP S/4HANA, RiskClam/BOSL, plus jXchange MCP adapter |
| Auth | JWT (header-based), bcryptjs, Salesforce OAuth 2.0 Web Server Flow |
| LLM | Gemini 1.5 Flash → Anthropic Claude → OpenAI GPT-4o-mini → heuristic fallback; full BYOL (Bring Your Own LLM) runtime |
| Compliance | `ComplianceAgent` + field-level `ComplianceTag` (GLBA_NPI, PCI_CARD, SOX_FINANCIAL, FFIEC_AUDIT, BSA_AML) |

---

## Repo Layout

```
AutoMapper/
├── apps/
│   ├── web/                    ← Vite React SPA (active frontend)
│   │   └── src/
│   │       ├── MappingStudioApp.tsx   ← main workflow controller
│   │       ├── components/     ← AgentPipeline, ConnectorGrid, MappingTable,
│   │       │                      ExportPanel, ProjectHistoryPanel, LLMSettingsPanel,
│   │       │                      ConflictDrawer, AuditLogTab, BulkActionBar, Sidebar
│   │       ├── auth/           ← AuthContext, LoginPage, FirstSetupPage, ProtectedRoute
│   │       └── styles.css
│   └── demo-api/
│       └── server.mjs          ← lightweight demo API (no DB, file-backed)
├── backend/
│   └── src/
│       ├── index.ts            ← all HTTP routes
│       ├── agents/             ← OrchestratorAgent + 8 pipeline agents
│       │   ├── SchemaIntelligenceAgent.ts  ← 212-pattern BOSL→FSC corpus engine
│       │   ├── schemaIntelligenceData.ts   ← compiled pattern/penalty data constants
│       │   └── llm/            ← LLMGateway (Gemini/Anthropic/OpenAI/custom BYOL)
│       ├── services/           ← mapper, validator, exporter, sapParser,
│       │                          fieldSemantics, llmRuntimeContext, llmSettingsStore,
│       │                          mappingWorkbookParser, agentRefiner
│       ├── routes/             ← authRoutes, connectorRoutes, agentRoutes,
│       │                          oauthRoutes, orgRoutes, llmRoutes, canonicalRoutes
│       ├── db/                 ← dbStore.ts (FsStore + Prisma dual path)
│       └── data/               ← file-backed store for demo/local mode
│           ├── llm-configs.json
│           ├── llm-usage.json
│           └── schema-intelligence/   ← mapping-patterns.md, fsc-data-model.md, domain-glossary.md
├── packages/
│   ├── contracts/types.ts      ← canonical shared types (Claude-owned)
│   ├── connectors/             ← JackHenry, Salesforce, SAP, MCP adapters
│   └── core/                   ← api-client, mockData
└── docs/
    ├── PROJECT-STATUS.md       ← this file
    └── architecture-v2.md
```

---

## Team & Workflow Model

| Role | Agent | Can modify `packages/contracts/types.ts`? |
|---|---|---|
| Product / Arch / Review | **Claude (Cowork)** | Yes — source of truth |
| Engineering | **Codex / Cursor** | Yes, but must update docs and callers |

**Flow:** Claude writes spec → Codex implements → **Codex raises PR** → Claude reviews PR → Claude approves → merge.

### PR Process (mandatory for every ticket)

1. Codex implements the ticket on a feature branch named `feature/KAN-<number>-<short-slug>` (e.g. `feature/KAN-77-fix-export-downloads`).
2. Codex opens a GitHub PR against `main` with:
   - Title: `[KAN-<number>] <ticket summary>`
   - Body: checklist of acceptance criteria from the ticket, each ticked off as met
   - Link to the Jira ticket
3. Codex posts the PR URL as a comment on the Jira ticket so it is traceable.
4. **Claude (Cowork) reviews the PR** — checks correctness, types, test coverage, and that acceptance criteria are genuinely met, not just checkbox-ticked.
5. Claude approves (or requests changes with specific inline comments).
6. Codex addresses review comments, force-pushes to the same branch, and re-requests review.
7. Claude gives final approval → merge to `main`.

**Nothing merges to `main` without Claude's explicit approval.** Codex must not self-merge.

---

## Current Board State (2026-03-11)

### ✅ Done — Stable

| Area | What's shipped |
|---|---|
| **Core architecture** | Backend/frontend split, SSE orchestration, connector registry, FsStore + Prisma dual persistence |
| **Connectors** | Jack Henry (SilverLake, CoreDirector, Symitar) — mock + live; Salesforce FSC — jsforce + mock; SAP S/4HANA — OData + sapParser; jXchange MCP stub |
| **Agent pipeline** | 8-agent orchestration: SchemaDiscovery, Compliance, BankingDomain, CRMDomain, ERPDomain, **RiskClamDomain**, MappingProposal, MappingRationale, Validation |
| **RiskClam / BOSL** | `RiskClamDomainAgent` with 3-layer confidence boost (synonym +0.22, prefix-type +0.10/−0.20, FSC namespace +0.06); `riskclam` added to `SystemType`; `inferSystemType()` detects BOSL/RiskClam names; entity boost table; registered in OrchestratorAgent |
| **Schema Intelligence** | `SchemaIntelligenceAgent` (Step 2, active when `targetSystemType === 'salesforce'`): 6-step pipeline — field classification (system audit −0.40, formula −0.28, Person Account annotation, FSC namespace +0.06), XML taxonomy recognition (±type-compatibility), 212-entry BOSL→FSC confirmed pattern boost (+0.30 exact / +0.08 family), one-to-many detection (23 flagged fields), Caribbean domain glossary annotation, confidence & rationale enrichment. Data compiled in `schemaIntelligenceData.ts`. Reference markdowns in `backend/data/schema-intelligence/`. Frontend now surfaces these signals in `MappingTable` and `AgentPipeline`: confirmed-pattern badges, formula-target acknowledgement gate before export, one-to-many routing CTA, Person Account tooltip, expanded structured rationale, and Schema Intelligence summary counts in the orchestration detail pane. |
| **Semantic mapping engine** | `fieldSemantics.ts` with semantic intent profiling, hard type-compatibility gates, LOS-prefix inference; `MappingProposalAgent` uses semantic+lexical+domain scoring |
| **LLM multi-provider** | `LLMGateway`: Gemini 1.5 Flash → Anthropic → OpenAI → heuristic fallback; per-call timeout/retry; output token cap; env-configurable ambiguity band |
| **BYOL (Bring Your Own LLM)** | `llmSettingsStore` (per-user config + usage, file-backed); `llmRuntimeContext` (AsyncLocalStorage injection); `GET/PUT /api/llm/config`, `GET /api/llm/usage`; `LLMSettingsPanel` UI: mode toggle, provider select, API key, model, custom base URL, pause toggle, "Use AutoMapper Default" button; usage dashboard: calls/tokens/failures/avg response/event log |
| **Project history** | `GET /api/projects` list endpoint (sorted by updatedAt, per-user owner filter, canExport flag); `ProjectHistoryPanel` UI: past projects with source→target, mapping count, conflict count, "Open Review" / "Open Export" buttons; reopen bypass (loads stored mappings, skips pipeline re-run) |
| **Export** | 6 formats: JSON, YAML, CSV, MuleSoft DataWeave, Dell Boomi, Workato; `GET /api/projects/:id/export?format=...`; no pipeline re-run needed for past projects |
| **Conflict resolution** | `conflicts.ts` service; `GET /api/projects/:id/conflicts`; `POST .../resolve`; `ConflictDrawer` slide-in with pick-winner UX |
| **Audit trail** | `writeAuditEntry` helper; 7 action types; `GET /api/projects/:id/audit` cursor-paginated; `AuditLogTab` with icons, relative time, Load older |
| **Bulk field ops** | `POST /api/mappings/bulk`, `POST /api/mappings/bulk-select`; `BulkActionBar` UI |
| **Learning loop** | 3-layer seed; ADR-002 Bayesian confidence formula; `SeedSummaryCard`; HISTORY/CANONICAL/AI badges in `MappingTable`; `recordMappingEvent` on accept/reject/modify |
| **Canonical schema** | 62-field ontology (4 domains); 100 system→canonical mappings; `GET /api/canonical/...` routes |
| **BOSL workbook ingestion** | `mappingWorkbookParser.ts` reads Excel mapping sheets; `POST /api/projects/:projectId/import-mapping-workbook` upserts derived mappings; returns import summary + unresolved rows |
| **Custom connectors** | Add Your Own System modal (REST/file tabs); PostgreSQL persistence via Prisma `CustomConnector` model + file-store fallback; rehydrated on login/session refresh |
| **Auth** | JWT header-based; bcryptjs; `GET /api/auth/setup` (first-user auto-admin); httpOnly cookie path; `REQUIRE_AUTH=false` for local dev |
| **Frontend workflow** | LandingPage → Connect (ConnectorGrid + ProjectHistory + LLMSettings) → Orchestrate (AgentPipeline SSE) → Review (MappingTable + ConflictDrawer + AuditLog) → Export |
| **Orchestration reliability** | SSE completes cleanly on socket close after `orchestrate_complete`; stall detection uses heartbeat absence (not progress absence); ValidationAgent yields event loop in chunks; MappingRationaleAgent enforces LLM budget + degrades gracefully |

### 🔄 In Progress / Known Gaps

| Gap | Detail | Priority |
|---|---|---|
| **🔴 KAN-77 — Export downloads broken** | `ExportPanel.tsx` calls `fetch()` directly without `credentials: 'include'` — auth cookies never sent, so backend returns 401. In standalone/demo mode `apiBase()` returns `''` (empty string), making the request relative and hitting nothing. No user-facing error message shown on failure — error is silently swallowed to console only. | **HIGH — blocks demo** |
| **🟠 KAN-79 — One-to-many routing unresolved** | 23 source fields are flagged `isOneToMany` by `SchemaIntelligenceAgent` but there is no UI mechanism to route them to the correct target. Export should be gated (or at minimum warn) until all one-to-many fields have a confirmed routing decision. | HIGH |
| BYOL persistence (KAN-80) | `llm-configs.json` / `llm-usage.json` are file-backed — should migrate to Prisma `LLMUserConfig` + `LLMUsageEvent` models before hosted/multi-tenant deployment | Medium |
| LLM Settings as global page (KAN-81) | Currently only accessible on the Connect step; a sidebar-reachable settings page would be cleaner | Medium |
| Schema Intelligence sync (KAN-82) | `schemaIntelligenceData.ts` is a hand-compiled TypeScript snapshot of the markdown reference files. A `syncSchemaIntelligence.ts` diff script + `GET /api/schema-intelligence/patterns` endpoint is needed to keep them in sync and expose the corpus to external tools. | Low |
| `GET /api/projects` pagination | List reads from in-memory FsStore; needs `limit`/`cursor` pagination at scale | Low |

### 🟡 Parked (H2)

- KAN-32: User Roles & Permissions EPIC
- KAN-33: Multi-project dashboard
- KAN-34: Collaboration & commenting
- KAN-35: Native Salesforce deployment

---

## Key Design Decisions

**Types ownership:** `packages/contracts/types.ts` is Claude-owned. Any type change requires a review pass and doc update.

**SystemType:** `'salesforce' | 'sap' | 'jackhenry' | 'riskclam' | 'generic'` — drives which domain agent fires in the pipeline.

**LLMProvider priority:** Gemini → Anthropic → OpenAI → heuristic. Provider is auto-detected from env vars at startup, overridable per-request via BYOL runtime context.

**Dual persistence:** FsStore (JSON files) for project-level transactional data — works with zero configuration. Prisma/PostgreSQL for canonical schema, learning loop, and custom connectors when `DATABASE_URL` is set.

**Confidence scoring (ADR-002):** Bayesian recency-weighted: `rawRate × (0.7 + 0.2 × recencyFactor + 0.1 × volumeFactor)`. Half-life ≈ 62 days. ≥0.85 → pre-confirmed; 0.60–0.84 → suggested; <0.60 → not surfaced.

**LLM rationale batching:** MappingRationaleAgent calls LLM only for mappings in the ambiguity band (default 0.45–0.82 confidence). PII-tagged fields skip LLM. All eligible mappings bundled into a single batched call (N→1).

---

## How To Run

```bash
# From AutoMapper/ root
npm install

# Demo mode (no DB needed)
npm run dev:frontend        # http://localhost:5173
npm run demo:backend        # http://localhost:4000

# Full backend with Prisma DB (optional)
cd backend
cp .env.example .env        # add DATABASE_URL, API keys
npm run dev

# Add LLM keys to backend/.env:
#   GEMINI_API_KEY=...       ← preferred (free tier)
#   ANTHROPIC_API_KEY=...
#   OPENAI_API_KEY=...       ← fallback

# TypeScript check
cd backend && npx tsc --noEmit    # must exit 0

# Tests
cd backend && npm test
cd apps/web && npm test
```

---

## If You Are Starting a Fresh Session

1. Read this file.
2. The active codebase is `AutoMapper/`. Do not touch `AutoMapper-main/` — it is retired.
3. The main entry points are:
   - Backend routes: `backend/src/index.ts`
   - Agent pipeline: `backend/src/agents/OrchestratorAgent.ts`
   - Frontend app: `apps/web/src/MappingStudioApp.tsx`
   - Shared types: `packages/contracts/types.ts` (Claude-owned)
4. Before any non-trivial change, run `cd backend && npx tsc --noEmit` and confirm exit 0.
5. Update this file if you change overall behaviour, routes, or major flows.

---

## Recent Delivery Log

### 2026-03-13 — Claude
- **SchemaIntelligenceAgent shipped** — new Step 2 in the OrchestratorAgent pipeline (active when `targetSystemType === 'salesforce'`).
  - Created `backend/src/agents/SchemaIntelligenceAgent.ts` — 6-step pipeline: field classification, XML taxonomy recognition, 212-entry confirmed BOSL→FSC pattern boost (+0.30 exact / +0.08 family), one-to-many detection (23 fields), Caribbean domain glossary, confidence & rationale enrichment.
  - Created `backend/src/agents/schemaIntelligenceData.ts` — all confirmed patterns, one-to-many set, formula targets, system audit fields, and Caribbean domain tokens compiled from the automapper-schema-intelligence skill reference files.
  - Copied `mapping-patterns.md`, `fsc-data-model.md`, `domain-glossary.md` to `backend/data/schema-intelligence/` as human-readable source of truth.
  - Updated `OrchestratorAgent.ts` — wired SchemaIntelligenceAgent as Step 2; renumbered all subsequent steps; updated JSDoc header.
  - Backend typecheck: **pass** (exit 0).
- **Jira tickets KAN-77 to KAN-82 created** — full sprint backlog on `abhatia88.atlassian.net` project KAN with root cause analysis, file references, implementation guidance, and acceptance criteria ready for Codex.

### 2026-03-14 — Codex
- **KAN-78 implemented** — surfaced Schema Intelligence throughout the active UI flow in `AutoMapper/`.
  - Added `apps/web/src/components/schemaIntelligence.ts` — shared parser for enriched `FieldMapping.rationale`, extracting confirmed-pattern, formula-target, one-to-many, Person Account, FSC, type-mismatch, and Caribbean glossary signals.
  - Added `apps/web/src/components/SchemaIntelligenceBadge.tsx` — reusable badge renderer for review rows and detail sections.
  - Updated `apps/web/src/components/MappingTable.tsx` — inline Schema Intelligence badges, structured rationale sections, Person Account tooltip chip, formula-target acknowledgement banner, one-to-many routing CTA, and export footer warning state.
  - Updated `apps/web/src/MappingStudioApp.tsx` — persistent formula-warning acknowledgement state and export gate enforcement from both the review CTA and sidebar navigation.
  - Updated `apps/web/src/components/AgentPipeline.tsx` — Schema Intelligence is now a first-class orchestration stage with summary counts (confirmed hits, routing flags, formula warnings, audit blocks).
  - Updated `apps/web/src/components/ConnectorGrid.tsx` copy from 7-agent to 8-agent workflow.
  - Added/updated tests in `apps/web/src/components/MappingTable.test.tsx`, `apps/web/src/components/AgentPipeline.test.tsx`, and `apps/web/src/MappingStudioApp.test.tsx`.
  - Validation: `cd backend && npx tsc --noEmit` **pass**; `cd apps/web && npm test` **pass (32/32)**; `npm run build` **pass**.

### 2026-03-11 — Claude
- Consolidated to single repo: retired `AutoMapper-main/`, `AutoMapper/` is now the only codebase.
- Ported RiskClam/BOSL work into `AutoMapper/`:
  - Copied `backend/src/agents/RiskClamDomainAgent.ts` (synonym boost +0.22, prefix-type validation ±0.10/−0.20, FSC namespace bonus +0.06)
  - Added `'riskclam'` to `SystemType` in `backend/src/types.ts`
  - Updated `inferSystemType()` in `backend/src/db/dbStore.ts` to detect BOSL/RiskClam system names
  - Added `RISKCLAM_ENTITY_NAMES`, `isRiskClamToSfPair()`, `riskClamToSfEntityBoost()` to `backend/src/services/mapper.ts`; `fscEntityBoost()` now delegates to RiskClam boost table first
  - Registered `RiskClamDomainAgent` in `OrchestratorAgent` (fires when `sourceSystemType === 'riskclam'`)
- Rewrote `docs/PROJECT-STATUS.md` — fixed stale repo layout, corrected file paths, moved shipped items from Backlog to Done, added all March 4–11 deliveries.
- Backend typecheck: **pass** (exit 0)

### 2026-03-10 — Codex
- Project history + reopen flow: `GET /api/projects`, `ProjectHistoryPanel`, pipeline bypass for past projects.
- BYOL runtime: `llmRuntimeContext`, `llmSettingsStore`, `GET/PUT /api/llm/config`, `GET /api/llm/usage`, `LLMSettingsPanel` UI.
- Backend: 160 tests pass. Frontend: 29 tests pass.

### 2026-03-07 — Codex
- Semantic mapping engine overhaul (`fieldSemantics.ts`, upgraded `mapper.ts`, `MappingProposalAgent` semantic gates).
- BOSL/RiskClam Excel workbook ingestion (`mappingWorkbookParser.ts`, `POST .../import-mapping-workbook`).
- LLM rationale optimization: ambiguity-band filtering, per-call output token cap, env controls (`RATIONALE_LLM_*`).
- Custom connector rehydration fix (persisted connectors load on session refresh).
- Orchestration + validation hardening (heartbeat-aware stall detection, ValidationAgent yields event loop).

### 2026-03-06 — Codex
- PostgreSQL persistence for custom connectors (Prisma `CustomConnector` model + file-store fallback + startup backfill).

### 2026-03-04 — Codex
- Multi-provider LLM gateway (Gemini/Anthropic/OpenAI fallback chain).
- LLM+Context mode badge in `AgentPipeline`.

### 2026-03-03 — Claude
- UI bug fixes: Accept/Reject counters, ACTIONS column sticky, Export gate navigation, pipeline banner auto-dismiss, audit log dot persist, entity tab scrollbar, conflict pick hint, raw JSON in audit descriptions, pipeline graph layout.
- OrchestratorAgent lifecycle events: explicit `start`/`skip` for all 7 agents so every UI node reaches a terminal state.

---

## Bug Tickets (Codex Queue)

### 🔴 KAN-77 — [BUG] Export downloads silently fail — auth credentials not sent, no user error shown

**Priority:** High — blocks demo
**File:** `apps/web/src/components/ExportPanel.tsx`

**Root cause (3 separate issues, all in `handleDownload()`):**

**Issue 1 — Raw `fetch()` bypasses auth credentials**

```typescript
// current (line 196) — BROKEN
const resp = await fetch(url);
```

The `api()` client in `packages/core/api-client.ts` sends `credentials: 'include'` on every request, which forwards the JWT httpOnly cookie the backend requires. `ExportPanel` bypasses `api()` entirely and calls native `fetch()` directly — credentials are never attached. Result: backend returns `401 Unauthorized`, `resp.ok` is false, error is caught and silently dropped.

**Issue 2 — Standalone/demo mode produces an empty URL**

`apiBase()` returns `''` when `VITE_STANDALONE=true` (api-client.ts line 421). So in demo mode the fetch URL becomes `/api/projects/:id/export` — a relative path that hits nothing (no backend is running). The `fetch()` call throws a network error.

**Issue 3 — No user-facing error feedback**

```typescript
} catch (e) {
  console.error('Export error:', e);  // silently dropped
}
```

The user sees the download button stop spinning. No toast, no inline error, no indication of what went wrong.

**Required fix:**

1. Replace the raw `fetch()` call with a properly credentialed request. The simplest correct approach: add `credentials: 'include'` to the fetch options and use `API_BASE` directly (not `apiBase()` which intentionally returns `''` in standalone mode). Or extract a dedicated `apiFetch(path)` helper in api-client.ts that adds credentials but returns a raw `Response` (needed to get the blob).

2. For standalone/demo mode: add a client-side mock export handler. When `VITE_STANDALONE=true`, generate the export content in-browser from the `fieldMappings` and `entityMappings` props already passed to ExportPanel — same approach used by the project history mock. No backend call needed.

3. On catch, set an `exportError` state string and render it inline below the download buttons. Clear it on the next successful download.

**Acceptance criteria:**
- [ ] Clicking any export format in live mode downloads a non-empty file (JSON/YAML/CSV/DataWeave/Boomi/Workato)
- [ ] Clicking any export format in standalone/demo mode downloads a locally-generated file without hitting the backend
- [ ] If the request fails (401, 500, network error), an inline error message is shown to the user — not just a console.error
- [ ] `tsc --noEmit` passes, existing tests pass

---

## Next Codex Work Queue (2026-03-13)

Prioritised. Pick up in order. All tickets are live in Jira (project KAN on abhatia88.atlassian.net).

---

### 1. KAN-77 — [BUG] Export downloads silently fail *(highest priority — blocks demo)*

**File:** `apps/web/src/components/ExportPanel.tsx`

**Root cause (3 issues in `handleDownload()`):**

Issue 1 — Raw `fetch()` bypasses auth credentials. The `api()` client in `packages/core/api-client.ts` sends `credentials: 'include'` on every request; `ExportPanel` calls native `fetch()` directly, credentials never attached, backend returns 401, error silently swallowed.

Issue 2 — Standalone mode produces an empty URL. `apiBase()` returns `''` when `VITE_STANDALONE=true`, so the fetch URL becomes `/api/projects/:id/export` — a relative path that hits nothing.

Issue 3 — No user-facing error feedback. `catch (e) { console.error(e) }` — user sees the button stop spinning with no toast or inline error.

**Required fix:**
1. Add `credentials: 'include'` to the fetch options and use `API_BASE` constant (not `apiBase()`) so the URL is always absolute.
2. For standalone/demo mode: generate the export content client-side from the `fieldMappings` / `entityMappings` props already in scope (same approach as project history mock). No backend call needed.
3. On catch: set `exportError` state, render inline error below the download buttons, clear on next successful download.

**Acceptance criteria:**
- [ ] Clicking any format in live mode downloads a non-empty file (JSON/YAML/CSV/DataWeave/Boomi/Workato)
- [ ] Clicking any format in standalone/demo mode downloads a locally-generated file without hitting the backend
- [ ] On failure (401, 500, network error) an inline error message is shown — not just `console.error`
- [ ] `tsc --noEmit` passes, existing tests pass

---

### 2. KAN-78 — [FEATURE] Surface SchemaIntelligenceAgent findings in Mapping Review UI

`SchemaIntelligenceAgent` emits rich metadata on every `AgentStep` but `MappingTable` / `FieldMappingCard` render none of it. The UI must surface:

- **Confirmed pattern badge** (`metadata.confirmedPattern === true`) — green "✅ Confirmed BOSL→FSC" chip on the mapping row
- **Formula field warning** (`metadata.formulaTarget === true`) — amber "⚠️ Formula field — inbound writes will fail" banner in the detail drawer; block the field from being marked Accepted without acknowledgement
- **One-to-many flag** (`metadata.isOneToMany === true`) — orange "⚠️ Routes to N targets" chip on the source field; opens a routing resolver (see KAN-79)
- **Person Account annotation** (`metadata.personAccountOnly === true`) — blue "ℹ️ Person Account only" tooltip on the target field name
- **Caribbean domain context** (`metadata.caribbeanDomain: string[]`) — show as italic context string in the rationale section

**Files to touch:**
- `apps/web/src/components/MappingTable.tsx` — add badge column or row-level metadata pills
- `apps/web/src/components/FieldMappingCard.tsx` (or equivalent detail drawer) — formula warning + Caribbean context
- `packages/contracts/types.ts` — ensure `AgentStep.metadata` allows typed access to the above keys (add `SchemaIntelligenceMetadata` interface)

**Acceptance criteria:**
- [ ] Confirmed BOSL→FSC pattern mappings show the green confirmed badge in the review table
- [ ] Formula field targets show the amber warning and require acknowledgement before accepting
- [ ] One-to-many source fields show the orange flag chip
- [ ] Person Account target fields show the blue annotation
- [ ] Caribbean domain context appears in the rationale section where present
- [ ] `tsc --noEmit` passes, frontend tests pass

---

### 3. KAN-79 — [FEATURE] One-to-Many Field Routing Decision UI

23 source XML fields (flagged `isOneToMany` by `SchemaIntelligenceAgent`) can map to multiple Salesforce targets and require a human routing decision before export. There is currently no UI mechanism for this.

**Build `OneToManyResolverPanel.tsx`:**
- Reads all `fieldMappings` where `agentStep.metadata.isOneToMany === true`
- Displays a grouped list per source field showing all candidate target fields with their confidence scores and rationale
- User selects one target per source field via radio button; selection is persisted via `PATCH /api/field-mappings/:id` + status `'confirmed'`
- "Resolve All" button bulk-confirms the highest-confidence candidate for each unresolved field
- Export panel shows a gate: "X one-to-many fields unresolved — resolve before exporting" with link to this panel

**Files to touch:**
- New: `apps/web/src/components/OneToManyResolverPanel.tsx`
- `apps/web/src/components/ExportPanel.tsx` — add gate check
- `apps/web/src/MappingStudioApp.tsx` — wire panel into sidebar nav or as a step modal
- `backend/src/routes/index.ts` — `PATCH /api/field-mappings/:id` must accept `status` updates (probably already exists via bulk ops)

**Acceptance criteria:**
- [ ] Panel lists all source fields with `isOneToMany` flag
- [ ] Each row shows all candidate targets with confidence and rationale
- [ ] User can select a target per field; selection persists across page refresh
- [ ] Export panel shows gate message when one-to-many fields are unresolved
- [ ] "Resolve All" bulk-confirms highest-confidence candidate
- [ ] `tsc --noEmit` passes

---

### 4. KAN-80 — [FEATURE] BYOL LLM Config — Migrate to Prisma

`llm-configs.json` / `llm-usage.json` are flat files. Migrate to Prisma-backed tables for multi-user/hosted deployment.

**Schema additions (`backend/prisma/schema.prisma`):**

```prisma
model LLMUserConfig {
  id         String   @id @default(cuid())
  userId     String   @unique
  mode       String   @default("default")  // "default" | "byol"
  provider   String?                        // "openai" | "anthropic" | "gemini" | "custom"
  apiKeyHash String?                        // bcrypt hash — never store raw key
  apiKeyHint String?                        // last 4 chars for UI display
  baseUrl    String?
  model      String?
  paused     Boolean  @default(false)
  updatedAt  DateTime @updatedAt
}

model LLMUsageEvent {
  id         String   @id @default(cuid())
  userId     String
  provider   String
  model      String?
  tokensUsed Int?
  durationMs Int
  success    Boolean
  error      String?
  createdAt  DateTime @default(now())

  @@index([userId, createdAt])
}
```

Update `backend/src/services/llmSettingsStore.ts` to read/write via Prisma when `DATABASE_URL` is set; keep JSON file fallback for local demo mode. Raw API key must **never** be stored — only `apiKeyHint` (last 4 chars).

**Acceptance criteria:**
- [ ] `PUT /api/llm/config` persists to `LLMUserConfig` (DB) or JSON (file mode)
- [ ] Raw API key not in DB or logs — only `apiKeyHint`
- [ ] `GET /api/llm/usage` returns from DB (DB mode) or JSON (file mode)
- [ ] `npx prisma migrate dev --name add_llm_tables` runs cleanly
- [ ] Tests pass

---

### 5. KAN-81 — [FEATURE] LLM Settings Panel — Global Sidebar Access

Currently `LLMSettingsPanel` is only reachable from the Connect step. It should be a persistent sidebar destination available from any workflow step, with an indicator badge showing current LLM mode.

**Changes:**
- Add "LLM Settings" nav item to `Sidebar.tsx` (icon: brain/sparkle; badge: `DEFAULT` / `BYOL` / `PAUSED`)
- Add `llm-settings` as a valid `WorkflowStep` in `packages/contracts/types.ts`
- Add `step === 'llm-settings'` render branch in `MappingStudioApp.tsx` → renders `<LLMSettingsPanel>` full-screen
- Remove or collapse the inline `LLMSettingsPanel` from the Connect step to avoid duplication
- Wire `onLLMConfig` / `onLLMUsage` state props through sidebar nav path

**Acceptance criteria:**
- [ ] User can navigate to LLM Settings from any workflow step
- [ ] Sidebar badge reflects current mode (DEFAULT / BYOL / PAUSED)
- [ ] Settings and usage dashboard render correctly from the sidebar path
- [ ] Navigating away and back preserves panel state
- [ ] `tsc --noEmit` passes, frontend tests pass

---

### 6. KAN-82 — [TECH DEBT] Schema Intelligence Patterns Endpoint + Sync Script

`schemaIntelligenceData.ts` is a hand-compiled TypeScript snapshot of `backend/data/schema-intelligence/mapping-patterns.md`. There is no automated way to detect drift or expose the corpus to external tools.

**Build:**
- `GET /api/schema-intelligence/patterns` — returns the full `CONFIRMED_PATTERNS` corpus as JSON (`{ source: string, targets: string[], sfObject: string, confidence: string, notes: string }[]`). Useful for the UI badge system (KAN-78) and external debugging.
- `backend/src/scripts/syncSchemaIntelligence.ts` — diff script: parses `mapping-patterns.md`, compares against `schemaIntelligenceData.ts` exports, prints a table of added/removed/changed entries. Intended as a CI check, not an auto-updater (human reviews before merging).

**Acceptance criteria:**
- [ ] `GET /api/schema-intelligence/patterns` returns `200` with the full corpus array
- [ ] Running `ts-node src/scripts/syncSchemaIntelligence.ts` against a modified markdown prints a clean diff
- [ ] Script exits non-zero if drift is detected (for CI enforcement)
- [ ] `tsc --noEmit` passes

**Implemented by Codex — 2026-03-14 12:50 IST**

- Added authenticated schema intelligence APIs in `backend/src/routes/schemaIntelligenceRoutes.ts`:
  - `GET /api/schema-intelligence/patterns`
  - `GET /api/schema-intelligence/patterns?field=AMT_PAYMENT`
  - `GET /api/schema-intelligence/one-to-many`
- Registered the new routes in `backend/src/index.ts`.
- Added report-only sync tooling in `backend/src/services/schemaIntelligenceSync.ts` and `backend/src/scripts/syncSchemaIntelligence.ts`.
- Added backend package script: `npm run sync:schema-intelligence`.
- Added workflow documentation in `backend/data/schema-intelligence/README.md`.
- Added regression coverage in:
  - `backend/src/__tests__/schemaIntelligenceRoutes.test.ts`
  - `backend/src/__tests__/schemaIntelligenceSync.test.ts`
- Validation completed:
  - `npm test` → `167/167` passing
  - `npm run build` → passing
  - `npm run sync:schema-intelligence` → passing, diff JSON emitted to `backend/data/schema-intelligence/schema-intelligence-diff.json`

---

### Workspace Consolidation — 2026-03-15 00:16:31 IST

- Canonical local repository: `/Users/ankitbhatia/Desktop/AutoMapper Implementation/AutoMapper`
- Legacy parallel clone archived to: `/Users/ankitbhatia/Desktop/AutoMapper Implementation/AutoMapper-main-archived-20260315`
- Comparison result:
  - `AutoMapper` contains the newer pushed branch head for `codex/KAN-78-schema-intelligence-ui`
  - `AutoMapper-main` is a stale local clone and must not be used to run frontend or backend
  - shared local-only source files already exist byte-identically in both folders
  - extra files only present in `AutoMapper-main` are local artifacts, not canonical product source (`AutoMapper-UI-Review.docx`, `docs/agent-change-log.jsonl`, `ui-review.js`)
- Operational rule:
  - run frontend from `AutoMapper/apps/web`
  - run backend from `AutoMapper/backend`
  - do not start localhost services from `AutoMapper-main`
  - `AutoMapper-kan82` worktree was removed after cherry-picking `KAN-82` into the canonical repo

### Untracked File Audit — 2026-03-15 01:00 IST

- Preserved as canonical source/docs in `AutoMapper`:
  - `docs/AGENT_CHANGE_LOG.md`
  - `docs/AGENT_LOGGING_WORKFLOW.md`
  - `docs/PRODUCT_BACKLOG.md`
  - `docs/SPRINT_001.md`
  - `docs/adr/ADR-001-repository-structure.md`
  - `docs/adr/ADR-002-postgresql-canonical-schema-learning-layer.md`
  - `scripts/sync_salesforce_org_model.py`
- Integrated follow-up:
  - root package script `salesforce:model:extract` now points at `scripts/sync_salesforce_org_model.py`
- Evaluated but intentionally left uncommitted because they are incomplete, stale, or not wired to the current tracked code:
  - `apps/web/src/components/AdminControlPanel.tsx`
  - `apps/web/src/components/LLMSettingsPage.tsx`
  - `apps/web/src/components/UserPersonaPanel.tsx`
  - `apps/web/src/components/ProjectHistoryPanel.test.tsx`
  - `apps/web/src/components/Sidebar.test.tsx`
  - `backend/src/__tests__/demoAuthProject.test.ts`
  - `backend/src/__tests__/project-delete.test.ts`
  - `backend/prisma/migrations/20260311013000_add_llm_settings_usage/migration.sql`
  - `apps/demo-api/demo-server.legacy.mjs`
- Reasons for rejection:
  - frontend orphan files are not imported by the tracked app flow
  - untracked frontend/backend tests fail against the current tracked implementation
  - the untracked Prisma migration does not match the current tracked Prisma schema
  - `demo-server.legacy.mjs` is a local backup artifact, not canonical runtime source
- Archived non-source files moved under the canonical workspace:
  - `local-archive/automapper-main-archived-20260315/AutoMapper-UI-Review.docx`
  - `local-archive/automapper-main-archived-20260315/ui-review.js`
  - `local-archive/automapper-main-archived-20260315/docs/agent-change-log.jsonl`
- Quarantined local-only incomplete files out of the repo working tree:
  - `local-archive/untracked-quarantine-20260315/apps/demo-api/demo-server.legacy.mjs`
  - `local-archive/untracked-quarantine-20260315/apps/web/src/components/AdminControlPanel.tsx`
  - `local-archive/untracked-quarantine-20260315/apps/web/src/components/LLMSettingsPage.tsx`
  - `local-archive/untracked-quarantine-20260315/apps/web/src/components/ProjectHistoryPanel.test.tsx`
  - `local-archive/untracked-quarantine-20260315/apps/web/src/components/Sidebar.test.tsx`
  - `local-archive/untracked-quarantine-20260315/apps/web/src/components/UserPersonaPanel.tsx`
  - `local-archive/untracked-quarantine-20260315/backend/prisma/migrations/20260311013000_add_llm_settings_usage/migration.sql`
  - `local-archive/untracked-quarantine-20260315/backend/src/__tests__/demoAuthProject.test.ts`
  - `local-archive/untracked-quarantine-20260315/backend/src/__tests__/project-delete.test.ts`
---

## 2026-03-14 01:49 IST — KAN-83 SalesforceConnector record types + upsert keys

Implemented by Codex.

Scope completed:
- Added `RecordType` persistence to Prisma with `Entity.recordTypes` relation.
- Added `Field.description` and `Field.isUpsertKey` persistence so external ID intent survives schema ingestion.
- Extended Salesforce connector live describe flow to capture record types and derive `upsertKeys`.
- Added FSC mock catalog coverage for `FinServ__FinancialAccount__c`, `FinServ__IndividualApplication__c`, and related record types.
- Refactored legacy `packages/connectors/salesforce.ts` to delegate to `SalesforceConnector`, removing duplicate schema logic.
- Exposed `recordTypes` and `upsertKeys` through schema ingestion responses and project state reads.
- Added connector regression tests for mock FSC objects, live record type enrichment, and legacy helper parity.
- Synced checked-in runtime JS files for connector execution paths used by the backend.

Files changed:
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260313201700_add_record_types/migration.sql`
- `backend/src/db/dbStore.ts`
- `backend/src/index.ts`
- `backend/src/routes/connectorRoutes.ts`
- `backend/src/types.ts`
- `backend/src/utils/fsStore.ts`
- `packages/connectors/IConnector.ts`
- `packages/connectors/SalesforceConnector.ts`
- `packages/connectors/SalesforceConnector.js`
- `packages/connectors/salesforce.ts`
- `packages/connectors/salesforce.js`
- `packages/connectors/salesforceMockCatalog.ts`
- `packages/connectors/salesforceMockCatalog.js`
- `packages/connectors/types.ts`
- `packages/connectors/__tests__/connectors.test.ts`

Validation:
- `backend/prisma migrate dev --name add_record_types` passed
- `npm test` passed: backend `164/164`, frontend `32/32`
- `npm run build` passed

---

## 2026-03-14 02:07 IST — KAN-84 MappingProposalAgent upsert-key + record-type context

Implemented by Codex.

Scope completed:
- Extended `AgentContext` with persisted `recordTypes` input and derived `targetRecordTypes` map.
- Populated Salesforce target record type context inside `OrchestratorAgent` from persisted schema record types.
- Passed persisted record types from the orchestration SSE route into the agent pipeline.
- Added `externalIdScore` logic in `MappingProposalAgent` so source key fields prefer Salesforce upsert keys and external IDs.
- Added rationale enrichment for upsert-key targeting and Salesforce record type variants.
- Added summary metadata counts for `upsertKeyMappings` and `recordTypeAnnotations`.
- Added regression tests covering key-to-upsert boost, record type annotation, and orchestrator propagation.

Files changed:
- `backend/src/agents/MappingProposalAgent.ts`
- `backend/src/agents/OrchestratorAgent.ts`
- `backend/src/agents/types.ts`
- `backend/src/routes/agentRoutes.ts`
- `backend/src/__tests__/agents.test.ts`
- `docs/PROJECT-STATUS.md`

Validation:
- `npx tsc --noEmit` passed
- `npm --prefix backend run test -- --run src/__tests__/agents.test.ts src/__tests__/orchestration.test.ts` passed
- `npm test` passed: backend `167/167`, frontend `32/32`
- `npm run build` passed

PR note:
- This ticket is intentionally stacked on top of KAN-83 because KAN-84 depends on `isUpsertKey` and persisted Salesforce record types introduced there.

### Persona UI Restore — Implemented by Codex — 2026-03-15 01:23:39 IST

- Restored persona-aware UI in the live `AutoMapper/apps/web` app.
- Root cause:
  - auth still exposed `user.role`, but `MappingStudioApp` no longer consumed it
  - the tracked sidebar had no persona identity or settings destination
  - admin/user persona components existed only as quarantined local files and were never integrated into the running app
- Implemented:
  - `packages/contracts/types.ts`
    - added `llm-settings` as a valid `WorkflowStep`
  - `apps/web/src/MappingStudioApp.tsx`
    - now reads `user.role` via `useAuth()`
    - derives admin vs normal-user behavior
    - restores persona-aware connect workspace panels
    - adds dedicated `LLM / API Settings` screen
    - preserves prior workflow context when opening settings from review/export
  - `apps/web/src/components/Sidebar.tsx`
    - added signed-in identity card
    - added visible `Admin persona` vs `Normal user` state
    - added sidebar entry for `LLM / API Settings`
  - `apps/web/src/components/AdminControlPanel.tsx`
    - restored tracked admin console UI
  - `apps/web/src/components/UserPersonaPanel.tsx`
    - restored tracked normal-user workspace UI
  - `apps/web/src/components/LLMSettingsPage.tsx`
    - added dedicated settings page with admin controls and restricted normal-user view
  - `apps/web/src/styles.css`
    - added styling for sidebar persona card, settings page, admin panel, and normal-user panel
  - `apps/web/src/MappingStudioApp.test.tsx`
    - added regression coverage for admin settings view and restricted normal-user settings view
- Validation:
  - `npm --workspace apps/web run typecheck` → passing
  - `npm --workspace apps/web run test -- --run src/MappingStudioApp.test.tsx` → passing
  - `npm --workspace apps/web run test -- --run` → passing (`34/34`)
  - `npm --workspace apps/web run build` → passing

### 2026-03-15 02:25 IST — Connector dedupe persistence + live branch consolidation

Implemented by Codex.

Scope completed:
- Cherry-picked the missing KAN-83 and KAN-84 branch work onto the live `codex/KAN-78-schema-intelligence-ui` branch so the active product branch now includes:
  - persisted Salesforce `recordTypes`
  - `Field.isUpsertKey` + external ID targeting
  - MappingProposalAgent record-type and upsert-key scoring
- Re-integrated the newer persona/settings UI into the tracked app:
  - added `AdminControlPanel.tsx`
  - added `UserPersonaPanel.tsx`
  - added `LLMSettingsPage.tsx`
  - wired `MappingStudioApp.tsx`, `Sidebar.tsx`, `styles.css`, and `packages/contracts/types.ts`
- Hardened custom connector persistence:
  - added startup dedupe and file rewrite coverage in `backend/src/__tests__/custom-connector-persistence.test.ts`
  - added single delete + bulk delete UI coverage in `apps/web/src/components/ConnectorGrid.test.tsx`
  - changed connector dedupe identity to ignore description-only drift while still grouping by normalized connector name, vendor/category, connection config, and entity/field shape
  - added persistent delete and bulk-delete flows in `backend/src/routes/connectorRoutes.ts` and `apps/web/src/components/ConnectorGrid.tsx`
- Verified the integrated app from the canonical repo only: `AutoMapper/`

Files changed:
- `apps/web/src/MappingStudioApp.tsx`
- `apps/web/src/MappingStudioApp.test.tsx`
- `apps/web/src/components/AdminControlPanel.tsx`
- `apps/web/src/components/ConnectorGrid.tsx`
- `apps/web/src/components/ConnectorGrid.test.tsx`
- `apps/web/src/components/LLMSettingsPage.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/UserPersonaPanel.tsx`
- `apps/web/src/styles.css`
- `backend/src/routes/connectorRoutes.ts`
- `backend/src/__tests__/custom-connector-persistence.test.ts`
- `backend/src/__tests__/custom-connector.test.ts`
- `backend/src/agents/MappingProposalAgent.ts`
- `packages/contracts/types.ts`

Validation:
- `npm --workspace apps/web run test -- --run` → passing (`36/36`)
- `npm --workspace apps/web run typecheck` → passing
- `npm --workspace apps/web run build` → passing
- `npm --prefix backend test -- --run` → passing (`176/176`)
- `npm --prefix backend run build` → passing
