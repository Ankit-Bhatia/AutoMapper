/**
 * Agent type system — shared contracts for all AutoMapper agents.
 *
 * The agent hierarchy:
 *   OrchestratorAgent
 *     ├─ SchemaDiscoveryAgent   (enriches raw schema with semantic annotations)
 *     ├─ ComplianceAgent        (validates regulatory tagging and flags risks)
 *     ├─ BankingDomainAgent     (Jack Henry SilverLake / Symitar heuristics)
 *     ├─ CRMDomainAgent         (Salesforce object/field heuristics)
 *     ├─ ERPDomainAgent         (SAP BAPI/IDoc heuristics)
 *     ├─ MappingProposalAgent   (LLM-assisted mapping generation)
 *     └─ ValidationAgent        (type-compatibility + coverage checks)
 */
import type { SystemType, Entity, Field, EntityMapping, FieldMapping } from '../types.js';
import type { ConnectorField, ComplianceTag } from '../connectors/IConnector.js';

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * Context passed to every agent.run() call.
 * Agents must never mutate context — they return updated mappings via AgentResult.
 */
export interface AgentContext {
  projectId: string;
  sourceSystemType: SystemType;
  targetSystemType: SystemType;
  /** Source-system entities */
  sourceEntities: Entity[];
  /** Target-system entities */
  targetEntities: Entity[];
  /** All fields (source + target). Use field.entityId to identify ownership. */
  fields: (Field | ConnectorField)[];
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  /** Called by agents to emit progress events (used for SSE streaming) */
  onStep?: (step: AgentStep) => void;
}

// ─── Step (progress event) ────────────────────────────────────────────────────

/**
 * A single reported action from an agent.
 * Emitted via AgentContext.onStep and streamed to the client over SSE.
 */
export interface AgentStep {
  /** Name of the agent emitting this step */
  agentName: string;
  /** Short machine-readable action label (e.g. "rescore", "compliance_flag") */
  action: string;
  /** Human-readable description for UI display */
  detail: string;
  /** If this step relates to a specific field mapping */
  fieldMappingId?: string;
  /** Mapping state before the change */
  before?: Partial<FieldMapping>;
  /** Mapping state after the change */
  after?: Partial<FieldMapping>;
  /** Wall-clock time this step took */
  durationMs: number;
  /** Agent-specific extras (e.g. compliance rule, LLM tokens used) */
  metadata?: Record<string, unknown>;
}

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * Result returned by every agent.run() call.
 */
export interface AgentResult {
  agentName: string;
  /** The full updated list of field mappings (may be unchanged if nothing improved) */
  updatedFieldMappings: FieldMapping[];
  /** All steps emitted during the run */
  steps: AgentStep[];
  /** Count of field mappings whose confidence changed positively */
  totalImproved: number;
  /** Agent-specific output metadata */
  metadata?: Record<string, unknown>;
}

// ─── Compliance report ────────────────────────────────────────────────────────

export interface ComplianceIssue {
  severity: 'error' | 'warning' | 'info';
  /** Machine-readable rule code */
  rule: string;
  /** Human-readable description */
  message: string;
  fieldMappingId?: string;
  sourceFieldName?: string;
  targetFieldName?: string;
  complianceTags?: ComplianceTag[];
}

export interface ComplianceReport {
  issues: ComplianceIssue[];
  totalErrors: number;
  totalWarnings: number;
  piiFieldCount: number;
  pciFieldCount: number;
  sox_financialFieldCount: number;
}

// ─── LLM types ────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  /** Provider used (openai | anthropic | heuristic) */
  provider: string;
  /** Approximate tokens used, if available */
  tokensUsed?: number;
}

export type LLMProvider = 'openai' | 'anthropic' | 'heuristic';
