/**
 * OrchestratorAgent — coordinates the full multi-agent mapping pipeline.
 *
 * Execution order:
 *   1. SchemaDiscoveryAgent       (enriches schema — sequential, always)
 *   2. SchemaIntelligenceAgent    (FSC pattern corpus + one-to-many flags — when target === 'salesforce')
 *   3. ComplianceAgent            (flags compliance issues — sequential, always)
 *   4. Domain agents              (sequential — only applicable ones run)
 *      ├─ BankingDomainAgent      (if sourceSystemType === 'jackhenry')
 *      ├─ CRMDomainAgent          (if targetSystemType === 'salesforce')
 *      ├─ ERPDomainAgent          (if sourceSystemType === 'sap')
 *      └─ RiskClamDomainAgent     (if sourceSystemType === 'riskclam')
 *   5. MappingProposalAgent       (LLM — if provider available)
 *   6. MappingRationaleAgent      (always — generates human-readable mapping intent)
 *   7. ValidationAgent            (always — final pass)
 *
 * Each step's field mappings feed into the next agent (pipeline pattern).
 * All onStep events are forwarded to the caller for SSE streaming.
 */
import { AgentBase } from './AgentBase.js';
import { SchemaDiscoveryAgent } from './SchemaDiscoveryAgent.js';
import { SchemaIntelligenceAgent } from './SchemaIntelligenceAgent.js';
import { ComplianceAgent } from './ComplianceAgent.js';
import { BankingDomainAgent } from './BankingDomainAgent.js';
import { CRMDomainAgent } from './CRMDomainAgent.js';
import { ERPDomainAgent } from './ERPDomainAgent.js';
import { RiskClamDomainAgent } from './RiskClamDomainAgent.js';
import { MappingProposalAgent } from './MappingProposalAgent.js';
import { MappingRationaleAgent } from './MappingRationaleAgent.js';
import { ValidationAgent } from './ValidationAgent.js';
import type { AgentContext, AgentResult, AgentStep, ComplianceReport } from './types.js';
import type { FieldMapping } from '../types.js';
import { buildEmbeddingCache } from '../services/EmbeddingService.js';
import { buildRelationshipGraph } from '../services/relationshipGraph.js';

export interface OrchestratorResult {
  updatedFieldMappings: FieldMapping[];
  allSteps: AgentStep[];
  totalImproved: number;
  complianceReport: ComplianceReport | null;
  agentsRun: string[];
  durationMs: number;
}

export class OrchestratorAgent extends AgentBase {
  readonly name = 'OrchestratorAgent';

  private schemaAgent = new SchemaDiscoveryAgent();
  private schemaIntelligenceAgent = new SchemaIntelligenceAgent();
  private complianceAgent = new ComplianceAgent();
  private bankingAgent = new BankingDomainAgent();
  private crmAgent = new CRMDomainAgent();
  private erpAgent = new ERPDomainAgent();
  private riskClamAgent = new RiskClamDomainAgent();
  private mappingAgent = new MappingProposalAgent();
  private rationaleAgent = new MappingRationaleAgent();
  private validationAgent = new ValidationAgent();

