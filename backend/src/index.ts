import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { DbStore } from './db/dbStore.js';
import { prisma } from './db/prismaClient.js';
import { writeAuditEntry, type AuditActor, type AuditAction } from './db/audit.js';
import { FsStore } from './utils/fsStore.js';
import { parseSapSchema } from './services/sapParser.js';
import { fetchSalesforceSchema } from '../../packages/connectors/salesforce.js';
import { suggestMappings } from './services/mapper.js';
import { validateMappings } from './services/validator.js';
import { buildExport, EXPORT_FORMATS, type ExportFormat } from './services/exporter.js';
import { runAgentRefinement, type RefinementStep } from './services/agentRefiner.js';
import {
  buildMappingConflicts,
  countUnresolvedConflicts,
  targetFieldIdFromConflictId,
} from './services/conflicts.js';
import { isActiveFieldMapping } from './utils/mappingStatus.js';
import { setupAuthRoutes } from './routes/authRoutes.js';
import { setupConnectorRoutes } from './routes/connectorRoutes.js';
import { setupAgentRoutes } from './routes/agentRoutes.js';
import { setupOAuthRoutes } from './routes/oauthRoutes.js';
import { setupErrorReportingRoutes } from './routes/errorReportingRoutes.js';
import { setupCanonicalRoutes } from './routes/canonicalRoutes.js';
import { activeProvider } from './agents/llm/LLMGateway.js';
import { setupOrgRoutes } from './routes/orgRoutes.js';
import { setupLLMRoutes } from './routes/llmRoutes.js';
import { createBulkRouter } from './routes/bulkRoutes.js';
import { authMiddleware } from './auth/authMiddleware.js';
import { runWithLLMRuntimeContext } from './services/llmRuntimeContext.js';
import { llmSettingsStore } from './services/llmSettingsStore.js';
import {
  CreateProjectSchema,
  SalesforceSchemaSchema,
  PatchFieldMappingSchema,
  ConflictResolutionRequestSchema,
  ResolveOneToManyMappingsSchema,
} from './validation/schemas.js';
import { captureException, sendHttpError } from './utils/httpErrors.js';
import type { AppState, FieldMapping, MappingProject } from './types.js';
import { getOneToManyPatternCandidates, getSchemaIntelligencePatternCandidates, isOneToManyFieldName } from './services/schemaIntelligencePatterns.js';
// Register all built-in connectors into the defaultRegistry (side-effect import)
import '../../packages/connectors/registerConnectors.js';

const app = express();
const upload = multer();
const port = Number(process.env.PORT || 4000);
const store = (
  process.env.DATABASE_URL
    ? new DbStore(prisma)
    : new FsStore(process.env.DATA_DIR || './data')
) as unknown as DbStore;

const defaultCorsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedCorsOrigins = (
  process.env.CORS_ORIGINS
  || process.env.FRONTEND_URL
  || defaultCorsOrigins.join(',')
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedCorsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  const requestId = req.header('x-request-id')?.trim() || randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  sendHttpError(req, res, status, code, message, details, 'api');
}

function toAuditActor(req: Request): AuditActor {
  return {
    userId: req.user?.userId ?? 'unknown',
    email: req.user?.email ?? 'unknown',
    role: req.user?.role ?? 'unknown',
  };
}

function writeAuditEntrySafe(args: {
  projectId: string;
  actor: AuditActor;
  action: AuditAction;
  targetType: 'field_mapping' | 'project' | 'conflict';
  targetId: string;
  before?: unknown;
  after?: unknown;
}): void {
  void writeAuditEntry(args).catch((error) => {
    console.error('[audit] Failed to write audit entry:', error);
  });
}

