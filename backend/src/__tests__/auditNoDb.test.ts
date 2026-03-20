import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureAuditFallbackStore, writeAuditEntry } from '../db/audit.js';
import { FsStore } from '../utils/fsStore.js';

const originalDatabaseUrl = process.env.DATABASE_URL;

function resetDatabaseUrl() {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}

describe('audit entries without a database', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    configureAuditFallbackStore(null);
    resetDatabaseUrl();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('writes to the file-backed fallback store when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'automapper-audit-'));
    const store = new FsStore(tempDir);
    configureAuditFallbackStore(store);

    await writeAuditEntry({
      projectId: 'project-1',
      actor: {
        userId: 'user-1',
        email: 'user@example.com',
        role: 'OWNER',
      },
      action: 'mapping_accepted',
      targetType: 'field_mapping',
      targetId: 'mapping-1',
      before: { status: 'suggested' },
      after: { status: 'accepted' },
    });

    const entries = store.getState().auditEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      projectId: 'project-1',
      action: 'mapping_accepted',
      targetId: 'mapping-1',
      actor: {
        email: 'user@example.com',
        role: 'OWNER',
      },
      diff: {
        before: { status: 'suggested' },
        after: { status: 'accepted' },
      },
    });
  });
});
