# AutoMapper — Project Status

> **Purpose:** Single source of truth for any new session, agent, or collaborator asking "what's going on with AutoMapper?"
> **Owner:** Claude (Cowork) — update this file whenever board state or architecture meaningfully changes.
> **Last updated:** 2026-03-27
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

## Current Board State (2026-03-26)

### ✅ Done — Stable

| Area | What's shipped |
|---|---|
| **Core architecture** | Backend/frontend split, SSE orchestration, connector registry, FsStore + Prisma dual persistence |
| **Connectors** | Jack Henry (SilverLake, CoreDirector, Symitar) — mock + live; Salesforce FSC — jsforce + mock + enriched FSC catalog; SAP S/4HANA — OData + sapParser; jXchange MCP stub |
| **Agent pipeline** | 9-agent orchestration: SchemaDiscovery → SchemaIntelligence → Compliance → Banking/CRM/ERP/RiskClam → MappingProposal → MappingRationale → Validation |
| **RiskClam / BOSL** | `RiskClamDomainAgent` with 3-layer confidence boost (synonym +0.22, prefix-type +0.10/−0.20, FSC namespace +0.06); `riskclam` added to `SystemType`; `inferSystemType()` detects BOSL/RiskClam names; entity boost table; registered in OrchestratorAgent |
| **Schema Intelligence** | `SchemaIntelligenceAgent` (Step 2): 6-step pipeline — field classification, XML taxonomy recognition, 212-entry BOSL→FSC confirmed pattern boost (+0.30 exact / +0.08 family), one-to-many detection (23 flagged fields), Caribbean domain glossary annotation. `GET /api/schema-intelligence/patterns` and `/one-to-many` endpoints. Sync script at `backend/src/scripts/syncSchemaIntelligence.ts`. |
| **Schema Intelligence UI (KAN-78)** | `MappingTable` + `FieldMappingCard` surface all SchemaIntelligenceAgent metadata: confirmed-pattern green badge, formula-target amber warning (blocks Accept), one-to-many orange flag, Person Account blue annotation, Caribbean domain context. `SchemaIntelligenceMetadata` interface in `packages/contracts/types.ts`. |
| **One-to-many resolver (KAN-79)** | `OneToManyResolverPanel.tsx` — dedicated routing step in workflow for 23 flagged BOSL source fields. Lists all candidate Salesforce targets with confidence and rationale. Pre/post-boarding lifecycle toggle hint. Export gated until all routing decisions confirmed. Persisted to `resolvedOneToManyMappings` on project. |
| **Semantic mapping engine** | `fieldSemantics.ts` with semantic intent profiling, hard type-compatibility gates, LOS-prefix inference; `MappingProposalAgent` uses semantic+lexical+domain scoring |
| **LLM multi-provider** | `LLMGateway`: Gemini 1.5 Flash → Anthropic → OpenAI → heuristic fallback; per-call timeout/retry; output token cap; env-configurable ambiguity band |
| **BYOL (Bring Your Own LLM)** | `llmSettingsStore` (per-user config + usage, file-backed); `llmRuntimeContext` (AsyncLocalStorage injection); `GET/PUT /api/llm/config`, `GET /api/llm/usage`; `LLMSettingsPanel` UI: mode toggle, provider select, API key, model, custom base URL, pause toggle, "Use AutoMapper Default" button; usage dashboard: calls/tokens/failures/avg response/event log |
| **LLM Settings global page (KAN-81)** | `LLMSettingsPage.tsx` — standalone sidebar destination reachable from any workflow step; `llm-settings` added as `WorkflowStep`; breadcrumb topbar + stat summary bar; dark/light theme toggle |
| **Salesforce connector enrichment (KAN-83)** | `RecordType` model in Prisma (`sfRecordTypeId`, `name`, `label`, `isDefault`, `isActive`); `Entity.recordTypes` relation; live path reads `recordTypeInfos` from jsforce describe; mock includes rep. record types for Account/IndividualApplication/FinancialAccount. `isUpsertKey` on `ConnectorField`; `upsertKeys` map on `ConnectorSchema`. FSC objects (`FinServ__FinancialAccount__c`, `FinServ__FinancialAccountTransaction__c`, `FinServ__BillingStatement__c`, `FinServ__IndividualApplication__c`, `FinServ__FinancialGoal__c`, `FinServ__ReciprocalRole__c`) added to mock catalog with domain-correct field lists including `ExternalAccountId__c`. |
| **Upsert key + record type scoring (KAN-84)** | `MappingProposalAgent.scoreTargetCandidate()` — `externalIdScore`: +0.25 (source key → SF upsert key), +0.15 (source key → SF externalId), −0.10 penalty (non-key source → upsert key target). `AgentContext.targetRecordTypes` populated from ConnectorSchema. Rationale annotated with applicable record type variants. `upsertKeyMappings` + `recordTypeAnnotations` in step summary event. |
| **Project history** | `GET /api/projects` list endpoint (sorted by updatedAt, per-user owner filter, canExport flag); `ProjectHistoryPanel` UI: past projects with source→target, mapping count, conflict count, "Open Review" / "Open Export" buttons; reopen bypass (loads stored mappings, skips pipeline re-run) |
| **KAN-102 — Multi-project dashboard** | `DashboardPage.tsx` is now the default authenticated home route (`/` and `/dashboard`). Portfolio summary bar shows mapped fields, export-ready count, open conflicts, and active projects. Project cards support inline rename, reopen, duplicate, archive, and archived filtering. `/new` preserves the connector-first creation flow. Backend adds enriched `GET /api/projects`, `PATCH /api/projects/:id`, and `POST /api/projects/:id/duplicate` across both Prisma and FsStore paths. |
| **KAN-103 — Versioned exports + schema drift** | `buildJsonExport()` now embeds a deterministic source/target `schemaFingerprint`. JSON exports persist versioned `ExportVersion` records in Prisma or FsStore (latest 10 retained) with stored field snapshots, and `GET /api/projects/:id/versions` returns newest-first export history. `SchemaDiscoveryAgent` compares the current schema against the latest approved export and emits `schema_drift_detected` with blocker/warning/info drift classification. Frontend surfaces blockers via `SchemaDriftModal.tsx` and warning-only changes via `SchemaDriftBanner.tsx`. |
| **Export (KAN-77)** | 6 formats: JSON, YAML, CSV, MuleSoft DataWeave, Dell Boomi, Workato; live mode uses `fetch(..., { credentials: 'include' })` against `API_BASE`; standalone/demo mode routes through `api<string>()` → `mockApiCall()`; inline `exportError` state shown on failure |
| **Conflict resolution** | `conflicts.ts` service; `GET /api/projects/:id/conflicts`; `POST .../resolve`; `ConflictDrawer` slide-in with pick-winner UX |
| **Audit trail** | `writeAuditEntry` helper; 7 action types; `GET /api/projects/:id/audit` cursor-paginated; `AuditLogTab` with icons, relative time, Load older |
| **Bulk field ops** | `POST /api/mappings/bulk`, `POST /api/mappings/bulk-select`; `BulkActionBar` UI |
| **Learning loop** | 3-layer seed; ADR-002 Bayesian confidence formula; `SeedSummaryCard`; HISTORY/CANONICAL/AI badges in `MappingTable`; `recordMappingEvent` on accept/reject/modify |
| **Canonical schema** | 62-field ontology (4 domains); 100 system→canonical mappings; `GET /api/canonical/...` routes |
| **BOSL workbook ingestion** | `mappingWorkbookParser.ts` reads Excel mapping sheets; `POST /api/projects/:projectId/import-mapping-workbook` upserts derived mappings; returns import summary + unresolved rows |
| **Custom connectors** | Add Your Own System modal (REST/file tabs); PostgreSQL persistence via Prisma `CustomConnector` model + file-store fallback; rehydrated on login/session refresh |
| **Auth** | JWT header-based; bcryptjs; `GET /api/auth/setup` (first-user auto-admin); httpOnly cookie path; all async route handlers wrapped in try/catch (Express 4 safety); demo server includes auth stub endpoints; `SetupRoute` no longer redirects `unauthenticated` users away from `/setup` |
| **Frontend workflow** | Dashboard → New Project (connector setup) → Orchestrate → Routing (one-to-many resolver) → Review → Export |
| **Orchestration reliability** | SSE completes cleanly; stall detection uses heartbeat absence; ValidationAgent yields event loop in chunks; MappingRationaleAgent enforces LLM budget + degrades gracefully |
| **KAN-85 — Embedding semantic scoring** | `EmbeddingService` with OpenAI-first / Gemini fallback; `embeddingCache` on `AgentContext`; `embeddings_ready/skipped/failed` events; `MappingProposalAgent` hybrid semantic scoring |
| **KAN-86 — Top-K retrieval shortlist** | `candidateRetrieval.ts`, `DEFAULT_RETRIEVAL_TOP_K = 5`; `FieldMapping.retrievalShortlist` persisted; shortlist-consistency guard; isolated `automapper_vitest` Postgres test DB |
| **KAN-87 — Structured reranker** | `structuredReranker.ts` — bounded to shortlist; sibling context + compliance cues; `FieldMapping.rerankerDecision` persisted; `reranker_complete` event; BOSL→FSC fixture 20/20 (mock) |
| **KAN-88 — Global mapping optimizer** | `mappingOptimizer.ts` — 3-pass greedy: validity sweep, duplicate-target resolution, required field coverage. `optimizer_complete` event. `optimizerDisplacement` + `lowConfidenceFallback` on `FieldMapping`. |
| **KAN-82 — Schema Intelligence sync** | `GET /api/schema-intelligence/patterns` (full corpus + `?field=` filter); `GET /api/schema-intelligence/one-to-many`; `backend/src/scripts/syncSchemaIntelligence.ts` diff script; `npm run sync:schema-intelligence`; `backend/data/schema-intelligence/README.md` |
| **KAN-99 — Seed dedup fix** | `suggest-mappings` path now runs the global mapping optimizer over seed output before persisting — eliminates the 100+ duplicate-target collision bug where `CurrentBalance` had 101 source field claimants |
| **KAN-100 — RiskClam FSC target universe** | Expanded mock FinancialAccount and related FSC objects to include domain-correct fields: `FinServ__PaymentAmount__c`, `FinServ__LoanAmount__c`, `Date_Credit_Approved__c`, `Residual_Income__c`, `Monthly_Payment__c` — fixes collapse onto generic balance fields |
| **KAN-101 — RiskClam retrieval ranking** | `candidateRetrieval.ts` — Schema Intelligence match boost for same-object confirmed patterns; generic distractors penalized when source concept mismatches. Key deltas: `AMT_PAYMENT` → `Monthly_Payment__c` 0.777 (was 0.528); `DATE_APPROVAL` → `Date_Credit_Approved__c` 0.733 (was 0.520). 193/193 tests passing. |
| **Open bug sweep (PR #24)** | Sweep of remaining Jira-tracked open bugs merged to main. |
| **KAN-89 — Benchmark harness + active learning (PR #25)** | `backend/src/__tests__/benchmark/` with `npm run benchmark`; 58-pair `benchmark-pairs.jsonl` gold set; `review-decisions.jsonl` file-backed active learning; `POST /api/review-decisions`; `candidateRetrieval.ts` applies accepted/rejected score boosts. Merged 2026-03-20. |
| **KAN-80 — BYOL LLM config Prisma migration** | `LLMUserConfig` + `LLMUsageEvent` Prisma models; AES-256-GCM encrypted API keys at rest; `apiKeyHint` masking; dual Prisma/file persistence; migration `20260325101500_add_llm_settings_tables`; startup seed from legacy `llm-configs.json` / `llm-usage.json`; file-fallback store test coverage. |

### 🔄 In Progress / Known Gaps

| Gap | Detail | Priority |
|---|---|---|
| **🔴 KAN-77 — Export downloads broken** | `ExportPanel.tsx` calls `fetch()` directly without `credentials: 'include'` — auth cookies never sent, so backend returns 401. In standalone/demo mode `apiBase()` returns `''` (empty string), making the request relative and hitting nothing. No user-facing error message shown on failure — error is silently swallowed to console only. | **HIGH — blocks demo** |
| **🟠 KAN-78 — SchemaIntelligence UI invisible** | `SchemaIntelligenceAgent` is live in the pipeline and emits rich metadata (`confirmedPattern`, `isOneToMany`, `formulaTarget`, `personAccountOnly`) via `AgentStep.metadata`, but `MappingTable` and `FieldMappingCard` render none of it. Confirmed pattern hits, formula warnings, one-to-many flags, and FSC namespace badges need to surface in the Mapping Review UI. | HIGH |
| **🟠 KAN-79 — One-to-many routing unresolved** | In progress on branch `codex/KAN-79-one-to-many-resolver`: adds `/api/schema-intelligence/patterns`, persisted `resolvedOneToManyMappings`, a dedicated `routing` workflow step, `OneToManyResolverPanel`, and export gating until routing decisions are confirmed. Pending PR review/merge. | HIGH |
| **🟡 KAN-88 — Global mapping optimizer** | 3-pass greedy optimizer: (1) validity sweep — hard bans, type-compat, out-of-scope lookups; (2) duplicate target resolution — keep highest-confidence claimant, demote rest through shortlist; (3) required field coverage — promote only if `retrievalScore ≥ 0.30`. `optimizer_complete` step event. **Depends on KAN-87 (done) + KAN-90 for scope enforcement (in progress).** | HIGH — next dispatch |
| **🟡 KAN-90 — Entity relationship graph** | In review on branch `codex/KAN-90-relationship-graph`: adds `relationshipGraph.ts`, wires `RelationshipGraph` + scoped `relationships` onto `AgentContext`, emits `relationship_graph_ready`, passes target-entity scope into the optimizer so lookup targets can be rejected when `referenceTo` points outside the loaded target schema, and now surfaces graph-driven `loadOrder` metadata in export specs. | MEDIUM |
| **🟠 KAN-90 — Entity relationship graph (PR #27 — changes requested)** | `RelationshipGraph`, `buildRelationshipGraph`, optimizer scope wiring all implemented. Missing: (1) `loadOrder` array in export spec — `topologicalOrder()` exists but never called from `exporter.ts`; (2) `relationship_graph_ready` step event not emitted from `OrchestratorAgent`. Awaiting Codex fix. | HIGH |
| **🟠 KAN-91 — Salesforce validation rule extraction (PR #28 — changes requested)** | Rule extraction, formula parsing, schema propagation all solid. Missing: (1) `partial_coverage_risk` detection — validator warns on all rules unconditionally, not just where some referenced fields are unmapped; (2) no `validationRuleSafety` export section (`suppressBeforeLoad`, `loadBlockingRules`, `partialCoverageRisks`); (3) silent error suppression without `validation_rules_unavailable` warning; (4) only 1 formula fixture tested vs 3 required; no classification tests. Awaiting Codex fix. | HIGH |
| **🟡 KAN-95 — Audit logging crashes in no-DB mode** | `backend/src/db/audit.ts:28` calls `prisma.auditEntry.create()` unconditionally even when `DATABASE_URL` is unset. Produces repeated `PrismaClientInitializationError` log noise on every project creation and orchestration run. Needs a `isDatabaseAvailable()` guard that routes to a file-backed sink (or no-op) in FsStore mode. | MEDIUM |
| `GET /api/projects` pagination | List reads from in-memory FsStore; needs `limit`/`cursor` pagination at scale | Low |
| **Reranker runtime wins** | No `rerankerDecision` was persisted in the first real-LLM smoke run (2026-03-16). `shouldUseReranker` may not be triggering at runtime because all mappings are already decisive, or the LLM is returning confidence < 0.55 threshold. Needs investigation. | Low (observation) |

### 🟡 Parked (H2)

- KAN-32: User Roles & Permissions EPIC
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

## Next Codex Work Queue (2026-03-25)

Two PRs awaiting fixes before re-review. One fresh dispatch in flight.

**Awaiting Codex fixes (changes-requested):**
1. **KAN-90 (PR #27)** — Add `loadOrder` to export spec + emit `relationship_graph_ready` step event. Both missing from the current PR.
2. **KAN-91 (PR #28)** — Add `partial_coverage_risk` logic to validator, `validationRuleSafety` export section, `validation_rules_unavailable` warning on permission error, and 2 additional formula fixture tests + classification tests.

**Next after those clear:**
3. **KAN-95** — Audit no-DB crash: `isDatabaseAvailable()` guard in `backend/src/db/audit.ts`. Quick fix, low risk.

---

## Recent Delivery Log

### 2026-03-25 — Codex (KAN-91 branch)
- **KAN-91 — Salesforce validation rule extraction** — active Salesforce validation rules are now extracted through the existing jsforce connection, classified into full-coverage vs partial-coverage risk during validation, and surfaced in both Review and export metadata.
  - Added `packages/connectors/salesforceValidationRules.ts` to query active `ValidationRule` metadata, ignore scoped identifiers like `$User.Id` / `Account.Name`, and attach rule summaries to affected target fields.
  - Updated both Salesforce schema paths (`packages/connectors/salesforce.ts`, `packages/connectors/SalesforceConnector.ts`) so fetched target fields can carry `validationRules` metadata in live mode; mock `Opportunity` metadata now includes a representative rule for local validation coverage.
  - Extended field contracts and persistence to carry validation-rule hints (`packages/contracts/types.ts`, `packages/connectors/types.ts`, `backend/src/types.ts`, `backend/src/db/dbStore.ts`, Prisma migration `20260325094500_add_field_validation_rules`).
  - `backend/src/services/validator.ts` now distinguishes fully covered rules from `partial_coverage_risk`, emits `validation_rules_unavailable` when tooling extraction fails, and writes a structured `validationRuleSafety` summary into the `ValidationReport`.
  - `backend/src/services/exporter.ts` now includes `validationRuleSafety` in canonical JSON export so downstream consumers can see whether rules were fully covered, partially covered, or unavailable.
  - Added regression coverage for scoped/cross-object formulas, unavailable rule loading, rule classification, and export output.
### 2026-03-25 — Claude (Cowork)
- **KAN-80 implemented for review.** Added legacy startup seeding from `llm-configs.json` / `llm-usage.json` into Prisma-backed `LLMUserConfig`, plus explicit file-fallback test coverage for `llmSettingsStore`.
- **KAN-89 reviewed + approved → Done.** PR #25 passed all 6 acceptance criteria: benchmark harness, 58-pair fixture, 5 metrics, review-decision file write, retrieval boost on next run, correct `.gitignore` exclusions.
- **KAN-90 (PR #27) — changes requested.** 2 gaps: `loadOrder` missing from export spec; `relationship_graph_ready` step event not emitted. Graph construction, optimizer wiring, and tests all pass.
- **KAN-91 (PR #28) — changes requested.** 4 gaps: `partial_coverage_risk` detection not implemented (unconditional per-field warn); no `validationRuleSafety` export section; silent error suppression without `validation_rules_unavailable` warning; insufficient formula fixtures and no classification tests. Foundation (extraction, formula parsing, type plumbing) is solid.
- **`CLAUDE.md` created** at repo root — auto-loaded session instructions for Claude Code and Cowork covering team model, Jira constants, PR workflow, key entry points, architecture invariants, review standards, and session startup checklist.

### 2026-03-21 — Codex (PRs #21–24, main)
- **KAN-99 — Seed dedup fix (PR #21):** `suggest-mappings` now runs the global mapping optimizer before persisting seed output. Eliminates the duplicate-target explosion (101 source fields mapping to `CurrentBalance`).
- **KAN-100 — RiskClam FSC target universe (PR #22):** Expanded mock FinancialAccount to include `FinServ__PaymentAmount__c`, `FinServ__LoanAmount__c`, `Date_Credit_Approved__c`, `Residual_Income__c`, `Monthly_Payment__c`, `Total_Assets__c` and related fields. Fixes collapse onto generic balance targets.
- **KAN-101 — RiskClam retrieval ranking (PR #23):** `candidateRetrieval.ts` — Schema Intelligence confirmed-pattern boost for same-object matches; generic distractors penalized on concept mismatch. `AMT_PAYMENT` → `Monthly_Payment__c` 0.777 (was 0.528); `DATE_APPROVAL` → `Date_Credit_Approved__c` 0.733 (was 0.520). 193/193 tests passing.
- **Open bug sweep (PR #24):** Remaining tracked Jira bugs resolved.

### 2026-03-20 — Codex (PR #20)
- **KAN-79 — One-to-many resolver** — one-to-many routing decision flow added end-to-end.
  - Added `GET /api/schema-intelligence/patterns` and `POST /api/projects/:id/one-to-many-resolutions` in `backend/src/index.ts`.
  - Added `resolvedOneToManyMappings` persistence in both Prisma-backed and FsStore-backed project paths (`backend/src/db/dbStore.ts`, `backend/src/utils/fsStore.ts`, Prisma migration `20260318023500_add_one_to_many_routing_resolutions`).
  - Added `schemaIntelligencePatterns.ts` helper service + backend tests.
  - Added `routing` workflow step and `OneToManyResolverPanel` in the frontend; export is now blocked when `ProjectPreflight.unresolvedRoutingDecisions > 0`.
  - Added standalone/demo API support for routing candidate lookup and resolution persistence in `packages/core/api-client.ts`.
  - Validation on branch: backend `tsc --noEmit` **pass**, backend `npm test -- --run` **184/184**, frontend `npm test -- --run` **41/41**, frontend build **pass**.

### 2026-03-13 — Claude
- **SchemaIntelligenceAgent shipped** — new Step 2 in the OrchestratorAgent pipeline (active when `targetSystemType === 'salesforce'`).
  - Created `backend/src/agents/SchemaIntelligenceAgent.ts` — 6-step pipeline: field classification, XML taxonomy recognition, 212-entry confirmed BOSL→FSC pattern boost (+0.30 exact / +0.08 family), one-to-many detection (23 fields), Caribbean domain glossary, confidence & rationale enrichment.
  - Created `backend/src/agents/schemaIntelligenceData.ts` — all confirmed patterns, one-to-many set, formula targets, system audit fields, and Caribbean domain tokens compiled from the automapper-schema-intelligence skill reference files.
  - Copied `mapping-patterns.md`, `fsc-data-model.md`, `domain-glossary.md` to `backend/data/schema-intelligence/` as human-readable source of truth.
  - Updated `OrchestratorAgent.ts` — wired SchemaIntelligenceAgent as Step 2; renumbered all subsequent steps; updated JSDoc header.
  - Backend typecheck: **pass** (exit 0).
- **Jira tickets KAN-77 to KAN-82 created** — full sprint backlog on `abhatia88.atlassian.net` project KAN with root cause analysis, file references, implementation guidance, and acceptance criteria ready for Codex.

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

## Next Codex Work Queue (2026-03-16)

Prioritised. Pick up in order. All tickets are live in Jira (project KAN on abhatia88.atlassian.net).

**Current dispatch: KAN-88** (global mapping optimizer). KAN-90 (relationship graph) is already running in parallel.
KAN-95 (audit no-DB) is a low-risk bug that can be folded into KAN-88's branch or dispatched separately.

---

### 0. KAN-88 — [FEATURE] Global mapping optimizer (3-pass) *(current dispatch)*

See full spec in the Jira ticket. Brief:
- **Pass 1:** validity sweep — hard bans (formula/read-only/autonumber targets), type-incompatible targets, lookup-out-of-scope (KAN-90 required for this sub-check)
- **Pass 2:** duplicate target resolution — keep highest-confidence claimant; demote rest through `FieldMapping.retrievalShortlist.candidates`
- **Pass 3:** required field coverage — promote unmatched source fields only if `retrievalScore ≥ 0.30`; else mark `uncovered_required`
- Emit `optimizer_complete` step event with full metadata shape
- Fixture must contain: deliberate duplicate targets, missing required field, hard-banned target, AI fallback below 0.30, type-incompatible pairing

**Depends on:** KAN-87 ✅ merged. KAN-90 for relationship scope — implement the scope check only if KAN-90 is already merged; otherwise skip that AC with a TODO comment.

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

### 2026-03-16 01:45 IST — KAN-85 embedding semantic scoring branch raised from main

Implemented by Codex.

Scope completed:
- Added `EmbeddingService` with enriched field text, OpenAI-first embedding fetch, Gemini fallback, and graceful disabled/failed outcomes.
- Added `embeddingCache` to `AgentContext` and wired `OrchestratorAgent` to build embeddings once per pipeline run.
- Emitted truthful orchestration events: `embeddings_ready`, `embeddings_skipped`, and `embeddings_failed`.
- Updated `MappingProposalAgent` to use embedding-assisted hybrid semantic scoring and expose `(embed)` in rationale when embeddings participate.
- Updated the initial `suggestMappings` path to use concept-aware hybrid semantic scoring instead of flat intent-only scoring.

Files changed:
- `backend/src/services/EmbeddingService.ts`
- `backend/src/services/fieldSemantics.ts`
- `backend/src/agents/types.ts`
- `backend/src/agents/OrchestratorAgent.ts`
- `backend/src/agents/MappingProposalAgent.ts`
- `backend/src/services/mapper.ts`
- `backend/src/__tests__/embeddingService.test.ts`
- `backend/src/__tests__/agents.test.ts`
- `backend/src/__tests__/mapper.test.ts`

Validation:
- `cd backend && ../node_modules/.bin/tsc --noEmit` -> passing
- `cd backend && ./node_modules/.bin/vitest run src/__tests__/embeddingService.test.ts src/__tests__/mapper.test.ts src/__tests__/agents.test.ts` -> passing (`58/58`)
- `cd backend && ./node_modules/.bin/vitest run --run` -> passing (`167/167`)

### 2026-03-16 02:20 IST — KAN-86 rebuilt cleanly from merged KAN-85 baseline

Implemented by Codex.

Scope completed:
- Added a dedicated top-K retrieval layer in `backend/src/services/candidateRetrieval.ts`.
- Fixed `K = 5` for this ticket and exposed it only as an optional test override at call sites.
- Persisted structured retrieval evidence directly on `FieldMapping.retrievalShortlist` in the shared contracts, backend types, Prisma schema, DB store, and FS store.
- Reworked `MappingProposalAgent` to build retrieval shortlists once, emit a single `retrieval_ready` event, and reuse the structured shortlist through deterministic ranking and LLM-gated refinement.
- Reworked the initial `suggestMappings` path to seed every suggested field mapping with the same structured retrieval shortlist.
- Added regression coverage for top-K boundary, descending ranking order, unknown-intent promotion via alias evidence, event emission, and persistence reload.

Files changed:
- `backend/src/services/candidateRetrieval.ts`
- `backend/src/services/mapper.ts`
- `backend/src/agents/MappingProposalAgent.ts`
- `backend/src/db/dbStore.ts`
- `backend/src/utils/fsStore.ts`
- `backend/src/types.ts`
- `packages/contracts/types.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260315211500_add_field_mapping_retrieval_shortlist/migration.sql`
- `backend/src/__tests__/candidateRetrieval.test.ts`
- `backend/src/__tests__/retrievalPersistence.test.ts`
- `backend/src/__tests__/agents.test.ts`
- `backend/src/__tests__/mapper.test.ts`

Validation:
- `cd backend && npm run typecheck` -> passing
- `cd backend && npm run lint` -> passing
- `cd backend && npm test -- --run src/__tests__/candidateRetrieval.test.ts src/__tests__/mapper.test.ts src/__tests__/agents.test.ts src/__tests__/retrievalPersistence.test.ts` -> passing (`60/60`)
- `cd backend && npm run build` -> passing
- `npm --workspace apps/web run build` -> passing
- `cd backend && DATABASE_URL='postgresql://postgres:password@localhost:5432/automapper_kan86_test' npx prisma db push --skip-generate` -> passing
- `cd backend && DATABASE_URL='postgresql://postgres:password@localhost:5432/automapper_kan86_test' npm test -- --run` -> passing (`172/172`)

RiskClam -> Salesforce comparison (same XML + same mock target object set, deterministic/no-LLM run):
- Baseline `main`: `121` field mappings, `9` entity mappings, `0` persisted retrieval shortlists
- KAN-86 rebuild: `130` field mappings, `9` entity mappings, `130` persisted retrieval shortlists
- Workbook-aligned hit count against the current mock target schema remained `0` in both runs because the workbook’s custom FSC target fields are not present in the current mock schema. KAN-86 improves retrieval structure and coverage, but not workbook parity on its own.

### 2026-03-16 03:15 IST — KAN-86 shortlist consistency fix after review

Implemented by Codex.

Scope completed:
- Closed the two review gaps where `MappingProposalAgent` Pass 2 and `suggestMappings` seeding could select a target that was not present in the persisted top-K `retrievalShortlist`.
- Restricted LLM-gated retargets in `backend/src/agents/MappingProposalAgent.ts` to shortlisted targets only.
- Restricted AI seeding overrides in `backend/src/services/mapper.ts` to shortlisted targets only, so newly created mapping artifacts cannot point outside their own structured shortlist.
- Added regression coverage for both failure modes.
- Fixed the plain `cd backend && npm test` review DoD by adding Vitest test bootstrap that provisions an isolated PostgreSQL database and pushes the current schema before the suite runs.

Files changed:
- `backend/src/agents/MappingProposalAgent.ts`
- `backend/src/services/mapper.ts`
- `backend/src/__tests__/agents.test.ts`
- `backend/src/__tests__/mapper.test.ts`
- `backend/vitest.config.ts`
- `backend/src/__tests__/setupEnv.ts`
- `backend/src/__tests__/globalSetup.ts`

Validation:
- `cd backend && npm run typecheck` -> passing
- `cd backend && npm run lint` -> passing
- `cd backend && npm test -- --run src/__tests__/agents.test.ts src/__tests__/mapper.test.ts src/__tests__/candidateRetrieval.test.ts src/__tests__/retrievalPersistence.test.ts` -> passing (`62/62`)
- `cd backend && npm test -- --run` -> passing (`174/174`)
- `npm --workspace apps/web run build` -> passing

Review-fix result:
- `FieldMapping.targetFieldId` now remains consistent with `FieldMapping.retrievalShortlist` in both the agent orchestration path and the initial project seeding path.
- The backend test suite now runs from a dedicated `automapper_vitest` database instead of depending on whatever local application database state already exists.

### 2026-03-16 03:05 IST — KAN-87 structured reranker stacked on KAN-86

Implemented by Codex.

Scope completed:
- Replaced the old full-schema LLM refinement path in `backend/src/agents/MappingProposalAgent.ts` with a shortlist-only structured reranker that operates only on the `KAN-86` retrieval shortlist.
- Added `backend/src/services/structuredReranker.ts` to build bounded reranker payloads with source field context, sibling context (2 before and 2 after), entity routing cues, compliance cues, and shortlisted target evidence.
- Persisted structured reranker output directly on `FieldMapping.rerankerDecision` through the shared contracts, backend types, Prisma schema, DB store, and FS store.
- Emitted `reranker_complete` events with candidate count, top-1 confidence, evidence signals, and reasoning so orchestration telemetry shows real reranker outcomes instead of generic refinement messages.
- Added a 20-case BOSL->FSC fixture benchmark in `backend/data/bosl-fsc-reranker-fixture.json` and regression coverage for shortlist-only prompting, persistence reload, and reranker precision improvement over the retrieval-only baseline.

Files changed:
- `backend/src/agents/MappingProposalAgent.ts`
- `backend/src/services/structuredReranker.ts`
- `backend/src/db/dbStore.ts`
- `backend/src/utils/fsStore.ts`
- `backend/src/types.ts`
- `packages/contracts/types.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260316024500_add_field_mapping_reranker_decision/migration.sql`
- `backend/src/__tests__/agents.test.ts`
- `backend/src/__tests__/retrievalPersistence.test.ts`
- `backend/src/__tests__/structuredReranker.test.ts`
- `backend/data/bosl-fsc-reranker-fixture.json`

Validation:
- `cd backend && npm run typecheck` -> passing
- `cd backend && npm run lint` -> passing
- `cd backend && npm test -- --run src/__tests__/agents.test.ts src/__tests__/structuredReranker.test.ts src/__tests__/retrievalPersistence.test.ts src/__tests__/mapper.test.ts` -> passing (`59/59`)
- `cd backend && DATABASE_URL='postgresql://postgres:password@localhost:5432/automapper_kan87_test' npx prisma db push --skip-generate` -> passing
- `cd backend && DATABASE_URL='postgresql://postgres:password@localhost:5432/automapper_kan87_test' npm test -- --run` -> passing (`174/174`)
- `npm --workspace apps/web run build` -> passing

Fixture benchmark:
- Baseline retrieval top-1 precision: `8/20` (`40%`)
- Structured reranker precision: `20/20` (`100%`)
- This exceeds the Jira minimum acceptance threshold of `>= 75%` top-1 precision on the BOSL->FSC fixture.

Stacking note:
- `KAN-87` is intentionally stacked on `KAN-86` PR `#13`.

### 2026-03-16 (morning IST) — KAN-87 reviewed + approved by Claude, merged to main

Reviewed by Claude (Cowork).

All 5 acceptance criteria passed:
- ✅ Reranker input bounded to shortlist (full schema never passed)
- ✅ `rerankerDecision` persisted on `FieldMapping` with confidence, evidence signals, reasoning
- ✅ `reranker_complete` step event emitted with candidate count + top-1 confidence
- ✅ 20-pair BOSL→FSC fixture test passes at 20/20 (baseline 8/20) — exceeds ≥75% threshold
- ✅ Ambiguous/unknown-intent fields rank measurably better vs pre-reranker baseline

Fix applied during review: `backend/src/__tests__/globalSetup.ts` — wrapped `execFileSync('dropdb'/'createdb'/'prisma db push')` in try/catch with graceful `console.warn` fallback, so `npm test` no longer crashes on machines without PostgreSQL.

Transition: KAN-87 → Done.

Runtime observation: first real-LLM smoke run showed no `rerankerDecision` persisted. `shouldUseReranker` may not be triggering at runtime (all mappings already decisive at Pass 1, or LLM confidence < 0.55 threshold). Logged as a Known Gap — see above.

### 2026-03-16 03:25 IST — KAN-87 synced with KAN-86 shortlist consistency fix

Implemented by Codex.

Scope completed:
- Ported the `KAN-86` shortlist-consistency fix into the stacked `KAN-87` branch where it still applied.
- Kept `suggestMappings` AI overrides inside the persisted `retrievalShortlist` contract.
- Added the isolated Vitest PostgreSQL bootstrap (`automapper_vitest`) so plain `cd backend && npm test` remains deterministic on the reranker branch as well.
- Left the shortlist-only reranker path intact, since it already selects only from the persisted shortlist and did not need the old Pass 2 LLM guard.

### 2026-03-17 01:35 IST — KAN-88 global mapping optimizer

Implemented by Codex.

Scope completed:
- Added a pure post-reranker optimizer in `backend/src/services/mappingOptimizer.ts` that performs a three-pass greedy resolution over the final mapping set.
- Pass 1 removes invalid targets (hard-ban targets, type-incompatible targets, and relationship-scope targets when a graph is present), walking `retrievalShortlist.candidates` for the next valid replacement and marking mappings `unmatched` when no valid replacement exists.
- Pass 2 resolves duplicate target assignments globally, keeping the highest-confidence claimant and demoting the rest through the persisted retrieval shortlist until every active target assignment is unique.
- Pass 3 covers required/key targets only from unmatched source fields whose persisted shortlist contains that target at `retrievalScore >= 0.30`; no low-score promotion is allowed.
- Added optimizer metadata to `FieldMapping` (`optimizerDisplacement`, `lowConfidenceFallback`) and introduced `FieldMappingStatus = 'unmatched'` in shared/backend contracts.
- Persisted optimizer metadata through Prisma + FS store (`optimizerDisplacement`, `lowConfidenceFallback`) and added migration `backend/prisma/migrations/20260317131500_add_field_mapping_optimizer_metadata/migration.sql`.
- Wired the optimizer into `backend/src/agents/MappingProposalAgent.ts` after the structured reranker and before final emission, with a new `optimizer_complete` step event that reports duplicate resolution, uncovered required fields, and low-confidence AI fallback flags.
- Updated backend consumers (`index.ts`, `validator.ts`, `conflicts.ts`, `exporter.ts`, `agentRefiner.ts`) to treat `unmatched` as an inactive mapping state.
- KAN-90 relationship scope is implemented on branch `codex/KAN-90-relationship-graph`; until that branch merges, `main` still skips lookup-scope rejection in the optimizer.

Files changed:
- `packages/contracts/types.ts`
- `packages/connectors/types.ts`
- `backend/src/types.ts`
- `backend/src/services/mappingOptimizer.ts`
- `backend/src/utils/mappingStatus.ts`
- `backend/src/agents/MappingProposalAgent.ts`
- `backend/src/db/dbStore.ts`
- `backend/src/utils/fsStore.ts`
- `backend/src/services/conflicts.ts`
- `backend/src/services/validator.ts`
- `backend/src/services/exporter.ts`
- `backend/src/services/agentRefiner.ts`
- `backend/src/index.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260317131500_add_field_mapping_optimizer_metadata/migration.sql`
- `backend/src/__tests__/mappingOptimizer.test.ts`
- `backend/src/__tests__/agents.test.ts`
- `backend/src/__tests__/retrievalPersistence.test.ts`

Validation:
- `cd backend && npx tsc --noEmit` -> passing
- `cd backend && npm run lint` -> passing
- `cd backend && npm test -- --run` -> passing (`179/179`)
- `cd backend && npx prisma generate` -> passing

Acceptance notes:
- Duplicate target assignments are removed from the final active mapping set.
- Required/key coverage is only promoted from unmatched sources when the shortlist score is `>= 0.30`; weak candidates remain uncovered rather than being force-assigned.
- Hard-banned targets do not survive the optimizer when a valid alternative exists.
- `optimizer_complete` is emitted from `MappingProposalAgent` with the required metadata shape, including the Jira-specified `aiFailbackFlagged` key.
- Relationship scope checks are now covered on the active KAN-90 branch through `RelationshipGraph.isInScope()` and optimizer displacement tests.
- KAN-90 review fixes now add `relationship_graph_ready` SSE telemetry and `loadOrder` export metadata driven by `RelationshipGraph.topologicalOrder()`.

## 2026-03-17 KAN-77 Export Download Fix (Implemented by Codex)

Summary:
- Fixed export downloads in `apps/web/src/components/ExportPanel.tsx` so live mode now uses `fetch(..., { credentials: 'include' })` against `API_BASE`, standalone/demo mode routes through `api<string>()`, and users see inline error feedback instead of silent failures.
- Exported `API_BASE` from `packages/core/api-client.ts` for absolute live download URLs.
- Added frontend regression coverage for live downloads, standalone downloads, and inline error clearing in `apps/web/src/components/ExportPanel.test.tsx`.
- Added `export-error` styling in `apps/web/src/styles.css`.
- Fixed the Vitest web harness so `localStorage.clear()` is always available in `apps/web/src/test/setup.ts`, and updated `apps/web/src/MappingStudioApp.test.tsx` to match the current LLM settings UI text structure.

Validation:
- `cd backend && npx tsc --noEmit` -> passing
- `cd backend && npm test -- --run` -> passing (`179/179`)
- `npm --workspace apps/web run typecheck` -> passing
- `npm --workspace apps/web run test -- --run` -> passing (`40/40`)
- `npm --workspace apps/web run build` -> passing

## 2026-03-20 KAN-101 RiskClam ranking fix (Implemented by Codex)

Summary:
- Tightened `backend/src/services/candidateRetrieval.ts` so same-object Schema Intelligence matches get a retrieval boost and generic distractors are penalized when they miss the source field's specific RiskClam concept.
- Added object-alias matching for Schema Intelligence targets such as `FA / Loan`, so `DATE_APPROVAL` can correctly boost `Date_Credit_Approved__c` on `FinancialAccount` and `Loan`.
- Left entity routing unchanged. This ticket only fixes field ranking inside the routed target object; package-level routing debt like `AMT_TOTAL_BOSL` remains a separate concern.
- Added focused regressions in:
  - `backend/src/__tests__/candidateRetrieval.test.ts`
  - `backend/src/__tests__/mapper.test.ts`

Measured retrieval deltas on the same synthetic scorer inputs used to reproduce the bug:
- `AMT_PAYMENT`
  - before: `Total_Fee_Amount__c 0.551`, `Disbursement_Amount__c 0.551`, `Monthly_Payment__c 0.528`
  - after: `Monthly_Payment__c 0.777`, `Disbursement_Amount__c 0.417`, `Total_Fee_Amount__c 0.408`
- `DATE_APPROVAL`
  - before: `OpenDate 0.540`, `Date_Credit_Approved__c 0.520`
  - after: `Date_Credit_Approved__c 0.733`, `OpenDate 0.388`
- `AMT_APPROVED_LOAN`
  - after: `Loan_Amount_formula__c 0.697`, `Disbursement_Amount__c 0.417`, `Total_Fee_Amount__c 0.408`
  - note: the optimizer still hard-bans formula targets later, which is expected

Validation:
- `cd backend && npx tsc --noEmit` -> passing
- `cd backend && npm test -- --run` -> passing (`193/193`)