function getProjectScopedState(state: AppState, project: MappingProject) {
  const sourceEntities = state.entities.filter((entity) => entity.systemId === project.sourceSystemId);
  const targetEntities = state.entities.filter((entity) => entity.systemId === project.targetSystemId);
  const entityMappings = state.entityMappings.filter((mapping) => mapping.projectId === project.id);
  const entityMappingIds = new Set(entityMappings.map((mapping) => mapping.id));
  const fieldMappings = state.fieldMappings.filter((mapping) => entityMappingIds.has(mapping.entityMappingId));
  const scopedFieldIds = new Set([
    ...sourceEntities.map((entity) => entity.id),
    ...targetEntities.map((entity) => entity.id),
  ]);
  const scopedFields = state.fields.filter((field) => scopedFieldIds.has(field.entityId));

  return {
    sourceEntities,
    targetEntities,
    entityMappings,
    fieldMappings,
    scopedFields,
  };
}

function buildProjectPreflight(
  project: MappingProject,
  state: AppState,
  fieldMappings: FieldMapping[],
) {
  const targetEntityIds = new Set(
    state.entities
      .filter((entity) => entity.systemId === project.targetSystemId)
      .map((entity) => entity.id),
  );
  const targetFields = state.fields.filter((field) => targetEntityIds.has(field.entityId));
  const targetFieldIds = new Set(targetFields.map((field) => field.id));
  const requiredTargetFields = targetFields.filter((field) => field.required);

  const scopedMappings = fieldMappings.filter((mapping) => targetFieldIds.has(mapping.targetFieldId));
  const activeMappings = scopedMappings.filter((mapping) => isActiveFieldMapping(mapping));
  const mappingsByTargetField = new Map<string, FieldMapping[]>();
  for (const mapping of activeMappings) {
    const existing = mappingsByTargetField.get(mapping.targetFieldId) ?? [];
    existing.push(mapping);
    mappingsByTargetField.set(mapping.targetFieldId, existing);
  }

  const unmappedRequiredFields = requiredTargetFields
    .filter((field) => (mappingsByTargetField.get(field.id) ?? []).length === 0)
    .map((field) => ({
      id: field.id,
      name: field.name,
      label: field.label,
    }));

  const mappedTargetCount = new Set(activeMappings.map((mapping) => mapping.targetFieldId)).size;
  const unresolvedConflicts = countUnresolvedConflicts(fieldMappings);
  const sourceFieldById = new Map(state.fields.map((field) => [field.id, field]));
  const resolvedOneToManyMappings = project.resolvedOneToManyMappings ?? {};
  const unresolvedRoutingDecisions = activeMappings.filter((mapping) => {
    const sourceField = sourceFieldById.get(mapping.sourceFieldId);
    if (!sourceField || !isOneToManyFieldName(sourceField.name)) return false;
    const resolution = resolvedOneToManyMappings[mapping.sourceFieldId];
    return resolution?.targetFieldId !== mapping.targetFieldId;
  }).length;
  const acceptedMappingsCount = scopedMappings.filter((mapping) => mapping.status === 'accepted').length;
  const suggestedMappingsCount = scopedMappings.filter(
    (mapping) => mapping.status === 'suggested' || mapping.status === 'modified',
  ).length;
  const rejectedMappingsCount = scopedMappings.filter((mapping) => mapping.status === 'rejected').length;
  const canExport =
    unmappedRequiredFields.length === 0
    && unresolvedConflicts === 0
    && unresolvedRoutingDecisions === 0;

  return {
    projectId: project.id,
    mappedTargetCount,
    targetFieldCount: targetFields.length,
    acceptedMappingsCount,
    suggestedMappingsCount,
    rejectedMappingsCount,
    unmappedRequiredFields,
    unresolvedConflicts,
    unresolvedRoutingDecisions,
    canExport,
  };
}

async function withLLMContext<T>(
  req: Request,
  res: Response,
  projectId: string | undefined,
  handler: () => Promise<T>,
): Promise<T> {
  const userId = req.user?.userId ?? 'demo-admin';
  const runtimeConfig = llmSettingsStore.getRuntimeConfig(userId);
  return runWithLLMRuntimeContext(
    {
      llmConfig: runtimeConfig,
      usageMeta: {
        userId,
        projectId,
        requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined,
      },
      onUsage: (capture, meta) => {
        if (!meta?.userId) return;
        llmSettingsStore.captureUsage(meta.userId, capture, {
          projectId: meta.projectId,
          requestId: meta.requestId,
        });
      },
    },
    handler,
  );
}

