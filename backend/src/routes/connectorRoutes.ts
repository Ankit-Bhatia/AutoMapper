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
import type { DbStore } from '../db/dbStore.js';
import { defaultRegistry } from '../connectors/ConnectorRegistry.js';
import type { ConnectorCredentials } from '../connectors/IConnector.js';
import { normalizeConnectorCredentials } from '../connectors/credentialNormalizer.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import { defaultSessionStore } from '../services/connectorSessionStore.js';
import { parseUploadedSchema } from '../services/schemaUploadParser.js';

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  res.status(status).json({ error: { code, message, details } });
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

export function setupConnectorRoutes(app: Express, store: DbStore): void {
  const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });

  // ─── GET /api/connectors ──────────────────────────────────────────────────
  // Public — no auth required for discovery
  app.get('/api/connectors', (_req, res) => {
    const connectors = defaultRegistry.listAll();
    res.json({ connectors });
  });

  // All mutating connector endpoints require auth
  app.use('/api/connectors', authMiddleware);

  // ─── GET /api/oauth/status ────────────────────────────────────────────────────
  // Returns which systems the user has connected (OAuth credentials stored in session)
  app.get('/api/oauth/status', authMiddleware, (_req: Request, res: Response) => {
    const userId = _req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
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
    if (!defaultRegistry.has(id)) {
      sendError(res, 404, 'CONNECTOR_NOT_FOUND', `No connector registered with id "${id}"`);
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
      sendError(res, 502, 'CONNECTION_ERROR', message);
    }
  });

  // ─── POST /api/connectors/:id/objects ────────────────────────────────────
  app.post('/api/connectors/:id/objects', async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!defaultRegistry.has(id)) {
      sendError(res, 404, 'CONNECTOR_NOT_FOUND', `No connector registered with id "${id}"`);
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
      sendError(res, 502, 'CONNECTOR_ERROR', message);
    }
  });

  // ─── POST /api/connectors/:id/schema ─────────────────────────────────────
  app.post('/api/connectors/:id/schema', async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!defaultRegistry.has(id)) {
      sendError(res, 404, 'CONNECTOR_NOT_FOUND', `No connector registered with id "${id}"`);
      return;
    }

    const body = req.body as Record<string, unknown>;
    const objectNames = Array.isArray(body.objects) ? (body.objects as string[]) : undefined;

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
      sendError(res, 502, 'CONNECTOR_ERROR', message);
    }
  });

  // ─── POST /api/projects/:projectId/schema/:connectorId ───────────────────
  // Ingest a connector schema into either the source or target system of a project.
  app.use('/api/projects', authMiddleware);
  app.post('/api/projects/:projectId/schema/upload-file', upload.single('file'), async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const project = await store.getProject(projectId);
    if (!project) {
      sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
      return;
    }

    if (!req.file) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Missing file upload');
      return;
    }

    const sideRaw = typeof req.body.side === 'string' ? req.body.side : '';
    if (sideRaw !== 'source' && sideRaw !== 'target') {
      sendError(res, 400, 'VALIDATION_ERROR', 'side must be either "source" or "target"');
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
      sendError(res, 400, 'SCHEMA_PARSE_ERROR', message);
    }
  });

  app.post(
    '/api/projects/:projectId/schema/:connectorId',
    async (req: Request, res: Response) => {
      const { projectId, connectorId } = req.params;

      const project = await store.getProject(projectId);
      if (!project) {
        sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
        return;
      }

      if (!defaultRegistry.has(connectorId)) {
        sendError(
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
      const objectNames = Array.isArray(body.objects) ? (body.objects as string[]) : undefined;

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
        sendError(res, 502, 'CONNECTOR_ERROR', message);
      }
    },
  );
}
