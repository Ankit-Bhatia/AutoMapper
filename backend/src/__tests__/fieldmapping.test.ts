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
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
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
      // keep retrying until timeout
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
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 2_000);
  });
}

describe('PATCH /api/field-mappings/:id in FsStore mode', () => {
  let child: ChildProcess | null = null;
  let tempDataDir: string | null = null;

  afterEach(async () => {
    await stopProcess(child);
    child = null;

    if (tempDataDir) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  });

  it('updates mapping status without Prisma when DATABASE_URL is unset', async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-fsstore-'));
    const dbPath = path.join(tempDataDir, 'db.json');
    fs.writeFileSync(
      dbPath,
      JSON.stringify(
        {
          systems: [],
          entities: [],
          fields: [],
          relationships: [],
          projects: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'FsStore Audit Project',
              sourceSystemId: '22222222-2222-4222-8222-222222222222',
              targetSystemId: '33333333-3333-4333-8333-333333333333',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          entityMappings: [
            {
              id: 'em-test-1',
              projectId: '11111111-1111-4111-8111-111111111111',
              sourceEntityId: '44444444-4444-4444-8444-444444444444',
              targetEntityId: '55555555-5555-4555-8555-555555555555',
              confidence: 0.64,
              rationale: 'seed',
            },
          ],
          auditEntries: [],
          fieldMappings: [
            {
              id: 'fm-test-1',
              entityMappingId: 'em-test-1',
              sourceFieldId: 'sf-test-1',
              targetFieldId: 'tf-test-1',
              transform: { type: 'direct', config: {} },
              confidence: 0.64,
              rationale: 'seed',
              status: 'suggested',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        REQUIRE_AUTH: 'false',
        DATABASE_URL: '',
        DATA_DIR: tempDataDir,
        JWT_SECRET: process.env.JWT_SECRET || 'test-secret',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForServer(baseUrl);

    const response = await fetch(`${baseUrl}/api/field-mappings/fm-test-1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'accepted' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      fieldMapping: {
        id: 'fm-test-1',
        status: 'accepted',
      },
    });

    const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as {
      auditEntries?: Array<{ action: string; actor: { email: string } }>;
    };
    expect(persisted.auditEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'mapping_accepted',
          actor: expect.objectContaining({
            email: 'demo.admin@automapper.local',
          }),
        }),
      ]),
    );
  });
});