// Auth routes (public — no middleware)
setupAuthRoutes(app);

// OAuth routes — Salesforce Web Server Flow + connection status endpoint
// Salesforce credentials are stored per-user in ConnectorSessionStore (not in .env)
// SF_APP_CLIENT_ID + SF_APP_CLIENT_SECRET in .env are the *app's* Connected App creds, not the customer's
setupOAuthRoutes(app);

// Error reporting routes (frontend ingest + authenticated reporting APIs)
setupErrorReportingRoutes(app);

// Canonical ontology + transitive system map APIs
setupCanonicalRoutes(app);

// Connector routes (GET /api/connectors public; POST endpoints behind authMiddleware)
// POST endpoints automatically merge session-stored OAuth tokens with request credentials
setupConnectorRoutes(app, store);

// Agent orchestration routes (POST /api/projects/:id/orchestrate, GET .../compliance)
setupAgentRoutes(app, store);

// Learning-loop org routes (mapping events, derived mappings, project seeding)
setupOrgRoutes(app, store);

// LLM config/usage routes (BYOL controls and token/call telemetry)
setupLLMRoutes(app);

// Protect all project and field-mapping routes
app.use('/api/projects', authMiddleware);
app.use('/api/field-mappings', authMiddleware);
app.use('/api/projects/:id/mappings', createBulkRouter(store));

app.get('/api/schema-intelligence/patterns', authMiddleware, (req, res) => {
  const fieldName = typeof req.query.field === 'string' ? req.query.field : undefined;
  res.json({
    field: fieldName,
    candidates: getSchemaIntelligencePatternCandidates(fieldName),
  });
});

app.post('/api/projects', async (req, res) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.issues);
    return;
  }
  const { name, sourceSystemName, targetSystemName } = parsed.data;
  const userId = req.user!.userId;
  const project = await store.createProject(name, userId, sourceSystemName, targetSystemName);
  writeAuditEntrySafe({
    projectId: project.id,
    actor: toAuditActor(req),
    action: 'project_created',
    targetType: 'project',
    targetId: project.id,
    after: { name: project.name },
  });
  res.status(201).json({ project });
});

app.get('/api/projects', async (req, res) => {
  const state = await store.getState();
  const systemsById = new Map(state.systems.map((system) => [system.id, system]));

  let visibleProjects = state.projects;
  if (process.env.REQUIRE_AUTH !== 'false') {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(req, res, 401, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }
    const owned = await prisma.mappingProject.findMany({
      where: { userId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((project) => project.id));
    visibleProjects = state.projects.filter((project) => ownedIds.has(project.id));
  }

  const projects = visibleProjects
    .map((project) => {
      const scoped = getProjectScopedState(state, project);
      const sourceSystem = systemsById.get(project.sourceSystemId);
      const targetSystem = systemsById.get(project.targetSystemId);
      const preflight = buildProjectPreflight(project, state, scoped.fieldMappings);
      return {
        project,
        sourceSystem,
        targetSystem,
        fieldMappingCount: scoped.fieldMappings.length,
        entityMappingCount: scoped.entityMappings.length,
        canExport: preflight.canExport,
        unresolvedConflicts: preflight.unresolvedConflicts,
      };
    })
    .sort((left, right) => Date.parse(right.project.updatedAt) - Date.parse(left.project.updatedAt));

  res.json({ projects });
});

app.get('/api/projects/:id', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = await store.getState();
  const scoped = getProjectScopedState(state, project);

  res.json({
    project,
    systems: state.systems.filter((s) => [project.sourceSystemId, project.targetSystemId].includes(s.id)),
    sourceEntities: scoped.sourceEntities,
    targetEntities: scoped.targetEntities,
    fields: scoped.scopedFields,
    relationships: state.relationships,
    entityMappings: scoped.entityMappings,
    fieldMappings: scoped.fieldMappings,
  });
});

app.post('/api/projects/:id/source-schema', upload.single('file'), async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }
  if (!req.file) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Missing file upload');
    return;
  }

  try {
    const content = req.file.buffer.toString('utf8');
    const parsed = parseSapSchema(content, req.file.originalname, project.sourceSystemId);
    await store.replaceSystemSchema(project.sourceSystemId, parsed.entities, parsed.fields, parsed.relationships);
    await store.updateProjectTimestamp(project.id);
    res.json({
      entities: parsed.entities,
      fields: parsed.fields,
      relationships: parsed.relationships,
      message: 'SAP schema ingested',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to parse SAP schema';
    sendError(req, res, 400, 'SCHEMA_PARSE_ERROR', message);
  }
});

