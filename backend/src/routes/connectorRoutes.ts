/**
 * connectorRoutes — REST API for the Connector Plugin Architecture.
 *
 * Endpoints:
 *   GET  /api/connectors                            List all registered connectors
 *   POST /api/connectors/:id/test                   Test a connector connection
 *   POST /api/connectors/:id/objects                List available objects
 *   POST /api/connectors/:id/schema                 Fetch full schema (all objects)
 *   POST /api/projects/:projectId/schema/:connectorId  Ingest connector schema into a project
 */
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import type { DbStore } from '../db/dbStore.js';
import type { FsStore } from '../utils/fsStore.js';
import { prisma } from '../db/prismaClient.js';
import { defaultRegistry } from '../../../packages/connectors/ConnectorRegistry.js';
import type { ConnectorCredentials } from '../../../packages/connectors/IConnector.js';
import { normalizeConnectorCredentials } from '../../../packages/connectors/credentialNormalizer.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import { defaultSessionStore } from '../services/connectorSessionStore.js';
import { parseUploadedSchema } from '../services/schemaUploadParser.js';
import type { DataType, MappingProject, System } from '../types.js';
import { sendHttpError } from '../utils/httpErrors.js';

function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  sendHttpError(req, res, status, code, message, details, 'connector');
}

/**
 * Extract and validate credentials from the request body, optionally merging with
 * session-stored credentials for a user + connector pair.
 * Request body credentials take precedence over session-stored credentials.
 * Returns an empty object (triggering mock mode) if nothing is provided.
 * @param body - request body
 * @param userId - optional: if provided, look up session credentials for this user
 * @param connectorId - optional: if provided with userId, look up session credentials for this connector
 * @returns merged credentials (request body takes precedence)
 */
function extractCredentials(
  body: Record<string, unknown>,
  userId?: string,
  connectorId?: string,
): ConnectorCredentials {
  let credentials: ConnectorCredentials = {};

  // First, try to get credentials from session store if userId and connectorId provided
  if (userId && connectorId) {
    const sessionCreds = defaultSessionStore.get(userId, connectorId);
    if (sessionCreds) {
      credentials = { ...sessionCreds };
    }
  }

  // Request body credentials take precedence
  if (body.credentials && typeof body.credentials === 'object' && !Array.isArray(body.credentials)) {
    credentials = { ...credentials, ...(body.credentials as ConnectorCredentials) };
  }

  return credentials;
}

function hasCredentialValues(credentials: ConnectorCredentials): boolean {
  return Object.values(credentials).some((value) => typeof value === 'string' && value.trim().length > 0);
}

const SALESFORCE_STANDARD_OBJECTS = ['Account', 'Contact', 'Opportunity', 'Case'];
const SALESFORCE_FSC_OBJECTS = [
  'FinancialAccount',
  'AccountParticipant',
  'PartyProfile',
  'IndividualApplication',
  'FinancialGoal',
];

const CUSTOM_CONNECTOR_REDACTED_KEYS = new Set([
  'bearerToken',
  'clientSecret',
  'password',
  'basicPassword',
  'apiKey',
  'basicUsername',
]);

const ALLOWED_CUSTOM_DATA_TYPES = new Set<DataType>([
  'string',
  'text',
  'number',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'time',
  'picklist',
  'email',
  'phone',
  'id',
  'reference',
  'unknown',
]);

interface CustomConnectorFieldInput {
  name: string;
  dataType: string;
}

interface CustomConnectorEntityInput {
  name: string;
  fields: CustomConnectorFieldInput[];
}

interface CustomConnectorDefinition {
  id: string;
  name: string;
  vendor: string;
  category: string;
  description: string;
  entities: string[];
  connectionConfig: Record<string, unknown>;
}

interface StoredCustomConnector {
  definition: CustomConnectorDefinition;
  entities: CustomConnectorEntityInput[];
}

const customConnectorStore = new Map<
  string,
  StoredCustomConnector
>();

function isPostgresCustomConnectorStoreEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function resolveCustomConnectorStorePath(): string {
  const dataDir = process.env.DATA_DIR?.trim() || './data';
  return path.resolve(process.cwd(), dataDir, 'custom-connectors.json');
}

const customConnectorStorePath = resolveCustomConnectorStorePath();

