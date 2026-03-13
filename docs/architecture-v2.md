## AutoMapper Architecture

AutoMapper is an AI‑assisted schema mapping platform that connects core banking systems (Jack Henry SilverLake, Core Director, Symitar) and ERPs (SAP S/4HANA) to CRM targets (Salesforce Financial Services Cloud). It discovers source and target schemas, proposes entity/field mappings, annotates them with compliance metadata, and exports integration artefacts for multiple iPaaS platforms.

This document describes the current implementation architecture based on the code in the `AutoMapper` tree.

---

## High‑Level System Overview

- **Frontend**: Single‑page React application (Vite + TypeScript) in `frontend/`. It guides the user through connector selection, schema ingestion, AI orchestration, mapping review, and export.
- **Backend**: Express API (TypeScript, Node 22) in `backend/`. It exposes REST + SSE endpoints, orchestrates a 7‑agent pipeline, talks to external systems via connectors, and persists project/mapping state via Prisma or a file‑backed store.
- **Connectors**: Pluggable connector layer under `backend/src/connectors/` that abstracts SAP, Salesforce, and Jack Henry cores (plus an MCP‑based connector).
- **Agents**: Multi‑stage AI/heuristic pipeline under `backend/src/agents/` driven by an `OrchestratorAgent` that refines mappings and produces compliance output.
- **Exports**: A single canonical mapping model is adapted to JSON, YAML, CSV, DataWeave, Boomi XML, and Workato recipe JSON by `backend/src/services/exporter.ts`.
- **Telemetry & Error Reporting**: Frontend telemetry in `frontend/src/telemetry/` and backend error reporting / structured HTTP errors under `backend/src/services/` and `backend/src/utils/`.

---

## Backend Architecture

### Entry Point and HTTP Surface

- **File**: `backend/src/index.ts`
- **Responsibilities**:
  - Bootstraps Express, CORS, JSON body parsing, and request‑ID correlation.
  - Selects persistence implementation:
    - `DbStore` with Prisma when `DATABASE_URL` is set.
    - `FsStore` for local file‑backed demo mode (`DATA_DIR`, defaults to `./data`).
  - Registers global routes:
    - `GET /api/health` – health check.
    - Auth: `setupAuthRoutes(app)`.
    - OAuth: `setupOAuthRoutes(app)` (Salesforce Web Server Flow and status).
    - Error reporting ingest: `setupErrorReportingRoutes(app)`.
    - Connector catalogue & schema APIs: `setupConnectorRoutes(app, store)`.
    - Agent orchestration SSE routes: `setupAgentRoutes(app, store)`.
  - Protects project + field‑mapping endpoints with `authMiddleware`.
  - Implements project lifecycle endpoints directly:
    - `POST /api/projects` – create project and associated system records.
    - `GET /api/projects/:id` – hydrate a rich project payload (systems, entities, fields, relationships, mappings).
    - `POST /api/projects/:id/source-schema` – SAP schema upload, parsed by `parseSapSchema` and written via `store.replaceSystemSchema`.
    - `POST /api/projects/:id/target-schema/salesforce` – live or mock Salesforce metadata loading via `fetchSalesforceSchema`.
    - `POST /api/projects/:id/suggest-mappings` – computes heuristic (+ optional AI) entity and field mappings using `suggestMappings` and validates them with `validateMappings`.
    - `PATCH /api/field-mappings/:id` – update individual mappings from the review UI.
    - `GET /api/projects/:id/export/formats` – list available export formats from `EXPORT_FORMATS`.
    - `GET /api/projects/:id/export` – build and stream an export using `buildExport`.
    - `POST /api/projects/:id/agent-refine` – server‑sent events (SSE) endpoint that runs a focused refinement pipeline (`runAgentRefinement`) over existing mappings.
  - Central error handler that converts thrown errors into structured HTTP responses and emits telemetry via `captureException`.
  - Process‑level handlers for `unhandledRejection` and `uncaughtException`.

Key design points:

- **Thin HTTP layer**: `index.ts` mainly composes service functions and the store; business logic lives in services and agents.
- **Streaming endpoints**: `/agent-refine` and the dedicated orchestration routes (registered via `setupAgentRoutes`) use SSE to push incremental progress to the frontend.
- **Side‑effect connector registration**: `import './connectors/registerConnectors.js'` populates a global registry once at startup.

