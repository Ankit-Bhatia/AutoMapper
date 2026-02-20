import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { FsStore } from './utils/fsStore.js';
import { parseSapSchema } from './services/sapParser.js';
import { fetchSalesforceSchema } from './connectors/salesforce.js';
import { suggestMappings } from './services/mapper.js';
import { validateMappings } from './services/validator.js';
import { buildCsvExport, buildJsonExport } from './services/exporter.js';

const app = express();
const upload = multer();
const port = Number(process.env.PORT || 4000);
const dataDir = path.resolve(process.env.DATA_DIR || './src/data');
const store = new FsStore(dataDir);

app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

app.post('/api/projects', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Project name is required');
    return;
  }
  const project = store.createProject(name);
  res.status(201).json({ project });
});

app.get('/api/projects/:id', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) {
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = store.getState();
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

app.post('/api/projects/:id/source-schema', upload.single('file'), (req, res) => {
  const project = store.getProject(req.params.id);
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
    store.replaceSystemSchema(project.sourceSystemId, parsed.entities, parsed.fields, parsed.relationships);
    store.updateProjectTimestamp(project.id);
    res.json({
      entities: parsed.entities,
      fields: parsed.fields,
      relationships: parsed.relationships,
      message: 'SAP schema ingested',
    });
  } catch (error: any) {
    sendError(res, 400, 'SCHEMA_PARSE_ERROR', error.message || 'Failed to parse SAP schema');
  }
});

app.post('/api/projects/:id/target-schema/salesforce', async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) {
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const objects = Array.isArray(req.body?.objects)
    ? req.body.objects.map((v: unknown) => String(v))
    : ['Account', 'Contact', 'Sales_Area__c'];

  const schema = await fetchSalesforceSchema(project.targetSystemId, {
    objects,
    credentials: req.body?.credentials,
  });

  store.replaceSystemSchema(project.targetSystemId, schema.entities, schema.fields, schema.relationships);
  store.updateProjectTimestamp(project.id);

  res.json({
    entities: schema.entities,
    fields: schema.fields,
    relationships: schema.relationships,
    mode: schema.mode,
  });
});

app.post('/api/projects/:id/suggest-mappings', async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) {
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }

  const state = store.getState();
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
  store.upsertMappings(project.id, suggestion.entityMappings, suggestion.fieldMappings);

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

app.patch('/api/field-mappings/:id', (req, res) => {
  const mapping = store.patchFieldMapping(req.params.id, {
    status: req.body?.status,
    confidence: req.body?.confidence,
    rationale: req.body?.rationale,
    sourceFieldId: req.body?.sourceFieldId,
    targetFieldId: req.body?.targetFieldId,
    transform: req.body?.transform,
  });

  if (!mapping) {
    sendError(res, 404, 'FIELD_MAPPING_NOT_FOUND', 'Field mapping not found');
    return;
  }
  res.json({ fieldMapping: mapping });
});

app.get('/api/projects/:id/export', (req, res) => {
  const format = String(req.query.format || 'json');
  const project = store.getProject(req.params.id);
  if (!project) {
    sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return;
  }
  if (!['json', 'csv'].includes(format)) {
    sendError(res, 400, 'VALIDATION_ERROR', 'format must be json or csv');
    return;
  }

  const state = store.getState();
  const entityMappings = state.entityMappings.filter((e) => e.projectId === project.id);
  const entityMappingIds = new Set(entityMappings.map((e) => e.id));
  const fieldMappings = state.fieldMappings.filter((f) => entityMappingIds.has(f.entityMappingId));
  const validation = validateMappings({
    entityMappings,
    fieldMappings,
    fields: state.fields,
    entities: state.entities,
  });

  if (format === 'csv') {
    const csv = buildCsvExport({
      project,
      entityMappings,
      fieldMappings,
      entities: state.entities,
      fields: state.fields,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${project.name}-mapping.csv"`);
    res.send(csv);
    return;
  }

  const json = buildJsonExport({
    project,
    entityMappings,
    fieldMappings,
    entities: state.entities,
    fields: state.fields,
    validation,
  });
  res.json(json);
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  sendError(res, 500, 'INTERNAL_ERROR', message);
});

app.listen(port, () => {
  console.log(`Auto Mapper backend running on http://localhost:${port}`);
});
