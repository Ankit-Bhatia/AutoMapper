# ADR-002 — PostgreSQL, Canonical Schema, and Org-Scoped Learning Layer

**Date:** 2026-03-01
**Status:** Accepted
**Deciders:** Ankit Bhatia (product), Claude (architecture)
**Supersedes:** Nothing (additive to ADR-001)

---

## Context

AutoMapper currently stores all data — projects, field mappings, connector schemas — in a flat JSON file store (`FsStore`). This works for single-session demo use but has three critical gaps:

1. **No shared knowledge.** Every new project re-discovers the same schemas from scratch. The system has no memory of what worked before.
2. **No canonical reference.** Mappings are expressed as direct system-to-system links (`SilverLake.CIF_Customer.CustLN → Salesforce.Contact.LastName`). Adding a third system requires building a new mapping set from scratch rather than routing through a shared canonical representation.
3. **No client-specific learning.** Each organisation has its own conventions, naming quirks, and compliance requirements. The system cannot adapt to a customer's known preferences.

This ADR introduces a PostgreSQL-backed knowledge layer that addresses all three gaps.

---

## Decision

Introduce PostgreSQL (via Prisma ORM) as a **shared knowledge database** alongside the existing FsStore.

**FsStore remains** for project-level transactional data: project records, in-progress field mappings, agent pipeline state. These are fast-changing, session-scoped, and do not benefit from centralisation.

**PostgreSQL handles** the shared, persistent, cross-project knowledge:
- The canonical field ontology
- System-to-canonical schema mappings
- Organisation (client) records
- Derived mapping history and confidence scores

---

## The Three-Layer Model

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 3: Client-Specific Derived Mappings (org-scoped)             │
│  "Org A always maps CustLN → BillingContact__c (custom field)"      │
│  → highest confidence, checked first                                 │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: Canonical Transitive Mappings (global, shared)            │
│  SilverLake.CIF_Customer.CustLN                                     │
│       → canonical.customer.last_name                                │
│       → Salesforce.Contact.LastName                                 │
│  → medium-high confidence, used as fallback                         │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1: Canonical Schema (global, curated)                        │
│  The universal field ontology — system-agnostic concepts            │
│  canonical.customer.last_name, canonical.account.balance, etc.      │
│  → ground truth, hand-curated + AI-assisted expansion               │
└─────────────────────────────────────────────────────────────────────┘
```

### How a new project uses all three layers:

When a user starts a SilverLake → Salesforce FSC project for Org A:

1. **Check org's derived mappings** (Layer 3): retrieve all previously accepted mappings for this org + this system pair. Pre-seed the project with these at their stored confidence score. These are shown as `pre-confirmed` status — the user can still reject them.
2. **Fill gaps via canonical** (Layer 2): for any source field not covered by Layer 3, find its canonical concept, then find the target system's field for that concept. Propose these at `suggested` status.
3. **Run AI pipeline** (Layer 1 + novel): for fields with no Layer 3 or Layer 2 coverage, the agent pipeline runs as today and proposes mappings. These are `suggested` at the agent's confidence score.

Over time, Layer 3 coverage grows and the AI pipeline is only invoked for genuinely novel or changed fields.

---

## Database Schema (PostgreSQL via Prisma)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Canonical ontology ────────────────────────────────────────────

model CanonicalDomain {
  id          String           @id @default(uuid())
  name        String           @unique  // "customer", "account", "transaction", "product"
  description String
  fields      CanonicalField[]
}

model CanonicalField {
  id              String                    @id @default(uuid())
  domainId        String
  domain          CanonicalDomain           @relation(fields: [domainId], references: [id])
  conceptName     String                    // "last_name", "billing_address_line1"
  displayLabel    String                    // "Customer Last Name"
  description     String
  dataType        String                    // canonical type: string | decimal | date | boolean | picklist
  complianceTags  String[]                  // GLBA_NPI | BSA_AML | SOX_FINANCIAL | FFIEC_AUDIT | PCI_CARD
  isDeprecated    Boolean                   @default(false)
  systemFields    SystemFieldCanonical[]

  @@unique([domainId, conceptName])
}

// ─── System schemas ────────────────────────────────────────────────

model SystemSchema {
  id           String                 @id @default(uuid())
  systemId     String                 // "jackhenry-silverlake", "salesforce-fsc", "sap-s4hana"
  systemName   String
  version      String                 // "2024.1", "Spring 25", etc.
  effectiveFrom DateTime
  isLatest     Boolean                @default(true)
  entities     SystemEntity[]
}

model SystemEntity {
  id           String        @id @default(uuid())
  schemaId     String
  schema       SystemSchema  @relation(fields: [schemaId], references: [id])
  entityName   String        // "CIF_Customer", "Account", "BusinessPartner"
  displayLabel String
  fields       SystemField[]

  @@unique([schemaId, entityName])
}

model SystemField {
  id              String                 @id @default(uuid())
  entityId        String
  entity          SystemEntity           @relation(fields: [entityId], references: [id])
  fieldName       String                 // "CustLN", "LastName", "NAME_LAST"
  displayLabel    String
  nativeType      String
  isRequired      Boolean                @default(false)
  isKey           Boolean                @default(false)
  isDeprecated    Boolean                @default(false)
  canonicalisations SystemFieldCanonical[]

  @@unique([entityId, fieldName])
}

model SystemFieldCanonical {
  id               String         @id @default(uuid())
  systemFieldId    String
  systemField      SystemField    @relation(fields: [systemFieldId], references: [id])
  canonicalFieldId String
  canonicalField   CanonicalField @relation(fields: [canonicalFieldId], references: [id])
  confidence       Float          @default(1.0)  // 0–1; hand-curated = 1.0
  createdBy        String         @default("system")  // "system" or userId

  @@unique([systemFieldId, canonicalFieldId])
}

// ─── Organisations ────────────────────────────────────────────────

model Organisation {
  id              String           @id @default(uuid())
  name            String
  slug            String           @unique  // used in API paths
  createdAt       DateTime         @default(now())
  derivedMappings DerivedMapping[]
  mappingEvents   MappingEvent[]
}

// ─── Derived mappings (org-scoped learning) ───────────────────────

model DerivedMapping {
  id                  String       @id @default(uuid())
  orgId               String
  org                 Organisation @relation(fields: [orgId], references: [id])
  sourceSystemId      String       // "jackhenry-silverlake"
  sourceEntityName    String       // "CIF_Customer"
  sourceFieldName     String       // "CustLN"
  targetSystemId      String       // "salesforce-fsc"
  targetEntityName    String       // "Contact"
  targetFieldName     String       // "LastName"
  preferredTransform  String       @default("direct")  // most-used transform type
  acceptCount         Int          @default(0)
  rejectCount         Int          @default(0)
  confidence          Float        @default(0.0)  // recomputed on every event
  lastAcceptedAt      DateTime?
  lastRejectedAt      DateTime?
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt

  @@unique([orgId, sourceSystemId, sourceEntityName, sourceFieldName, targetSystemId, targetEntityName, targetFieldName])
  @@index([orgId, sourceSystemId, targetSystemId])
}

// ─── Mapping events (raw feed into DerivedMapping) ────────────────

model MappingEvent {
  id                String       @id @default(uuid())
  orgId             String
  org               Organisation @relation(fields: [orgId], references: [id])
  projectId         String       // FsStore project id (cross-reference)
  fieldMappingId    String       // FsStore FieldMapping id
  actorUserId       String
  actorEmail        String
  actorRole         String
  action            String       // "accepted" | "rejected" | "modified"
  sourceSystemId    String
  sourceEntityName  String
  sourceFieldName   String
  targetSystemId    String
  targetEntityName  String
  targetFieldName   String
  transformType     String
  timestamp         DateTime     @default(now())

  @@index([orgId, sourceSystemId, targetSystemId])
  @@index([projectId])
}
```

