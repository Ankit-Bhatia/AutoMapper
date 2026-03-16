import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupOrgRoutes } from '../routes/orgRoutes.js';
import { FsStore } from '../utils/fsStore.js';

describe('orgRoutes seed in FsStore mode', () => {
  let server: Server;
  let baseUrl = '';
  let store: FsStore;
  let projectId = '';
  let tempDir = '';
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousRequireAuth = process.env.REQUIRE_AUTH;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.REQUIRE_AUTH = 'false';

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-orgroutes-fs-'));
    store = new FsStore(tempDir);
    const project = store.createProject('RiskClam Project', undefined, 'RiskClam', 'Salesforce');
    projectId = project.id;

    const app = express();
    app.use(express.json());
    setupOrgRoutes(app, store);

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });

    if (previousDatabaseUrl) process.env.DATABASE_URL = previousDatabaseUrl;
    else delete process.env.DATABASE_URL;

    if (previousRequireAuth) process.env.REQUIRE_AUTH = previousRequireAuth;
    else delete process.env.REQUIRE_AUTH;
  });

  it('returns a zero-summary without Prisma in no-DB mode', async () => {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: { fromDerived: number; fromCanonical: number; fromAgent: number; total: number } };
    expect(body.summary).toEqual({
      fromDerived: 0,
      fromCanonical: 0,
      fromAgent: 0,
      total: 0,
    });
  });
});
