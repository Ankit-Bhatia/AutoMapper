/**
 * AutoMapper MCP Server (TypeScript / Full Backend)
 * ==================================================
 * Registers an MCP server endpoint on the existing Express app.
 * Mount this alongside the REST API by calling setupMCPServer(app, store).
 *
 * Exposed tools use AutoMapper's real connector registry and in-memory
 * project store — this is the production version vs. the standalone
 * mcp-server.mjs which is the demo version.
 *
 * Endpoint: POST/GET/DELETE /mcp  (StreamableHTTP transport)
 *
 * For Claude Desktop integration, the standalone mcp-server.mjs with
 * --stdio flag is simpler. This module is for HTTP-based integrations
 * (Cursor, web agents, Claude Code remote mode).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Express, Request, Response } from 'express';
import { defaultRegistry } from '../connectors/ConnectorRegistry.js';
import type { InMemoryStore } from '../db/inMemoryStore.js';

// ─── Session management ───────────────────────────────────────────────────────

const sessions = new Map<string, StreamableHTTPServerTransport>();

// ─── Server factory ───────────────────────────────────────────────────────────

function createMcpServer(store: InMemoryStore): McpServer {
  const server = new McpServer({ name: 'automapper', version: '1.0.0' });

  // ── list_connectors ────────────────────────────────────────────────────────
  server.tool(
    'automapper_list_connectors',
    'List all registered AutoMapper connectors with metadata.',
    {},
    async () => {
      const connectors = defaultRegistry.list();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ connectors, total: connectors.length }, null, 2) }],
      };
    },
  );

  // ── get_system_info ────────────────────────────────────────────────────────
  server.tool(
    'automapper_get_system_info',
    'Get detailed metadata for a connector including protocol, auth method, and system-specific configuration.',
    { connector_id: z.string() },
    async ({ connector_id }) => {
      try {
        const connector = await defaultRegistry.instantiate(connector_id);
        await connector.connect();
        const info = await connector.getSystemInfo();
        return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── fetch_schema ───────────────────────────────────────────────────────────
  server.tool(
    'automapper_fetch_schema',
    'Fetch the full schema from a connector — entities, fields, compliance tags (GLBA_NPI, PCI_CARD, SOX_FINANCIAL, FFIEC_AUDIT, BSA_AML), and jXchange XPath values.',
    {
      connector_id: z.string(),
      entities: z.array(z.string()).optional(),
    },
    async ({ connector_id, entities }) => {
      try {
        const connector = await defaultRegistry.instantiate(connector_id);
        await connector.connect();
        const schema = await connector.fetchSchema(entities);
        return { content: [{ type: 'text' as const, text: JSON.stringify(schema, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── get_sample_data ────────────────────────────────────────────────────────
  server.tool(
    'automapper_get_sample_data',
    'Get sample/synthetic rows for an entity. PII fields are automatically masked.',
    {
      connector_id: z.string(),
      entity: z.string(),
      limit: z.number().int().min(1).max(10).optional().default(3),
    },
    async ({ connector_id, entity, limit }) => {
      try {
        const connector = await defaultRegistry.instantiate(connector_id);
        await connector.connect();
        const rows = await connector.getSampleData(entity, limit);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ connector_id, entity, rows }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── test_connection ────────────────────────────────────────────────────────
  server.tool(
    'automapper_test_connection',
    'Test whether a connector can establish a connection.',
    { connector_id: z.string() },
    async ({ connector_id }) => {
      try {
        const connector = await defaultRegistry.instantiate(connector_id);
        await connector.connect();
        const result = await connector.testConnection();
        return { content: [{ type: 'text' as const, text: JSON.stringify({ connector_id, ...result }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── list_projects ──────────────────────────────────────────────────────────
  server.tool(
    'automapper_list_projects',
    'List all AutoMapper mapping projects with their source/target system info and mapping status.',
    {},
    async () => {
      const projects = store.listProjects();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ projects, total: projects.length }, null, 2) }],
      };
    },
  );

  // ── get_project ────────────────────────────────────────────────────────────
  server.tool(
    'automapper_get_project',
    'Get full details of a mapping project including all entity and field mappings with confidence scores.',
    { project_id: z.string() },
    async ({ project_id }) => {
      const project = store.getProject(project_id);
      if (!project) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Project "${project_id}" not found` }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(project, null, 2) }] };
    },
  );

  // ── suggest_mappings ───────────────────────────────────────────────────────
  server.tool(
    'automapper_suggest_mappings',
    'Run heuristic field mapping for an existing project and return suggested mappings with confidence scores.',
    { project_id: z.string() },
    async ({ project_id }) => {
      const project = store.getProject(project_id);
      if (!project) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Project "${project_id}" not found` }) }], isError: true };
      }
      // Return current mappings (the REST API endpoint /suggest-mappings would run the full heuristic)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            project_id,
            fieldMappings: project.fieldMappings ?? [],
            note: 'Use POST /api/projects/:id/suggest-mappings via REST API to regenerate mappings, or POST /api/projects/:id/orchestrate for the full AI agent pipeline.',
          }, null, 2),
        }],
      };
    },
  );

  return server;
}

// ─── Express route setup ──────────────────────────────────────────────────────

/**
 * Mount AutoMapper's MCP server on the existing Express application.
 * Call this in index.ts after other routes are set up.
 *
 * @example
 * import { setupMCPServer } from './mcp/autoMapperMCPServer.js';
 * setupMCPServer(app, store);
 */
export function setupMCPServer(app: Express, store: InMemoryStore): void {
  async function handleRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      if (!sessionId) {
        if (req.method !== 'POST') {
          res.status(400).json({ error: 'New MCP sessions must be initialized with POST' });
          return;
        }
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        const server = createMcpServer(store);
        await server.connect(transport);
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await transport.handleRequest(req, res, req.body);
        if (transport.sessionId) sessions.set(transport.sessionId, transport);

      } else if (sessions.has(sessionId)) {
        await sessions.get(sessionId)!.handleRequest(req, res, req.body);

      } else {
        res.status(404).json({ error: `MCP session "${sessionId}" not found or expired` });
      }
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  }

  app.all('/mcp', (req, res) => void handleRequest(req, res));

  console.log('[AutoMapper] MCP server mounted at /mcp (StreamableHTTP)');
}
