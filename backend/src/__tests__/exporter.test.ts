import { describe, expect, it } from 'vitest';

import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  MappingProject,
  System,
  ValidationReport,
} from '../types.js';
import { buildJsonExport } from '../services/exporter.js';

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
    const entityMappings: EntityMapping[] = [{
      id: 'em-1',
      projectId: project.id,
      sourceEntityId: 'src-entity',
      targetEntityId: 'tgt-entity',
      confidence: 0.82,
      rationale: 'test',
    }];
    const fieldMappings: FieldMapping[] = [{
      id: 'fm-1',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-field',
      targetFieldId: 'tgt-field',
      transform: { type: 'direct', config: {} },
      confidence: 0.82,
      rationale: 'test',
      status: 'accepted',
    }];
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
