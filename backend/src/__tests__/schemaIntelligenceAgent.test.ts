import { describe, expect, it } from 'vitest';
import { SchemaIntelligenceAgent } from '../agents/SchemaIntelligenceAgent.js';
import { COREDIR_FSC_PATTERNS, COREDIR_ONE_TO_MANY_FIELDS } from '../agents/coreDirSchemaData.js';
import type { AgentContext, AgentStep } from '../agents/types.js';
import type { Entity, EntityMapping, Field, FieldMapping } from '../types.js';

function makeEntity(id: string, systemId: string, name: string): Entity {
  return { id, systemId, name };
}

function makeField(id: string, entityId: string, name: string, dataType: Field['dataType']): Field {
  return { id, entityId, name, dataType, required: false, isKey: false };
}

function makeFieldMapping(id: string, sourceFieldId: string, targetFieldId: string, confidence = 0.55): FieldMapping {
  return {
    id,
    entityMappingId: 'entity-map-1',
    sourceFieldId,
    targetFieldId,
    transform: { type: 'direct', config: {} },
    confidence,
    rationale: 'seed',
    status: 'suggested',
  };
}

async function runAgent(options: {
  sourceFieldNames: string[];
  mappedSourceFieldName: string;
  targetFieldName: string;
  targetDataType: Field['dataType'];
  sourceSystemType?: AgentContext['sourceSystemType'];
  targetSystemType?: AgentContext['targetSystemType'];
}) {
  const sourceEntity = makeEntity('src-entity', 'src-system', 'SourceRecord');
  const targetEntity = makeEntity('tgt-entity', 'tgt-system', 'TargetRecord');
  const sourceFields = options.sourceFieldNames.map((name, index) =>
    makeField(`src-${index + 1}`, sourceEntity.id, name, 'string'),
  );
  const mappedSource = sourceFields.find((field) => field.name === options.mappedSourceFieldName);
  if (!mappedSource) {
    throw new Error(`Missing mapped source field ${options.mappedSourceFieldName}`);
  }
  const targetField = makeField('tgt-1', targetEntity.id, options.targetFieldName, options.targetDataType);
  const entityMappings: EntityMapping[] = [{
    id: 'entity-map-1',
    projectId: 'project-1',
    sourceEntityId: sourceEntity.id,
    targetEntityId: targetEntity.id,
    confidence: 0.7,
    rationale: 'seed',
  }];
  const fieldMappings = [makeFieldMapping('mapping-1', mappedSource.id, targetField.id)];
  const steps: AgentStep[] = [];
  const context: AgentContext = {
    projectId: 'project-1',
    sourceSystemType: options.sourceSystemType ?? 'jackhenry',
    targetSystemType: options.targetSystemType ?? 'salesforce',
    sourceEntities: [sourceEntity],
    targetEntities: [targetEntity],
    fields: [...sourceFields, targetField],
    entityMappings,
    fieldMappings,
    onStep: (step) => steps.push(step),
  };

  const agent = new SchemaIntelligenceAgent();
  const result = await agent.run(context);
  return { result, steps };
}

describe('SchemaIntelligenceAgent CoreDirector corpus', () => {
  it('exports a CoreDirector corpus with at least 100 patterns and exactly 8 one-to-many entries', () => {
    const patternCount = Object.values(COREDIR_FSC_PATTERNS).reduce((count, patterns) => count + patterns.length, 0);
    expect(patternCount).toBeGreaterThanOrEqual(100);
    expect(COREDIR_ONE_TO_MANY_FIELDS).toEqual([
      'ADDR_LINE1',
      'CUST_NAME',
      'LOAN_MAT_DT',
      'LOAN_INT_RATE',
      'LOAN_OFFICER_NBR',
      'LOAN_TYPE',
      'LOAN_BRANCH_NBR',
      'ACCT_TYPE',
    ]);
  });

  it('detects the CoreDirector corpus and boosts CIF_NBR → AccountNumber to at least 0.85', async () => {
    const { result, steps } = await runAgent({
      sourceFieldNames: ['CIF_NBR', 'CUST_LAST_NAME', 'LOAN_BAL', 'LOAN_INT_RATE'],
      mappedSourceFieldName: 'CIF_NBR',
      targetFieldName: 'AccountNumber',
      targetDataType: 'string',
    });

    expect(result.updatedFieldMappings[0]?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.updatedFieldMappings[0]?.rationale).toContain('Confirmed CoreDirector→FSC pattern');
    expect(steps.some((step) => step.action === 'schema_intelligence_corpus' && step.detail.includes('Applied coredir corpus'))).toBe(true);
  });

  it('boosts LOAN_BAL → FinServ__Balance__c above 0.85', async () => {
    const { result } = await runAgent({
      sourceFieldNames: ['CIF_NBR', 'LOAN_BAL', 'ACCT_NBR', 'LOAN_INT_RATE'],
      mappedSourceFieldName: 'LOAN_BAL',
      targetFieldName: 'FinServ__Balance__c',
      targetDataType: 'currency',
    });

    expect(result.updatedFieldMappings[0]?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.updatedFieldMappings[0]?.rationale).toContain('FinServ__Balance__c');
  });

  it('flags LOAN_INT_RATE as one-to-many and surfaces picklist translation for LOAN_PYMT_FREQ', async () => {
    const loanRate = await runAgent({
      sourceFieldNames: ['CIF_NBR', 'LOAN_INT_RATE', 'LOAN_PYMT_FREQ', 'ACCT_NBR'],
      mappedSourceFieldName: 'LOAN_INT_RATE',
      targetFieldName: 'FinServ__InterestRate__c',
      targetDataType: 'percent',
    });
    expect(loanRate.result.updatedFieldMappings[0]?.rationale).toContain('One-to-Many field');

    const paymentFreq = await runAgent({
      sourceFieldNames: ['CIF_NBR', 'LOAN_INT_RATE', 'LOAN_PYMT_FREQ', 'ACCT_NBR'],
      mappedSourceFieldName: 'LOAN_PYMT_FREQ',
      targetFieldName: 'FinServ__PaymentFrequency__c',
      targetDataType: 'picklist',
    });
    expect(paymentFreq.result.updatedFieldMappings[0]?.rationale.toLowerCase()).toContain('picklist translation required');
  });

  it('keeps BOSL schemas on the BOSL corpus and does not apply CoreDirector boosts', async () => {
    const { result, steps } = await runAgent({
      sourceFieldNames: ['AMT_PAYMENT', 'DATE_BOARDING', 'CODE_ENTITY_TYPE', 'AMT_TOTAL_ASSETS'],
      mappedSourceFieldName: 'AMT_PAYMENT',
      targetFieldName: 'FinServ__PaymentAmount__c',
      targetDataType: 'currency',
      sourceSystemType: 'riskclam',
    });

    expect(result.updatedFieldMappings[0]?.rationale).toContain('Confirmed BOSL→FSC pattern');
    expect(result.updatedFieldMappings[0]?.rationale).not.toContain('CoreDirector→FSC');
    expect(steps.some((step) => step.action === 'schema_intelligence_corpus' && step.detail.includes('Applied bosl corpus'))).toBe(true);
  });
});
