import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsStore } from '../utils/fsStore.js';
import { AppError } from '../utils/httpErrors.js';

describe('FsStore project members', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function createStore() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-members-'));
    return new FsStore(tempDir);
  }

  it('throws 409 when adding a duplicate member email', async () => {
    const store = createStore();
    const project = store.createProject('Members Project', 'user-1', 'RiskClam', 'Salesforce', 'admin@example.com');

    await expect(store.addProjectMember(project.id, {
      userId: 'user-2',
      email: 'admin@example.com',
      role: 'viewer',
      addedAt: new Date().toISOString(),
    })).rejects.toMatchObject<AppError>({
      status: 409,
      message: 'A member with that email already exists',
    });
  });

  it('throws 400 when removing the last admin', async () => {
    const store = createStore();
    const project = store.createProject('Members Project', 'user-1', 'RiskClam', 'Salesforce', 'admin@example.com');
    const [admin] = store.listProjectMembers(project.id);

    await expect(store.removeProjectMember(project.id, admin.userId)).rejects.toMatchObject<AppError>({
      status: 400,
      message: 'Cannot remove the last Admin',
    });
  });
});
