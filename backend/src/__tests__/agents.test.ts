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
import { MappingRationaleAgent } from '../agents/MappingRationaleAgent.js';
import { ValidationAgent } from '../agents/ValidationAgent.js';
import { OrchestratorAgent } from '../agents/OrchestratorAgent.js';
import { sanitizeFields, countRedactedFields, buildSafeSchemaDescription } from '../agents/llm/PIIGuard.js';
import { activeProvider } from '../agents/llm/LLMGateway.js';
import * as LLMGateway from '../agents/llm/LLMGateway.js';
import * as EmbeddingService from '../services/EmbeddingService.js';

import type { AgentContext } from '../agents/types.js';
import type { Entity, Field, EntityMapping, FieldMapping } from '../types.js';
import type { ConnectorField } from '../../../packages/connectors/IConnector.js';

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
    const originalGemini = process.env.GEMINI_API_KEY;
    const originalGeminiLegacy = process.env.GEMINI_KEY;
    const originalGoogle = process.env.GOOGLE_API_KEY;
    const originalProvider = process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLM_PROVIDER;
    expect(activeProvider()).toBe('heuristic');
    if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic;
    if (originalGemini) process.env.GEMINI_API_KEY = originalGemini;
    if (originalGeminiLegacy) process.env.GEMINI_KEY = originalGeminiLegacy;
    if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
    if (originalProvider) process.env.LLM_PROVIDER = originalProvider;
  });

  it('activeProvider returns anthropic when ANTHROPIC_API_KEY is set', () => {
    const originalAnthropic = process.env.ANTHROPIC_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    const originalProvider = process.env.LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(activeProvider()).toBe('anthropic');
    if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalGemini) process.env.GEMINI_API_KEY = originalGemini;
    if (originalProvider) process.env.LLM_PROVIDER = originalProvider;
  });

  it('activeProvider returns gemini when GEMINI_API_KEY is set and anthropic is absent', () => {
    const originalAnthropic = process.env.ANTHROPIC_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    const originalOpenAI = process.env.OPENAI_API_KEY;
    const originalProvider = process.env.LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    expect(activeProvider()).toBe('gemini');
    if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalGemini) process.env.GEMINI_API_KEY = originalGemini;
    else delete process.env.GEMINI_API_KEY;
    if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
    else delete process.env.OPENAI_API_KEY;
    if (originalProvider) process.env.LLM_PROVIDER = originalProvider;
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
  it('runs deterministic context ranker when no LLM provider configured', async () => {
    const original = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      geminiLegacy: process.env.GEMINI_KEY,
      google: process.env.GOOGLE_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GOOGLE_API_KEY;

    const agent = new MappingProposalAgent();
    const ctx = makeContext();
    const steps: unknown[] = [];
    const result = await agent.run({ ...ctx, onStep: (step) => steps.push(step) });

    expect(result.updatedFieldMappings.length).toBe(ctx.fieldMappings.length);
    expect((steps as { action: string }[]).some((step) => step.action === 'context_mode')).toBe(true);
    expect((steps as { action: string }[]).some((step) => step.action === 'mapping_proposal_complete')).toBe(true);

    if (original.openai) process.env.OPENAI_API_KEY = original.openai;
    if (original.anthropic) process.env.ANTHROPIC_API_KEY = original.anthropic;
    if (original.gemini) process.env.GEMINI_API_KEY = original.gemini;
    if (original.geminiLegacy) process.env.GEMINI_KEY = original.geminiLegacy;
    if (original.google) process.env.GOOGLE_API_KEY = original.google;
  });

  it('retargets low-confidence mappings using context ranking in heuristic mode', async () => {
    const original = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      geminiLegacy: process.env.GEMINI_KEY,
      google: process.env.GOOGLE_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GOOGLE_API_KEY;

    const agent = new MappingProposalAgent();
    const srcEnt = makeEntity({ id: 'src-ent', systemId: 'src-sys', name: 'Borrower' });
    const tgtEnt = makeEntity({ id: 'tgt-ent', systemId: 'tgt-sys', name: 'PartyProfile' });
    const srcField = makeField({ id: 'src-tax-id', entityId: 'src-ent', name: 'TaxID', dataType: 'string', complianceTags: ['GLBA_NPI'] });
    const wrongTgt = makeField({ id: 'tgt-name', entityId: 'tgt-ent', name: 'Name', dataType: 'string', complianceTags: [] });
    const bestTgt = makeField({ id: 'tgt-tax-id', entityId: 'tgt-ent', name: 'TaxID', dataType: 'string', complianceTags: ['GLBA_NPI'] });
    const em: EntityMapping = {
      id: 'em-1',
      projectId: 'proj-1',
      sourceEntityId: 'src-ent',
      targetEntityId: 'tgt-ent',
      confidence: 0.8,
      rationale: 'test',
    };
    const fm: FieldMapping = {
      id: 'fm-1',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-tax-id',
      targetFieldId: 'tgt-name',
      confidence: 0.42,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'initial',
    };

    const result = await agent.run({
      ...makeContext(),
      sourceEntities: [srcEnt],
      targetEntities: [tgtEnt],
      fields: [srcField, wrongTgt, bestTgt],
      entityMappings: [em],
      fieldMappings: [fm],
    });

    expect(result.totalImproved).toBeGreaterThan(0);
    expect(result.updatedFieldMappings[0]?.targetFieldId).toBe('tgt-tax-id');
    expect(result.updatedFieldMappings[0]?.confidence).toBeGreaterThan(0.42);

    if (original.openai) process.env.OPENAI_API_KEY = original.openai;
    if (original.anthropic) process.env.ANTHROPIC_API_KEY = original.anthropic;
    if (original.gemini) process.env.GEMINI_API_KEY = original.gemini;
    if (original.geminiLegacy) process.env.GEMINI_KEY = original.geminiLegacy;
    if (original.google) process.env.GOOGLE_API_KEY = original.google;
  });

  it('tags rationale with embed when embedding cache improves the semantic score', async () => {
    const original = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      geminiLegacy: process.env.GEMINI_KEY,
      google: process.env.GOOGLE_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GOOGLE_API_KEY;

    const agent = new MappingProposalAgent();
    const srcEnt = makeEntity({ id: 'src-ent', systemId: 'src-sys', name: 'Borrower' });
    const tgtEnt = makeEntity({ id: 'tgt-ent', systemId: 'tgt-sys', name: 'PartyProfile' });
    const srcField = makeField({ id: 'src-tenure', entityId: 'src-ent', name: 'CUST_TENURE_MONTHS', label: 'Customer Tenure Months', dataType: 'integer' });
    const bestTgt = makeField({ id: 'tgt-tenure', entityId: 'tgt-ent', name: 'YearsWithFirm__c', label: 'Years With Firm', dataType: 'integer' });
    const em: EntityMapping = {
      id: 'em-1',
      projectId: 'proj-1',
      sourceEntityId: 'src-ent',
      targetEntityId: 'tgt-ent',
      confidence: 0.8,
      rationale: 'test',
    };
    const fm: FieldMapping = {
      id: 'fm-1',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-tenure',
      targetFieldId: 'tgt-tenure',
      confidence: 0.42,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'initial',
    };

    const result = await agent.run({
      ...makeContext(),
      sourceEntities: [srcEnt],
      targetEntities: [tgtEnt],
      fields: [srcField, bestTgt],
      entityMappings: [em],
      fieldMappings: [fm],
      embeddingCache: new Map([
        ['src-tenure', [1, 0, 0]],
        ['tgt-tenure', [1, 0, 0]],
      ]),
    });

    expect(result.updatedFieldMappings[0]?.targetFieldId).toBe('tgt-tenure');
    expect(result.updatedFieldMappings[0]?.confidence ?? 0).toBeGreaterThan(0.42);
    expect(result.updatedFieldMappings[0]?.rationale ?? '').toContain('embedding');
    expect(result.updatedFieldMappings[0]?.retrievalShortlist?.topK).toBe(5);
    expect(result.updatedFieldMappings[0]?.retrievalShortlist?.candidates[0]?.targetFieldId).toBe('tgt-tenure');

    if (original.openai) process.env.OPENAI_API_KEY = original.openai;
    if (original.anthropic) process.env.ANTHROPIC_API_KEY = original.anthropic;
    if (original.gemini) process.env.GEMINI_API_KEY = original.gemini;
    if (original.geminiLegacy) process.env.GEMINI_KEY = original.geminiLegacy;
    if (original.google) process.env.GOOGLE_API_KEY = original.google;
  });

  it('emits one retrieval_ready event with shortlistsBuilt and topK', async () => {
    const agent = new MappingProposalAgent();
    const steps: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
    const srcEnt = makeEntity({ id: 'src-ent', systemId: 'src-sys', name: 'Borrower' });
    const tgtEnt = makeEntity({ id: 'tgt-ent', systemId: 'tgt-sys', name: 'PartyProfile' });
    const srcField = makeField({
      id: 'src-tenure',
      entityId: 'src-ent',
      name: 'CUST_TENURE_MONTHS',
      label: 'Customer Tenure Months',
      dataType: 'integer',
    });
    const tgtField = makeField({
      id: 'tgt-tenure',
      entityId: 'tgt-ent',
      name: 'YearsWithFirm__c',
      label: 'Years With Firm',
      dataType: 'integer',
    });
    const em: EntityMapping = {
      id: 'em-1',
      projectId: 'proj-1',
      sourceEntityId: 'src-ent',
      targetEntityId: 'tgt-ent',
      confidence: 0.8,
      rationale: 'test',
    };
    const fm: FieldMapping = {
      id: 'fm-1',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-tenure',
      targetFieldId: 'tgt-tenure',
      confidence: 0.42,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'initial',
    };

    await agent.run({
      ...makeContext(),
      sourceEntities: [srcEnt],
      targetEntities: [tgtEnt],
      fields: [srcField, tgtField],
      entityMappings: [em],
      fieldMappings: [fm],
      onStep: (step) => steps.push(step),
    });

    const retrievalReady = steps.filter((step) => step.action === 'retrieval_ready');
    expect(retrievalReady).toHaveLength(1);
    expect(retrievalReady[0]?.metadata).toMatchObject({
      shortlistsBuilt: 1,
      topK: 5,
    });
  });

  it('uses shortlist-only reranker input and persists rerankerDecision on the mapping', async () => {
    const activeProviderSpy = vi.spyOn(LLMGateway, 'activeProvider').mockReturnValue('gemini');
    const llmCompleteSpy = vi.spyOn(LLMGateway, 'llmComplete').mockResolvedValue({
      content: JSON.stringify({
        selectedTargetFieldId: 'tgt-first-name',
        selectedTargetFieldName: 'FirstName',
        finalRank: 1,
        confidence: 0.88,
        evidenceSignals: ['retrieval', 'sibling'],
        reasoning: 'Sibling cluster indicates this field is the first-name component.',
      }),
      provider: 'gemini',
      tokensUsed: 51,
    });

    const agent = new MappingProposalAgent();
    const steps: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
    const srcEnt = makeEntity({ id: 'src-ent', systemId: 'src-sys', name: 'Borrower' });
    const tgtEnt = makeEntity({ id: 'tgt-ent', systemId: 'tgt-sys', name: 'Account' });
    const srcFirst = makeField({ id: 'src-first', entityId: 'src-ent', name: 'NAME_FIRST', label: 'First Name', dataType: 'string' });
    const srcMiddle = makeField({ id: 'src-middle', entityId: 'src-ent', name: 'NAME_MIDDLE', label: 'Middle Name', dataType: 'string' });
    const srcLast = makeField({ id: 'src-last', entityId: 'src-ent', name: 'NAME_LAST', label: 'Last Name', dataType: 'string' });
    const tgtName = makeField({ id: 'tgt-name', entityId: 'tgt-ent', name: 'Name', label: 'Account Name', dataType: 'string' });
    const tgtFirst = makeField({ id: 'tgt-first-name', entityId: 'tgt-ent', name: 'FirstName', label: 'First Name', dataType: 'string' });
    const tgtLast = makeField({ id: 'tgt-last-name', entityId: 'tgt-ent', name: 'LastName', label: 'Last Name', dataType: 'string' });
    const tgtMiddle = makeField({ id: 'tgt-middle-name', entityId: 'tgt-ent', name: 'MiddleName', label: 'Middle Name', dataType: 'string' });
    const tgtSuffix = makeField({ id: 'tgt-suffix', entityId: 'tgt-ent', name: 'Suffix', label: 'Suffix', dataType: 'string' });
    const tgtExcluded = makeField({ id: 'tgt-legacy', entityId: 'tgt-ent', name: 'LegacyControlFlag__c', label: 'Legacy Control Flag', dataType: 'boolean' });
    const em: EntityMapping = {
      id: 'em-1',
      projectId: 'proj-1',
      sourceEntityId: 'src-ent',
      targetEntityId: 'tgt-ent',
      confidence: 0.8,
      rationale: 'test',
    };
    const fm: FieldMapping = {
      id: 'fm-1',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-first',
      targetFieldId: 'tgt-name',
      confidence: 0.56,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'initial',
    };

    const result = await agent.run({
      ...makeContext(),
      sourceEntities: [srcEnt],
      targetEntities: [tgtEnt],
      fields: [
        srcFirst,
        srcMiddle,
        srcLast,
        tgtName,
        tgtFirst,
        tgtLast,
        tgtMiddle,
        tgtSuffix,
        tgtExcluded,
      ],
      entityMappings: [em],
      fieldMappings: [fm],
      onStep: (step) => steps.push(step),
    });

    expect(activeProviderSpy).toHaveBeenCalled();
    expect(llmCompleteSpy).toHaveBeenCalledTimes(1);

    const promptContent = llmCompleteSpy.mock.calls[0]?.[0].map((message) => message.content).join('\n') ?? '';
    expect(promptContent).toContain('NAME_MIDDLE');
    expect(promptContent).toContain('NAME_LAST');
    expect(promptContent).not.toContain('LegacyControlFlag__c');
    expect(promptContent).not.toContain('TARGET SCHEMA');

    const updated = result.updatedFieldMappings[0];
    expect(updated?.targetFieldId).toBe('tgt-first-name');
    expect(updated?.rerankerDecision).toMatchObject({
      selectedTargetFieldId: 'tgt-first-name',
      finalRank: 1,
      confidence: 0.88,
      evidenceSignals: ['retrieval', 'sibling'],
    });

    const rerankerComplete = steps.filter((step) => step.action === 'reranker_complete');
    expect(rerankerComplete).toHaveLength(1);
    expect(rerankerComplete[0]?.metadata).toMatchObject({
      candidateCount: 5,
      top1Confidence: 0.88,
    });
  });

  it('emits optimizer_complete metadata and removes duplicate targets after reranking', async () => {
    const original = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      geminiLegacy: process.env.GEMINI_KEY,
      google: process.env.GOOGLE_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GOOGLE_API_KEY;

    const agent = new MappingProposalAgent();
    const steps: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
    const srcEnt = makeEntity({ id: 'src-ent', systemId: 'src-sys', name: 'Borrower' });
    const tgtEnt = makeEntity({ id: 'tgt-ent', systemId: 'tgt-sys', name: 'Account' });
    const srcAmount = makeField({ id: 'src-amount', entityId: 'src-ent', name: 'AMT_APPROVED', dataType: 'decimal' });
    const srcPayment = makeField({ id: 'src-payment', entityId: 'src-ent', name: 'AMT_PAYMENT', dataType: 'decimal' });
    const tgtBalance = makeField({ id: 'tgt-balance', entityId: 'tgt-ent', name: 'CurrentBalance', dataType: 'decimal' });
    const tgtPayment = makeField({ id: 'tgt-payment', entityId: 'tgt-ent', name: 'PaymentAmount', dataType: 'decimal' });
    const em: EntityMapping = {
      id: 'em-1',
      projectId: 'proj-1',
      sourceEntityId: 'src-ent',
      targetEntityId: 'tgt-ent',
      confidence: 0.8,
      rationale: 'test',
    };
    const fmAmount: FieldMapping = {
      id: 'fm-amount',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-amount',
      targetFieldId: 'tgt-balance',
      confidence: 0.82,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'initial',
    };
    const fmPayment: FieldMapping = {
      id: 'fm-payment',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-payment',
      targetFieldId: 'tgt-balance',
      confidence: 0.79,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'initial',
    };

    const result = await agent.run({
      ...makeContext(),
      sourceEntities: [srcEnt],
      targetEntities: [tgtEnt],
      fields: [srcAmount, srcPayment, tgtBalance, tgtPayment],
      entityMappings: [em],
      fieldMappings: [fmAmount, fmPayment],
      onStep: (step) => steps.push(step),
    });

    const optimizerStep = steps.find((step) => step.action === 'optimizer_complete');
    expect(optimizerStep?.metadata).toMatchObject({
      duplicatesResolved: expect.any(Number),
      unmatchedFromDuplicates: expect.any(Number),
      hardBanViolationsRemoved: expect.any(Number),
      typeIncompatibleRemoved: expect.any(Number),
      lookupOutOfScopeRemoved: expect.any(Number),
      requiredFieldsCovered: expect.any(Number),
      requiredFieldsUncovered: expect.any(Number),
      aiFailbackFlagged: expect.any(Number),
    });

    const activeTargets = result.updatedFieldMappings
      .filter((mapping) => mapping.status !== 'rejected' && mapping.status !== 'unmatched')
      .map((mapping) => mapping.targetFieldId);
    expect(new Set(activeTargets).size).toBe(activeTargets.length);

    if (original.openai) process.env.OPENAI_API_KEY = original.openai;
    if (original.anthropic) process.env.ANTHROPIC_API_KEY = original.anthropic;
    if (original.gemini) process.env.GEMINI_API_KEY = original.gemini;
    if (original.geminiLegacy) process.env.GEMINI_KEY = original.geminiLegacy;
    if (original.google) process.env.GOOGLE_API_KEY = original.google;
  });
});

