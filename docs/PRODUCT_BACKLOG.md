# AutoMapper — Product Backlog

**Owner:** Claude (PM / BA / Tech Lead)  
**Dev:** Codex  
**Last updated:** 2026-02-28

---

## Working Model

| Role | Agent | Responsibilities |
|---|---|---|
| PM / BA / Tech Lead | Claude | Requirements, prioritization, acceptance criteria, architecture decisions, spec writing, review |
| Developer | Codex | Implementation, git operations, test execution, change log entries (`npm run log:codex`) |

**Handoff protocol:**
1. Claude writes a spec in `docs/SPRINT_NNN.md`
2. Codex implements and logs `npm run log:codex -- --summary "..." --files "..."`
3. Claude reviews output, updates backlog, writes next spec

---

## Product Vision

AutoMapper is a **demo-first, sell-on-POC** enterprise integration tool.  
Primary buyer: Integration architects at banks migrating from Jack Henry cores to Salesforce FSC.  
Primary demo flow: SilverLake → Salesforce FSC, end-to-end in under 90 seconds.

---

## Current State (as of 2026-02-28)

### ✅ Complete
- Backend: 5 connectors (SilverLake, CoreDirector, Symitar, Salesforce FSC, SAP), all with live+mock modes
- Backend: 7-agent orchestration pipeline with SSE streaming
- Backend: JWT auth + Salesforce OAuth 2.0 Web Server Flow
- Backend: 6 export formats (JSON, YAML, CSV, DataWeave, Boomi, Workato)
- Backend: 11 test files
- Frontend: LandingPage, ConnectorGrid (Demo/Live toggle + credential panels), AgentPipeline, MappingTable, ExportPanel, Sidebar, ErrorBoundary
- Standalone demo HTML (244KB, works on file:// protocol)
- Agent change logging system (Codex)

### ❌ Gaps (ordered by priority)

| # | Gap | Impact | Who noticed |
|---|---|---|---|
| G1 | demo-server.mjs: Salesforce only has 3 objects (missing 5 FSC objects); SAP only has 2 objects (missing Customer, Supplier, CostCenter) | Demo breaks if target is Salesforce FSC; mapping suggestions are incomplete | PM audit |
| G2 | App.tsx does not pass live credentials from ConnectorGrid to backend `/api/connectors/:id/schema` in Live mode | Live mode credential panel is cosmetic — no real connection | PM audit |
| G3 | Backend test suite status unknown — tsconfig fix may have broken test discovery | CI/CD unreliable | Tech lead |
| G4 | ConnectionPanel.tsx exists but its role vs ConnectorGrid is unclear — potential dead code or conflicting UX | UX confusion, bundle bloat | PM audit |
| G5 | demo-server.mjs mapping engine produces random pairings — SilverLake→Salesforce FSC should produce deterministic, high-quality suggestions matching mockData.ts | Demo shows weak/wrong mappings | PM audit |
| G6 | ExportPanel calls `/api/projects/:id/export` but in standalone demo mode there is no backend — export silently fails | Demo dead-end at export step | PM audit |
| G7 | Salesforce OAuth redirect URI not validated in `.env.example` — `SF_APP_REDIRECT_URI` is missing its default value | First-run live setup fails | Tech lead |
| G8 | LandingPage metrics (fields, coverage %, pipeline timing) are hardcoded estimates that don't reflect real SilverLake→SF numbers | Sales credibility | BA audit |
| G9 | MCP server (mcp-server.mjs) has not been reviewed or tested | Unknown state | Tech lead |

---

## Prioritized Backlog

### P0 — Demo-critical (Sprint 1, Codex)
Must be done before any external demo.

- **AM-001** Update demo-server.mjs with full FSC Salesforce schema (8 objects) and full SAP schema (5 objects) — *see SPRINT_001.md*
- **AM-002** Update demo-server.mjs mapping engine to produce deterministic, credible SilverLake→Salesforce FSC field suggestions — *see SPRINT_001.md*
- **AM-003** Wire export in standalone demo: ExportPanel must work in STANDALONE mode without a backend (client-side JSON/CSV/YAML generation from in-memory mappings) — *see SPRINT_001.md*

### P1 — MVP live mode (Sprint 2, Codex)
Required before showing to a real Salesforce org or JH instance.

- **AM-004** Wire App.tsx to pass live credentials from ConnectorGrid to `/api/connectors/:id/schema` and handle the response
- **AM-005** Salesforce OAuth Web Server Flow: add frontend "Connect with Salesforce" button that opens `/api/oauth/salesforce/authorize` in a popup, handles callback, updates connection status badge in ConnectorGrid
- **AM-006** Connection status badge: show green/red live status in ConnectorGrid card after credential test

### P2 — Quality & stability (Sprint 3, Codex)
- **AM-007** Run full backend test suite; fix any failures; add missing test for CoreDirector connector mock mode
- **AM-008** Audit ConnectionPanel.tsx — determine if it's used, if not remove it; if yes, integrate cleanly with ConnectorGrid
- **AM-009** Add `/api/connectors/:id/test` UI — show latency + connection status in the credential panel

### P3 — Product polish (Sprint 4+)
- **AM-010** LandingPage: replace hardcoded metrics with real numbers derived from mockData.ts entity/field counts
- **AM-011** MCP server review and smoke-test
- **AM-012** Add JH SilverLake and SAP to Salesforce OAuth-style connection wizard
- **AM-013** Implement `PATCH /api/field-mappings/:id` optimistic UI update in MappingTable (currently re-fetches whole project)
- **AM-014** Add confidence threshold filter in MappingTable (slider: show only mappings above X% confidence)

---

## Definition of Done (all tickets)

1. Feature works in both Demo mode (standalone HTML) and Live mode (local dev server)
2. No TypeScript errors (`tsc -b --noEmit` passes)
3. No new test regressions
4. `npm run log:codex` entry added with `--files` listing all changed files
5. Claude reviews and marks ticket closed in this backlog

---

## Non-Goals (MVP)

- Mobile/responsive layout
- Multi-tenancy / team workspaces
- Persistent cloud storage (Postgres not required for MVP)
- Symitar live connection (low priority — credit union market secondary)
- JH MCP connector (waiting on JH to publish their MCP server)
