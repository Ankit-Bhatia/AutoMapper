import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbStore } from '../db/dbStore.js';
import { setupConnectorRoutes } from '../routes/connectorRoutes.js';

interface HttpResult {
  status: number;
  body: unknown;
}

function createTestServer(): { server: http.Server; baseUrl: string } {
  const app = express();
  app.use(express.json());
  setupConnectorRoutes(app, {} as DbStore);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, baseUrl };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function sendJson(
  baseUrl: string,
  path: string,
  method: 'POST' | 'DELETE',
  payload?: Record<string, unknown>,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(path, baseUrl),
      {
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
            }
          : undefined,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: unknown = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = raw;
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            body: parsed,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) {
      req.write(JSON.stringify(payload));
    }
    req.end();
  });
}

describe('POST /api/connectors/custom', () => {
  const originalRequireAuth = process.env.REQUIRE_AUTH;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.REQUIRE_AUTH = 'false';
    process.env.DATABASE_URL = '';
  });

  afterEach(() => {
    process.env.REQUIRE_AUTH = originalRequireAuth;
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
    else delete process.env.DATABASE_URL;
  });

  it('creates a custom connector and returns 201 with custom-* id', async () => {
    const { server, baseUrl } = createTestServer();
    const connectorName = `Core API Test ${Date.now()}`;
    let createdId: string | null = null;

    try {
      const response = await sendJson(baseUrl, '/api/connectors/custom', 'POST', {
        name: connectorName,
        vendor: 'Acme',
        category: 'core-banking',
        description: 'Acme core REST',
        entities: [
          {
            name: 'Customer',
            fields: [
              { name: 'customerId', dataType: 'string' },
              { name: 'status', dataType: 'string' },
            ],
          },
        ],
        connectionConfig: {
          baseUrl: 'https://api.example.com',
          auth: 'bearer',
          bearerToken: 'secret-token',
          basicUsername: 'user',
          basicPassword: 'pass',
          apiKey: 'secret-key',
        },
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: expect.stringMatching(/^custom-/),
        connector: {
          name: connectorName,
          vendor: 'Acme',
        },
      });
      createdId = (response.body as { id?: string }).id ?? null;

      const connector = (response.body as { connector?: { connectionConfig?: Record<string, unknown> } })
        .connector;
      expect(connector?.connectionConfig).toMatchObject({
        baseUrl: 'https://api.example.com',
        auth: 'bearer',
      });
      expect(connector?.connectionConfig).not.toHaveProperty('bearerToken');
      expect(connector?.connectionConfig).not.toHaveProperty('basicUsername');
      expect(connector?.connectionConfig).not.toHaveProperty('basicPassword');
      expect(connector?.connectionConfig).not.toHaveProperty('apiKey');
    } finally {
      if (createdId) {
        await sendJson(baseUrl, `/api/connectors/custom/${createdId}`, 'DELETE');
      }
      await closeServer(server);
    }
  });

  it('returns 400 INVALID_INPUT when name is missing', async () => {
    const { server, baseUrl } = createTestServer();

    try {
      const response = await sendJson(baseUrl, '/api/connectors/custom', 'POST', {});
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'INVALID_INPUT',
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  it('returns 400 INVALID_INPUT when entities are empty', async () => {
    const { server, baseUrl } = createTestServer();

    try {
      const response = await sendJson(baseUrl, '/api/connectors/custom', 'POST', {
        name: 'X',
        entities: [],
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'INVALID_INPUT',
        },
      });
    } finally {
      await closeServer(server);
    }
  });
});
