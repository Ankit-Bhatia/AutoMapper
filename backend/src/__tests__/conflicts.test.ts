import { describe, expect, it } from 'vitest';
import type { Entity, Field, FieldMapping } from '../types.js';
import {
  buildMappingConflicts,
  countUnresolvedConflicts,
  targetFieldIdFromConflictId,
} from '../services/conflicts.js';

const entities: Entity[] = [
  { id: 'entity-source', systemId: 'system-a', name: 'SourceEntity' },
  { id: 'entity-target', systemId: 'system-b', name: 'TargetEntity' },
];

const fields: Field[] = [
  { id: 'field-source-a', entityId: 'entity-source', name: 'SourceA', dataType: 'string' },
  { id: 'field-source-b', entityId: 'entity-source', name: 'SourceB', dataType: 'string' },
  { id: 'field-target-a', entityId: 'entity-target', name: 'TargetA', dataType: 'string' },
  { id: 'field-target-b', entityId: 'entity-target', name: 'TargetB', dataType: 'string' },
];

const mappings: FieldMapping[] = [
  {
    id: 'map-a',
    entityMappingId: 'em-1',
    sourceFieldId: 'field-source-a',
    targetFieldId: 'field-target-a',
    transform: { type: 'direct', config: {} },
    confidence: 0.9,
    rationale: 'A',
    status: 'accepted',
  },
  {
    id: 'map-b',
    entityMappingId: 'em-1',
    sourceFieldId: 'field-source-b',
    targetFieldId: 'field-target-a',
    transform: { type: 'direct', config: {} },
    confidence: 0.6,
    rationale: 'B',
    status: 'suggested',
  },
  {
    id: 'map-c',
    entityMappingId: 'em-1',
    sourceFieldId: 'field-source-b',
    targetFieldId: 'field-target-b',
    transform: { type: 'direct', config: {} },
    confidence: 0.4,
    rationale: 'C',
    status: 'rejected',
  },
];

describe('conflict helpers', () => {
  it('counts unresolved conflicts from active (non-rejected) mappings only', () => {
    const result = countUnresolvedConflicts(mappings);
    expect(result).toBe(1);
  });

  it('builds conflict descriptors with target metadata', () => {
    const conflicts = buildMappingConflicts(mappings, fields, entities, '2026-03-02T00:00:00.000Z');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: 'conflict-field-target-a',
      targetFieldId: 'field-target-a',
      targetFieldName: 'TargetA',
      targetEntityName: 'TargetEntity',
      competingMappingIds: ['map-a', 'map-b'],
    });
  });

  it('parses conflict id format safely', () => {
    expect(targetFieldIdFromConflictId('conflict-field-target-a')).toBe('field-target-a');
    expect(targetFieldIdFromConflictId('invalid')).toBeNull();
  });
});
