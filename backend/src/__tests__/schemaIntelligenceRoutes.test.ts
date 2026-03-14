import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIRMED_PATTERNS, ONE_TO_MANY_FIELDS } from '../agents/schemaIntelligenceData.js';
import { setupSchemaIntelligenceRoutes } from '../routes/schemaIntelligenceRoutes.js';

async function startServer(requireAuth: 'true' | 'false') {
  process.env.REQUIRE_AUTH = requireAuth;
  const app = express();
  app.use(express.json());
  setupSchemaIntelligenceRoutes(app);

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

afterEach(async () => {
  delete process.env.REQUIRE_AUTH;
});

describe('schema intelligence routes', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  });

  it('returns the full confirmed patterns corpus', async () => {
    const started = await startServer('false');
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/schema-intelligence/patterns`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      patterns: typeof CONFIRMED_PATTERNS;
      count: number;
    };

    expect(body.count).toBe(Object.keys(CONFIRMED_PATTERNS).length);
    expect(body.patterns.amtpayment).toEqual(CONFIRMED_PATTERNS.amtpayment);
  });

  it('filters schema intelligence patterns by field name', async () => {
    const started = await startServer('false');
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/schema-intelligence/patterns?field=AMT_PAYMENT`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      field: string;
      normalizedField: string;
      patterns: typeof CONFIRMED_PATTERNS.amtpayment;
      count: number;
    };

    expect(body.field).toBe('AMT_PAYMENT');
    expect(body.normalizedField).toBe('amtpayment');
    expect(body.patterns).toEqual(CONFIRMED_PATTERNS.amtpayment);
    expect(body.count).toBe(CONFIRMED_PATTERNS.amtpayment.length);
  });

  it('returns the one-to-many XML field list', async () => {
    const started = await startServer('false');
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/schema-intelligence/one-to-many`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { fields: string[]; count: number };
    expect(body.fields).toEqual(Array.from(ONE_TO_MANY_FIELDS).sort());
    expect(body.count).toBe(ONE_TO_MANY_FIELDS.size);
  });

  it('returns 404 for an unknown field filter', async () => {
    const started = await startServer('false');
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/schema-intelligence/patterns?field=DOES_NOT_EXIST`);
    expect(response.status).toBe(404);

    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('SCHEMA_INTELLIGENCE_PATTERN_NOT_FOUND');
  });

  it('requires authentication when auth is enabled', async () => {
    const started = await startServer('true');
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/schema-intelligence/patterns`);
    expect(response.status).toBe(401);

    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });
});