### Persistence Layer

- **Files**:
  - `backend/src/db/dbStore.ts` (not fully listed here) – Prisma‑backed implementation.
  - `backend/src/utils/fsStore.ts` – JSON‑file‑backed store used when no database URL is configured.
- **Shape**:
  - Stores canonical entities defined in `backend/src/types.ts` (e.g. `System`, `Entity`, `Field`, `Relationship`, `MappingProject`, `EntityMapping`, `FieldMapping`, `ValidationReport`).
  - Exposes high‑level methods used by the API:
    - `createProject`, `getProject`, `getState`, `replaceSystemSchema`, `updateProjectTimestamp`, `upsertMappings`, `patchFieldMapping`.

The store abstraction allows local demos with zero DB dependencies while still supporting a SQL backend in production.

### Connectors Layer

- **Registry**:
  - `backend/src/connectors/ConnectorRegistry.ts` defines:
    - `ConnectorMeta` – metadata returned by `GET /api/connectors` (display name, category, protocol, credential requirements, etc.).
    - `ConnectorFactory` – factory type for instantiating connectors.
    - `ConnectorRegistry` – registry that maps IDs to factories and metadata.
    - `defaultRegistry` – process‑wide singleton.
  - `resolveSystemType` maps `SystemType` (e.g. `sap`, `salesforce`, `jackhenry`) to a primary connector ID.

- **Registration**:
  - `backend/src/connectors/registerConnectors.ts` is a side‑effect module that registers all built‑in connectors into `defaultRegistry`:
    - `jackhenry-silverlake` → `SilverLakeConnector`
    - `jackhenry-coredirector` → `CoreDirectorConnector`
    - `jackhenry-symitar` → `SymitarConnector`
    - `jackhenry-mcp` → `JXchangeMCPConnector` (Model Context Protocol wrapper)
    - `salesforce` → `SalesforceConnector`
    - `sap` → `SAPConnector`
  - Each registration includes detailed human‑readable `description`, `protocol`, and `requiredCredentials`, plus `hasMockMode` to advertise demo support.

- **Implementations**:
  - Each connector implements `IConnector` from `backend/src/connectors/IConnector.ts`, providing:
    - Methods to fetch and normalise schemas into the canonical `Entity`/`Field` model.
    - Optional test endpoints and mock data paths.
  - The **JXchange MCP connector** delegates to an external MCP server defined by `JH_MCP_SERVER_URL`, with graceful fallback to mock mode.

Connectors are consumed by route handlers in `backend/src/routes/connectorRoutes.ts`, which merge per‑user OAuth tokens (stored in `ConnectorSessionStore`) with request‑time credentials.

### Services Layer

Key services live under `backend/src/services/`:

- **Mapping suggestion** – `mapper.ts`
  - Entry: `suggestMappings({ project, sourceEntities, targetEntities, fields })`.
  - For each source entity:
    - Chooses a best‑match target entity using string similarity (`bestStringMatch`, `jaccard`) and domain knowledge biases (Financial Services Cloud object preferences).
    - Computes a confidence score combining heuristic similarity and AI output (if available via `getAiSuggestions`).
    - Creates `EntityMapping` records with rationale text.
  - For each source field:
    - Scores each potential target field using:
      - Name/label similarity (`jaccard`).
      - Type compatibility (`typeCompatibilityScore`).
      - Domain heuristics (`coreToFscFieldBoost`) for core‑to‑FSC mappings.
    - Applies thresholds depending on whether the mapping is a core→FSC pair.
    - Optionally incorporates AI per‑field suggestions and transform hints from `getAiSuggestions`.
    - Derives a `TransformType` (`direct`, `concat`, `formatDate`, `lookup`, `trim`, etc.) via `inferTransform`.
  - Returns coherent `entityMappings` + `fieldMappings` used as the starting point for the agent pipeline.

- **Validation** – `validator.ts`
  - Entry: `validateMappings({ entityMappings, fieldMappings, fields, entities })` → `ValidationReport`.
  - Emits `ValidationWarning`s for:
    - Type mismatches based on `typeCompatibilityScore`.
    - Incomplete picklist coverage when source and target both have enumerated values.
    - Missing mappings for required target fields.
  - Produces a summary with counts by warning type, surfaced in the frontend review and export.

