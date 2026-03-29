import { describe, expect, it } from 'vitest';

import { SchemaDiscoveryAgent } from '../agents/SchemaDiscoveryAgent.js';
import type { AgentStep } from '../agents/types.js';
import type { Entity, Field, MappingProject, StoredExportVersionRecord } from '../types.js';
import { buildFieldsSnapshot, buildSchemaFingerprint } from '../services/schemaFingerprint.js';

const project: MappingProject = {
  id: 'project-1',
  name: 'Drift project',
  sourceSystemId: 'src-system',
  targetSystemId: 'tgt-system',
  createdAt: '2026-03-27T00:00:00.000Z',
  updatedAt: '2026-03-27T00:00:00.000Z',
};

const sourceEntities: Entity[] = [{ id: 'src-entity', systemId: project.sourceSystemId, name: 'Loan' }];
const targetEntities: Entity[] = [{ id: 'tgt-entity', systemId: project.targetSystemId, name: 'FinancialAccount' }];

function makeFields(targetDataType = 'decimal'): Field[] {
  return [
    { id: 'src-field', entityId: 'src-entity', name: 'AMT_PAYMENT', dataType: 'decimal', required: true },
    { id: 'tgt-field', entityId: 'tgt-entity', name: 'Monthly_Payment__c', dataType: targetDataType as Field['dataType'], required: true },
  ];
}

function makeLatestVersion(fields: Field[]): StoredExportVersionRecord {
  return {
    id: 'version-1',
    projectId: project.id,
    version: 1,
    exportedAt: '2026-03-27T00:00:00.000Z',
    schemaFingerprint: buildSchemaFingerprint(project, [...sourceEntities, ...targetEntities], fields, '2026-03-27T00:00:00.000Z'),
    fieldsSnapshot: buildFieldsSnapshot(project, [...sourceEntities, ...targetEntities], fields),
  };
}

describe('SchemaDiscoveryAgent schema drift', () => {
  it('does not emit schema_drift_detected when the schema fingerprint matches the latest export', async () => {
    const agent = new SchemaDiscoveryAgent();
    const fields = makeFields();
    const steps: AgentStep[] = [];

    await agent.run({
      projectId: project.id,
      sourceSystemType: 'jackhenry',
      targetSystemType: 'salesforce',
      sourceEntities,
      targetEntities,
      fields,
      entityMappings: [],
      fieldMappings: [],
      latestExportVersion: makeLatestVersion(fields),
      onStep: (step) => steps.push(step),
    });

    expect(steps.find((step) => step.action === 'schema_drift_detected')).toBeUndefined();
    expect(steps.find((step) => step.action === 'schema_discovery_complete')).toBeDefined();
  });

  it('emits schema_drift_detected before the terminal discovery step when drift exists', async () => {
    const agent = new SchemaDiscoveryAgent();
    const previousFields = makeFields();
    const currentFields = makeFields('string');
    const steps: AgentStep[] = [];

    await agent.run({
      projectId: project.id,
      sourceSystemType: 'jackhenry',
      targetSystemType: 'salesforce',
      sourceEntities,
      targetEntities,
      fields: currentFields,
      entityMappings: [],
      fieldMappings: [],
      latestExportVersion: makeLatestVersion(previousFields),
      onStep: (step) => steps.push(step),
    });

    const driftIndex = steps.findIndex((step) => step.action === 'schema_drift_detected');
    const terminalIndex = steps.findIndex((step) => step.action === 'schema_discovery_complete');

    expect(driftIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThan(driftIndex);
    expect(steps[driftIndex]?.metadata).toMatchObject({
      sourceChanged: false,
      targetChanged: true,
      blockers: [
        expect.objectContaining({
          fieldId: 'tgt-field',
          changeType: 'type_changed',
          previousType: 'decimal',
          currentType: 'string',
        }),
      ],
    });
  });
});
