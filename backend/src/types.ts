export type SystemType = 'salesforce' | 'sap' | 'jackhenry' | 'riskclam' | 'generic';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  createdAt: string;
  updatedAt: string;
}

export type DataType =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'picklist'
  | 'email'
  | 'phone'
  | 'id'
  | 'reference'
  | 'unknown';

export interface System {
  id: string;
  name: string;
  type: SystemType;
}

export interface Entity {
  id: string;
  systemId: string;
  name: string;
  label?: string;
  description?: string;
}

export interface RecordType {
  id?: string;
  name: string;
  developerName?: string;
  active?: boolean;
  entityName?: string;
}

export interface Field {
  id: string;
  entityId: string;
  name: string;
  label?: string;
  description?: string;
  dataType: DataType;
  length?: number;
  precision?: number;
  scale?: number;
  required?: boolean;
  isKey?: boolean;
  isExternalId?: boolean;
  isFormula?: boolean;
  isSystemField?: boolean;
  isAutoNumber?: boolean;
  referenceTo?: string[];
  picklistValues?: string[];
  // Connector metadata — populated by Jack Henry / SAP / Salesforce connectors
  jxchangeXPath?: string;        // e.g. "CIFInq.Rs.CIFRec.CIFInfo.TaxId"
  jxchangeXtendElemKey?: string; // Core Director XtendElem override key
  iso20022Name?: string;         // ISO 20022 canonical name e.g. "TaxIdentification"
  complianceTags?: string[];     // e.g. ["GLBA_NPI", "BSA_AML"]
  complianceNote?: string;       // human-readable compliance caveat
  validationRules?: FieldValidationRule[];
}

export interface FieldValidationRule {
  name: string;
  entityName: string;
  errorMessage?: string;
  description?: string;
  errorDisplayField?: string;
  referencedFields?: string[];
  kind?: 'rule' | 'unavailable';
}

export interface Relationship {
  fromEntityId: string;
  toEntityId: string;
  type: 'lookup' | 'masterdetail' | 'parentchild';
  viaField?: string;
}

export interface MappingProject {
  id: string;
  name: string;
  sourceSystemId: string;
  targetSystemId: string;
  createdAt: string;
  updatedAt: string;
  resolvedOneToManyMappings?: Record<string, OneToManyResolution>;
}

export interface OneToManyResolution {
  sourceFieldId: string;
  sourceFieldName: string;
  targetFieldId: string;
  targetFieldName: string;
  targetObject?: string;
  resolvedAt: string;
}

export interface SchemaIntelligencePatternCandidate {
  xmlField: string;
  normalizedFieldKey: string;
  targetFieldName: string;
  targetObject: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
  isOneToMany: boolean;
  isFormulaTarget: boolean;
  isPersonAccountOnly: boolean;
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

export type TransformType =
  | 'direct'
  | 'concat'
  | 'formatDate'
  | 'lookup'
  | 'static'
  | 'regex'
  | 'split'
  | 'trim';

export interface FieldMapping {
  id: string;
  entityMappingId: string;
  sourceFieldId: string;
  targetFieldId: string;
  transform: {
    type: TransformType;
    config: Record<string, unknown>;
  };
  confidence: number;
  rationale: string;
  status: FieldMappingStatus;
  seedSource?: 'derived' | 'canonical' | 'agent';
  retrievalShortlist?: RetrievalShortlist;
  rerankerDecision?: RerankerDecision;
  optimizerDisplacement?: OptimizerDisplacement;
  lowConfidenceFallback?: boolean;
}

export interface ValidationWarning {
  type:
    | 'type_mismatch'
    | 'missing_required'
    | 'picklist_coverage'
    | 'validation_rule'
    | 'partial_coverage_risk'
    | 'validation_rules_unavailable';
  entityMappingId: string;
  fieldMappingId?: string;
  message: string;
}

export interface ValidationRuleSafetySummary {
  evaluatedRuleCount: number;
  fullyCoveredRuleCount: number;
  partialCoverageRiskCount: number;
  genericWarningCount: number;
  unavailableCount: number;
}

export interface ValidationReport {
  warnings: ValidationWarning[];
  summary: {
    totalWarnings: number;
    typeMismatch: number;
    missingRequired: number;
    picklistCoverage: number;
    validationRule: number;
    partialCoverageRisk?: number;
    validationRulesUnavailable?: number;
  };
  validationRuleSafety?: ValidationRuleSafetySummary;
}

export interface AppState {
  systems: System[];
  entities: Entity[];
  fields: Field[];
  relationships: Relationship[];
  projects: MappingProject[];
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  auditEntries: AuditEntry[];
}

export interface SuggestMappingsResponse {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  validation: ValidationReport;
}

export interface SeedSummary {
  fromDerived: number;
  fromCanonical: number;
  fromAgent: number;
  total: number;
}

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
  role: string;
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
