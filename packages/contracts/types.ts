// ─── Core domain types ───────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  sourceSystemId: string;
  targetSystemId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Entity {
  id: string;
  systemId: string;
  name: string;
  label?: string;
  description?: string;
}

export interface Field {
  id: string;
  entityId: string;
  name: string;
  label?: string;
  description?: string;
  dataType: string;
  required?: boolean;
  isKey?: boolean;
  isExternalId?: boolean;
  isFormula?: boolean;
  isSystemField?: boolean;
  isAutoNumber?: boolean;
  referenceTo?: string[];
  picklistValues?: string[];
  // Connector metadata
  jxchangeXPath?: string;
  iso20022Name?: string;
  complianceTags?: string[];
  complianceNote?: string;
}

export interface EntityMapping {
  id: string;
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  confidence: number;
  rationale: string;
}

export type RetrievalSemanticMode = 'embedding' | 'alias' | 'intent';

export interface RetrievalShortlistCandidate {
  targetFieldId: string;
  targetFieldName: string;
  retrievalScore: number;
  semanticMode: RetrievalSemanticMode;
  evidence: string[];
}

export interface RetrievalShortlist {
  sourceFieldId: string;
  topK: number;
  candidates: RetrievalShortlistCandidate[];
}

export interface RerankerDecision {
  sourceFieldId: string;
  candidateCount: number;
  selectedTargetFieldId: string;
  selectedTargetFieldName: string;
  finalRank: number;
  confidence: number;
  evidenceSignals: string[];
  reasoning?: string;
  provider?: string;
}

export type OptimizerDisplacementReason =
  | 'hard_ban'
  | 'type_incompatible'
  | 'lookup_out_of_scope'
  | 'duplicate_displaced'
  | 'low_confidence_fallback';

export interface OptimizerDisplacement {
  originalTargetFieldId: string;
  reason: OptimizerDisplacementReason;
  finalAssignment: string | null;
}

export type FieldMappingStatus =
  | 'suggested'
  | 'accepted'
  | 'rejected'
  | 'modified'
  | 'unmatched';

export interface FieldMapping {
  id: string;
  entityMappingId: string;
  sourceFieldId: string;
  targetFieldId: string;
  transform: { type: TransformType; config: Record<string, unknown> };
  confidence: number;
  rationale: string;
  status: FieldMappingStatus;
  seedSource?: 'derived' | 'canonical' | 'agent';
  retrievalShortlist?: RetrievalShortlist;
  rerankerDecision?: RerankerDecision;
  optimizerDisplacement?: OptimizerDisplacement;
  lowConfidenceFallback?: boolean;
}

export interface SeedSummary {
  fromDerived: number;
  fromCanonical: number;
  fromAgent: number;
  total: number;
}

export type UserRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | string;

export type AuditAction =
  | 'mapping_suggested'
  | 'mapping_accepted'
  | 'mapping_rejected'
  | 'mapping_modified'
  | 'conflict_resolved'
  | 'project_created'
  | 'project_exported';

export interface AuditActor {
  userId: string;
  email: string;
  role: UserRole;
}

export interface AuditEntry {
  id: string;
  projectId: string;
  actor: AuditActor;
  action: AuditAction;
  targetType: 'field_mapping' | 'project' | 'conflict';
  targetId: string;
  diff?: {
    before?: unknown;
    after?: unknown;
  };
  timestamp: string;
}

export interface MappingConflict {
  id: string;
  targetFieldId: string;
  targetFieldName: string;
  targetEntityName: string;
  competingMappingIds: string[];
  resolvedWinnerId: string | null;
  detectedAt: string;
  resolvedAt: string | null;
}

export interface ProjectPreflight {
  projectId: string;
  mappedTargetCount: number;
  targetFieldCount: number;
  acceptedMappingsCount: number;
  suggestedMappingsCount: number;
  rejectedMappingsCount: number;
  unmappedRequiredFields: Array<{ id: string; name: string; label?: string }>;
  unresolvedConflicts: number;
  canExport: boolean;
}

