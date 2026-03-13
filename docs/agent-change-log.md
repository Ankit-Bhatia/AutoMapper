# Agent Change Log

Tracks implementation entries by automation agent.

| Timestamp (UTC) | Agent | Message |
| --- | --- | --- |
| 2026-02-28T18:52:44.748Z | codex | KAN-21 monorepo restructure stabilization: flattened packages/connectors and moved connector tests |
| 2026-02-28T18:52:48.164Z | claude | KAN-21 compatibility check entry added for cross-agent traceability |
| 2026-02-28T19:03:00.095Z | codex | KAN-38 dark-theme token migration applied in apps/web/src/styles.css with animation keyframes |
| 2026-02-28T19:11:56.385Z | codex | KAN-39 implemented sidebar SVG mark, status strip, and landing hero/simulator animation redesign |
| 2026-02-28T19:12:00.224Z | codex | KAN-40 implemented connector category accents, modal tab pills, and mapping table confidence/keyboard/group header upgrades |
| 2026-02-28T19:55:39.673Z | codex | KAN-42 hardened backend strict-mode build: monorepo tsconfig alignment, connector typing fixes, MCP store typing updates, and full root build+tests passing |
| 2026-03-01T07:07:21.292Z | codex | KAN-44 completed ADR-001 hardening: apps/demo-api/server.mjs migration, workspace package identity updates, runbooks added, and workspace dependency stabilization |
| 2026-03-01T07:07:25.247Z | codex | KAN-41 completed horizontal AgentPipeline graph UI: hex nodes, animated beams, timestamped event log, responsive overflow, and animated completion counters |
| 2026-03-01T18:37:03.848Z | codex | KAN-58/59/60/61 completed: backend tsc clean, apps migration state verified, auth JWT email+cookie assertions hardened, prisma migrate+generate executed, Jira moved to Done |
| 2026-03-01T19:10:46.678Z | codex | Completed KAN-57/KAN-62/KAN-63 in AutoMapper repo: added audit trail model+routes+UI tab, validated canonical/org routes, ran prisma generate/seed, backend+frontend tests/build, and updated Jira comments/status to Done. |
| 2026-03-01T19:32:32.786Z | codex | Completed KAN-56: implemented backend conflict detection/resolution + preflight conflict gating, added frontend ConflictDrawer/badge/row highlighting, added standalone mock parity, ran build+tests, and updated Jira comment/status to Done. |
| 2026-03-03T18:48:02.788Z | codex | Added automation script to sync project status and Jira comments in one command. |
| 2026-03-03T18:53:48.286Z | codex | Enabled LLM+Context mode wiring: backend now emits llmProvider/hasLLM in SSE start events; frontend shows intelligence mode badge; suggest-mappings mode labels updated to context-only vs llm+context; tests/build passing. |
| 2026-03-03T21:21:46.887Z | codex | Added Gemini-capable backend brain path: multi-provider LLM gateway (anthropic/gemini/openai), provider fallback, provider-aware suggest-mappings metadata, and AI path hardening so quota/provider failures fall back cleanly to heuristics. Restarted backend and verified Gemini key detection via live probe. |
| 2026-03-05T20:59:02.857Z | codex | Implemented PostgreSQL persistence for custom connectors (with automatic file-store fallback). Added Prisma CustomConnector model + migration, refactored connectorRoutes custom connector read/write paths to use Prisma when DATABASE_URL is set, added startup backfill from custom-connectors.json to DB, and validated with migrate deploy + full backend typecheck/tests. |
| 2026-03-06T20:51:17.153Z | codex | Completed mapping-engine overhaul: added semantic intent profiling and hard compatibility gates, reduced raw type dominance for string-heavy metadata, upgraded suggestMappings scoring/rationale to semantic+lexical+adaptive-type+domain, aligned MappingProposalAgent ranking with semantic gates, added ValidationAgent semantic mismatch rejection, and enabled LOS-prefix type inference across inferred schema modes. |
