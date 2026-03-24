import { describe, expect, it } from 'vitest';

import type { Entity, Relationship } from '../types.js';
import { buildRelationshipGraph } from '../services/relationshipGraph.js';

function entity(id: string, name: string, label?: string): Entity {
  return { id, systemId: 'sys-1', name, label };
}

function rel(fromEntityId: string, toEntityId: string, viaField?: string): Relationship {
  return { fromEntityId, toEntityId, type: 'lookup', viaField };
}

describe('RelationshipGraph', () => {
  it('resolves entity ids by id, api name, or label', () => {
    const graph = buildRelationshipGraph([
      entity('financial-account-id', 'FinancialAccount', 'Financial Account'),
      entity('account-id', 'Account'),
    ], []);

    expect(graph.resolveEntityId('financial-account-id')).toBe('financial-account-id');
    expect(graph.resolveEntityId('FinancialAccount')).toBe('financial-account-id');
    expect(graph.resolveEntityId('Financial Account')).toBe('financial-account-id');
    expect(graph.resolveEntityId('MissingObject')).toBeNull();
  });

  it('computes topological order and scope membership from relationships', () => {
    const entities = [
      entity('financial-account-id', 'FinancialAccount'),
      entity('account-id', 'Account'),
      entity('contact-id', 'Contact'),
    ];
    const relationships = [
      rel('financial-account-id', 'account-id', 'AccountId'),
      rel('account-id', 'contact-id', 'PrimaryContactId'),
    ];
    const graph = buildRelationshipGraph(entities, relationships);

    expect(graph.topologicalOrder(['financial-account-id', 'account-id', 'contact-id'])).toEqual([
      'financial-account-id',
      'account-id',
      'contact-id',
    ]);
    expect(graph.isInScope('Account', ['financial-account-id', 'account-id'])).toBe(true);
    expect(graph.isInScope('Contact', ['financial-account-id', 'account-id'])).toBe(false);
  });
});