app.post('/api/projects/:id/target-schema/salesforce', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const schemaInput = SalesforceSchemaSchema.safeParse(req.body);
  if (!schemaInput.success) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid input', schemaInput.error.issues);
    return;
  }

  const objects = Array.isArray(schemaInput.data.objects)
    ? schemaInput.data.objects
    : ['Account', 'Contact', 'Sales_Area__c'];

  const schema = await fetchSalesforceSchema(project.targetSystemId, {
    objects,
    credentials: schemaInput.data.credentials,
  });

  await store.replaceSystemSchema(project.targetSystemId, schema.entities, schema.fields, schema.relationships);
  await store.updateProjectTimestamp(project.id);

  res.json({
    entities: schema.entities,
    fields: schema.fields,
    relationships: schema.relationships,
    mode: schema.mode,
  });
});

app.post('/api/projects/:id/suggest-mappings', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = await store.getState();
  const sourceEntities = state.entities.filter((e) => e.systemId === project.sourceSystemId);
  const targetEntities = state.entities.filter((e) => e.systemId === project.targetSystemId);

  if (!sourceEntities.length || !targetEntities.length) {
    sendError(req, res, 400, 'MISSING_SCHEMAS', 'Load both source and target schemas first');
    return;
  }

  const suggestion = await withLLMContext(req, res, project.id, async () => suggestMappings({
    project,
    sourceEntities,
    targetEntities,
    fields: state.fields,
  }));
  await store.upsertMappings(project.id, suggestion.entityMappings, suggestion.fieldMappings);
  writeAuditEntrySafe({
    projectId: project.id,
    actor: toAuditActor(req),
    action: 'mapping_suggested',
    targetType: 'project',
    targetId: project.id,
    after: {
      entityMappings: suggestion.entityMappings.length,
      fieldMappings: suggestion.fieldMappings.length,
    },
  });

  const validation = validateMappings({
    entityMappings: suggestion.entityMappings,
    fieldMappings: suggestion.fieldMappings,
    fields: state.fields,
    entities: state.entities,
  });
  const llmProvider = await withLLMContext(req, res, project.id, async () => activeProvider());
  const hasLLM = llmProvider !== 'heuristic';

  res.json({
    entityMappings: suggestion.entityMappings,
    fieldMappings: suggestion.fieldMappings,
    validation,
    mode: hasLLM ? 'llm+context' : 'context-only',
    hasLLM,
    llmProvider,
  });
});

app.patch('/api/field-mappings/:id', async (req, res) => {
  const parsed = PatchFieldMappingSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.issues);
    return;
  }

  let existing: {
    id: string;
    status: string;
    transform: unknown;
    entityMapping: { projectId: string } | null;
  } | null = null;

  if (process.env.DATABASE_URL) {
    existing = await prisma.fieldMapping.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        transform: true,
        entityMapping: {
          select: {
            projectId: true,
          },
        },
      },
    });
    if (!existing) {
      sendError(req, res, 404, 'FIELD_MAPPING_NOT_FOUND', 'Field mapping not found');
      return;
    }
  }

  const mapping = await store.patchFieldMapping(req.params.id, parsed.data);
  if (!mapping) {
    sendError(req, res, 404, 'FIELD_MAPPING_NOT_FOUND', 'Field mapping not found');
    return;
  }

  if (existing?.entityMapping?.projectId) {
    const hasTransformChange = parsed.data.transform !== undefined;
    const action =
      parsed.data.status === 'accepted'
        ? 'mapping_accepted'
        : parsed.data.status === 'rejected'
          ? 'mapping_rejected'
          : hasTransformChange || parsed.data.status === 'modified'
            ? 'mapping_modified'
            : null;

    if (action) {
      writeAuditEntrySafe({
        projectId: existing.entityMapping.projectId,
        actor: toAuditActor(req),
        action,
        targetType: 'field_mapping',
        targetId: mapping.id,
        before: {
          status: existing.status,
          transform: existing.transform,
        },
        after: {
          status: mapping.status,
          transform: mapping.transform,
        },
      });
    }
  }
  res.json({ fieldMapping: mapping });
});

