# Agent Logging Workflow

Use this workflow for all Codex/Claude changes so ownership is explicit and auditable.

## 1) Record each change

- Codex:
  - `npm run log:codex -- --summary "what changed"`
- Claude:
  - `npm run log:claude -- --summary "what changed"`

Optional explicit file list:

- `npm run log:codex -- --summary "..." --files "frontend/src/App.tsx,backend/src/index.ts"`

If the working folder is not a git repo, `--files` is required.

## 2) Review history

- Last 20 entries:
  - `npm run log:history`
- Only Codex entries:
  - `npm run log:history -- --agent codex --limit 50`
- Only Claude entries:
  - `npm run log:history -- --agent claude --limit 50`

## Storage

- Human-readable log:
  - `docs/AGENT_CHANGE_LOG.md`
- Machine-readable log:
  - `docs/agent-change-log.jsonl`

## Commit convention (recommended)

Use commit subjects with agent prefix to avoid ambiguity in git history:

- `[CODEX] ...`
- `[CLAUDE] ...`