---

## Confidence Scoring Formula

Derived mapping confidence is recomputed on every `MappingEvent` write using a **Bayesian recency-weighted score**:

```typescript
function computeConfidence(mapping: DerivedMapping): number {
  const total = mapping.acceptCount + mapping.rejectCount;
  if (total === 0) return 0;

  // Raw acceptance rate
  const rawRate = mapping.acceptCount / total;

  // Recency bonus: boost if recently accepted, decay if not touched in > 90 days
  const daysSinceAccepted = mapping.lastAcceptedAt
    ? (Date.now() - mapping.lastAcceptedAt.getTime()) / 86_400_000
    : 365;
  const recencyFactor = Math.exp(-daysSinceAccepted / 90); // half-life ≈ 62 days

  // Volume factor: more observations = more trust (caps at 1.0 after ~20 events)
  const volumeFactor = Math.min(total / 20, 1.0);

  return rawRate * (0.7 + 0.2 * recencyFactor + 0.1 * volumeFactor);
}
```

Confidence thresholds:
- `>= 0.85` → `pre-confirmed` (shown as accepted, user can still reject)
- `0.60 – 0.84` → `suggested` (agent-quality suggestion, highlighted)
- `< 0.60` → not surfaced from derived store (fall back to canonical or AI)

---

## Migration Path

Phase 1 (this ADR): Postgres added alongside FsStore. FsStore remains authoritative for projects. Postgres handles canonical schema and learning. No data migrated.

Phase 2 (future): Projects migrated to Postgres. FsStore deprecated. Full relational model including Users, Projects, FieldMappings in Postgres.

---

## API Surface (new endpoints)

```
GET  /api/canonical/domains                          → list canonical domains
GET  /api/canonical/domains/:id/fields               → canonical fields in domain
GET  /api/systems/:systemId/fields                   → system schema fields
GET  /api/systems/:systemId/fields/:fieldId/canonical → canonical mapping for field

GET  /api/org/:orgSlug/derived-mappings              → all derived mappings for org
GET  /api/org/:orgSlug/derived-mappings/:src/:tgt    → mappings for a system pair
POST /api/org/:orgSlug/mapping-events                → record an accept/reject event
```

Projects call `GET /api/org/:orgSlug/derived-mappings/:src/:tgt` at project creation to pre-seed mappings.

---

## Consequences

**Positive:**
- Mapping quality compounds over time — each accepted mapping improves the next project
- Adding a new target system (e.g., nCino, Temenos) immediately benefits from canonical mappings to any already-supported source system
- Client-specific behaviour (custom fields, org conventions) is captured and reused
- FFIEC/SOX audit requirements are easier to satisfy with a durable, queryable history

**Negative / risks:**
- Postgres adds operational overhead (connection pooling, migrations, backups) — mitigated by using Prisma Migrate and a managed PG instance (Railway, Supabase, or Render)
- Canonical schema quality is a new ongoing responsibility — hand-curated ontology needs maintenance as systems evolve
- Schema versioning for system schemas (e.g., SilverLake releases a new version) requires a process to flag deprecated fields and update canonicalisations

---

## Open Questions (to resolve in SPEC phase)

1. **Multi-tenant isolation:** Are derived mappings ever shared across organisations (opt-in "community mappings")? Decision deferred to KAN-50.
2. **Schema version cadence:** How often do we update system schemas, and who triggers it? Deferred to KAN-49.
3. **Canonical ontology ownership:** Hand-curated vs. AI-assisted expansion. Initial seed is hand-curated; AI expansion is a Phase 2 feature.