app.post('/api/projects/:id/one-to-many-resolutions', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const parsed = ResolveOneToManyMappingsSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid one-to-many resolution payload', parsed.error.issues);
    return;
  }

  const state = await store.getState();
  const scoped = getProjectScopedState(state, project);
  const mappingById = new Map(scoped.fieldMappings.map((mapping) => [mapping.id, mapping]));
  const fieldById = new Map(scoped.scopedFields.map((field) => [field.id, field]));
  const nextResolvedMappings = { ...(project.resolvedOneToManyMappings ?? {}) };

  for (const resolution of parsed.data.resolutions) {
    const mapping = mappingById.get(resolution.fieldMappingId);
    if (!mapping) {
      sendError(req, res, 404, 'FIELD_MAPPING_NOT_FOUND', `Field mapping ${resolution.fieldMappingId} not found`);
      return;
    }
    if (mapping.sourceFieldId !== resolution.sourceFieldId) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'Resolution source field does not match field mapping');
      return;
    }

    const sourceField = fieldById.get(resolution.sourceFieldId);
    const targetField = fieldById.get(resolution.targetFieldId);
    if (!sourceField || !targetField) {
      sendError(req, res, 404, 'FIELD_NOT_FOUND', 'Resolved source or target field was not found in project scope');
      return;
    }

    const candidates = getOneToManyPatternCandidates(sourceField.name);
    if (candidates.length === 0) {
      sendError(req, res, 400, 'NOT_ONE_TO_MANY_FIELD', `${sourceField.name} is not marked as one-to-many`);
      return;
    }
    if (!candidates.some((candidate) => candidate.targetFieldName === targetField.name)) {
      sendError(req, res, 400, 'INVALID_ONE_TO_MANY_TARGET', `${targetField.name} is not a valid routing candidate for ${sourceField.name}`);
      return;
    }

    const nextStatus =
      mapping.targetFieldId === targetField.id && mapping.status !== 'unmatched'
        ? mapping.status
        : 'modified';
    await store.patchFieldMapping(mapping.id, {
      targetFieldId: targetField.id,
      status: nextStatus,
    });

    nextResolvedMappings[sourceField.id] = {
      sourceFieldId: sourceField.id,
      sourceFieldName: sourceField.name,
      targetFieldId: targetField.id,
      targetFieldName: targetField.name,
      targetObject: state.entities.find((entity) => entity.id === targetField.entityId)?.name,
      resolvedAt: new Date().toISOString(),
    };
  }

  const updatedProject = await store.updateProjectResolvedOneToManyMappings(project.id, nextResolvedMappings);
  const updatedState = await store.getState();
  const refreshedProject = updatedProject ?? (await store.getProject(project.id));
  if (!refreshedProject) {
    sendError(req, res, 500, 'PROJECT_UPDATE_FAILED', 'Failed to persist one-to-many resolutions');
    return;
  }
  const refreshedScoped = getProjectScopedState(updatedState, refreshedProject);

  res.json({
    project: refreshedProject,
    fieldMappings: refreshedScoped.fieldMappings,
  });
});

app.get('/api/projects/:id/preflight', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = await store.getState();
  const scoped = getProjectScopedState(state, project);
  res.json(buildProjectPreflight(project, state, scoped.fieldMappings));
});

app.get('/api/projects/:id/conflicts', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = await store.getState();
  const scoped = getProjectScopedState(state, project);
  const conflicts = buildMappingConflicts(scoped.fieldMappings, scoped.scopedFields, state.entities);
  res.json({ conflicts, total: conflicts.length });
});

