import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { DbStore } from './db/dbStore.js';
import { prisma } from './db/prismaClient.js';
import { FsStore } from './utils/fsStore.js';
import { parseSapSchema } from './services/sapParser.js';
import { fetchSalesforceSchema } from './connectors/salesforce.js';
import { suggestMappings } from './services/mapper.js';
import { validateMappings } from './services/validator.js';
import { buildExport, EXPORT_FORMATS, type ExportFormat } from './services/exporter.js';
import { runAgentRefinement, type RefinementStep } from './services/agentRefiner.js';
import { setupAuthRoutes } from './routes/authRoutes.js';
import { setupConnectorRoutes } from './routes/connectorRoutes.js';
import { setupAgentRoutes } from './routes/agentRoutes.js';
import { setupOAuthRoutes } from './routes/oauthRoutes.js';
import { authMiddleware } from './auth/authMiddleware.js';
import {
  CreateProjectSchema,
  SalesforceSchemaSchema,
  PatchFieldMappingSchema,
} from './validation/schemas.js';
// Register all built-in connectors into the defaultRegistry (side-effect import)
import './connectors/registerConnectors.js';

const app = express();
const upload = multer();
const port = Number(process.env.PORT || 4000);
const store = (
  process.env.DATABASE_URL
    ? new DbStore(prisma)
    : new FsStore(process.env.DATA_DIR || './data')
) as unknown as DbStore;

app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

// Auth routes (public — no middleware)
setupAuthRoutes(app);

// OAuth routes — Salesforce Web Server Flow + connection status endpoint
// Salesforce credentials are stored per-user in ConnectorSessionStore (not in .env)
// SF_APP_CLIENT_ID + SF_APP_CLIENT_SECRET in .env are the *app's* Connected App creds, not the customer's
setupOAuthRoutes(app);

// Connector routes (GET /api/connectors public; POST endpoints behind authMiddleware)
// POST endpoints automatically merge session-stored OAuth tokens with request credentials
setupConnectorRoutes(app, store);

// Agent orchestration routes (POST /api/projects/:id/orchestrate, GET .../compliance)
setupAgentRoutes(app, store);

// Protect all project and field-mapping routes
app.use('/api/projects', authMiddleware);
app.use('/api/field-mappings', authMiddleware);

app.post('/api/projects', async (req, res) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.issues);
    return;
  }
  const { name, sourceSystemName, targetSystemName } = parsed.data;
  const userId = req.user!.userId;
  const project = await store.createProject(name, userId, sourceSystemName, targetSystemName);
  res.status(201).json({ project });
});

app.get('/api/projects/:id', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = await store.getState();
  const sourceEntities = state.entities.filter((e) => e.systemId === project.sourceSystemId);
  const targetEntities = state.entities.filter((e) => e.systemId === project.targetSystemId);
  const entityMappings = state.entityMappings.filter((m) => m.projectId === project.id);
  const entityMappingIds = new Set(entityMappings.map((e) => e.id));
  const fieldMappings = state.fieldMappings.filter((f) => entityMappingIds.has(f.entityMappingId));

  res.json({
    project,
    systems: state.systems.filter((s) => [project.sourceSystemId, project.targetSystemId].includes(s.id)),
    sourceEntities,
    targetEntities,
    fields: state.fields.filter((f) => [...sourceEntities, ...targetEntities].some((e) => e.id === f.entityId)),
    relationships: state.relationships,
    entityMappings,
    fieldMappings,
  });
});

app.post('/api/projects/:id/source-schema', upload.single('file'), async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }
  if (!req.file) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Missing file upload');
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
    sendError(res, 400, 'SCHEMA_PARSE_ERROR', message);
  }
});

app.post('/api/projects/:id/target-schema/salesforce', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const schemaInput = SalesforceSchemaSchema.safeParse(req.body);
  if (!schemaInput.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid input', schemaInput.error.issues);
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
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = await store.getState();
  const sourceEntities = state.entities.filter((e) => e.systemId === project.sourceSystemId);
  const targetEntities = state.entities.filter((e) => e.systemId === project.targetSystemId);

  if (!sourceEntities.length || !targetEntities.length) {
    sendError(res, 400, 'MISSING_SCHEMAS', 'Load both source and target schemas first');
    return;
  }

  const suggestion = await suggestMappings({
    project,
    sourceEntities,
    targetEntities,
    fields: state.fields,
  });
  await store.upsertMappings(project.id, suggestion.entityMappings, suggestion.fieldMappings);

  const validation = validateMappings({
    entityMappings: suggestion.entityMappings,
    fieldMappings: suggestion.fieldMappings,
    fields: state.fields,
    entities: state.entities,
  });

  res.json({
    entityMappings: suggestion.entityMappings,
    fieldMappings: suggestion.fieldMappings,
    validation,
    mode: process.env.OPENAI_API_KEY ? 'heuristic+ai' : 'heuristic',
  });
});

app.patch('/api/field-mappings/:id', async (req, res) => {
  const parsed = PatchFieldMappingSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.issues);
    return;
  }

  const mapping = await store.patchFieldMapping(req.params.id, parsed.data);
  if (!mapping) {
    sendError(res, 404, 'FIELD_MAPPING_NOT_FOUND', 'Field mapping not found');
    return;
  }
  res.json({ fieldMapping: mapping });
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
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }
  if (!(format in EXPORT_FORMATS)) {
    sendError(
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

app.post('/api/projects/:id/agent-refine', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) {
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
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

  writeEvent({
    type: 'start',
    projectId: project.id,
    totalLowConfidence: fieldMappings.filter((fm) => fm.status === 'suggested' && fm.confidence < 0.65).length,
    hasAi: Boolean(process.env.OPENAI_API_KEY),
  });

  try {
    const result = await runAgentRefinement({
      project,
      entityMappings,
      fieldMappings,
      entities: state.entities,
      fields: state.fields,
      onStep: (step: RefinementStep) => {
        writeEvent({ type: 'step', ...step });
      },
    });

    await store.upsertMappings(project.id, entityMappings, result.updatedFieldMappings);

    writeEvent({
      type: 'complete',
      totalImproved: result.totalImproved,
      updatedMappings: result.updatedFieldMappings.length,
      validation: result.finalValidation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Refinement failed';
    writeEvent({ type: 'error', message });
  } finally {
    res.end();
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  sendError(res, 500, 'INTERNAL_ERROR', message);
});

app.listen(port, () => {
  console.log(`Auto Mapper backend running on http://localhost:${port}`);
});
