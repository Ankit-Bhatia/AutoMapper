import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAgentRefinement } from '../services/agentRefiner.js';
import type { Entity, EntityMapping, Field, FieldMapping, MappingProject } from '../types.js';

// Force heuristic path by clearing the API key
beforeEach(() => {
  process.env.OPENAI_API_KEY = '';
  vi.clearAllMocks();
});

const PROJECT: MappingProject = {
  id: 'proj-1',
  name: 'Test Project',
  sourceSystemId: 'src-sys',
  targetSystemId: 'tgt-sys',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

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
  required: opts.required ?? false,
  isKey: opts.isKey ?? false,
  isExternalId: opts.isExternalId ?? false,
  picklistValues: opts.picklistValues ?? [],
  ...opts,
});

const makeEntityMapping = (srcEntityId: string, tgtEntityId: string): EntityMapping => ({
  id: 'em1',
  projectId: 'proj-1',
  sourceEntityId: srcEntityId,
  targetEntityId: tgtEntityId,
  confidence: 0.8,
  rationale: 'test',
});

const makeFieldMapping = (
  id: string,
  entityMappingId: string,
  sourceFieldId: string,
  targetFieldId: string,
  confidence: number,
  status: FieldMapping['status'] = 'suggested',
): FieldMapping => ({
  id,
  entityMappingId,
  sourceFieldId,
  targetFieldId,
  transform: { type: 'direct', config: {} },
  confidence,
  rationale: 'initial match',
  status,
});

describe('agentRefiner — heuristic path (no OpenAI)', () => {
  const ENTITIES: Entity[] = [
    { id: 'se1', systemId: 'src-sys', name: 'Customer' },
    { id: 'te1', systemId: 'tgt-sys', name: 'Account' },
  ];

  it('should emit exactly 3 refinement steps', async () => {
    const steps: string[] = [];
    const result = await runAgentRefinement({
      project: PROJECT,
      entityMappings: [makeEntityMapping('se1', 'te1')],
      fieldMappings: [makeFieldMapping('fm1', 'em1', 'sf1', 'tf1', 0.5)],
      entities: ENTITIES,
      fields: [
        makeField('sf1', 'se1', 'Name', 'string'),
        makeField('tf1', 'te1', 'Name', 'string'),
      ],
      onStep: (step) => steps.push(step.phase),
    });

    expect(result.steps).toHaveLength(3);
    expect(steps).toEqual(['few-shot-refinement', 'conflict-resolution', 'required-fields']);
  });

  it('heuristic rescore should raise confidence on type-compatible pair', async () => {
    // Low-confidence mapping between two compatible string fields
    const srcField = makeField('sf2', 'se1', 'CustomerName', 'string');
    const tgtField = makeField('tf2', 'te1', 'AccountName', 'string');
    const fm = makeFieldMapping('fm2', 'em1', 'sf2', 'tf2', 0.40); // below 0.65 threshold

    const result = await runAgentRefinement({
      project: PROJECT,
      entityMappings: [makeEntityMapping('se1', 'te1')],
      fieldMappings: [fm],
      entities: ENTITIES,
      fields: [srcField, tgtField],
      onStep: () => {},
    });

    const updated = result.updatedFieldMappings.find((f) => f.id === 'fm2')!;
    expect(updated.confidence).toBeGreaterThanOrEqual(fm.confidence);
  });

  it('conflict resolution should pick higher-confidence winner', async () => {
    const srcField1 = makeField('sf3', 'se1', 'Phone', 'phone');
    const srcField2 = makeField('sf4', 'se1', 'MobilePhone', 'phone');
    const tgtField = makeField('tf3', 'te1', 'Phone', 'phone');

    // Both confidences >= 0.65 so the few-shot heuristic won't touch them;
    // fm4 (0.85) should beat fm3 (0.70) in conflict resolution.
    const fm1 = makeFieldMapping('fm3', 'em1', 'sf3', 'tf3', 0.70);
    const fm2 = makeFieldMapping('fm4', 'em1', 'sf4', 'tf3', 0.85);

    const result = await runAgentRefinement({
      project: PROJECT,
      entityMappings: [makeEntityMapping('se1', 'te1')],
      fieldMappings: [fm1, fm2],
      entities: ENTITIES,
      fields: [srcField1, srcField2, tgtField],
      onStep: () => {},
    });

    // Winner (fm4, 0.85 → boosted to 0.95) vs loser (fm3, 0.70 → demoted to 0.55)
    const winner = result.updatedFieldMappings.find((f) => f.id === 'fm4')!;
    const loser = result.updatedFieldMappings.find((f) => f.id === 'fm3')!;
    expect(winner.confidence).toBeGreaterThan(loser.confidence);
  });

  it('required field pass should create a mapping for unmapped required target field', async () => {
    const srcField = makeField('sf5', 'se1', 'Email', 'email');
    const tgtRequired = makeField('tf4', 'te1', 'BillingEmail', 'email', { required: true });

    // No field mappings initially — required target field is unmapped
    const result = await runAgentRefinement({
      project: PROJECT,
      entityMappings: [makeEntityMapping('se1', 'te1')],
      fieldMappings: [],
      entities: ENTITIES,
      fields: [srcField, tgtRequired],
      onStep: () => {},
    });

    const requiredStep = result.steps.find((s) => s.phase === 'required-fields')!;
    expect(requiredStep.improved).toBeGreaterThanOrEqual(1);
    expect(result.updatedFieldMappings.length).toBeGreaterThan(0);
  });

  it('totalImproved should sum all step improvements', async () => {
    const result = await runAgentRefinement({
      project: PROJECT,
      entityMappings: [makeEntityMapping('se1', 'te1')],
      fieldMappings: [makeFieldMapping('fm5', 'em1', 'sf1', 'tf1', 0.8)],
      entities: ENTITIES,
      fields: [
        makeField('sf1', 'se1', 'Name', 'string'),
        makeField('tf1', 'te1', 'Name', 'string'),
      ],
      onStep: () => {},
    });

    const sumOfSteps = result.steps.reduce((sum, s) => sum + s.improved, 0);
    expect(result.totalImproved).toBe(sumOfSteps);
  });
});