function loadCustomConnectorStoreFromDisk(): void {
  try {
    if (!fs.existsSync(customConnectorStorePath)) return;
    const raw = fs.readFileSync(customConnectorStorePath, 'utf8').trim();
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const typed = entry as {
        definition?: CustomConnectorDefinition;
        entities?: CustomConnectorEntityInput[];
      };
      if (!typed.definition || typeof typed.definition.id !== 'string') continue;
      if (!Array.isArray(typed.entities)) continue;
      customConnectorStore.set(typed.definition.id, {
        definition: typed.definition,
        entities: typed.entities,
      });
    }
  } catch (error) {
    console.error('[custom-connectors] Failed to load persisted connectors:', error);
  }
}

function persistCustomConnectorStoreToDisk(): void {
  const dirPath = path.dirname(customConnectorStorePath);
  fs.mkdirSync(dirPath, { recursive: true });
  const payload = JSON.stringify(Array.from(customConnectorStore.values()), null, 2);
  fs.writeFileSync(customConnectorStorePath, payload, 'utf8');
}

loadCustomConnectorStoreFromDisk();

function sanitizeCustomConnectionConfig(connectionConfig: unknown): Record<string, unknown> {
  if (!connectionConfig || typeof connectionConfig !== 'object' || Array.isArray(connectionConfig)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(connectionConfig as Record<string, unknown>).filter(
      ([key]) => !CUSTOM_CONNECTOR_REDACTED_KEYS.has(key),
    ),
  );
}

function normalizeCustomEntities(input: unknown): CustomConnectorEntityInput[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entity): CustomConnectorEntityInput | null => {
      if (!entity || typeof entity !== 'object') return null;
      const typedEntity = entity as { name?: unknown; fields?: unknown };
      if (typeof typedEntity.name !== 'string' || !typedEntity.name.trim()) return null;
      if (!Array.isArray(typedEntity.fields) || !typedEntity.fields.length) return null;
      const fields = typedEntity.fields
        .map((field): CustomConnectorFieldInput | null => {
          if (!field || typeof field !== 'object') return null;
          const typedField = field as { name?: unknown; dataType?: unknown; type?: unknown };
          if (typeof typedField.name !== 'string' || !typedField.name.trim()) return null;
          const dataType =
            typeof typedField.dataType === 'string' && typedField.dataType.trim()
              ? typedField.dataType.trim()
              : typeof typedField.type === 'string' && typedField.type.trim()
                ? typedField.type.trim()
                : 'string';
          return {
            name: typedField.name.trim(),
            dataType,
          };
        })
        .filter((field): field is CustomConnectorFieldInput => Boolean(field));
      if (!fields.length) return null;
      return {
        name: typedEntity.name.trim(),
        fields,
      };
    })
    .filter((entity): entity is CustomConnectorEntityInput => Boolean(entity));
}

function toCustomDataType(value: string): DataType {
  const normalized = value.toLowerCase() as DataType;
  return ALLOWED_CUSTOM_DATA_TYPES.has(normalized) ? normalized : 'string';
}

function buildCustomSchema(
  systemId: string,
  entities: CustomConnectorEntityInput[],
): { entities: Array<{ id: string; systemId: string; name: string; label: string }>; fields: Array<{ id: string; entityId: string; name: string; label: string; dataType: DataType; required: boolean }>; relationships: [] } {
  const schemaEntities = entities.map((entity) => ({
    id: randomUUID(),
    systemId,
    name: entity.name,
    label: entity.name,
  }));
  const entityIdByName = new Map(schemaEntities.map((entity) => [entity.name, entity.id]));

  const schemaFields = entities.flatMap((entity) =>
    entity.fields.map((field) => ({
      id: randomUUID(),
      entityId: entityIdByName.get(entity.name) ?? '',
      name: field.name,
      label: field.name,
      dataType: toCustomDataType(field.dataType || 'string'),
      required: false,
    })),
  );

  return {
    entities: schemaEntities,
    fields: schemaFields,
    relationships: [],
  };
}

function toStoredCustomConnector(input: {
  id: string;
  name: string;
  vendor: string;
  category: string;
  description: string;
  entityNames: string[];
  entities: unknown;
  connectionConfig: unknown;
}): StoredCustomConnector | null {
  const normalizedEntities = normalizeCustomEntities(input.entities);
  if (!normalizedEntities.length) return null;

  return {
    definition: {
      id: input.id,
      name: input.name,
      vendor: input.vendor,
      category: input.category,
      description: input.description,
      entities: normalizedEntities.map((entity) => entity.name),
      connectionConfig: sanitizeCustomConnectionConfig(input.connectionConfig),
    },
    entities: normalizedEntities,
  };
}

