# ADR-001: Repository Structure — Monorepo Layout with Ownership Boundaries

**Status:** Accepted
**Date:** 2026-02-28
**Author:** Claude (Staff Engineer / Architect)
**Ticket:** KAN-20 (SPEC) / KAN-21 (BUILD)

---

## Context

AutoMapper is growing from a single-file demo into a multi-connector financial data mapping platform supporting Jack Henry (SilverLake, CoreDirector, Symitar), Salesforce FSC, SAP S/4HANA, and arbitrary custom connectors. The current flat monorepo structure creates:

- **Ownership ambiguity** between Claude (architect, contracts) and Codex (builder, implementation). Both agents edit the same files, causing merge conflicts and unintended scope drift.
- **No canonical API contract location.** `frontend/src/types.ts`, `demo-server.mjs`, and `backend/src/` all define overlapping type shapes with no single source of truth.
- **No architecture decision history.** Design choices are embedded in code comments or Jira descriptions, not a durable, reviewable record.
- **Connector interfaces scattered.** Each connector is a direct implementation with no shared interface contract, making normalization and substitution hard to verify.

---

## Decision

Adopt a structured monorepo layout with explicit ownership assignment per directory. The boundary rule is simple: **Claude writes `/packages/contracts` and `/docs/adr`; Codex implements everything else to match.**

---

## Target Layout

```
AutoMapper-main/
├── apps/
│   ├── web/                  ← Codex owns (React + TS + Vite)
│   │   ├── src/
│   │   ├── public/
│   │   └── vite.config.ts
│   └── demo-api/             ← Codex owns (Express/Node mock server)
│       └── demo-server.mjs
│
├── packages/
│   ├── contracts/            ← Claude authors; Codex consumes (read-only)
│   │   ├── openapi/          ← YAML/JSON OpenAPI specs per endpoint group
│   │   ├── types.ts          ← Canonical TypeScript types (replaces frontend/src/types.ts)
│   │   └── schemas/          ← JSON Schema files for entity validation
│   ├── connectors/           ← Claude defines interfaces; Codex implements
│   │   ├── interface.ts      ← IConnector, ISchemaProvider, INormalizer
│   │   ├── salesforce/
│   │   ├── jackhenry/
│   │   ├── sap/
│   │   └── custom/
│   └── core/                 ← Codex implements; Claude reviews
│       ├── auth/             ← token management, OAuth helpers
│       ├── errors/           ← canonical error types, codes
│       ├── retry/            ← backoff, circuit-breaker primitives
│       └── logging/          ← structured log helpers (no PII)
│
└── docs/
    ├── adr/                  ← Claude owns (this directory)
    ├── runbooks/             ← Claude owns
    └── (existing files)
```

---

## Migration Mapping (Current → Target)

| Current path | Target path | Owner after migration |
|---|---|---|
| `frontend/` | `apps/web/` | Codex |
| `demo-server.mjs` | `apps/demo-api/demo-server.mjs` | Codex |
| `frontend/src/types.ts` | `packages/contracts/types.ts` | Claude |
| `frontend/src/api/client.ts` | `packages/core/api-client.ts` | Codex |
| `backend/src/connectors/` | `packages/connectors/` | Claude (interface) / Codex (impl) |
| `backend/src/__tests__/` | `packages/connectors/<name>/__tests__/` | Codex |
| `docs/` | `docs/` (add `adr/`, `runbooks/` subdirs) | Claude |

---

## Connector Interface Contract

Claude will author `packages/connectors/interface.ts` defining:

```typescript
// IConnector — every connector must implement this
export interface IConnector {
  readonly id: string;           // stable kebab-case connector ID
  readonly displayName: string;
  readonly protocol: string;

  /**
   * Verify connectivity and auth. Returns latencyMs.
   * Must not throw on failure — return { connected: false, error }.
   */
  test(credentials: ConnectorCredentials): Promise<TestResult>;

  /**
   * Discover the schema for the given system side.
   * Must return entities + fields in the canonical shape.
   */
  fetchSchema(options: SchemaFetchOptions): Promise<SchemaPayload>;
}

// INormalizer — maps raw connector field names to canonical domain names
export interface INormalizer {
  normalize(raw: RawField[]): NormalizedField[];
}
```

Codex implements each connector to satisfy this interface. No ad-hoc connector calls are permitted outside of implementations of `IConnector`.

---

## Workspace Configuration

Root `package.json` becomes an npm/pnpm workspace root:

```json
{
  "name": "automapper",
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```

`apps/web/vite.config.ts` gets path aliases:

```typescript
resolve: {
  alias: {
    '@contracts': path.resolve(__dirname, '../../packages/contracts'),
    '@core':      path.resolve(__dirname, '../../packages/core'),
    '@connectors': path.resolve(__dirname, '../../packages/connectors'),
  }
}
```

---

## Non-Functional Constraints

- **Zero runtime changes.** The migration is purely structural — no business logic moves, no API surface changes, no schema changes.
- **Tests must pass.** `npm run typecheck` and `npm run build` must exit 0 after migration. All existing unit tests must pass.
- **Incremental migration is acceptable.** If full migration is too disruptive in one PR, Codex may stage it as: (a) directory skeleton + workspace config, (b) `apps/` moves, (c) `packages/` extraction.
- **No import duplication.** After migration, `frontend/src/types.ts` is deleted and `apps/web/` imports only from `@contracts/types`.

---

## Consequences

**Positive:**
- Claude and Codex can work in parallel without file conflicts (different directory ownership).
- A single `packages/contracts/types.ts` eliminates the current type drift between `demo-server.mjs` and `frontend/src/types.ts`.
- `IConnector` interface makes connector substitution and testing deterministic.
- ADR directory gives the project a durable design memory.

**Negative / Risks:**
- Import path refactor is mechanical but large (~40 files). Codex must update all `../../types` and `../types` imports.
- Workspace hoisting can introduce peer-dependency conflicts. Codex should verify with `npm install --workspaces` after restructure.
- Build CI must be updated to run from workspace root, not `frontend/`.

---

## Alternatives Considered

| Option | Rejected because |
|---|---|
| Keep flat structure, just add `docs/adr/` | Does not resolve ownership ambiguity or type duplication |
| Full polyrepo (separate git repos per package) | Too much overhead for a 2-agent team at current scale |
| Nx or Turborepo | Adds tooling complexity; npm workspaces sufficient for now |

---

## Review Checklist (before BUILD starts)

- [x] ADR stored in `/docs/adr/` and linked from Jira SPEC ticket
- [ ] `packages/contracts/types.ts` drafted by Claude (KAN-20 deliverable)
- [ ] `packages/connectors/interface.ts` drafted by Claude (KAN-20 deliverable)
- [ ] BUILD ticket KAN-21 created with migration steps as subtasks
- [ ] Codex has confirmed Vite path alias approach is compatible with current tsconfig