  /**
   * Run the full agent pipeline.
   * Returns an OrchestratorResult (superset of AgentResult).
   */
  async orchestrate(context: AgentContext): Promise<OrchestratorResult> {
    const pipelineStart = Date.now();
    const allSteps: AgentStep[] = [];
    const agentsRun: string[] = [];
    let totalImproved = 0;

    // ── Pre-compute field embeddings ─────────────────────────────────────────
    // Batch-fetch once before the pipeline so MappingProposalAgent can blend
    // embedding cosine similarity into its semantic score without extra API calls.
    // Falls back to null (intent-only scoring) if no embedding provider key exists.
    const embedStart = Date.now();
    const entityNamesById = new Map([
      ...context.sourceEntities.map((entity) => [entity.id, entity.name] as const),
      ...context.targetEntities.map((entity) => [entity.id, entity.name] as const),
    ]);
    const embeddingResult = await buildEmbeddingCache(context.fields, { entityNamesById });
    const embedMs = Date.now() - embedStart;

    // Wrap onStep to collect all steps
    const wrappedContext: AgentContext = {
      ...context,
      embeddingCache: embeddingResult.cache ?? undefined,
      relationshipGraph: context.relationshipGraph
        ?? buildRelationshipGraph(
          [...context.sourceEntities, ...context.targetEntities],
          context.relationships ?? [],
        ),
      onStep: (step) => {
        allSteps.push(step);
        context.onStep?.(step);
      },
    };

    if (embeddingResult.status === 'ready' && embeddingResult.cache) {
      this.info(
        wrappedContext,
        'embeddings_ready',
        `Embedding cache built via ${embeddingResult.provider}${embeddingResult.fallbackFrom ? ` (fallback from ${embeddingResult.fallbackFrom})` : ''}: ${embeddingResult.cache.size} field vectors in ${embedMs}ms`,
        {
          fieldCount: embeddingResult.cache.size,
          durationMs: embedMs,
          provider: embeddingResult.provider,
          fallbackFrom: embeddingResult.fallbackFrom,
        },
      );
    } else if (embeddingResult.status === 'disabled') {
      this.info(
        wrappedContext,
        'embeddings_skipped',
        `${embeddingResult.reason ?? 'Embeddings disabled'} — using concept + intent semantic scoring`,
        { reason: embeddingResult.reason },
      );
    } else {
      this.info(
        wrappedContext,
        'embeddings_failed',
        `${embeddingResult.reason ?? 'Embedding provider failed'} — continuing with concept + intent semantic scoring`,
        {
          reason: embeddingResult.reason,
          attemptedProviders: embeddingResult.attemptedProviders,
        },
      );
    }

    this.info(wrappedContext, 'orchestrate_start',
      `Starting pipeline: source=${context.sourceSystemType}, target=${context.targetSystemType}, mappings=${context.fieldMappings.length}`);

    let currentMappings = context.fieldMappings;

    // ── 1. Schema Discovery ──────────────────────────────────────────────────
    const schemaResult = await this.schemaAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    currentMappings = schemaResult.updatedFieldMappings;
    agentsRun.push(this.schemaAgent.name);

    // ── 2. Schema Intelligence ────────────────────────────────────────────────
    // Applies the 212-pattern BOSL→FSC confirmed corpus, detects one-to-many
    // fields, flags formula field targets, and annotates with Caribbean domain
    // context. Runs before ComplianceAgent so enriched rationales are available.
    const schemaIntelResult = await this.schemaIntelligenceAgent.run({
      ...wrappedContext,
      fieldMappings: currentMappings,
    });
    currentMappings = schemaIntelResult.updatedFieldMappings;
    totalImproved += schemaIntelResult.totalImproved;
    agentsRun.push(this.schemaIntelligenceAgent.name);

    // ── 3. Compliance ────────────────────────────────────────────────────────
    const complianceResult = await this.complianceAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    currentMappings = complianceResult.updatedFieldMappings;
    agentsRun.push(this.complianceAgent.name);

    // ── 4. Domain agents (sequential) ────────────────────────────────────────
    const domainAgents: AgentBase[] = [];
    if (context.sourceSystemType === 'jackhenry') domainAgents.push(this.bankingAgent);
    if (context.targetSystemType === 'salesforce') domainAgents.push(this.crmAgent);
    if (context.sourceSystemType === 'sap') domainAgents.push(this.erpAgent);
    if (context.sourceSystemType === 'riskclam') domainAgents.push(this.riskClamAgent);

    for (const agent of domainAgents) {
      const domainResult = await agent.run({ ...wrappedContext, fieldMappings: currentMappings });

      // Keep the highest-confidence candidate per mapping while preserving sequence.
      const mergedMappings = currentMappings.map((mapping) => {
        const candidate = domainResult.updatedFieldMappings.find((m) => m.id === mapping.id);
        if (candidate && candidate.confidence > mapping.confidence) {
          return candidate;
        }
        return mapping;
      });

      const domainImproved = mergedMappings.filter(
        (m, i) => m.confidence > currentMappings[i].confidence,
      ).length;

      currentMappings = mergedMappings;
      totalImproved += domainImproved;
      agentsRun.push(agent.name);
    }

    // ── 5. LLM Mapping Proposal ──────────────────────────────────────────────
    const proposalResult = await this.mappingAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    totalImproved += proposalResult.totalImproved;
    currentMappings = proposalResult.updatedFieldMappings;
    agentsRun.push(this.mappingAgent.name);

    // ── 6. Mapping Rationale ─────────────────────────────────────────────────
    // Generates human-readable intent explanations for each field mapping.
    // Runs after LLM proposal so it can capture AI-refined confidence scores.
    const rationaleResult = await this.rationaleAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    currentMappings = rationaleResult.updatedFieldMappings;
    agentsRun.push(this.rationaleAgent.name);

    // ── 7. Validation ────────────────────────────────────────────────────────
    const validationResult = await this.validationAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    currentMappings = validationResult.updatedFieldMappings;
    agentsRun.push(this.validationAgent.name);

    const durationMs = Date.now() - pipelineStart;

    this.info(
      wrappedContext,
      'orchestrate_complete',
      `Pipeline complete in ${durationMs}ms — ${totalImproved} total mappings improved across ${agentsRun.length} agents`,
      { agentsRun, totalImproved, durationMs },
    );

    return {
      updatedFieldMappings: currentMappings,
      allSteps,
      totalImproved,
      complianceReport: this.complianceAgent.lastReport,
      agentsRun,
      durationMs,
    };
  }

  /** Implements AgentBase.run() — delegates to orchestrate() */
  async run(context: AgentContext): Promise<AgentResult> {
    const result = await this.orchestrate(context);
    return {
      agentName: this.name,
      updatedFieldMappings: result.updatedFieldMappings,
      steps: result.allSteps,
      totalImproved: result.totalImproved,
      metadata: {
        agentsRun: result.agentsRun,
        complianceReport: result.complianceReport,
        durationMs: result.durationMs,
      },
    };
  }
}
