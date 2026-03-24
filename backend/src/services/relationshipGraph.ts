import type { Entity, Relationship } from '../types.js';

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export class RelationshipGraph {
  private readonly entityIdsByKey = new Map<string, string>();
  private readonly entityIds = new Set<string>();
  private readonly adjacency = new Map<string, Set<string>>();

  constructor(
    entities: Entity[],
    private readonly relationships: Relationship[],
  ) {
    for (const entity of entities) {
      this.entityIds.add(entity.id);
      this.entityIdsByKey.set(normalizeKey(entity.id), entity.id);
      this.entityIdsByKey.set(normalizeKey(entity.name), entity.id);
      if (entity.label) {
        this.entityIdsByKey.set(normalizeKey(entity.label), entity.id);
      }
      this.adjacency.set(entity.id, new Set());
    }

    for (const relationship of relationships) {
      if (!this.entityIds.has(relationship.fromEntityId) || !this.entityIds.has(relationship.toEntityId)) {
        continue;
      }
      this.adjacency.get(relationship.fromEntityId)?.add(relationship.toEntityId);
    }
  }

  resolveEntityId(reference: string): string | null {
    return this.entityIdsByKey.get(normalizeKey(reference)) ?? null;
  }

  isInScope(referenceTo: string, scopedEntityIds: string[]): boolean {
    const resolved = this.resolveEntityId(referenceTo);
    if (!resolved) return false;
    return new Set(scopedEntityIds).has(resolved);
  }

  topologicalOrder(scopedEntityIds?: string[]): string[] {
    const scoped = new Set(
      (scopedEntityIds?.length ? scopedEntityIds : Array.from(this.entityIds))
        .filter((entityId) => this.entityIds.has(entityId)),
    );
    const indegree = new Map<string, number>();
    for (const entityId of scoped) {
      indegree.set(entityId, 0);
    }

    for (const relationship of this.relationships) {
      if (!scoped.has(relationship.fromEntityId) || !scoped.has(relationship.toEntityId)) continue;
      indegree.set(
        relationship.toEntityId,
        (indegree.get(relationship.toEntityId) ?? 0) + 1,
      );
    }

    const queue = Array.from(scoped).filter((entityId) => (indegree.get(entityId) ?? 0) === 0).sort();
    const ordered: string[] = [];

    while (queue.length) {
      const current = queue.shift()!;
      ordered.push(current);

      const outgoing = this.adjacency.get(current);
      if (!outgoing) continue;

      for (const next of Array.from(outgoing).sort()) {
        if (!scoped.has(next)) continue;
        const nextIndegree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, nextIndegree);
        if (nextIndegree === 0) {
          queue.push(next);
          queue.sort();
        }
      }
    }

    if (ordered.length < scoped.size) {
      for (const entityId of Array.from(scoped).sort()) {
        if (!ordered.includes(entityId)) {
          ordered.push(entityId);
        }
      }
    }

    return ordered;
  }
}

export function buildRelationshipGraph(
  entities: Entity[],
  relationships: Relationship[],
): RelationshipGraph {
  return new RelationshipGraph(entities, relationships);
}
