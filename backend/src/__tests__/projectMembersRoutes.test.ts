import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { generateToken } from '../auth/jwt.js';

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
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 2_000);
  });
}

describe('project member routes', () => {
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

  async function bootServer(options?: {
    requireAuth?: boolean;
    members?: Array<{ userId: string; email: string; role: string; addedAt: string }>;
  }) {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-project-members-'));
    const dbPath = path.join(tempDataDir, 'db.json');
    const now = new Date().toISOString();
    fs.writeFileSync(dbPath, JSON.stringify({
      systems: [
        { id: 'src-system-1', name: 'jackhenry-coredirector', type: 'jackhenry' },
        { id: 'tgt-system-1', name: 'salesforce', type: 'salesforce' },
      ],
      entities: [
        { id: 'src-entity-1', systemId: 'src-system-1', name: 'Loan' },
        { id: 'tgt-entity-1', systemId: 'tgt-system-1', name: 'FinancialAccount' },
      ],
      fields: [
        { id: 'src-field-1', entityId: 'src-entity-1', name: 'AMT_PAYMENT', dataType: 'decimal' },
        { id: 'tgt-field-1', entityId: 'tgt-entity-1', name: 'Monthly_Payment__c', dataType: 'decimal', required: true },
      ],
      relationships: [],
      projects: [
        {
          id: 'project-1',
          name: 'Protected Project',
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
          confidence: 0.9,
          rationale: 'seed',
          status: 'accepted',
        },
      ],
      auditEntries: [],
    }, null, 2), 'utf8');

    if (options?.members) {
      const membersPath = path.join(tempDataDir, 'projects', 'project-1', 'members.json');
      fs.mkdirSync(path.dirname(membersPath), { recursive: true });
      fs.writeFileSync(membersPath, JSON.stringify(options.members, null, 2), 'utf8');
    }

    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        REQUIRE_AUTH: options?.requireAuth ? 'true' : 'false',
        DATABASE_URL: '',
        DATA_DIR: tempDataDir,
        JWT_SECRET: 'test-secret',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForServer(baseUrl);
    return { baseUrl, dbPath };
  }

  it('returns an empty members array for projects with no members in demo mode', async () => {
    const { baseUrl } = await bootServer();

    const response = await fetch(`${baseUrl}/api/projects/project-1/members`);
    const body = await response.json() as { members: unknown[] };

    expect(response.status).toBe(200);
    expect(body.members).toEqual([]);
  });

  it('adds members in demo mode and returns 409 for duplicate email', async () => {
    const { baseUrl } = await bootServer({
      members: [{ userId: 'admin@example.com', email: 'admin@example.com', role: 'admin', addedAt: new Date().toISOString() }],
    });

    const created = await fetch(`${baseUrl}/api/projects/project-1/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mapper@example.com', role: 'mapper' }),
    });

    expect(created.status).toBe(201);

    const duplicate = await fetch(`${baseUrl}/api/projects/project-1/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mapper@example.com', role: 'viewer' }),
    });
    const duplicateBody = await duplicate.json() as { error: { message: string } };

    expect(duplicate.status).toBe(409);
    expect(duplicateBody.error.message).toBe('A member with that email already exists');
  });

  it('writes a role_changed audit entry when a member role is patched', async () => {
    const now = new Date().toISOString();
    const { baseUrl, dbPath } = await bootServer({
      members: [
        { userId: 'admin@example.com', email: 'admin@example.com', role: 'admin', addedAt: now },
        { userId: 'mapper@example.com', email: 'mapper@example.com', role: 'mapper', addedAt: now },
      ],
    });

    const response = await fetch(`${baseUrl}/api/projects/project-1/members/mapper@example.com`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'approver' }),
    });
    const body = await response.json() as { role: string };

    expect(response.status).toBe(200);
    expect(body.role).toBe('approver');

    const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as {
      auditEntries: Array<{ action: string; diff?: { before?: { role?: string }; after?: { role?: string } } }>;
    };
    expect(persisted.auditEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'role_changed',
        diff: expect.objectContaining({
          before: expect.objectContaining({ role: 'mapper' }),
          after: expect.objectContaining({ role: 'approver' }),
        }),
      }),
    ]));
  });

  it('returns 400 when removing the last admin', async () => {
    const { baseUrl } = await bootServer({
      members: [{ userId: 'admin@example.com', email: 'admin@example.com', role: 'admin', addedAt: new Date().toISOString() }],
    });

    const response = await fetch(`${baseUrl}/api/projects/project-1/members/admin@example.com`, {
      method: 'DELETE',
    });
    const body = await response.json() as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toBe('Cannot remove the last Admin');
  });

  it('blocks export for viewer and mapper roles when auth is enabled', async () => {
    const now = new Date().toISOString();
    process.env.JWT_SECRET = 'test-secret';
    const { baseUrl } = await bootServer({
      requireAuth: true,
      members: [
        { userId: 'viewer-user', email: 'viewer@example.com', role: 'viewer', addedAt: now },
        { userId: 'mapper-user', email: 'mapper@example.com', role: 'mapper', addedAt: now },
        { userId: 'approver-user', email: 'approver@example.com', role: 'approver', addedAt: now },
      ],
    });

    const viewerToken = generateToken({ userId: 'viewer-user', email: 'viewer@example.com', role: 'VIEWER' });
    const mapperToken = generateToken({ userId: 'mapper-user', email: 'mapper@example.com', role: 'EDITOR' });
    const approverToken = generateToken({ userId: 'approver-user', email: 'approver@example.com', role: 'OWNER' });

    const viewerResponse = await fetch(`${baseUrl}/api/projects/project-1/export?format=json`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerResponse.status).toBe(403);
    expect(await viewerResponse.json()).toEqual({ error: 'Insufficient role' });

    const mapperResponse = await fetch(`${baseUrl}/api/projects/project-1/export?format=json`, {
      headers: { Authorization: `Bearer ${mapperToken}` },
    });
    expect(mapperResponse.status).toBe(403);
    expect(await mapperResponse.json()).toEqual({ error: 'Insufficient role' });

    const approverResponse = await fetch(`${baseUrl}/api/projects/project-1/export?format=json`, {
      headers: { Authorization: `Bearer ${approverToken}` },
    });
    expect(approverResponse.status).toBe(200);
  });
});
