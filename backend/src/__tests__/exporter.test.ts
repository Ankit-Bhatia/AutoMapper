import { describe, expect, it } from 'vitest';

import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  MappingProject,
  Relationship,
  System,
  ValidationReport,
} from '../types.js';
import { buildJsonExport, buildWorkatoExport, type BuildInput } from '../services/exporter.js';

function makeBuildInput(): BuildInput {
  const project: MappingProject = {
    id: 'project-1',
    name: 'KAN-90 Export Order',
    sourceSystemId: 'source-system',
    targetSystemId: 'target-system',
    createdAt: '2026-03-25T00:00:00.000Z',
    updatedAt: '2026-03-25T00:00:00.000Z',
  };

  const systems: System[] = [
    { id: 'source-system', name: 'RiskClam', type: 'riskclam' },
    { id: 'target-system', name: 'Salesforce', type: 'salesforce' },
  ];

  const entities: Entity[] = [
    { id: 'src-loan', systemId: 'source-system', name: 'Loan' },
    { id: 'target-contact', systemId: 'target-system', name: 'Contact' },
    { id: 'target-account', systemId: 'target-system', name: 'Account' },
    { id: 'target-financial-account', systemId: 'target-system', name: 'FinancialAccount' },
  ];

  const fields: Field[] = [
    { id: 'src-name', entityId: 'src-loan', name: 'NAME_FIRST', dataType: 'string' },
    { id: 'src-account', entityId: 'src-loan', name: 'ACCOUNT_ID', dataType: 'id' },
    { id: 'src-balance', entityId: 'src-loan', name: 'AMT_TOTAL_CURRENT_BALANCE', dataType: 'decimal' },
    { id: 'tgt-contact-name', entityId: 'target-contact', name: 'FirstName', dataType: 'string' },
    { id: 'tgt-account-id', entityId: 'target-account', name: 'ExternalId__c', dataType: 'id' },
    { id: 'tgt-balance', entityId: 'target-financial-account', name: 'CurrentBalance', dataType: 'decimal' },
  ];

  const relationships: Relationship[] = [
    { fromEntityId: 'target-financial-account', toEntityId: 'target-account', type: 'lookup', viaField: 'AccountId' },
    { fromEntityId: 'target-account', toEntityId: 'target-contact', type: 'lookup', viaField: 'PrimaryContactId' },
  ];

  const entityMappings: EntityMapping[] = [
    {
      id: 'em-contact',
      projectId: project.id,
      sourceEntityId: 'src-loan',
      targetEntityId: 'target-contact',
      confidence: 0.76,
      rationale: 'Contact fields',
    },
    {
      id: 'em-financial-account',
      projectId: project.id,
      sourceEntityId: 'src-loan',
      targetEntityId: 'target-financial-account',
      confidence: 0.92,
      rationale: 'Financial account fields',
    },
    {
      id: 'em-account',
      projectId: project.id,
      sourceEntityId: 'src-loan',
      targetEntityId: 'target-account',
      confidence: 0.81,
      rationale: 'Account fields',
    },
  ];

  const fieldMappings: FieldMapping[] = [
    {
      id: 'fm-contact',
      entityMappingId: 'em-contact',
      sourceFieldId: 'src-name',
      targetFieldId: 'tgt-contact-name',
      transform: { type: 'direct', config: {} },
      confidence: 0.82,
      rationale: 'Name mapping',
      status: 'suggested',
    },
    {
      id: 'fm-account',
      entityMappingId: 'em-account',
      sourceFieldId: 'src-account',
      targetFieldId: 'tgt-account-id',
      transform: { type: 'direct', config: {} },
      confidence: 0.84,
      rationale: 'Account id mapping',
      status: 'suggested',
    },
    {
      id: 'fm-balance',
      entityMappingId: 'em-financial-account',
      sourceFieldId: 'src-balance',
      targetFieldId: 'tgt-balance',
      transform: { type: 'direct', config: {} },
      confidence: 0.9,
      rationale: 'Balance mapping',
      status: 'accepted',
    },
  ];

  const validation: ValidationReport = {
    warnings: [],
    summary: {
      totalWarnings: 0,
      typeMismatch: 0,
      missingRequired: 0,
      picklistCoverage: 0,
      validationRule: 0,
      partialCoverageRisk: 0,
      validationRulesUnavailable: 0,
    },
  };

  return {
    project,
    systems,
    entities,
    fields,
    relationships,
    entityMappings,
    fieldMappings,
    validation,
  };
}

