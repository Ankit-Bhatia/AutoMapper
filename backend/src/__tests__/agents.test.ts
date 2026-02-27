/**
 * Phase 2 agent test suite.
 *
 * Tests: SchemaDiscoveryAgent, ComplianceAgent, BankingDomainAgent,
 *        CRMDomainAgent, ERPDomainAgent, MappingProposalAgent,
 *        ValidationAgent, OrchestratorAgent, PIIGuard, LLMGateway
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SchemaDiscoveryAgent } from '../agents/SchemaDiscoveryAgent.js';
import { ComplianceAgent } from '../agents/ComplianceAgent.js';
import { BankingDomainAgent } from '../agents/BankingDomainAgent.js';
import { CRMDomainAgent } from '../agents/CRMDomainAgent.js';
import { ERPDomainAgent } from '../agents/ERPDomainAgent.js';
import { MappingProposalAgent } from '../agents/MappingProposalAgent.js';
import { ValidationAgent } from '../agents/ValidationAgent.js';
import { OrchestratorAgent } from '../agents/OrchestratorAgent.js';
import { sanitizeFields, countRedactedFields, buildSafeSchemaDescription } from '../agents/llm/PIIGuard.js';
import { activeProvider } from '../agents/llm/LLMGateway.js';

import type { AgentContext } from '../agents/types.js';
import type { Entity, Field, EntityMapping, FieldMapping } from '../types.js';
import type { ConnectorField } from '../connectors/IConnector.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return { id: 'ent-1', systemId: 'sys-1', name: 'CIF', label: 'Customer Info', ...overrides };
}

function makeField(overrides: Partial<ConnectorField & Field> = {}): ConnectorField {
  return {
    id: 'fld-1',
    entityId: 'ent-1',
    name: 'LegalName',
    label: 'Legal Name',
    dataType: 'string',
    required: false,
    isKey: false,
    complianceTags: [],
    ...overrides,
  } as ConnectorField;
}

function makeFieldMapping(overrides: Partial<FieldMapping> = {}): FieldMapping {
  return {
    id: 'fm-1',
    entityMappingId: 'em-1',
    sourceFieldId: 'src-fld-1',
    targetFieldId: 'tgt-fld-1',
    confidence: 0.75,
    status: 'suggested',
    transform: null,
    notes: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const srcEnt = makeEntity({ id: 'src-ent', systemId: 'src-sys', name: 'CIF' });
  const tgtEnt = makeEntity({ id: 'tgt-ent', systemId: 'tgt-sys', name: 'Account' });
  const srcField = makeField({ id: 'src-fld-1', entityId: 'src-ent', name: 'LegalName' });
  const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Name' });
  const em: EntityMapping = { id: 'em-1', projectId: 'proj-1', sourceEntityId: 'src-ent', targetEntityId: 'tgt-ent', confidence: 0.8, status: 'suggested', notes: null };
  const fm = makeFieldMapping();

  return {
    projectId: 'proj-1',
    sourceSystemType: 'jackhenry',
    targetSystemType: 'salesforce',
    sourceEntities: [srcEnt],
    targetEntities: [tgtEnt],
    fields: [srcField, tgtField],
    entityMappings: [em],
    fieldMappings: [fm],
    ...overrides,
  };
}

// ─── PIIGuard ─────────────────────────────────────────────────────────────────

describe('PIIGuard', () => {
  it('passes through non-PII fields unchanged', () => {
    const field = makeField({ name: 'LegalName', complianceTags: [] });
    const [safe] = sanitizeFields([field]);
    expect(safe.redacted).toBe(false);
    expect(safe.name).toBe('LegalName');
  });

  it('redacts GLBA_NPI fields', () => {
    const field = makeField({ name: 'TaxID', complianceTags: ['GLBA_NPI'] });
    const [safe] = sanitizeFields([field]);
    expect(safe.redacted).toBe(true);
    expect(safe.name).toBe('[REDACTED_PII_FIELD]');
    expect(safe.redactReason).toBe('GLBA_NPI');
  });

  it('redacts PCI_CARD fields with PCI placeholder', () => {
    const field = makeField({ name: 'CardNumber', complianceTags: ['PCI_CARD'] });
    const [safe] = sanitizeFields([field]);
    expect(safe.redacted).toBe(true);
    expect(safe.name).toBe('[REDACTED_PCI_FIELD]');
    expect(safe.redactReason).toBe('PCI_CARD');
  });

  it('countRedactedFields counts GLBA_NPI + PCI_CARD', () => {
    const fields = [
      makeField({ id: 'f1', name: 'TaxID', complianceTags: ['GLBA_NPI'] }),
      makeField({ id: 'f2', name: 'CardNum', complianceTags: ['PCI_CARD'] }),
      makeField({ id: 'f3', name: 'LegalName', complianceTags: [] }),
    ];
    expect(countRedactedFields(fields)).toBe(2);
  });

  it('SOX_FINANCIAL fields are NOT redacted (not PII)', () => {
    const field = makeField({ name: 'CurrentBalance', complianceTags: ['SOX_FINANCIAL'] });
    const [safe] = sanitizeFields([field]);
    expect(safe.redacted).toBe(false);
    expect(safe.name).toBe('CurrentBalance');
  });

  it('buildSafeSchemaDescription produces entity:field summary', () => {
    const entity = makeEntity();
    const field = makeField({ entityId: 'ent-1', name: 'LegalName' });
    const desc = buildSafeSchemaDescription([entity], [field]);
    expect(desc).toContain('CIF');
    expect(desc).toContain('LegalName');
  });
});

// ─── LLMGateway ───────────────────────────────────────────────────────────────

describe('LLMGateway', () => {
  it('activeProvider returns heuristic when no API keys set', () => {
    // Ensure keys are not set in test environment
    const originalOpenAI = process.env.OPENAI_API_KEY;
    const originalAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(activeProvider()).toBe('heuristic');
    if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic;
  });

  it('activeProvider returns anthropic when ANTHROPIC_API_KEY is set', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(activeProvider()).toBe('anthropic');
    if (original) process.env.ANTHROPIC_API_KEY = original;
    else delete process.env.ANTHROPIC_API_KEY;
  });
});

// ─── SchemaDiscoveryAgent ────────────────────────────────────────────────────

describe('SchemaDiscoveryAgent', () => {
  let agent: SchemaDiscoveryAgent;

  beforeEach(() => { agent = new SchemaDiscoveryAgent(); });

  it('classifies isKey field as identifier', async () => {
    const field = makeField({ name: 'CIFNumber', isKey: true });
    const ctx = makeContext({ fields: [field, makeField({ id: 'f2', entityId: 'tgt-ent', name: 'AccountId' })] });
    await agent.run(ctx);
    const annotation = agent.annotations.get(field.id);
    expect(annotation?.purpose).toBe('identifier');
  });

  it('classifies GLBA_NPI field as pii_personal', async () => {
    const field = makeField({ name: 'SSN', complianceTags: ['GLBA_NPI'] });
    const ctx = makeContext({ fields: [field] });
    await agent.run(ctx);
    expect(agent.annotations.get(field.id)?.purpose).toBe('pii_personal');
  });

  it('classifies email field as pii_contact when GLBA_NPI tagged', async () => {
    const field = makeField({ name: 'PrimaryEmail', dataType: 'email', complianceTags: ['GLBA_NPI'] });
    const ctx = makeContext({ fields: [field] });
    await agent.run(ctx);
    expect(agent.annotations.get(field.id)?.purpose).toBe('pii_contact');
  });

  it('classifies balance field as financial', async () => {
    const field = makeField({ name: 'CurrentBalance', dataType: 'decimal', complianceTags: ['SOX_FINANCIAL'] });
    const ctx = makeContext({ fields: [field] });
    await agent.run(ctx);
    expect(agent.annotations.get(field.id)?.purpose).toBe('financial');
  });

  it('groups address fields into address semantic group', async () => {
    const field = makeField({ name: 'AddressLine1', dataType: 'string' });
    const ctx = makeContext({ fields: [field] });
    await agent.run(ctx);
    expect(agent.annotations.get(field.id)?.semanticGroup).toBe('address');
  });

  it('emits at least one step', async () => {
    const steps: unknown[] = [];
    const ctx = makeContext({ onStep: (s) => steps.push(s) });
    await agent.run(ctx);
    expect(steps.length).toBeGreaterThan(0);
  });

  it('totalImproved is always 0 (discovery does not change mappings)', async () => {
    const ctx = makeContext();
    const result = await agent.run(ctx);
    expect(result.totalImproved).toBe(0);
  });
});

// ─── ComplianceAgent ─────────────────────────────────────────────────────────

describe('ComplianceAgent', () => {
  let agent: ComplianceAgent;

  beforeEach(() => { agent = new ComplianceAgent(); });

  it('flags BSA_AML field mapped to non-audited target', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'RiskScore', complianceTags: ['BSA_AML'] });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'CustomScore__c', complianceTags: [] });
    const fm = makeFieldMapping({ sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    await agent.run(ctx);
    const bsaIssues = agent.lastReport!.issues.filter((i) => i.rule === 'BSA_AML_AUDIT_TRAIL_MISSING');
    expect(bsaIssues.length).toBeGreaterThan(0);
  });

  it('flags SOX_FINANCIAL field with low confidence', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'CurrentBalance', complianceTags: ['SOX_FINANCIAL'] });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Amount' });
    const fm = makeFieldMapping({ confidence: 0.5, sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    await agent.run(ctx);
    const soxIssues = agent.lastReport!.issues.filter((i) => i.rule === 'SOX_FINANCIAL_LOW_CONFIDENCE');
    expect(soxIssues.length).toBeGreaterThan(0);
  });

  it('counts PII fields correctly', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'TaxID', complianceTags: ['GLBA_NPI', 'FFIEC_AUDIT', 'BSA_AML'] });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Name' });
    const fm = makeFieldMapping({ sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    await agent.run(ctx);
    expect(agent.lastReport!.piiFieldCount).toBe(1);
  });

  it('produces no errors for clean mappings', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'LegalName', complianceTags: [] });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Name', complianceTags: [] });
    const fm = makeFieldMapping({ confidence: 0.9, sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    await agent.run(ctx);
    expect(agent.lastReport!.totalErrors).toBe(0);
  });
});

// ─── BankingDomainAgent ───────────────────────────────────────────────────────

describe('BankingDomainAgent', () => {
  let agent: BankingDomainAgent;

  beforeEach(() => { agent = new BankingDomainAgent(); });

  it('boosts confidence when LegalName → Name (banking synonym)', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'LegalName', complianceTags: ['GLBA_NPI'] });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Name' });
    const fm = makeFieldMapping({ confidence: 0.70, sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    const result = await agent.run(ctx);
    const updated = result.updatedFieldMappings[0];
    expect(updated.confidence).toBeGreaterThan(0.70);
  });

  it('penalises DividendRate → InterestRate (credit-union terminology error)', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'DividendRate', dataType: 'decimal' });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'InterestRate__c' });
    const fm = makeFieldMapping({ confidence: 0.70, sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    const result = await agent.run(ctx);
    expect(result.updatedFieldMappings[0].confidence).toBeLessThan(0.70);
  });

  it('skips when source system is not jackhenry', async () => {
    const ctx = makeContext({ sourceSystemType: 'salesforce' });
    const result = await agent.run(ctx);
    expect(result.totalImproved).toBe(0);
  });
});

// ─── CRMDomainAgent ───────────────────────────────────────────────────────────

describe('CRMDomainAgent', () => {
  let agent: CRMDomainAgent;

  beforeEach(() => { agent = new CRMDomainAgent(); });

  it('boosts confidence for mapping to Salesforce standard field', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'LegalName' });
    const tgtEnt = makeEntity({ id: 'tgt-ent', name: 'Account' });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Name' });
    const fm = makeFieldMapping({ confidence: 0.70, sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm], targetEntities: [tgtEnt] });
    const result = await agent.run(ctx);
    expect(result.updatedFieldMappings[0].confidence).toBeGreaterThan(0.70);
  });

  it('slightly reduces confidence for custom fields below 0.75', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'LegalName' });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'LegalName__c' });
    const fm = makeFieldMapping({ confidence: 0.60, sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    const result = await agent.run(ctx);
    expect(result.updatedFieldMappings[0].confidence).toBeLessThan(0.60);
  });

  it('skips when target system is not salesforce', async () => {
    const ctx = makeContext({ targetSystemType: 'sap' });
    const result = await agent.run(ctx);
    expect(result.totalImproved).toBe(0);
  });
});

// ─── ERPDomainAgent ───────────────────────────────────────────────────────────

describe('ERPDomainAgent', () => {
  let agent: ERPDomainAgent;

  beforeEach(() => { agent = new ERPDomainAgent(); });

  it('boosts confidence for SAP BAPI field SMTP_ADDR → Email', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'SMTP_ADDR', dataType: 'email' });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Email' });
    const fm = makeFieldMapping({ confidence: 0.55, sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ sourceSystemType: 'sap', fields: [srcField, tgtField], fieldMappings: [fm] });
    const result = await agent.run(ctx);
    expect(result.updatedFieldMappings[0].confidence).toBeGreaterThan(0.55);
  });

  it('skips when source system is not sap', async () => {
    const ctx = makeContext({ sourceSystemType: 'jackhenry' });
    const result = await agent.run(ctx);
    expect(result.totalImproved).toBe(0);
  });
});

// ─── MappingProposalAgent ─────────────────────────────────────────────────────

describe('MappingProposalAgent', () => {
  it('returns no-op when no LLM provider configured', async () => {
    const original = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const agent = new MappingProposalAgent();
    const ctx = makeContext();
    const result = await agent.run(ctx);

    expect(result.totalImproved).toBe(0);
    expect(result.updatedFieldMappings).toEqual(ctx.fieldMappings);

    if (original.openai) process.env.OPENAI_API_KEY = original.openai;
    if (original.anthropic) process.env.ANTHROPIC_API_KEY = original.anthropic;
  });
});

// ─── ValidationAgent ─────────────────────────────────────────────────────────

describe('ValidationAgent', () => {
  let agent: ValidationAgent;

  beforeEach(() => { agent = new ValidationAgent(); });

  it('rejects mapping with type mismatch (string → date)', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'CIFNumber', dataType: 'string' });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'CloseDate', dataType: 'date' });
    const fm = makeFieldMapping({ sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    const result = await agent.run(ctx);
    // string → date is NOT in TYPE_COMPAT for string
    const updated = result.updatedFieldMappings[0];
    expect(updated.status).toBe('rejected');
  });

  it('accepts compatible types (decimal → decimal)', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'CurrentBalance', dataType: 'decimal' });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Amount', dataType: 'decimal' });
    const fm = makeFieldMapping({ sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    const result = await agent.run(ctx);
    expect(result.updatedFieldMappings[0].status).not.toBe('rejected');
  });

  it('flags required target field that has no mapping', async () => {
    const srcField = makeField({ id: 'src-fld-1', name: 'LegalName' });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Name', required: true });
    // Empty mappings — required tgtField has no mapping
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [] });
    const steps: unknown[] = [];
    await agent.run({ ...ctx, onStep: (s) => steps.push(s) });
    const missingSteps = (steps as { action: string }[]).filter((s) => s.action === 'validation_missing_required');
    expect(missingSteps.length).toBeGreaterThan(0);
  });

  it('flags picklist value gaps', async () => {
    const srcField = makeField({
      id: 'src-fld-1', name: 'Status', dataType: 'picklist',
      picklistValues: ['Active', 'Inactive', 'Suspended'],
    });
    const tgtField = makeField({
      id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'AccountStatus', dataType: 'picklist',
      picklistValues: ['Active', 'Inactive'],
    });
    const fm = makeFieldMapping({ sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const steps: unknown[] = [];
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm], onStep: (s) => steps.push(s) });
    await agent.run(ctx);
    const gapSteps = (steps as { action: string }[]).filter((s) => s.action === 'validation_picklist_gap');
    expect(gapSteps.length).toBeGreaterThan(0);
  });
});

// ─── OrchestratorAgent ────────────────────────────────────────────────────────

describe('OrchestratorAgent', () => {
  it('runs full pipeline and returns result with agentsRun list', async () => {
    const orchestrator = new OrchestratorAgent();
    const ctx = makeContext();
    const result = await orchestrator.orchestrate(ctx);

    expect(result.agentsRun).toContain('SchemaDiscoveryAgent');
    expect(result.agentsRun).toContain('ComplianceAgent');
    expect(result.agentsRun).toContain('ValidationAgent');
    expect(result.updatedFieldMappings).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('includes BankingDomainAgent when source is jackhenry', async () => {
    const orchestrator = new OrchestratorAgent();
    const ctx = makeContext({ sourceSystemType: 'jackhenry' });
    const result = await orchestrator.orchestrate(ctx);
    expect(result.agentsRun).toContain('BankingDomainAgent');
  });

  it('includes CRMDomainAgent when target is salesforce', async () => {
    const orchestrator = new OrchestratorAgent();
    const ctx = makeContext({ targetSystemType: 'salesforce' });
    const result = await orchestrator.orchestrate(ctx);
    expect(result.agentsRun).toContain('CRMDomainAgent');
  });

  it('does NOT include ERPDomainAgent for jackhenry→salesforce', async () => {
    const orchestrator = new OrchestratorAgent();
    const ctx = makeContext({ sourceSystemType: 'jackhenry', targetSystemType: 'salesforce' });
    const result = await orchestrator.orchestrate(ctx);
    expect(result.agentsRun).not.toContain('ERPDomainAgent');
  });

  it('produces a compliance report', async () => {
    const orchestrator = new OrchestratorAgent();
    const srcField = makeField({ id: 'src-fld-1', name: 'TaxID', complianceTags: ['GLBA_NPI'], complianceNote: 'Must mask' });
    const tgtField = makeField({ id: 'tgt-fld-1', entityId: 'tgt-ent', name: 'Name' });
    const fm = makeFieldMapping({ sourceFieldId: 'src-fld-1', targetFieldId: 'tgt-fld-1' });
    const ctx = makeContext({ fields: [srcField, tgtField], fieldMappings: [fm] });
    const result = await orchestrator.orchestrate(ctx);
    expect(result.complianceReport).not.toBeNull();
    expect(result.complianceReport?.piiFieldCount).toBeGreaterThanOrEqual(1);
  });

  it('allSteps contains steps from every agent that ran', async () => {
    const orchestrator = new OrchestratorAgent();
    const ctx = makeContext();
    const result = await orchestrator.orchestrate(ctx);
    const agentNames = new Set(result.allSteps.map((s) => s.agentName));
    expect(agentNames.has('SchemaDiscoveryAgent')).toBe(true);
    expect(agentNames.has('ComplianceAgent')).toBe(true);
  });
});
