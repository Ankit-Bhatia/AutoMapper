# Architecture (Phase 1)

## Backend

- `src/index.ts`: REST API and route handlers
- `src/connectors/salesforce.ts`: Salesforce metadata fetch (live + mock)
- `src/services/sapParser.ts`: OData XML / JSON / CSV schema parsers
- `src/services/mapper.ts`: heuristic + optional AI mapping suggestion engine
- `src/services/validator.ts`: mapping validation report generation
- `src/services/exporter.ts`: JSON/CSV export builder
- `src/utils/fsStore.ts`: local JSON persistence

## Frontend

- Single-page React app with three tabs:
  - Project Setup
  - Mapping Review
  - Export

## Data Model

Implements required normalized entities:
- System, Entity, Field, Relationship
- MappingProject, EntityMapping, FieldMapping

See `backend/src/models/types.ts` for canonical TypeScript definitions.