export type TransformType =
  | 'direct'
  | 'concat'
  | 'formatDate'
  | 'lookup'
  | 'static'
  | 'regex'
  | 'split'
  | 'trim';

export interface ValidationWarning {
  type: string;
  entityMappingId?: string;
  fieldMappingId?: string;
  message: string;
}

export interface ValidationReport {
  warnings: ValidationWarning[];
  summary: {
    totalWarnings: number;
    typeMismatch: number;
    missingRequired: number;
    picklistCoverage: number;
  };
}

export interface ProjectPayload {
  project: Project;
  sourceEntities: Entity[];
  targetEntities: Entity[];
  fields: Field[];
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
}

export interface SystemSummary {
  id: string;
  name: string;
  type: string;
}

export interface ProjectHistoryItem {
  project: Project;
  sourceSystem?: SystemSummary;
  targetSystem?: SystemSummary;
  fieldMappingCount: number;
  entityMappingCount: number;
  canExport: boolean;
  unresolvedConflicts: number;
}

export interface ProjectListResponse {
  projects: ProjectHistoryItem[];
}

export type LLMRuntimeProvider = 'openai' | 'anthropic' | 'gemini' | 'custom' | 'heuristic';

export interface LLMPublicConfig {
  userId: string;
  mode: 'default' | 'byol';
  paused: boolean;
  provider?: Exclude<LLMRuntimeProvider, 'heuristic'>;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  updatedAt: string;
}

export interface LLMConfigResponse {
  config: LLMPublicConfig;
  effectiveProvider: LLMRuntimeProvider;
  usingDefaultProvider: boolean;
}

export interface LLMUsageEvent {
  id: string;
  createdAt: string;
  userId: string;
  projectId?: string;
  requestId?: string;
  provider: string;
  model?: string;
  tokensUsed?: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface LLMUsageSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
  callsByProvider: Record<string, number>;
  windowHours: number;
}

export interface LLMUsageResponse {
  summary: LLMUsageSummary;
  events: LLMUsageEvent[];
}

// ─── Connector / schema discovery ────────────────────────────────────────────

export type ConnectorId =
  | 'jackhenry-silverlake'
  | 'jackhenry-coredirector'
  | 'jackhenry-symitar'
  | 'salesforce'
  | 'sap';

export interface ConnectorDefinition {
  id: ConnectorId | string;
  name: string;
  vendor: string;
  category: 'core-banking' | 'crm' | 'erp' | 'credit-union';
  description: string;
  logoClass: string; // CSS class applied to .connector-logo div
  entities: string[];
}

// ─── Agent orchestration ──────────────────────────────────────────────────────

export type AgentStatus = 'pending' | 'running' | 'done' | 'error';

export interface AgentStepDef {
  id: string;
  label: string;
  description: string;
}

export interface AgentStepState {
  id: string;
  label: string;
  status: AgentStatus;
  output?: string;
  startedAt?: number;
  finishedAt?: number;
}

// SSE event shapes from /api/projects/:id/orchestrate
export type OrchestrationEventType =
  | 'agent_start'
  | 'agent_complete'
  | 'pipeline_complete'
  | 'error';

export interface OrchestrationEvent {
  event: OrchestrationEventType;
  agent?: string;
  step?: number;
  output?: string;
  entityMappings?: EntityMapping[];
  fieldMappings?: FieldMapping[];
  validation?: ValidationReport;
  totalMappings?: number;
  complianceFlags?: number;
  processingMs?: number;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export type ExportFormat = 'json' | 'yaml' | 'csv' | 'dataweave' | 'boomi' | 'workato';

export interface ExportFormatDef {
  id: ExportFormat;
  label: string;
  description: string;
  ext: string;
  category: 'standard' | 'ipaas';
}

// ─── App workflow steps ───────────────────────────────────────────────────────

export type WorkflowStep = 'command-center' | 'connect' | 'llm-settings' | 'orchestrate' | 'review' | 'export';
