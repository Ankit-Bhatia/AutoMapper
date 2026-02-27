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
  dataType: string;
  required?: boolean;
  isKey?: boolean;
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

export interface FieldMapping {
  id: string;
  entityMappingId: string;
  sourceFieldId: string;
  targetFieldId: string;
  transform: { type: TransformType; config: Record<string, unknown> };
  confidence: number;
  rationale: string;
  status: 'suggested' | 'accepted' | 'rejected' | 'modified';
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

export type WorkflowStep = 'connect' | 'orchestrate' | 'review' | 'export';
