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

describe('project dashboard routes in FsStore mode', () => {
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
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-dashboard-'));
    const dbPath = path.join(tempDataDir, 'db.json');
    const now = new Date().toISOString();
    fs.writeFileSync(
      dbPath,
      JSON.stringify(
        {
          systems: [
            { id: 'src-system-1', name: 'jackhenry-silverlake', type: 'jackhenry' },
            { id: 'tgt-system-1', name: 'salesforce', type: 'salesforce' },
          ],
          entities: [
            { id: 'src-entity-1', systemId: 'src-system-1', name: 'Loan' },
            { id: 'tgt-entity-1', systemId: 'tgt-system-1', name: 'FinancialAccount' },
          ],
          fields: [
            { id: 'src-field-1', entityId: 'src-entity-1', name: 'AMT_PAYMENT', dataType: 'decimal' },
            { id: 'tgt-field-1', entityId: 'tgt-entity-1', name: 'Monthly_Payment__c', dataType: 'decimal', required: true },
            { id: 'tgt-field-2', entityId: 'tgt-entity-1', name: 'OpenDate', dataType: 'date', required: true },
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
              confidence: 0.8,
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
              confidence: 0.82,
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
    return { baseUrl, dbPath };
  }

  it('returns enriched project cards for the dashboard list', async () => {
    const { baseUrl } = await bootServer();

    const response = await fetch(`${baseUrl}/api/projects`);
    const body = await response.json() as {
      projects: Array<{
        project: { id: string; archived?: boolean };
        sourceConnectorName?: string;
        targetConnectorName?: string;
        coverage: { mapped: number; total: number };
        openConflicts: number;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({
      project: {
        id: 'project-1',
        archived: false,
      },
      sourceConnectorName: 'Jack Henry SilverLake',
      targetConnectorName: 'Salesforce CRM',
      coverage: {
        mapped: 1,
        total: 2,
      },
      openConflicts: 0,
    });
  });

  it('patches project name/archive and duplicates mappings', async () => {
    const { baseUrl, dbPath } = await bootServer();

    const patchResponse = await fetch(`${baseUrl}/api/projects/project-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Archived Portfolio Project', archived: true }),
    });
    const patched = await patchResponse.json() as { project: { name: string; archived?: boolean } };

    expect(patchResponse.status).toBe(200);
    expect(patched.project).toMatchObject({
      name: 'Archived Portfolio Project',
      archived: true,
    });

    const duplicateResponse = await fetch(`${baseUrl}/api/projects/project-1/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const duplicated = await duplicateResponse.json() as { newProjectId: string; project: { name: string; archived?: boolean } };

    expect(duplicateResponse.status).toBe(201);
    expect(duplicated.newProjectId).toBeTruthy();
    expect(duplicated.project).toMatchObject({
      name: 'Copy of Archived Portfolio Project',
      archived: false,
    });

    const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as {
      projects: Array<{ id: string; name: string; archived?: boolean }>;
      entityMappings: Array<{ projectId: string }>;
      fieldMappings: Array<{ entityMappingId: string }>;
      auditEntries: Array<{ action: string }>;
    };

    expect(persisted.projects).toHaveLength(2);
    expect(persisted.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'project-1', archived: true }),
        expect.objectContaining({ id: duplicated.newProjectId, name: 'Copy of Archived Portfolio Project', archived: false }),
      ]),
    );
    expect(persisted.entityMappings).toHaveLength(2);
    expect(persisted.fieldMappings).toHaveLength(2);
    expect(persisted.auditEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'project_updated' }),
        expect.objectContaining({ action: 'project_created' }),
      ]),
    );
  });
});