async function listCustomConnectors(): Promise<StoredCustomConnector[]> {
  if (!isPostgresCustomConnectorStoreEnabled()) {
    return Array.from(customConnectorStore.values());
  }
  await ensureCustomConnectorBackfill();

  const rows = await prisma.customConnector.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      vendor: true,
      category: true,
      description: true,
      entityNames: true,
      entities: true,
      connectionConfig: true,
    },
  });

  return rows
    .map((row) =>
      toStoredCustomConnector({
        id: row.id,
        name: row.name,
        vendor: row.vendor,
        category: row.category,
        description: row.description,
        entityNames: row.entityNames,
        entities: row.entities,
        connectionConfig: row.connectionConfig,
      }),
    )
    .filter((row): row is StoredCustomConnector => Boolean(row));
}

async function getCustomConnector(connectorId: string): Promise<StoredCustomConnector | null> {
  if (!isPostgresCustomConnectorStoreEnabled()) {
    return customConnectorStore.get(connectorId) ?? null;
  }
  await ensureCustomConnectorBackfill();

  const row = await prisma.customConnector.findUnique({
    where: { id: connectorId },
    select: {
      id: true,
      name: true,
      vendor: true,
      category: true,
      description: true,
      entityNames: true,
      entities: true,
      connectionConfig: true,
    },
  });
  if (!row) return null;

  return toStoredCustomConnector({
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    category: row.category,
    description: row.description,
    entityNames: row.entityNames,
    entities: row.entities,
    connectionConfig: row.connectionConfig,
  });
}

async function saveCustomConnector(
  connector: StoredCustomConnector,
  createdByUserId?: string,
): Promise<void> {
  if (!isPostgresCustomConnectorStoreEnabled()) {
    customConnectorStore.set(connector.definition.id, connector);
    persistCustomConnectorStoreToDisk();
    return;
  }
  await ensureCustomConnectorBackfill();

  const entitiesJson = connector.entities as unknown as Prisma.InputJsonValue;
  const configJson = connector.definition.connectionConfig as unknown as Prisma.InputJsonValue;

  await prisma.customConnector.create({
    data: {
      id: connector.definition.id,
      name: connector.definition.name,
      vendor: connector.definition.vendor,
      category: connector.definition.category,
      description: connector.definition.description,
      entityNames: connector.definition.entities,
      entities: entitiesJson,
      connectionConfig: configJson,
      createdByUserId: createdByUserId ?? null,
    },
  });
}

let customConnectorBackfillPromise: Promise<void> | null = null;

function ensureCustomConnectorBackfill(): Promise<void> {
  if (!isPostgresCustomConnectorStoreEnabled()) return Promise.resolve();
  if (customConnectorBackfillPromise) return customConnectorBackfillPromise;

  customConnectorBackfillPromise = (async () => {
    try {
      loadCustomConnectorStoreFromDisk();
      if (!customConnectorStore.size) return;

      for (const connector of customConnectorStore.values()) {
        const entitiesJson = connector.entities as unknown as Prisma.InputJsonValue;
        const configJson = connector.definition.connectionConfig as unknown as Prisma.InputJsonValue;

        await prisma.customConnector.upsert({
          where: { id: connector.definition.id },
          update: {
            name: connector.definition.name,
            vendor: connector.definition.vendor,
            category: connector.definition.category,
            description: connector.definition.description,
            entityNames: connector.definition.entities,
            entities: entitiesJson,
            connectionConfig: configJson,
          },
          create: {
            id: connector.definition.id,
            name: connector.definition.name,
            vendor: connector.definition.vendor,
            category: connector.definition.category,
            description: connector.definition.description,
            entityNames: connector.definition.entities,
            entities: entitiesJson,
            connectionConfig: configJson,
          },
        });
      }

      customConnectorStore.clear();
    } catch (error) {
      console.error('[custom-connectors] Failed to backfill file store to database:', error);
    }
  })();

  return customConnectorBackfillPromise;
}