- **Export** – `exporter.ts`
  - Defines a shared `BuildInput` that includes project, systems, entities, fields, mappings, and optional validation.
  - Provides format‑specific builders:
    - `buildJsonExport` – canonical JSON mapping model.
    - `buildYamlExport` – human‑readable YAML for VCS review.
    - `buildCsvExport` – flat spreadsheet (one row per field mapping).
    - `buildDataWeaveExport` – MuleSoft DataWeave 2.0 script with per‑mapping comments and confidence labels.
    - `buildBoomiExport` – Dell Boomi Data Map XML descriptor.
    - `buildWorkatoExport` – Workato recipe JSON skeleton with datapill expressions.
  - Dispatcher: `buildExport(format, input)` – validates `format` against `EXPORT_FORMATS`, constructs a filename, and returns `{ content, mime, filename }` to `index.ts`, which decides whether to send JSON or attachment text.

- **Agent refinement** – `agentRefiner.ts`
  - Runs a focused re‑scoring/refinement process over existing mappings and streams intermediate `RefinementStep`s.
  - Used by `POST /api/projects/:id/agent-refine` in `index.ts` to provide an incremental improvement experience separate from full orchestration.

- **LLM abstraction** – `llmAdapter.ts`
  - Normalises calls to different providers (`openai`, `anthropic`) and exposes a single `getAiSuggestions` API to upstream services/agents.
  - When no API keys are configured, falls back to heuristic‑only mode while preserving the same interface.

- **Other services** – `schemaUploadParser.ts`, `sapParser.ts`, `errorReporting.ts`, `connectorSessionStore.ts`:
  - Implement parsing and ingestion of uploaded schemas.
  - Store per‑user Salesforce OAuth sessions.
  - Propagate structured error telemetry to a central sink.

### Agents and Orchestration Pipeline

- **Core types**: `backend/src/agents/types.ts`
  - `AgentContext` – immutable context for each agent run (project/system types, entities, fields, mappings, and `onStep` callback).
  - `AgentStep` – structured progress event (agent name, action, before/after mapping deltas, duration, metadata) streamed to clients via SSE.
  - `AgentResult` – agent output (updated mappings, steps, `totalImproved` count).
  - `ComplianceReport` – aggregate of compliance issues and counts (PII/PCI/SOX).

- **Orchestrator**: `backend/src/agents/OrchestratorAgent.ts`
  - Extends `AgentBase` and owns instances of:
    - `SchemaDiscoveryAgent`
    - `ComplianceAgent`
    - `BankingDomainAgent`
    - `CRMDomainAgent`
    - `ERPDomainAgent`
    - `MappingProposalAgent`
    - `MappingRationaleAgent`
    - `ValidationAgent`
  - **Execution order** (sequential pipeline):
    1. **SchemaDiscoveryAgent** – validates and enriches raw schemas.
    2. **ComplianceAgent** – flags compliance issues and attaches regulatory tags.
    3. **Domain agents** – conditionally run based on system types:
       - Banking (Jack Henry) – `BankingDomainAgent`.
       - CRM (Salesforce) – `CRMDomainAgent`.
       - ERP (SAP) – `ERPDomainAgent`.
       Domain agents merge their outputs into the current mapping set while preserving sequence and only adopting candidates that increase confidence.
    4. **MappingProposalAgent** – LLM‑assisted refinement of mappings (heuristic‑only fallback when LLM unavailable).
    5. **MappingRationaleAgent** – generates human‑readable rationale for each mapping, referencing AI‑refined scores when present.
    6. **ValidationAgent** – final consistency and coverage pass.
  - Tracks:
    - `allSteps` – flattened timeline of `AgentStep` events for UI.
    - `totalImproved` – count of mappings whose confidence improved across all agents.
    - `agentsRun` – which agents actually ran for this connector combination.
    - `durationMs` – end‑to‑end pipeline duration.
    - `complianceReport` – last compliance report emitted by `ComplianceAgent`.

- **Agent orchestration routes**: `backend/src/routes/agentRoutes.ts` (not shown here)
  - Implements `/api/projects/:id/orchestrate` and related endpoints.
  - Creates an `OrchestratorAgent`, wires `onStep` to stream SSE events (`agent_start`, `agent_complete`, `step`, `pipeline_complete`, `error`).
  - Persists updated mappings back into the store when orchestration completes.

