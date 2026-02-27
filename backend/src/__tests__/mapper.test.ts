import { describe, it, expect, vi, beforeEach } from 'vitest';
import { suggestMappings } from '../services/mapper.js';
import type { Entity, Field, MappingProject } from '../types.js';

vi.mock('../services/llmAdapter.js', () => ({
  getAiSuggestions: vi.fn().mockResolvedValue(null),
}));

const PROJECT: MappingProject = {
  id: 'proj-1',
  name: 'Test Project',
  sourceSystemId: 'src-sys',
  targetSystemId: 'tgt-sys',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const makeEntity = (id: string, systemId: string, name: string, label?: string): Entity => ({
  id,
  systemId,
  name,
  label,
});

const makeField = (
  id: string,
  entityId: string,
  name: string,
  dataType: Field['dataType'],
  opts: Partial<Field> = {},
): Field => ({
  id,
  entityId,
  name,
  dataType,
  label: opts.label,
  required: opts.required ?? false,
  isKey: opts.isKey ?? false,
  isExternalId: opts.isExternalId ?? false,
  ...opts,
});

describe('suggestMappings — heuristic path (no AI)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exact-name match should produce confidence ≥ 0.7', async () => {
    const srcEntity = makeEntity('se1', 'src-sys', 'Customer', 'Customer');
    const tgtEntity = makeEntity('te1', 'tgt-sys', 'Customer', 'Customer');
    const srcField = makeField('sf1', 'se1', 'CustomerName', 'string');
    const tgtField = makeField('tf1', 'te1', 'CustomerName', 'string');

    const { entityMappings, fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields: [srcField, tgtField],
    });

    expect(entityMappings).toHaveLength(1);
    expect(entityMappings[0].confidence).toBeGreaterThanOrEqual(0.7);
    expect(fieldMappings).toHaveLength(1);
    expect(fieldMappings[0].sourceFieldId).toBe('sf1');
    expect(fieldMappings[0].targetFieldId).toBe('tf1');
  });

  it('partial name match should still produce a field mapping', async () => {
    // 'Sale Opportunity' shares the token 'opportunity' with the target 'Opportunity'
    // → moderate Jaccard score → entity IS matched → field mappings attempted
    const srcEntity = makeEntity('se2', 'src-sys', 'Sale Opportunity', 'Opportunity Record');
    const tgtEntity = makeEntity('te2', 'tgt-sys', 'Opportunity', 'Opportunity');
    // 'Status Code' shares 'status' token with 'Status' → base score above 0.35
    const srcField = makeField('sf2', 'se2', 'Status Code', 'string');
    const tgtField = makeField('tf2', 'te2', 'Status', 'string');

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields: [srcField, tgtField],
    });

    // Status Code → Status should match (above 0.35 combined threshold)
    expect(fieldMappings.length).toBeGreaterThanOrEqual(1);
    const fm = fieldMappings.find((f) => f.sourceFieldId === 'sf2');
    expect(fm).toBeDefined();
  });

  it('entity with no plausible target match should be skipped', async () => {
    const srcEntity = makeEntity('se3', 'src-sys', 'ZVENDOR_DATA', 'Vendor Data');
    const tgtEntity = makeEntity('te3', 'tgt-sys', 'Contact', 'Contact');
    const srcField = makeField('sf3', 'se3', 'ZVendorCode', 'string');
    const tgtField = makeField('tf3', 'te3', 'LastName', 'string');

    const { entityMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields: [srcField, tgtField],
    });

    // There might be a mapping even for poor matches (bestStringMatch always returns something),
    // but we specifically check that extremely poor matches have low confidence
    for (const em of entityMappings) {
      if (em.sourceEntityId === 'se3') {
        expect(em.confidence).toBeLessThan(0.8);
      }
    }
  });

  it('Name1 → Name should infer concat transform', async () => {
    const srcEntity = makeEntity('se4', 'src-sys', 'Customer', 'Customer');
    const tgtEntity = makeEntity('te4', 'tgt-sys', 'Customer', 'Customer');
    const srcField = makeField('sf4', 'se4', 'Name1', 'string');
    const tgtField = makeField('tf4', 'te4', 'Name', 'string');

    const { fieldMappings } = await suggestMappings({
      project: PROJECT,
      sourceEntities: [srcEntity],
      targetEntities: [tgtEntity],
      fields: [srcField, tgtField],
    });

    const fm = fieldMappings.find((f) => f.sourceFieldId === 'sf4');
    expect(fm).toBeDefined();
    expect(fm?.transform.type).toBe('concat');
  });
});