// ─── MappingRationaleAgent ───────────────────────────────────────────────────

describe('MappingRationaleAgent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses LLM only for ambiguity-band mappings and forwards low maxOutputTokens', async () => {
    const agent = new MappingRationaleAgent();
    const activeProviderSpy = vi.spyOn(LLMGateway, 'activeProvider').mockReturnValue('gemini');
    const llmCompleteSpy = vi.spyOn(LLMGateway, 'llmComplete').mockResolvedValue({
      content: 'Both fields represent the same account identity concept.',
      provider: 'gemini',
      tokensUsed: 22,
    });

    const env = {
      min: process.env.RATIONALE_LLM_MIN_CONFIDENCE,
      max: process.env.RATIONALE_LLM_MAX_CONFIDENCE,
      maxCalls: process.env.RATIONALE_MAX_LLM_CALLS,
      maxTokens: process.env.RATIONALE_LLM_MAX_OUTPUT_TOKENS,
    };
    process.env.RATIONALE_LLM_MIN_CONFIDENCE = '0.45';
    process.env.RATIONALE_LLM_MAX_CONFIDENCE = '0.82';
    process.env.RATIONALE_MAX_LLM_CALLS = '5';
    process.env.RATIONALE_LLM_MAX_OUTPUT_TOKENS = '64';

    const srcEnt = makeEntity({ id: 'src-ent', systemId: 'src-sys', name: 'Borrower' });
    const tgtEnt = makeEntity({ id: 'tgt-ent', systemId: 'tgt-sys', name: 'PartyProfile' });
    const src1 = makeField({ id: 'src-1', entityId: 'src-ent', name: 'LegalName', dataType: 'string' });
    const tgt1 = makeField({ id: 'tgt-1', entityId: 'tgt-ent', name: 'Name', dataType: 'string' });
    const src2 = makeField({ id: 'src-2', entityId: 'src-ent', name: 'TaxId', dataType: 'string' });
    const tgt2 = makeField({ id: 'tgt-2', entityId: 'tgt-ent', name: 'TaxId', dataType: 'string' });
    const em: EntityMapping = {
      id: 'em-1',
      projectId: 'proj-1',
      sourceEntityId: 'src-ent',
      targetEntityId: 'tgt-ent',
      confidence: 0.8,
      status: 'suggested',
      notes: null,
    };
    const fmAmbiguous: FieldMapping = {
      id: 'fm-ambiguous',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-1',
      targetFieldId: 'tgt-1',
      confidence: 0.7,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'semantic 0.62',
    };
    const fmHighConfidence: FieldMapping = {
      id: 'fm-high',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-2',
      targetFieldId: 'tgt-2',
      confidence: 0.94,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'semantic 0.98',
    };

    const result = await agent.run({
      ...makeContext(),
      sourceEntities: [srcEnt],
      targetEntities: [tgtEnt],
      fields: [src1, tgt1, src2, tgt2],
      entityMappings: [em],
      fieldMappings: [fmAmbiguous, fmHighConfidence],
    });

    expect(activeProviderSpy).toHaveBeenCalled();
    expect(llmCompleteSpy).toHaveBeenCalledTimes(1);
    expect(llmCompleteSpy.mock.calls[0]?.[1]).toMatchObject({ maxOutputTokens: 64 });
    expect(result.updatedFieldMappings[0]?.rationale ?? '').toContain('LLM insight');
    expect(result.updatedFieldMappings[1]?.rationale ?? '').not.toContain('LLM insight');

    process.env.RATIONALE_LLM_MIN_CONFIDENCE = env.min;
    process.env.RATIONALE_LLM_MAX_CONFIDENCE = env.max;
    process.env.RATIONALE_MAX_LLM_CALLS = env.maxCalls;
    process.env.RATIONALE_LLM_MAX_OUTPUT_TOKENS = env.maxTokens;
  });

  it('still uses LLM for semantic-incompatible mappings even above confidence band', async () => {
    const agent = new MappingRationaleAgent();
    vi.spyOn(LLMGateway, 'activeProvider').mockReturnValue('gemini');
    const llmCompleteSpy = vi.spyOn(LLMGateway, 'llmComplete').mockResolvedValue({
      content: 'Mapping requires business rule review because semantic intent differs.',
      provider: 'gemini',
      tokensUsed: 18,
    });

    const env = {
      min: process.env.RATIONALE_LLM_MIN_CONFIDENCE,
      max: process.env.RATIONALE_LLM_MAX_CONFIDENCE,
    };
    process.env.RATIONALE_LLM_MIN_CONFIDENCE = '0.45';
    process.env.RATIONALE_LLM_MAX_CONFIDENCE = '0.82';

    const srcEnt = makeEntity({ id: 'src-ent', systemId: 'src-sys', name: 'Loan' });
    const tgtEnt = makeEntity({ id: 'tgt-ent', systemId: 'tgt-sys', name: 'Contact' });
    const src = makeField({ id: 'src-amount', entityId: 'src-ent', name: 'AMT_LOAN', dataType: 'decimal' });
    const tgt = makeField({ id: 'tgt-email', entityId: 'tgt-ent', name: 'Email', dataType: 'email' });
    const em: EntityMapping = {
      id: 'em-1',
      projectId: 'proj-1',
      sourceEntityId: 'src-ent',
      targetEntityId: 'tgt-ent',
      confidence: 0.8,
      status: 'suggested',
      notes: null,
    };
    const fm: FieldMapping = {
      id: 'fm-incompatible',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-amount',
      targetFieldId: 'tgt-email',
      confidence: 0.93,
      status: 'suggested',
      transform: { type: 'direct', config: {} },
      rationale: 'semantic 0.22',
    };

    const result = await agent.run({
      ...makeContext(),
      sourceEntities: [srcEnt],
      targetEntities: [tgtEnt],
      fields: [src, tgt],
      entityMappings: [em],
      fieldMappings: [fm],
    });

    expect(llmCompleteSpy).toHaveBeenCalledTimes(1);
    expect(result.updatedFieldMappings[0]?.rationale ?? '').toContain('LLM insight');

    process.env.RATIONALE_LLM_MIN_CONFIDENCE = env.min;
    process.env.RATIONALE_LLM_MAX_CONFIDENCE = env.max;
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

  it('emits embeddings_skipped when no embedding provider key is configured', async () => {
    const spy = vi.spyOn(EmbeddingService, 'buildEmbeddingCache').mockResolvedValue({
      status: 'disabled',
      cache: null,
      attemptedProviders: [],
      reason: 'no embedding provider key found',
    });

    const orchestrator = new OrchestratorAgent();
    const result = await orchestrator.orchestrate(makeContext());

    expect(result.allSteps.some((step) => step.action === 'embeddings_skipped')).toBe(true);
    spy.mockRestore();
  });

  it('emits embeddings_ready when embedding cache builds successfully', async () => {
    const spy = vi.spyOn(EmbeddingService, 'buildEmbeddingCache').mockResolvedValue({
      status: 'ready',
      cache: new Map([
        ['src-fld-1', [1, 0]],
        ['tgt-fld-1', [1, 0]],
      ]),
      attemptedProviders: ['openai'],
      provider: 'openai',
    });

    const orchestrator = new OrchestratorAgent();
    const result = await orchestrator.orchestrate(makeContext());

    expect(result.allSteps.some((step) => step.action === 'embeddings_ready')).toBe(true);
    spy.mockRestore();
  });
});