app.post('/api/projects/:id/conflicts/:conflictId/resolve', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const parsed = ConflictResolutionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid conflict resolution payload', parsed.error.issues);
    return;
  }

  const targetFieldId = targetFieldIdFromConflictId(req.params.conflictId);
  if (!targetFieldId) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid conflictId format');
    return;
  }

  const state = await store.getState();
  const scoped = getProjectScopedState(state, project);
  const competing = scoped.fieldMappings.filter(
    (mapping) => mapping.targetFieldId === targetFieldId && isActiveFieldMapping(mapping),
  );
  if (competing.length < 2) {
    sendError(req, res, 404, 'CONFLICT_NOT_FOUND', 'Conflict not found or already resolved');
    return;
  }

  const { action, winnerMappingId } = parsed.data;
  if (action === 'pick' && winnerMappingId && !competing.some((mapping) => mapping.id === winnerMappingId)) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'winnerMappingId must be one of the competing mappings');
    return;
  }

  const beforeStatuses = competing.map((mapping) => ({ id: mapping.id, status: mapping.status }));
  const competingIds = competing.map((mapping) => mapping.id);
  if (store instanceof FsStore) {
    if (action === 'pick') {
      await Promise.all(
        competing.map((mapping) => store.patchFieldMapping(mapping.id, {
          status: mapping.id === winnerMappingId ? 'accepted' : 'rejected',
        })),
      );
    } else {
      await Promise.all(competing.map((mapping) => store.patchFieldMapping(mapping.id, { status: 'rejected' })));
    }
  } else {
    await prisma.$transaction(async (tx) => {
      if (action === 'pick') {
        await tx.fieldMapping.updateMany({
          where: { id: { in: competingIds } },
          data: { status: 'rejected' },
        });
        await tx.fieldMapping.update({
          where: { id: winnerMappingId! },
          data: { status: 'accepted' },
        });
      } else {
        await tx.fieldMapping.updateMany({
          where: { id: { in: competingIds } },
          data: { status: 'rejected' },
        });
      }
    });
  }
  await store.updateProjectTimestamp(project.id);

  const updatedState = await store.getState();
  const updatedScoped = getProjectScopedState(updatedState, project);
  const unresolvedConflicts = countUnresolvedConflicts(updatedScoped.fieldMappings);
  const updatedStatuses = updatedScoped.fieldMappings
    .filter((mapping) => mapping.targetFieldId === targetFieldId)
    .map((mapping) => ({ id: mapping.id, status: mapping.status }));

  writeAuditEntrySafe({
    projectId: project.id,
    actor: toAuditActor(req),
    action: 'conflict_resolved',
    targetType: 'conflict',
    targetId: req.params.conflictId,
    before: {
      action,
      winnerMappingId: winnerMappingId ?? null,
      statuses: beforeStatuses,
    },
    after: {
      action,
      winnerMappingId: winnerMappingId ?? null,
      statuses: updatedStatuses,
      unresolvedConflicts,
    },
  });

  res.json({
    resolved: true,
    unresolvedConflicts,
  });
});

// GET /api/projects/:id/export?format=json|yaml|csv|dataweave|boomi|workato
// Also accepts GET /api/projects/:id/export/formats to list available formats
app.get('/api/projects/:id/export/formats', (_req, res) => {
  res.json({ formats: EXPORT_FORMATS });
});

app.get('/api/projects/:id/export', async (req, res) => {
  const format = String(req.query.format || 'json') as ExportFormat;
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }
  if (!(format in EXPORT_FORMATS)) {
    sendError(
      req,
      res, 400, 'VALIDATION_ERROR',
      `format must be one of: ${Object.keys(EXPORT_FORMATS).join(', ')}`,
    );
    return;
  }

  const state = await store.getState();
  const entityMappings = state.entityMappings.filter((e) => e.projectId === project.id);
  const entityMappingIds = new Set(entityMappings.map((e) => e.id));
  const fieldMappings = state.fieldMappings.filter((f) => entityMappingIds.has(f.entityMappingId));
  const validation = validateMappings({
    entityMappings,
    fieldMappings,
    fields: state.fields,
    entities: state.entities,
  });

  const projectSystems = state.systems.filter(
    (s) => s.id === project.sourceSystemId || s.id === project.targetSystemId,
  );

  const result = buildExport(format, {
    project,
    systems: projectSystems,
    entityMappings,
    fieldMappings,
    entities: state.entities,
    fields: state.fields,
    validation,
  });
  writeAuditEntrySafe({
    projectId: project.id,
    actor: toAuditActor(req),
    action: 'project_exported',
    targetType: 'project',
    targetId: project.id,
    after: {
      format,
    },
  });

  // For JSON/Workato: send as JSON object; for all others: send as text with file download
  if (typeof result.content === 'object') {
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.json(result.content);
  } else {
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  }
});