function defaultSalesforceObjectsForProject(
  side: 'source' | 'target',
  project: MappingProject,
  systems: System[],
): string[] {
  void project;
  void systems;
  if (side === 'target') return [...SALESFORCE_FSC_OBJECTS, ...SALESFORCE_STANDARD_OBJECTS];
  return SALESFORCE_STANDARD_OBJECTS;
}

export function setupConnectorRoutes(app: Express, store: DbStore | FsStore): void {
  const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });
  void ensureCustomConnectorBackfill();

  // ─── GET /api/connectors ──────────────────────────────────────────────────
  // Public — no auth required for discovery
  app.get('/api/connectors', async (_req, res) => {
    try {
      const connectors = defaultRegistry.listAll();
      const customConnectors = (await listCustomConnectors()).map(({ definition }) => ({
        id: definition.id,
        displayName: definition.name,
        category: definition.category,
        description: definition.description,
        hasMockMode: true,
        requiredCredentials: [],
        protocol: 'Custom',
        vendor: definition.vendor,
        entities: definition.entities,
      }));
      res.json({ connectors: [...connectors, ...customConnectors] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not list connectors';
      sendError(_req, res, 500, 'CONNECTOR_PERSISTENCE_ERROR', message);
    }
  });

  // All mutating connector endpoints require auth
  app.use('/api/connectors', authMiddleware);

  // ─── POST /api/connectors/custom ──────────────────────────────────────────
  app.post('/api/connectors/custom', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const vendor = typeof body.vendor === 'string' && body.vendor.trim() ? body.vendor.trim() : 'Custom';
    const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'crm';
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : 'Custom connector';
    const entities = normalizeCustomEntities(body.entities);

    if (!name) {
      sendError(req, res, 400, 'INVALID_INPUT', 'name is required');
      return;
    }
    if (!entities.length) {
      sendError(req, res, 400, 'INVALID_INPUT', 'entities must be a non-empty array');
      return;
    }

    const safeConnectionConfig = sanitizeCustomConnectionConfig(body.connectionConfig);
    const id = `custom-${randomUUID().slice(0, 8)}`;

    const definition: CustomConnectorDefinition = {
      id,
      name,
      vendor,
      category,
      description,
      entities: entities.map((entity) => entity.name),
      connectionConfig: safeConnectionConfig,
    };

    const entry: StoredCustomConnector = {
      definition,
      entities,
    };

    try {
      await saveCustomConnector(entry, req.user?.userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not persist custom connector';
      sendError(req, res, 500, 'CONNECTOR_PERSISTENCE_ERROR', message);
      return;
    }

    res.status(201).json({
      id,
      connector: definition,
    });
  });

  // ─── GET /api/oauth/status ────────────────────────────────────────────────────
  // Returns which systems the user has connected (OAuth credentials stored in session)
  app.get('/api/oauth/status', authMiddleware, (_req: Request, res: Response) => {
    const userId = _req.user?.userId;
    if (!userId) {
      sendError(_req, res, 401, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const systems = defaultSessionStore.connectedSystems(userId);
    const statusMap = defaultSessionStore.status(userId);

    res.json({
      connected: systems.length > 0,
      systems,
      status: statusMap,
    });
  });

  // ─── POST /api/connectors/:id/test ────────────────────────────────────────
  app.post('/api/connectors/:id/test', async (req: Request, res: Response) => {
    const { id } = req.params;
    let customConnector: StoredCustomConnector | null = null;
    try {
      customConnector = await getCustomConnector(id);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not load custom connector';
      sendError(req, res, 500, 'CONNECTOR_PERSISTENCE_ERROR', message);
      return;
    }
    if (!defaultRegistry.has(id) && !customConnector) {
      sendError(req, res, 404, 'CONNECTOR_NOT_FOUND', `No connector registered with id "${id}"`);
      return;
    }

    if (customConnector) {
      res.json({
        connected: true,
        latencyMs: 0,
        systemInfo: {
          mode: 'uploaded',
          displayName: customConnector.definition.name,
          protocol: 'Custom',
        },
      });
      return;
    }

    try {
      const userId = req.user?.userId;
      const credentials = normalizeConnectorCredentials(
        id,
        extractCredentials(req.body as Record<string, unknown>, userId, id),
      );
      const connector = defaultRegistry.instantiate(id, credentials);
      await connector.connect(credentials);
      const result = await connector.testConnection();
      const info = await connector.getSystemInfo();
      if (hasCredentialValues(credentials) && info.mode !== 'live') {
        sendError(
          req,
          res,
          502,
          'LIVE_CONNECTION_REQUIRED',
          `Connector "${id}" did not establish a live connection with the provided credentials`,
        );
        return;
      }
      res.json({ ...result, systemInfo: info });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Connection test failed';
      sendError(req, res, 502, 'CONNECTION_ERROR', message);
    }
  });

  // ─── POST /api/connectors/:id/objects ────────────────────────────────────
  app.post('/api/connectors/:id/objects', async (req: Request, res: Response) => {
    const { id } = req.params;
    let customConnector: StoredCustomConnector | null = null;
    try {
      customConnector = await getCustomConnector(id);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not load custom connector';
      sendError(req, res, 500, 'CONNECTOR_PERSISTENCE_ERROR', message);
      return;
    }
    if (!defaultRegistry.has(id) && !customConnector) {
      sendError(req, res, 404, 'CONNECTOR_NOT_FOUND', `No connector registered with id "${id}"`);
      return;
    }

    if (customConnector) {
      res.json({
        objects: customConnector.definition.entities,
        mode: 'uploaded',
        total: customConnector.definition.entities.length,
      });
      return;
    }

    try {
      const userId = req.user?.userId;
      const credentials = normalizeConnectorCredentials(
        id,
        extractCredentials(req.body as Record<string, unknown>, userId, id),
      );
      const connector = defaultRegistry.instantiate(id, credentials);
      await connector.connect(credentials);
      const objects = await connector.listObjects();
      const info = await connector.getSystemInfo();
      if (hasCredentialValues(credentials) && info.mode !== 'live') {
        sendError(
          req,
          res,
          502,
          'LIVE_CONNECTION_REQUIRED',
          `Connector "${id}" did not establish a live connection with the provided credentials`,
        );
        return;
      }
      res.json({ objects, mode: info.mode, total: objects.length });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to list objects';
      sendError(req, res, 502, 'CONNECTOR_ERROR', message);
    }
  });

  // ─── POST /api/connectors/:id/schema ─────────────────────────────────────
  app.post('/api/connectors/:id/schema', async (req: Request, res: Response) => {
    const { id } = req.params;
    let customConnector: StoredCustomConnector | null = null;
    try {
      customConnector = await getCustomConnector(id);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not load custom connector';
      sendError(req, res, 500, 'CONNECTOR_PERSISTENCE_ERROR', message);
      return;
    }
    if (!defaultRegistry.has(id) && !customConnector) {
      sendError(req, res, 404, 'CONNECTOR_NOT_FOUND', `No connector registered with id "${id}"`);
      return;
    }

    const body = req.body as Record<string, unknown>;
    const objectNames = Array.isArray(body.objects) ? (body.objects as string[]) : undefined;

    if (customConnector) {
      const schema = buildCustomSchema(`sys-${id}`, customConnector.entities);
      res.json({
        entities: schema.entities,
        fields: schema.fields,
        relationships: schema.relationships,
        mode: 'uploaded',
        entityCount: schema.entities.length,
        fieldCount: schema.fields.length,
      });
      return;
    }

    try {
      const userId = req.user?.userId;
      const credentials = normalizeConnectorCredentials(
        id,
        extractCredentials(body, userId, id),
      );
      const connector = defaultRegistry.instantiate(id, credentials);
      await connector.connect(credentials);
      const schema = await connector.fetchSchema(objectNames);
      if (hasCredentialValues(credentials) && schema.mode !== 'live') {
        sendError(
          req,
          res,
          502,
          'LIVE_CONNECTION_REQUIRED',
          `Connector "${id}" returned mock schema despite provided credentials`,
        );
        return;
      }
      res.json({
        entities: schema.entities,
        fields: schema.fields,
        relationships: schema.relationships,
        mode: schema.mode,
        entityCount: schema.entities.length,
        fieldCount: schema.fields.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch schema';
      sendError(req, res, 502, 'CONNECTOR_ERROR', message);
    }
  });

  // ─── POST /api/projects/:projectId/schema/:connectorId ───────────────────
  // Ingest a connector schema into either the source or target system of a project.
  app.use('/api/projects', authMiddleware);
  app.post('/api/projects/:projectId/schema/upload-file', upload.single('file'), async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const project = await store.getProject(projectId);
    if (!project) {
      sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
      return;
    }

    if (!req.file) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'Missing file upload');
      return;
    }

    const sideRaw = typeof req.body.side === 'string' ? req.body.side : '';
    if (sideRaw !== 'source' && sideRaw !== 'target') {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'side must be either "source" or "target"');
      return;
    }

    const side = sideRaw as 'source' | 'target';
    const systemId = side === 'source' ? project.sourceSystemId : project.targetSystemId;

    try {
      const content = req.file.buffer.toString('utf8');
      const parsed = parseUploadedSchema(content, req.file.originalname, systemId);
      await store.replaceSystemSchema(systemId, parsed.entities, parsed.fields, parsed.relationships);
      await store.updateProjectTimestamp(projectId);

      res.json({
        entities: parsed.entities,
        fields: parsed.fields,
        relationships: parsed.relationships,
        mode: 'uploaded',
        side,
        systemId,
        fileName: req.file.originalname,
        entityCount: parsed.entities.length,
        fieldCount: parsed.fields.length,
        message: `${side} schema uploaded and ingested`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Schema upload parse failed';
      sendError(req, res, 400, 'SCHEMA_PARSE_ERROR', message);
    }
  });

  app.post(
    '/api/projects/:projectId/schema/:connectorId',
    async (req: Request, res: Response) => {
      const { projectId, connectorId } = req.params;

      const project = await store.getProject(projectId);
      if (!project) {
        sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
        return;
      }

      let customConnector: StoredCustomConnector | null = null;
      try {
        customConnector = await getCustomConnector(connectorId);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Could not load custom connector';
        sendError(req, res, 500, 'CONNECTOR_PERSISTENCE_ERROR', message);
        return;
      }
      if (!defaultRegistry.has(connectorId) && !customConnector) {
        sendError(
          req,
          res,
          404,
          'CONNECTOR_NOT_FOUND',
          `No connector registered with id "${connectorId}"`,
        );
        return;
      }

      const body = req.body as Record<string, unknown>;
      const side = body.side === 'target' ? 'target' : 'source';
      const systemId = side === 'source' ? project.sourceSystemId : project.targetSystemId;

      if (customConnector) {
        try {
          const schema = buildCustomSchema(systemId, customConnector.entities);
          await store.replaceSystemSchema(systemId, schema.entities, schema.fields, schema.relationships);
          await store.updateProjectTimestamp(projectId);

          res.json({
            entities: schema.entities,
            fields: schema.fields,
            relationships: schema.relationships,
            mode: 'uploaded',
            side,
            systemId,
            message: `${side} schema ingested via ${connectorId}`,
          });
          return;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Schema ingestion failed';
          sendError(req, res, 502, 'CONNECTOR_ERROR', message);
          return;
        }
      }

      let objectNames = Array.isArray(body.objects) ? (body.objects as string[]) : undefined;
      if ((!objectNames || objectNames.length === 0) && connectorId === 'salesforce') {
        const state = await store.getState();
        objectNames = defaultSalesforceObjectsForProject(side, project, state.systems);
      }

      try {
        const userId = req.user?.userId;
        const credentials = normalizeConnectorCredentials(
          connectorId,
          extractCredentials(body, userId, connectorId),
        );
        const connector = defaultRegistry.instantiate(connectorId, credentials);
        await connector.connect(credentials);
        const schema = await connector.fetchSchema(objectNames);
        if (hasCredentialValues(credentials) && schema.mode !== 'live') {
          sendError(
            req,
            res,
            502,
            'LIVE_CONNECTION_REQUIRED',
            `Connector "${connectorId}" returned mock schema despite provided credentials`,
          );
          return;
        }

        const normalizedEntities = schema.entities.map((entity) => ({
          ...entity,
          systemId,
        }));

        await store.replaceSystemSchema(systemId, normalizedEntities, schema.fields, schema.relationships);
        await store.updateProjectTimestamp(projectId);

        res.json({
          entities: normalizedEntities,
          fields: schema.fields,
          relationships: schema.relationships,
          mode: schema.mode,
          side,
          systemId,
          message: `${side} schema ingested via ${connectorId}`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Schema ingestion failed';
        sendError(req, res, 502, 'CONNECTOR_ERROR', message);
      }
    },
  );
}
