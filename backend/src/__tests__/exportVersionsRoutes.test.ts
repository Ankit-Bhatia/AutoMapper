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
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Backend did not start within ${timeoutMs}ms`);
}

async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
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

describe('export version routes in FsStore mode', () => {
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

  async function bootServer() {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-export-versions-'));
    const dbPath = path.join(tempDataDir, 'db.json');
    const now = new Date().toISOString();
    fs.writeFileSync(
      dbPath,
      JSON.stringify(
        {
          systems: [
            { id: 'src-system-1', name: 'jackhenry-coredirector', type: 'jackhenry' },
            { id: 'tgt-system-1', name: 'salesforce', type: 'salesforce' },
          ],
          entities: [
            { id: 'src-entity-1', systemId: 'src-system-1', name: 'Loan' },
            { id: 'tgt-entity-1', systemId: 'tgt-system-1', name: 'FinancialAccount' },
          ],
          fields: [
            { id: 'src-field-1', entityId: 'src-entity-1', name: 'AMT_PAYMENT', dataType: 'decimal', required: true },
            { id: 'src-field-2', entityId: 'src-entity-1', name: 'STATUS', dataType: 'string', required: false },
            { id: 'tgt-field-1', entityId: 'tgt-entity-1', name: 'Monthly_Payment__c', dataType: 'decimal', required: true },
            { id: 'tgt-field-2', entityId: 'tgt-entity-1', name: 'Status__c', dataType: 'string', required: false },
          ],
          relationships: [],
          projects: [
            {
              id: 'project-1',
              name: 'Core Director to FSC',
              sourceSystemId: 'src-system-1',
              targetSystemId: 'tgt-system-1',
              createdAt: now,
              updatedAt: now,
              archived: false,
              resolvedOneToManyMappings: {},
            },
          ],
          entityMappings: [
            {
              id: 'entity-map-1',
              projectId: 'project-1',
              sourceEntityId: 'src-entity-1',
              targetEntityId: 'tgt-entity-1',
              confidence: 0.9,
              rationale: 'seed',
            },
          ],
          fieldMappings: [
            {
              id: 'field-map-1',
              entityMappingId: 'entity-map-1',
              sourceFieldId: 'src-field-1',
              targetFieldId: 'tgt-field-1',
              transform: { type: 'direct', config: {} },
              confidence: 0.92,
              rationale: 'seed',
              status: 'accepted',
            },
          ],
          auditEntries: [],
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
    return { baseUrl };
  }

  it('embeds schema fingerprints and persists version records newest-first', async () => {
    const { baseUrl } = await bootServer();

    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${baseUrl}/api/projects/project-1/export?format=json`);
      expect(response.status).toBe(200);
      const body = await response.json() as {
        automapper: {
          metadata: {
            schemaFingerprint: {
              sourceHash: string;
              targetHash: string;
              fieldCount: { source: number; target: number };
            };
          };
        };
      };
      expect(body.automapper.metadata.schemaFingerprint).toMatchObject({
        fieldCount: { source: 2, target: 2 },
      });
      expect(body.automapper.metadata.schemaFingerprint.sourceHash).toHaveLength(64);
      expect(body.automapper.metadata.schemaFingerprint.targetHash).toHaveLength(64);
    }

    const versionsResponse = await fetch(`${baseUrl}/api/projects/project-1/versions`);
    const versionsBody = await versionsResponse.json() as {
      versions: Array<{
        version: number;
        schemaFingerprint: { sourceHash: string; targetHash: string };
      }>;
    };

    expect(versionsResponse.status).toBe(200);
    expect(versionsBody.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(versionsBody.versions[0].schemaFingerprint.sourceHash).toHaveLength(64);

    const versionsDir = path.join(tempDataDir!, 'projects', 'project-1', 'versions');
    const versionFiles = fs.readdirSync(versionsDir);
    expect(versionFiles).toHaveLength(2);

    const storedVersion = JSON.parse(
      fs.readFileSync(path.join(versionsDir, versionFiles[0]), 'utf8'),
    ) as {
      schemaFingerprint: { sourceHash: string; targetHash: string };
      fieldsSnapshot: { source: Array<{ id: string }>; target: Array<{ id: string }> };
    };

    expect(storedVersion.schemaFingerprint.sourceHash).toHaveLength(64);
    expect(storedVersion.fieldsSnapshot.source).toHaveLength(2);
    expect(storedVersion.fieldsSnapshot.target).toHaveLength(2);
  });
});
