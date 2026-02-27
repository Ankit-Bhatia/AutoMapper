/**
 * OrchestratorAgent — coordinates the full multi-agent mapping pipeline.
 *
 * Execution order:
 *   1. SchemaDiscoveryAgent     (enriches schema — sequential, always)
 *   2. ComplianceAgent          (flags compliance issues — sequential, always)
 *   3. Domain agents            (sequential — only applicable ones run)
 *      ├─ BankingDomainAgent    (if sourceSystemType === 'jackhenry')
 *      ├─ CRMDomainAgent        (if targetSystemType === 'salesforce')
 *      └─ ERPDomainAgent        (if sourceSystemType === 'sap')
 *   4. MappingProposalAgent     (LLM — if provider available)
 *   5. MappingRationaleAgent    (always — generates human-readable mapping intent)
 *   6. ValidationAgent          (always — final pass)
 *
 * Each step's field mappings feed into the next agent (pipeline pattern).
 * All onStep events are forwarded to the caller for SSE streaming.
 */
import { AgentBase } from './AgentBase.js';
import { SchemaDiscoveryAgent } from './SchemaDiscoveryAgent.js';
import { ComplianceAgent } from './ComplianceAgent.js';
import { BankingDomainAgent } from './BankingDomainAgent.js';
import { CRMDomainAgent } from './CRMDomainAgent.js';
import { ERPDomainAgent } from './ERPDomainAgent.js';
import { MappingProposalAgent } from './MappingProposalAgent.js';
import { MappingRationaleAgent } from './MappingRationaleAgent.js';
import { ValidationAgent } from './ValidationAgent.js';
import type { AgentContext, AgentResult, AgentStep, ComplianceReport } from './types.js';
import type { FieldMapping } from '../types.js';

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
  private complianceAgent = new ComplianceAgent();
  private bankingAgent = new BankingDomainAgent();
  private crmAgent = new CRMDomainAgent();
  private erpAgent = new ERPDomainAgent();
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

    // Wrap onStep to collect all steps
    const wrappedContext: AgentContext = {
      ...context,
      onStep: (step) => {
        allSteps.push(step);
        context.onStep?.(step);
      },
    };

    this.info(wrappedContext, 'orchestrate_start',
      `Starting pipeline: source=${context.sourceSystemType}, target=${context.targetSystemType}, mappings=${context.fieldMappings.length}`);

    let currentMappings = context.fieldMappings;

    // ── 1. Schema Discovery ──────────────────────────────────────────────────
    const schemaResult = await this.schemaAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    currentMappings = schemaResult.updatedFieldMappings;
    agentsRun.push(this.schemaAgent.name);

    // ── 2. Compliance ────────────────────────────────────────────────────────
    const complianceResult = await this.complianceAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    currentMappings = complianceResult.updatedFieldMappings;
    agentsRun.push(this.complianceAgent.name);

    // ── 3. Domain agents (sequential) ────────────────────────────────────────
    const domainAgents: AgentBase[] = [];
    if (context.sourceSystemType === 'jackhenry') domainAgents.push(this.bankingAgent);
    if (context.targetSystemType === 'salesforce') domainAgents.push(this.crmAgent);
    if (context.sourceSystemType === 'sap') domainAgents.push(this.erpAgent);

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

    // ── 4. LLM Mapping Proposal ──────────────────────────────────────────────
    const proposalResult = await this.mappingAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    totalImproved += proposalResult.totalImproved;
    currentMappings = proposalResult.updatedFieldMappings;
    agentsRun.push(this.mappingAgent.name);

    // ── 5. Mapping Rationale ─────────────────────────────────────────────────
    // Generates human-readable intent explanations for each field mapping.
    // Runs after LLM proposal so it can capture AI-refined confidence scores.
    const rationaleResult = await this.rationaleAgent.run({ ...wrappedContext, fieldMappings: currentMappings });
    currentMappings = rationaleResult.updatedFieldMappings;
    agentsRun.push(this.rationaleAgent.name);

    // ── 6. Validation ────────────────────────────────────────────────────────
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
