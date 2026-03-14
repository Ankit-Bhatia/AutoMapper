import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not resolve free port')));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(baseUrl: string, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // keep retrying
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Backend did not start within ${timeoutMs}ms`);
}

async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child) return;
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 2_000);
  });
}

function startBackend(port: number, dataDir: string): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      REQUIRE_AUTH: 'false',
      DATABASE_URL: '',
      DATA_DIR: dataDir,
      JWT_SECRET: process.env.JWT_SECRET || 'test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('custom connector persistence', () => {
  let tempDataDir: string | null = null;
  let backend: ChildProcess | null = null;

  afterEach(async () => {
    await stopProcess(backend);
    backend = null;
    if (tempDataDir) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  });

  it('persists custom connectors across backend restarts', async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-custom-connector-'));

    const firstPort = await getFreePort();
    const firstBase = `http://127.0.0.1:${firstPort}`;
    backend = startBackend(firstPort, tempDataDir);
    await waitForServer(firstBase);

    const createResponse = await fetch(`${firstBase}/api/connectors/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'LOS API',
        vendor: 'Acme',
        category: 'core-banking',
        description: 'LOS connector',
        entities: [
          {
            name: 'LoanApplication',
            fields: [
              { name: 'applicationId', dataType: 'string' },
              { name: 'status', dataType: 'string' },
            ],
          },
        ],
        connectionConfig: {
          baseUrl: 'https://example.com',
          bearerToken: 'secret',
        },
      }),
    });
    const created = await createResponse.json();
    expect(createResponse.status).toBe(201);
    expect(created.id).toMatch(/^custom-/);
    const connectorId = created.id as string;

    await stopProcess(backend);
    backend = null;

    const secondPort = await getFreePort();
    const secondBase = `http://127.0.0.1:${secondPort}`;
    backend = startBackend(secondPort, tempDataDir);
    await waitForServer(secondBase);

    const listResponse = await fetch(`${secondBase}/api/connectors`);
    const listBody = await listResponse.json() as { connectors: Array<{ id: string; displayName: string }> };
    expect(listResponse.status).toBe(200);
    expect(listBody.connectors.some((connector) => connector.id === connectorId)).toBe(true);
  });

  it('dedupes persisted custom connectors on startup and rewrites the file snapshot', async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-custom-connector-dedupe-'));
    fs.writeFileSync(
      path.join(tempDataDir, 'custom-connectors.json'),
      JSON.stringify([
        {
          definition: {
            id: 'custom-a',
            name: 'Core API',
            vendor: 'Acme',
            category: 'core-banking',
            description: 'Acme core REST',
            entities: ['Customer'],
            connectionConfig: { baseUrl: 'https://api.example.com', auth: 'bearer' },
          },
          entities: [
            {
              name: 'Customer',
              fields: [
                { name: 'customerId', dataType: 'string' },
                { name: 'status', dataType: 'string' },
              ],
            },
          ],
        },
        {
          definition: {
            id: 'custom-b',
            name: 'core api',
            vendor: 'Acme',
            category: 'core-banking',
            description: 'Legacy description variant',
            entities: ['Customer'],
            connectionConfig: { baseUrl: 'https://api.example.com', auth: 'bearer' },
          },
          entities: [
            {
              name: 'Customer',
              fields: [
                { name: 'customerId', dataType: 'string' },
              ],
            },
          ],
        },
      ], null, 2),
      'utf8',
    );

    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    backend = startBackend(port, tempDataDir);
    await waitForServer(baseUrl);

    const listResponse = await fetch(`${baseUrl}/api/connectors`);
    const listBody = await listResponse.json() as { connectors: Array<{ id: string }> };
    const customConnectors = listBody.connectors.filter((connector) => connector.id.startsWith('custom-'));

    expect(customConnectors).toHaveLength(1);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(tempDataDir, 'custom-connectors.json'), 'utf8'),
    ) as Array<{ definition: { id: string } }>;
    expect(persisted).toHaveLength(1);
  });

  it('persists custom connector deletion across backend restarts', async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-custom-connector-delete-'));

    const firstPort = await getFreePort();
    const firstBase = `http://127.0.0.1:${firstPort}`;
    backend = startBackend(firstPort, tempDataDir);
    await waitForServer(firstBase);

    const createResponse = await fetch(`${firstBase}/api/connectors/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'LOS API',
        vendor: 'Acme',
        category: 'core-banking',
        description: 'LOS connector',
        entities: [
          {
            name: 'LoanApplication',
            fields: [
              { name: 'applicationId', dataType: 'string' },
              { name: 'status', dataType: 'string' },
            ],
          },
        ],
        connectionConfig: {
          baseUrl: 'https://example.com',
        },
      }),
    });
    const created = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const deleteResponse = await fetch(`${firstBase}/api/connectors/custom/${created.id}`, {
      method: 'DELETE',
    });
    const deleteBody = await deleteResponse.json() as { deletedIds?: string[] };
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody.deletedIds).toContain(created.id);

    await stopProcess(backend);
    backend = null;

    const secondPort = await getFreePort();
    const secondBase = `http://127.0.0.1:${secondPort}`;
    backend = startBackend(secondPort, tempDataDir);
    await waitForServer(secondBase);

    const listResponse = await fetch(`${secondBase}/api/connectors`);
    const listBody = await listResponse.json() as { connectors: Array<{ id: string }> };
    expect(listBody.connectors.some((connector) => connector.id === created.id)).toBe(false);
  });
});
