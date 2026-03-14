# Agent Change Log

Append-only activity log for Codex and Claude updates.

## Entry Format
- Timestamp (UTC)
- Agent (`codex` or `claude`)
- Summary
- Branch / Commit
- Files

---

### 2026-02-27T18:26:55.234Z | CODEX
- Summary: Added shared Codex/Claude change logging workflow and audit scripts
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `<no-file-diff-detected>`
### 2026-02-27T18:27:41.964Z | CODEX
- Summary: Added no-git file-list guard for attribution
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `scripts/agent-log.mjs`, `docs/AGENT_LOGGING_WORKFLOW.md`
### 2026-02-27T18:27:52.053Z | CODEX
- Summary: Backfilled attribution for initial logging setup
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `scripts/agent-log.mjs`, `scripts/agent-history.mjs`, `docs/AGENT_CHANGE_LOG.md`, `docs/AGENT_LOGGING_WORKFLOW.md`, `README.md`, `package.json`
### 2026-02-27T18:36:46.771Z | CLAUDE
- Summary: Enhanced ConnectorGrid: full FSC entity lists, Demo/Live mode toggle, per-connector credential input panels, protocol+auth meta row; updated CSS; fixed tsconfig to exclude test files from build; rewrote README.md to reflect Phase 2 architecture; rebuilt AutoMapper-demo.html (244KB)
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `frontend/src/components/ConnectorGrid.tsx`, `frontend/src/styles.css`, `frontend/tsconfig.json`, `README.md`, `AutoMapper-demo.html`
### 2026-02-28T06:31:01.980Z | CLAUDE
- Summary: Sprint 1 (AM-001, AM-002, AM-003): Full FSC + SAP schemas, canonical SilverLake→Salesforce mapping engine, client-side 6-format export
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `demo-server.mjs`, `frontend/src/components/ExportPanel.tsx`, `frontend/src/App.tsx`, `AutoMapper-demo.html`
### 2026-02-28T11:44:08.308Z | CLAUDE
- Summary: KAN-13 BUG FIX: Fixed React 18 StrictMode mountedRef bug in AgentPipeline.tsx that caused all 7 pipeline agents to stall in Running state and never complete. Added mountedRef.current = true as first line of cleanup useEffect so remount correctly resets the guard. Also added res.flush() to demo-server.mjs write helper to prevent Node.js response buffering from stalling SSE stream. Rebuilt AutoMapper-demo.html (252KB).
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `frontend/src/components/AgentPipeline.tsx`, `demo-server.mjs`, `AutoMapper-demo.html`
### 2026-02-28T11:48:59.879Z | CLAUDE
- Summary: KAN-12 AUDIT: Confirmed ConnectionPanel.tsx is dead code via grep — zero external imports across all 10 other .tsx/.ts files in frontend/src. Component was an early prototype (3 connectors: Salesforce, Jack Henry, SAP; inline styles; window.location.href OAuth) that was fully superseded by ConnectorGrid.tsx (5 connectors, Live/Mock/Upload modes, popup OAuth). Deleted ConnectionPanel.tsx. TypeScript: 0 errors. Build: 252KB, 41 modules (no change). AutoMapper-demo.html rebuilt.
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `frontend/src/components/ConnectionPanel.tsx`, `AutoMapper-demo.html`
### 2026-02-28T12:11:53.406Z | CLAUDE
- Summary: KAN-15: Fix mock mapping showcase — expand Salesforce schema with 5 FSC objects + fix heuristic mapper with domain synonyms and nameSim guard.
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `demo-server.mjs`, `AutoMapper-demo.html`
### 2026-02-28T12:35:32.117Z | CLAUDE
- Summary: KAN-14: Custom Connector feature — Add Your Own System. Added POST /api/connectors/custom route to demo-server.mjs; modal with JDBC/REST/File Upload tabs + entity builder in ConnectorGrid.tsx; CSS for modal and custom card in styles.css; 'custom' category added to types.ts.
- Branch: `<no-git>`
- Commit: `<no-git>`
- Files: `demo-server.mjs`, `frontend/src/components/ConnectorGrid.tsx`, `frontend/src/styles.css`, `frontend/src/types.ts`, `AutoMapper-demo.html`
