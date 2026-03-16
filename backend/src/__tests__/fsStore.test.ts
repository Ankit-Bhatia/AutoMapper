import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsStore } from '../utils/fsStore.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('FsStore system inference', () => {
  it('classifies RiskClam projects as riskclam in file-store mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-fsstore-'));
    tempDirs.push(dir);

    const store = new FsStore(dir);
    const project = store.createProject('RiskClam Project', undefined, 'RiskClam', 'Salesforce');
    const state = store.getState();
    const sourceSystem = state.systems.find((system) => system.id === project.sourceSystemId);
    const targetSystem = state.systems.find((system) => system.id === project.targetSystemId);

    expect(sourceSystem?.name).toBe('RiskClam');
    expect(sourceSystem?.type).toBe('riskclam');
    expect(targetSystem?.type).toBe('salesforce');
  });
});