This design separates orchestration (pipeline control, streaming) from individual agent implementations (domain and compliance logic).

---

## Frontend Architecture

### Entry Point and App Shell

- **Entry**:
  - `frontend/src/main.tsx` – React/Vite bootstrap.
  - `frontend/src/App.tsx` – main application component.

- **App responsibilities** (`App.tsx`):
  - Maintains **workflow step**: `'connect' → 'orchestrate' → 'review' → 'export'`.
  - Owns **project state**:
    - `project` (ID, name, system types).
    - Connector IDs (`sourceConnectorId`, `targetConnectorId`) and display names.
  - Owns **schema and mapping state**:
    - `sourceEntities`, `targetEntities`, `fields`.
    - `entityMappings`, `fieldMappings`.
    - `sourceSchemaMode` / `targetSchemaMode` (`live` / `mock` / `uploaded`).
    - `validation` (`ValidationReport` mirrored from backend).
    - `isOrchestrated` flag used to gate UI affordances.
  - Handles **Salesforce OAuth callback** query params on mount.
  - Sets global error reporting context via `setErrorReportingContext`.

The `App` component routes between child views:

- `ConnectorGrid` – connector selection and project setup.
- `AgentPipeline` – visualisation of the 7‑agent SSE pipeline.
- `MappingTable` – interactive mapping review table.
- `ExportPanel` – export controls and summary.
- `Sidebar` – persistent navigation and status indicator.
- `LandingPage` – initial marketing/overview screen before entering the studio.

### API Client and Telemetry

- **API client**: `frontend/src/api/client.ts`
  - Provides `api<T>(path, options?)` for JSON requests against the backend.
  - Encapsulates base URL building (`apiBase()`), auth token handling, and a `getEventSource` abstraction that can return a real `EventSource` or `MockEventSource` in demo mode.
  - Exposes `isDemoUiMode` and `resetMockState` to switch between live and embedded demo behaviour.

- **Telemetry**: `frontend/src/telemetry/errorReporting.ts`
  - `reportFrontendError` – posts structured error payloads to backend error ingest routes, used throughout `App.tsx` and pipeline components.
  - `setErrorReportingContext` – attaches workflow context (project, step, connectors) to subsequent error reports.

### Connector Selection and Project Setup

- **Component**: `frontend/src/components/ConnectorGrid.tsx`
  - Renders available source/target connectors using metadata from `GET /api/connectors`.
  - Allows mock vs live mode selection where applicable.
  - On proceed, calls `onProceed(srcId, tgtId, options)` provided by `App`.

- **Setup flow** (`handleConnectorProceed` in `App.tsx`):
  1. **Create project** via `POST /api/projects` with a human‑readable default name (e.g. "SilverLake → Salesforce").
  2. **Ingest source schema**:
     - If a source file is provided, uploads via `POST /api/projects/:id/schema/upload-file`.
     - Otherwise, calls `POST /api/projects/:id/schema/{srcId}` to request either live or mock schema from the connector.
  3. **Ingest target schema** using the same pattern.
  4. **Generate heuristic suggestions** via `POST /api/projects/:id/suggest-mappings`.
  5. **Load full project state** via `GET /api/projects/:id`.
  6. **Advance workflow step** to `'orchestrate'`.

Errors in this flow are reported via `reportFrontendError` and surfaced to the user in a validation box; on failure, connector and project state are reset.

### Orchestration Pipeline UI

- **Component**: `frontend/src/components/AgentPipeline.tsx`
  - Presents the 7‑agent pipeline as a vertical list, using `AGENT_DEFS` for label/description:
    - Schema Discovery
    - Compliance Scan
    - Banking Domain
    - CRM Domain
    - Mapping Proposal
    - Mapping Rationale
    - Validation
  - Establishes an SSE connection to `/api/projects/:id/orchestrate` (with `access_token` query param when available).
  - Normalises events emitted by the backend (`agent_start`, `agent_complete`, `step`, `pipeline_complete`, `error`) into `AgentStepState` objects for UI.
  - Enforces **minimum visibility durations** to prevent flicker:
    - `MIN_STEP_VISIBLE_MS` per step.
    - `MIN_PIPELINE_VISIBLE_MS` for the overall pipeline.
  - Queues event handling via `enqueueEvent` to avoid race conditions between rapid SSE events and React state updates.
  - Detects pipeline stalls: if no event is received for `STALL_TIMEOUT_MS`, the SSE stream is closed and the user is prompted to retry.
  - On completion:
    - Optionally reloads project state via REST as a source‑of‑truth.
    - Calls `onComplete` with `PipelineResult` (entity/field mappings, validation, counts, processing time).
    - Calls `onReviewReady` (from `App`) to advance to the `'review'` tab.

