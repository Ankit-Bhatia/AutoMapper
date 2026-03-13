import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateToken } from '../auth/jwt.js';
import { setupOAuthRoutes } from '../routes/oauthRoutes.js';
import { ConnectorSessionStore } from '../services/connectorSessionStore.js';

interface HttpResult {
  status: number;
  body: unknown;
}

async function makeRequest(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<HttpResult> {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(path, baseUrl),
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
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
    if (payload) req.write(payload);
    req.end();
  });
}

describe('oauthRoutes SAP client credentials flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.JWT_SECRET;
    delete process.env.REQUIRE_AUTH;
  });

  it('connects SAP OAuth via client credentials and exposes sap in status', async () => {
    process.env.REQUIRE_AUTH = 'true';
    process.env.JWT_SECRET = 'test-jwt-secret';

    const store = new ConnectorSessionStore();
    const app = express();
    app.use(express.json());
    setupOAuthRoutes(app, store);

    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const token = generateToken({ userId: 'user-1', email: 'owner1@example.com', role: 'OWNER' });

    const tokenResponse = {
      access_token: 'sap-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'sap.read',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(tokenResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    try {
      const connectResult = await makeRequest(
        baseUrl,
        'POST',
        '/api/oauth/sap/connect',
        token,
        {
          clientId: 'sap-client-id',
          clientSecret: 'sap-client-secret',
          tokenUrl: 'https://sap.example.com/oauth/token',
        },
      );
      expect(connectResult.status).toBe(200);
      expect(connectResult.body).toMatchObject({
        connected: true,
        system: 'sap',
        expiresIn: 3600,
      });
      expect(connectResult.body).not.toHaveProperty('accessToken');

      const statusResult = await makeRequest(baseUrl, 'GET', '/api/oauth/status', token);
      expect(statusResult.status).toBe(200);
      expect(statusResult.body).toMatchObject({
        systems: ['sap'],
        status: {
          sap: {
            connected: true,
          },
        },
      });

      const stored = store.get('user-1', 'sap');
      expect(stored).toBeDefined();
      expect(stored?.accessToken).toBe('sap-access-token');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('disconnect clears SAP OAuth session credentials', async () => {
    process.env.REQUIRE_AUTH = 'true';
    process.env.JWT_SECRET = 'test-jwt-secret';

    const store = new ConnectorSessionStore();
    store.set('user-2', 'sap', {
      accessToken: 'existing-token',
      tokenType: 'Bearer',
      tokenUrl: 'https://sap.example.com/oauth/token',
    });

    const app = express();
    app.use(express.json());
    setupOAuthRoutes(app, store);

    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const token = generateToken({ userId: 'user-2', email: 'owner2@example.com', role: 'OWNER' });

    try {
      const disconnectResult = await makeRequest(
        baseUrl,
        'POST',
        '/api/oauth/sap/disconnect',
        token,
        {},
      );
      expect(disconnectResult.status).toBe(200);
      expect(disconnectResult.body).toMatchObject({ disconnected: true });

      const statusResult = await makeRequest(baseUrl, 'GET', '/api/oauth/status', token);
      expect(statusResult.status).toBe(200);
      expect(statusResult.body).toMatchObject({
        systems: [],
        status: {},
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
