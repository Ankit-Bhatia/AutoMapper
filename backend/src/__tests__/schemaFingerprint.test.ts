import { describe, expect, it } from 'vitest';

import type { Entity, Field, MappingProject, StoredExportVersionRecord } from '../types.js';
import {
  buildFieldsSnapshot,
  buildSchemaFingerprint,
  computeSchemaFingerprint,
  detectSchemaDrift,
} from '../services/schemaFingerprint.js';

const project: MappingProject = {
  id: 'project-1',
  name: 'Schema Drift Test',
  sourceSystemId: 'src-system',
  targetSystemId: 'tgt-system',
  createdAt: '2026-03-27T00:00:00.000Z',
  updatedAt: '2026-03-27T00:00:00.000Z',
};

const entities: Entity[] = [
  { id: 'src-entity', systemId: 'src-system', name: 'Loan' },
  { id: 'tgt-entity', systemId: 'tgt-system', name: 'FinancialAccount' },
];

function makeFields(overrides?: {
  source?: Field[];
  target?: Field[];
}): Field[] {
  return [
    ...(overrides?.source ?? [
      { id: 'src-required', entityId: 'src-entity', name: 'ACCOUNT_ID', dataType: 'id', required: true },
      { id: 'src-optional', entityId: 'src-entity', name: 'STATUS_CODE', dataType: 'string', required: false },
    ]),
    ...(overrides?.target ?? [
      { id: 'tgt-required', entityId: 'tgt-entity', name: 'ExternalId__c', dataType: 'id', required: true },
      { id: 'tgt-optional', entityId: 'tgt-entity', name: 'Status__c', dataType: 'string', required: false },
    ]),
  ];
}

describe('schema fingerprint', () => {
  it('is stable for the same scoped fields regardless of input order', () => {
    const entityIds = new Set(['src-entity', 'tgt-entity']);
    const fields = makeFields();
    const reversed = [...fields].reverse();

    expect(computeSchemaFingerprint(fields, entityIds)).toBe(computeSchemaFingerprint(reversed, entityIds));
  });

  it('changes when field metadata changes', () => {
    const entityIds = new Set(['src-entity', 'tgt-entity']);
    const original = makeFields();
    const changed = makeFields({
      target: [
        { id: 'tgt-required', entityId: 'tgt-entity', name: 'ExternalId__c', dataType: 'string', required: true },
        { id: 'tgt-optional', entityId: 'tgt-entity', name: 'Status__c', dataType: 'string', required: false },
      ],
    });

    expect(computeSchemaFingerprint(original, entityIds)).not.toBe(computeSchemaFingerprint(changed, entityIds));
  });
});

describe('schema drift classification', () => {
  it('classifies blockers, warnings, and additions across source and target snapshots', () => {
    const previousFields = makeFields();
    const latestVersion: StoredExportVersionRecord = {
      id: 'version-1',
      projectId: project.id,
      version: 1,
      exportedAt: '2026-03-27T00:00:00.000Z',
      schemaFingerprint: buildSchemaFingerprint(project, entities, previousFields, '2026-03-27T00:00:00.000Z'),
      fieldsSnapshot: buildFieldsSnapshot(project, entities, previousFields),
    };

    const currentFields = makeFields({
      source: [
        { id: 'src-required', entityId: 'src-entity', name: 'ACCOUNT_ID', dataType: 'number', required: true },
        { id: 'src-added', entityId: 'src-entity', name: 'NEW_SOURCE_FIELD', dataType: 'string', required: false },
      ],
      target: [],
    });

    const drift = detectSchemaDrift(
      latestVersion,
      buildSchemaFingerprint(project, entities, currentFields, '2026-03-27T01:00:00.000Z'),
      buildFieldsSnapshot(project, entities, currentFields),
      entities,
    );

    expect(drift).not.toBeNull();
    expect(drift?.sourceChanged).toBe(true);
    expect(drift?.targetChanged).toBe(true);
    expect(drift?.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: 'src-required',
          changeType: 'type_changed',
          previousType: 'id',
          currentType: 'number',
          required: true,
        }),
        expect.objectContaining({
          fieldId: 'tgt-required',
          changeType: 'removed',
          previousType: 'id',
          required: true,
        }),
      ]),
    );
    expect(drift?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: 'src-optional',
          changeType: 'removed',
          previousType: 'string',
          required: false,
        }),
        expect.objectContaining({
          fieldId: 'tgt-optional',
          changeType: 'removed',
          previousType: 'string',
          required: false,
        }),
      ]),
    );
    expect(drift?.additions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: 'src-added',
          changeType: 'added',
          currentType: 'string',
        }),
      ]),
    );
  });
});