The component also exposes detailed stats: total mapped fields, entities, compliance flags, and warning counts, which are shown in a completion card.

### Mapping Review and Export

- **Mapping review**: `frontend/src/components/MappingTable.tsx`
  - Displays entity and field mappings with confidence, status, and rationale.
  - Allows the user to accept/reject/update mappings; changes are persisted via `PATCH /api/field-mappings/:id`.
  - Shows validation warnings grouped by type (type mismatch, missing required, picklist coverage).
  - Provides a call‑to‑action to proceed to Export.

- **Export**: `frontend/src/components/ExportPanel.tsx`
  - Fetches available formats from `GET /api/projects/:id/export/formats`.
  - Invokes `GET /api/projects/:id/export?format={json|yaml|csv|dataweave|boomi|workato}` to trigger download, using the filename from the response headers.
  - Surfaces statistics such as:
    - Number of entities and fields mapped.
    - How many mappings are accepted vs suggested.
    - Validation summary counts.

---

## Cross‑Cutting Concerns

### Authentication and OAuth

- **Auth**:
  - Implemented under `backend/src/auth/` and wired via `setupAuthRoutes` and `authMiddleware`.
  - `authMiddleware` protects `/api/projects` and `/api/field-mappings` routes by default.

- **Salesforce OAuth**:
  - Routes configured by `setupOAuthRoutes(app)` handle:
    - Initiation of the Web Server Flow.
    - Callback handling.
    - Connection status.
  - User‑specific Salesforce tokens are stored in `ConnectorSessionStore` and merged with request credentials for schema and data access.

### Error Handling and Telemetry

- **Backend**:
  - `captureException` and `sendHttpError` (from `backend/src/utils/httpErrors.ts`) standardise error responses (code, message, details, origin).
  - Global Express error handler converts thrown errors into JSON error payloads and logs metadata (`requestId`, path, method, userId).
  - Process‑level handlers send unhandled exceptions/rejections through the same telemetry channel.

- **Frontend**:
  - `reportFrontendError` posts errors to the backend error ingest routes with contextual metadata (workflow step, project, connectors).
  - `AppErrorBoundary` wraps the UI to catch React‑level render errors and report them.

### Demo vs Production Modes

- **Backend**:
  - Presence of `DATABASE_URL`, Salesforce, SAP, and Jack Henry credentials toggles between live and mock connector behaviour.
  - `FsStore` allows running the entire system without a database for demos.

- **Frontend**:
  - `isDemoUiMode` and `MockEventSource` enable a fully scripted demo experience where pipeline steps and events are simulated.
  - `demo.html` / `PREVIEW.html` bundle a standalone, file‑served experience with pre‑embedded schemas and events.

---

## End‑to‑End Flow Summary

1. **User opens the studio**:
   - `LandingPage` → `ConnectorGrid` in the React app.

2. **User selects connectors**:
   - `ConnectorGrid` posts to `/api/projects` to create a project.
   - Source and target schemas are ingested from connectors or uploaded files.
   - Backend computes initial heuristic/AI mapping suggestions and validation results.

3. **User runs the AI pipeline**:
   - `AgentPipeline` opens an SSE connection to `/api/projects/:id/orchestrate`.
   - Backend `OrchestratorAgent` runs schema discovery, compliance, domain agents, mapping proposal, rationale generation, and validation.
   - The frontend visualises progress in real time and receives a consolidated `PipelineResult`.

4. **User reviews mappings**:
   - `MappingTable` displays mappings, confidence, rationale, and validation warnings.
   - User adjusts mappings; updates are persisted via `PATCH /api/field-mappings/:id`.

5. **User exports the spec**:
   - `ExportPanel` lets the user choose a format.
   - Backend builds the requested export from the canonical mapping model and streams it as a download.

This architecture cleanly separates concerns between UI, orchestration, connectors, mapping logic, and exports, while keeping a single canonical mapping representation at the core of the system.

