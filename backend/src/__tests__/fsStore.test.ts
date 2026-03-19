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

  it('persists resolved one-to-many routing decisions in file-store mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-fsstore-'));
    tempDirs.push(dir);

    const store = new FsStore(dir);
    const project = store.createProject('Routing Project', undefined, 'RiskClam', 'Salesforce');

    store.updateProjectResolvedOneToManyMappings(project.id, {
      'source-field-1': {
        sourceFieldId: 'source-field-1',
        sourceFieldName: 'AMT_PAYMENT',
        targetFieldId: 'target-field-1',
        targetFieldName: 'Monthly_Payment__c',
        targetObject: 'Loan',
        resolvedAt: new Date().toISOString(),
      },
    });

    const reloaded = new FsStore(dir);
    const reloadedProject = reloaded.getProject(project.id);

    expect(reloadedProject?.resolvedOneToManyMappings?.['source-field-1']?.targetFieldName).toBe('Monthly_Payment__c');
    expect(reloadedProject?.resolvedOneToManyMappings?.['source-field-1']?.targetObject).toBe('Loan');
  });
});
