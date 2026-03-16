import type { Entity, Field, FieldMapping } from '../types.js';
import { isActiveFieldMapping } from '../utils/mappingStatus.js';

export interface ProjectConflict {
  id: string;
  targetFieldId: string;
  targetFieldName: string;
  targetEntityName: string;
  competingMappingIds: string[];
  resolvedWinnerId: string | null;
  detectedAt: string;
  resolvedAt: string | null;
}

export function countUnresolvedConflicts(
  mappings: Array<Pick<FieldMapping, 'targetFieldId' | 'status'>>,
): number {
  const grouped = new Map<string, number>();
  for (const mapping of mappings) {
    if (!isActiveFieldMapping(mapping)) continue;
    grouped.set(mapping.targetFieldId, (grouped.get(mapping.targetFieldId) ?? 0) + 1);
  }
  return [...grouped.values()].filter((count) => count > 1).length;
}

export function targetFieldIdFromConflictId(conflictId: string): string | null {
  if (!conflictId.startsWith('conflict-')) return null;
  const targetFieldId = conflictId.slice('conflict-'.length).trim();
  return targetFieldId.length ? targetFieldId : null;
}

export function buildMappingConflicts(
  mappings: FieldMapping[],
  fields: Field[],
  entities: Entity[],
  detectedAt = new Date().toISOString(),
): ProjectConflict[] {
  const activeMappings = mappings.filter((mapping) => isActiveFieldMapping(mapping));
  const grouped = new Map<string, FieldMapping[]>();

  for (const mapping of activeMappings) {
    const group = grouped.get(mapping.targetFieldId) ?? [];
    group.push(mapping);
    grouped.set(mapping.targetFieldId, group);
  }

  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

  const conflicts: ProjectConflict[] = [];
  for (const [targetFieldId, group] of grouped) {
    if (group.length < 2) continue;

    const targetField = fieldById.get(targetFieldId);
    const targetEntity = targetField ? entityById.get(targetField.entityId) : null;
    conflicts.push({
      id: `conflict-${targetFieldId}`,
      targetFieldId,
      targetFieldName: targetField?.name ?? targetFieldId,
      targetEntityName: targetEntity?.name ?? 'Unknown Entity',
      competingMappingIds: group.map((mapping) => mapping.id),
      resolvedWinnerId: null,
      detectedAt,
      resolvedAt: null,
    });
  }

  conflicts.sort((left, right) => {
    const entityCmp = left.targetEntityName.localeCompare(right.targetEntityName);
    if (entityCmp !== 0) return entityCmp;
    return left.targetFieldName.localeCompare(right.targetFieldName);
  });

  return conflicts;
}
