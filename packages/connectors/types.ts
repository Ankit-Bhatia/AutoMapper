export type SystemType = 'salesforce' | 'sap' | 'jackhenry' | 'generic';

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

export interface Field {
  id: string;
  entityId: string;
  name: string;
  label?: string;
  dataType: DataType;
  length?: number;
  precision?: number;
  scale?: number;
  required?: boolean;
  isKey?: boolean;
  isExternalId?: boolean;
  picklistValues?: string[];
  // Connector metadata — populated by Jack Henry / SAP / Salesforce connectors
  jxchangeXPath?: string;        // e.g. "CIFInq.Rs.CIFRec.CIFInfo.TaxId"
  jxchangeXtendElemKey?: string; // Core Director XtendElem override key
  iso20022Name?: string;         // ISO 20022 canonical name e.g. "TaxIdentification"
  complianceTags?: string[];     // e.g. ["GLBA_NPI", "BSA_AML"]
  complianceNote?: string;       // human-readable compliance caveat
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
}

export interface EntityMapping {
  id: string;
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  confidence: number;
  rationale: string;
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
  status: 'suggested' | 'accepted' | 'rejected' | 'modified';
}

export interface ValidationWarning {
  type: 'type_mismatch' | 'missing_required' | 'picklist_coverage';
  entityMappingId: string;
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

export interface AppState {
  systems: System[];
  entities: Entity[];
  fields: Field[];
  relationships: Relationship[];
  projects: MappingProject[];
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
}

export interface SuggestMappingsResponse {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  validation: ValidationReport;
}
