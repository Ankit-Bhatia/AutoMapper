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

describe('POST /api/projects/:id/conflicts/:conflictId/resolve in FsStore mode', () => {
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

  it('accepts the chosen mapping and leaves the competing mapping unmatched', async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-conflict-'));
    const dbPath = path.join(tempDataDir, 'db.json');
    fs.writeFileSync(
      dbPath,
      JSON.stringify(
        {
          systems: [
            { id: '11111111-1111-4111-8111-111111111111', name: 'RiskClam', type: 'riskclam' },
            { id: '22222222-2222-4222-8222-222222222222', name: 'Salesforce', type: 'salesforce' },
          ],
          entities: [
            { id: '33333333-3333-4333-8333-333333333333', systemId: '11111111-1111-4111-8111-111111111111', name: 'LOAN' },
            { id: '44444444-4444-4444-8444-444444444444', systemId: '22222222-2222-4222-8222-222222222222', name: 'FinancialAccount' },
          ],
          fields: [
            { id: '55555555-5555-4555-8555-555555555555', entityId: '33333333-3333-4333-8333-333333333333', name: 'AMT_PAYMENT', dataType: 'decimal' },
            { id: '66666666-6666-4666-8666-666666666666', entityId: '33333333-3333-4333-8333-333333333333', name: 'AMT_APPROVED_LOAN', dataType: 'decimal' },
            { id: '77777777-7777-4777-8777-777777777777', entityId: '44444444-4444-4444-8444-444444444444', name: 'Monthly_Payment__c', dataType: 'decimal' },
          ],
          relationships: [],
          projects: [
            {
              id: '88888888-8888-4888-8888-888888888888',
              name: 'Conflict Project',
              sourceSystemId: '11111111-1111-4111-8111-111111111111',
              targetSystemId: '22222222-2222-4222-8222-222222222222',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          entityMappings: [
            {
              id: '99999999-9999-4999-8999-999999999999',
              projectId: '88888888-8888-4888-8888-888888888888',
              sourceEntityId: '33333333-3333-4333-8333-333333333333',
              targetEntityId: '44444444-4444-4444-8444-444444444444',
              confidence: 0.9,
              rationale: 'test',
            },
          ],
          fieldMappings: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              entityMappingId: '99999999-9999-4999-8999-999999999999',
              sourceFieldId: '55555555-5555-4555-8555-555555555555',
              targetFieldId: '77777777-7777-4777-8777-777777777777',
              transform: { type: 'direct', config: {} },
              confidence: 0.91,
              rationale: 'test',
              status: 'suggested',
            },
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              entityMappingId: '99999999-9999-4999-8999-999999999999',
              sourceFieldId: '66666666-6666-4666-8666-666666666666',
              targetFieldId: '77777777-7777-4777-8777-777777777777',
              transform: { type: 'direct', config: {} },
              confidence: 0.62,
              rationale: 'test',
              status: 'suggested',
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

    const response = await fetch(`${baseUrl}/api/projects/88888888-8888-4888-8888-888888888888/conflicts/conflict-77777777-7777-4777-8777-777777777777/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'pick', winnerMappingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ resolved: true, unresolvedConflicts: 0 });

    const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as {
      fieldMappings: Array<{ id: string; status: string }>;
      auditEntries: Array<{ action: string }>;
    };

    expect(persisted.fieldMappings.find((mapping) => mapping.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')?.status).toBe('accepted');
    expect(persisted.fieldMappings.find((mapping) => mapping.id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')?.status).toBe('unmatched');
    expect(persisted.auditEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'conflict_resolved' }),
      ]),
    );
  });
});