app.get('/api/projects/:id/audit', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100;
  const beforeRaw = typeof req.query.before === 'string' ? req.query.before : null;

  const where: Prisma.AuditEntryWhereInput = {
    projectId: project.id,
  };
  if (beforeRaw) {
    const beforeDate = new Date(beforeRaw);
    if (!Number.isNaN(beforeDate.getTime())) {
      where.timestamp = { lt: beforeDate };
    }
  }

  const entries = await prisma.auditEntry.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  const nextBefore = entries.length === limit
    ? entries[entries.length - 1]?.timestamp.toISOString() ?? null
    : null;

  res.json({
    entries: entries.map((entry) => ({
      id: entry.id,
      projectId: entry.projectId,
      actor: {
        userId: entry.actorUserId,
        email: entry.actorEmail,
        role: entry.actorRole,
      },
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      diff: {
        before: entry.diffBefore,
        after: entry.diffAfter,
      },
      timestamp: entry.timestamp.toISOString(),
    })),
    nextBefore,
  });
});

app.post('/api/projects/:id/agent-refine', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = await store.getState();
  const entityMappings = state.entityMappings.filter((e) => e.projectId === project.id);
  const entityMappingIds = new Set(entityMappings.map((e) => e.id));
  const fieldMappings = state.fieldMappings.filter((f) => entityMappingIds.has(f.entityMappingId));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const writeEvent = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const llmProvider = await withLLMContext(req, res, project.id, async () => activeProvider());
  writeEvent({
    type: 'start',
    projectId: project.id,
    totalLowConfidence: fieldMappings.filter((fm) => isActiveFieldMapping(fm) && fm.status === 'suggested' && fm.confidence < 0.65).length,
    llmProvider,
    hasAi: llmProvider !== 'heuristic',
  });

  try {
    const result = await withLLMContext(req, res, project.id, async () => runAgentRefinement({
      project,
      entityMappings,
      fieldMappings,
      entities: state.entities,
      fields: state.fields,
      onStep: (step: RefinementStep) => {
        writeEvent({ type: 'step', ...step });
      },
    }));

    await store.upsertMappings(project.id, entityMappings, result.updatedFieldMappings);

    writeEvent({
      type: 'complete',
      totalImproved: result.totalImproved,
      updatedMappings: result.updatedFieldMappings.length,
      validation: result.finalValidation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Refinement failed';
    captureException('orchestrator', error, {
      code: 'REFINEMENT_ERROR',
      context: {
        requestId: res.locals.requestId as string | undefined,
        projectId: project.id,
        path: req.originalUrl || req.url,
        method: req.method,
        userId: req.user?.userId,
      },
    });
    writeEvent({ type: 'error', message });
  } finally {
    res.end();
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  captureException('backend', err, {
    code: 'INTERNAL_ERROR',
    context: {
      requestId: res.locals.requestId as string | undefined,
      path: _req.originalUrl || _req.url,
      method: _req.method,
      userId: _req.user?.userId,
    },
  });
  sendError(_req, res, 500, 'INTERNAL_ERROR', message);
});

process.on('unhandledRejection', (reason) => {
  captureException('runtime', reason, { code: 'UNHANDLED_REJECTION', severity: 'fatal' });
});

process.on('uncaughtException', (err) => {
  captureException('runtime', err, { code: 'UNCAUGHT_EXCEPTION', severity: 'fatal' });
});

app.listen(port, () => {
  console.log(`Auto Mapper backend running on http://localhost:${port}`);
});
