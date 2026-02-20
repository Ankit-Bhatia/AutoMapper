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
}

export interface Field {
  id: string;
  entityId: string;
  name: string;
  label?: string;
  dataType: string;
  required?: boolean;
  picklistValues?: string[];
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
  transform: { type: string; config: Record<string, unknown> };
  confidence: number;
  rationale: string;
  status: 'suggested' | 'accepted' | 'rejected' | 'modified';
}

export interface ValidationReport {
  warnings: Array<{ type: string; message: string }>;
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
