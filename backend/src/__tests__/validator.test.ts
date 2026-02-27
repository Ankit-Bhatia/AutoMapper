import { describe, it, expect } from 'vitest';
import { validateMappings } from '../services/validator.js';
import type { Entity, EntityMapping, Field, FieldMapping } from '../types.js';

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

const makeEntityMapping = (id: string, srcEntityId: string, tgtEntityId: string): EntityMapping => ({
  id,
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
  status: FieldMapping['status'] = 'suggested',
): FieldMapping => ({
  id,
  entityMappingId,
  sourceFieldId,
  targetFieldId,
  transform: { type: 'direct', config: {} },
  confidence: 0.75,
  rationale: 'test',
  status,
});

describe('validateMappings', () => {
  it('should detect type_mismatch when string is mapped to date', () => {
    const srcField = makeField('sf1', 'se1', 'ModifiedAt', 'string');
    const tgtField = makeField('tf1', 'te1', 'LastModifiedDate', 'date');
    const em = makeEntityMapping('em1', 'se1', 'te1');
    const fm = makeFieldMapping('fm1', 'em1', 'sf1', 'tf1');

    const report = validateMappings({
      entityMappings: [em],
      fieldMappings: [fm],
      fields: [srcField, tgtField],
      entities: [],
    });

    expect(report.summary.typeMismatch).toBeGreaterThanOrEqual(1);
    const warning = report.warnings.find((w) => w.type === 'type_mismatch');
    expect(warning).toBeDefined();
    expect(warning?.fieldMappingId).toBe('fm1');
  });

  it('should detect missing_required when a required target field has no mapping', () => {
    const srcField = makeField('sf2', 'se2', 'Name', 'string');
    const tgtRequiredField = makeField('tf2', 'te2', 'LastName', 'string', { required: true });
    const tgtOptionalField = makeField('tf3', 'te2', 'Phone', 'string', { required: false });

    // Only map to optional, leaving LastName unmapped
    const em = makeEntityMapping('em2', 'se2', 'te2');
    const fm = makeFieldMapping('fm2', 'em2', 'sf2', 'tf3');

    const entities: Entity[] = [
      { id: 'se2', systemId: 'src', name: 'Contact' },
      { id: 'te2', systemId: 'tgt', name: 'Contact' },
    ];

    const report = validateMappings({
      entityMappings: [em],
      fieldMappings: [fm],
      fields: [srcField, tgtRequiredField, tgtOptionalField],
      entities,
    });

    expect(report.summary.missingRequired).toBeGreaterThanOrEqual(1);
    const warning = report.warnings.find((w) => w.type === 'missing_required');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('LastName');
  });

  it('should detect picklist_coverage when source values are not all in target', () => {
    const srcField = makeField('sf3', 'se3', 'Status', 'picklist', {
      picklistValues: ['Active', 'Inactive', 'Pending'],
    });
    const tgtField = makeField('tf4', 'te3', 'Status', 'picklist', {
      picklistValues: ['Active', 'Inactive'],
    });

    const em = makeEntityMapping('em3', 'se3', 'te3');
    const fm = makeFieldMapping('fm3', 'em3', 'sf3', 'tf4');

    const report = validateMappings({
      entityMappings: [em],
      fieldMappings: [fm],
      fields: [srcField, tgtField],
      entities: [],
    });

    expect(report.summary.picklistCoverage).toBeGreaterThanOrEqual(1);
    const warning = report.warnings.find((w) => w.type === 'picklist_coverage');
    expect(warning).toBeDefined();
  });

  it('should correctly populate summary counts', () => {
    const sf1 = makeField('sf1', 'se1', 'CreatedAt', 'string');
    const tf1 = makeField('tf1', 'te1', 'CreatedDate', 'date');
    const sf2 = makeField('sf2', 'se1', 'StatusCode', 'picklist', { picklistValues: ['A', 'B', 'C'] });
    const tf2 = makeField('tf2', 'te1', 'Status__c', 'picklist', { picklistValues: ['A', 'B'] });
    const tf3 = makeField('tf3', 'te1', 'RequiredField', 'string', { required: true });

    const em = makeEntityMapping('em4', 'se1', 'te1');
    const fm1 = makeFieldMapping('fm1', 'em4', 'sf1', 'tf1');
    const fm2 = makeFieldMapping('fm2', 'em4', 'sf2', 'tf2');
    // tf3 is required but not mapped

    const entities: Entity[] = [
      { id: 'se1', systemId: 'src', name: 'Order' },
      { id: 'te1', systemId: 'tgt', name: 'Order__c' },
    ];

    const report = validateMappings({
      entityMappings: [em],
      fieldMappings: [fm1, fm2],
      fields: [sf1, tf1, sf2, tf2, tf3],
      entities,
    });

    expect(report.summary.totalWarnings).toBeGreaterThanOrEqual(3);
    expect(report.summary.typeMismatch).toBeGreaterThanOrEqual(1);
    expect(report.summary.picklistCoverage).toBeGreaterThanOrEqual(1);
    expect(report.summary.missingRequired).toBeGreaterThanOrEqual(1);
    expect(report.summary.totalWarnings).toBe(
      report.summary.typeMismatch + report.summary.missingRequired + report.summary.picklistCoverage,
    );
  });
});