describe('exporter load order', () => {
  it('adds relationship-graph topological order to canonical JSON metadata', () => {
    const exportSpec = buildJsonExport(makeBuildInput()) as {
      automapper: {
        metadata: {
          loadOrder: string[];
          schemaFingerprint: {
            sourceHash: string;
            targetHash: string;
            fieldCount: { source: number; target: number };
            computedAt: string;
          };
        };
      };
    };

    expect(exportSpec.automapper.metadata.loadOrder).toEqual([
      'target-financial-account',
      'target-account',
      'target-contact',
    ]);
    expect(exportSpec.automapper.metadata.schemaFingerprint).toMatchObject({
      fieldCount: { source: 3, target: 3 },
    });
    expect(exportSpec.automapper.metadata.schemaFingerprint.sourceHash).toHaveLength(64);
    expect(exportSpec.automapper.metadata.schemaFingerprint.targetHash).toHaveLength(64);
    expect(Date.parse(exportSpec.automapper.metadata.schemaFingerprint.computedAt)).not.toBeNaN();
  });

  it('adds relationship-graph topological order to workato metadata', () => {
    const exportSpec = buildWorkatoExport(makeBuildInput()) as {
      metadata: {
        loadOrder: string[];
      };
    };

    expect(exportSpec.metadata.loadOrder).toEqual([
      'target-financial-account',
      'target-account',
      'target-contact',
    ]);
  });
});

describe('exporter validationRuleSafety', () => {
  it('includes validationRuleSafety in the canonical JSON export', () => {
    const project: MappingProject = {
      id: 'project-1',
      name: 'KAN-91 Export',
      sourceSystemId: 'src-system',
      targetSystemId: 'tgt-system',
      createdAt: '2026-03-25T00:00:00.000Z',
      updatedAt: '2026-03-25T00:00:00.000Z',
    };
    const systems: System[] = [
      { id: 'src-system', name: 'RiskClam', type: 'riskclam' },
      { id: 'tgt-system', name: 'Salesforce', type: 'salesforce' },
    ];
    const entities: Entity[] = [
      { id: 'src-entity', systemId: 'src-system', name: 'Loan' },
      { id: 'tgt-entity', systemId: 'tgt-system', name: 'Opportunity' },
    ];
    const fields: Field[] = [
      { id: 'src-field', entityId: 'src-entity', name: 'AMT_PAYMENT', dataType: 'decimal' },
      { id: 'tgt-field', entityId: 'tgt-entity', name: 'Amount', dataType: 'decimal' },
    ];
    const entityMappings: EntityMapping[] = [
      {
        id: 'em-1',
        projectId: project.id,
        sourceEntityId: 'src-entity',
        targetEntityId: 'tgt-entity',
        confidence: 0.82,
        rationale: 'test',
      },
    ];
    const fieldMappings: FieldMapping[] = [
      {
        id: 'fm-1',
        entityMappingId: 'em-1',
        sourceFieldId: 'src-field',
        targetFieldId: 'tgt-field',
        transform: { type: 'direct', config: {} },
        confidence: 0.82,
        rationale: 'test',
        status: 'accepted',
      },
    ];
    const validation: ValidationReport = {
      warnings: [],
      summary: {
        totalWarnings: 0,
        typeMismatch: 0,
        missingRequired: 0,
        picklistCoverage: 0,
        validationRule: 0,
        partialCoverageRisk: 0,
        validationRulesUnavailable: 0,
      },
      validationRuleSafety: {
        evaluatedRuleCount: 3,
        fullyCoveredRuleCount: 2,
        partialCoverageRiskCount: 1,
        genericWarningCount: 0,
        unavailableCount: 0,
      },
    };

    const exportSpec = buildJsonExport({
      project,
      systems,
      entityMappings,
      fieldMappings,
      entities,
      fields,
      validation,
    }) as {
      automapper: {
        validationRuleSafety: ValidationReport['validationRuleSafety'];
      };
    };

    expect(exportSpec.automapper.validationRuleSafety).toEqual(validation.validationRuleSafety);
  });
});
