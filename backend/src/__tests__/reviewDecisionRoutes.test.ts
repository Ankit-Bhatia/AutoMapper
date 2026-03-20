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
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 2_000);
  });
}

describe('POST /api/review-decisions', () => {
  let child: ChildProcess | null = null;
  let tempDataDir: string | null = null;
  let reviewFile: string | null = null;

  afterEach(async () => {
    await stopProcess(child);
    child = null;
    if (tempDataDir) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
      reviewFile = null;
    }
  });

  it('appends accepted and rejected review decisions to jsonl in FsStore mode', async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-review-route-'));
    reviewFile = path.join(tempDataDir, 'review-decisions.jsonl');
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
        REVIEW_DECISIONS_FILE: reviewFile,
        JWT_SECRET: process.env.JWT_SECRET || 'test-secret',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForServer(baseUrl);

    const response = await fetch(`${baseUrl}/api/review-decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceFieldId: 'AMT_PAYMENT',
        targetFieldId: 'FinServ__PaymentAmount__c',
        action: 'accepted',
        confidence: 0.87,
      }),
    });

    expect(response.status).toBe(204);
    const lines = fs.readFileSync(reviewFile, 'utf8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      sourceFieldId: 'AMT_PAYMENT',
      targetFieldId: 'FinServ__PaymentAmount__c',
      action: 'accepted',
      confidence: 0.87,
    });
  });
});
