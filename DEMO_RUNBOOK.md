# AutoMapper Demo Runbook (1-Week Demo Mode)

## Goal

Run a reliable local demo without requiring Postgres or live credentials.

This build now supports:
- demo auth bootstrap from the frontend
- backend file-backed storage when `DATABASE_URL` is not set
- schema discovery + mapping suggestions in mock mode

## Prerequisites

- Node.js + npm installed
- Dependencies installed at repo root and backend/frontend workspaces

## Start the Demo (Local)

Open two terminals in the repo root:

1. Backend (demo-safe, no DB required)

```bash
npm run demo:backend
```

2. Frontend (binds to loopback)

```bash
npm run demo:frontend
```

## URLs

- Frontend: `http://127.0.0.1:5173/` (or `5174` if `5173` is in use)
- Backend API: `http://127.0.0.1:4000`

## Recommended Demo Flows

### Best cross-system story (now produces mappings)

- Source: `Jack Henry SilverLake`
- Target: `Salesforce CRM`

Expected result:
- schema discovery succeeds
- heuristic mapping suggestions are non-empty
- agent pipeline can run

### Backup flows (very reliable)

- `SAP -> Salesforce` (should produce non-empty suggestions)
- `Salesforce -> Salesforce` (high-confidence visible mappings)
- `SAP -> SAP` (high-confidence visible mappings)

## Demo Script (Suggested)

1. Open frontend URL
2. Select source + target systems
3. Click `Discover schemas`
4. Wait for setup to complete (project creation + source/target schema ingest + suggestions)
5. Run orchestration pipeline
6. Review mappings (accept/reject a few)
7. Export (CSV/JSON)

## Demo Mode Behaviors (Important)

- If no `DATABASE_URL` is configured, backend runs in file-backed mode (`backend/data`).
- Frontend auto-registers/logs in a demo user and attaches a JWT for protected endpoints.
- Connectors may operate in `mock` mode unless valid live credentials are provided.

## Troubleshooting

### "Discover schemas" fails immediately

Check:
- backend is running on `:4000`
- frontend is using the current Vite port (5173 or 5174)
- refresh the page after backend restart

### Frontend says port 5173 is in use

Vite will move to the next port (e.g. `5174`). Use the printed URL.

### Backend crashes on startup with Prisma / DATABASE_URL errors

Use:

```bash
npm run demo:backend
```

This uses the no-DB demo path.

### Live connector credentials fail but UI continues

Connector routes were hardened for credentialed requests. If credentials are supplied and live connection fails, the API returns an error instead of silently using mock mode.

## Pre-Demo Checklist

- [ ] Backend running (`/api/health` returns `{"ok":true}`)
- [ ] Frontend page loads
- [ ] `Jack Henry SilverLake -> Salesforce` setup produces mappings
- [ ] Orchestration step completes
- [ ] Export works (CSV or JSON)
- [ ] Backup flow tested (`Salesforce -> Salesforce`)

