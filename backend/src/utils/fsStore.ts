import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AppState,
  Entity,
  Field,
  FieldMapping,
  MappingProject,
  Relationship,
  System,
} from '../types.js';

const EMPTY_STATE: AppState = {
  systems: [],
  entities: [],
  fields: [],
  relationships: [],
  projects: [],
  entityMappings: [],
  fieldMappings: [],
};

export class FsStore {
  private readonly dbPath: string;
  private state: AppState;

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'db.json');
    this.state = this.load();
  }

  private load(): AppState {
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify(EMPTY_STATE, null, 2), 'utf8');
      return structuredClone(EMPTY_STATE);
    }
    return JSON.parse(fs.readFileSync(this.dbPath, 'utf8')) as AppState;
  }

  private persist() {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  getState(): AppState {
    return this.state;
  }

  createProject(name: string): MappingProject {
    const now = new Date().toISOString();
    const sourceSystem: System = { id: uuidv4(), name: 'SAP', type: 'sap' };
    const targetSystem: System = { id: uuidv4(), name: 'Salesforce', type: 'salesforce' };

    this.state.systems.push(sourceSystem, targetSystem);

    const project: MappingProject = {
      id: uuidv4(),
      name,
      sourceSystemId: sourceSystem.id,
      targetSystemId: targetSystem.id,
      createdAt: now,
      updatedAt: now,
    };
    this.state.projects.push(project);
    this.persist();
    return project;
  }

  updateProjectTimestamp(projectId: string) {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.updatedAt = new Date().toISOString();
    this.persist();
  }

  getProject(projectId: string): MappingProject | undefined {
    return this.state.projects.find((p) => p.id === projectId);
  }

  replaceSystemSchema(
    systemId: string,
    entities: Entity[],
    fields: Field[],
    relationships: Relationship[],
  ) {
    const entityIds = new Set(this.state.entities.filter((e) => e.systemId === systemId).map((e) => e.id));
    this.state.entities = this.state.entities.filter((e) => e.systemId !== systemId).concat(entities);
    this.state.fields = this.state.fields.filter((f) => !entityIds.has(f.entityId)).concat(fields);
    this.state.relationships = this.state.relationships
      .filter((r) => !entityIds.has(r.fromEntityId) && !entityIds.has(r.toEntityId))
      .concat(relationships);
    this.persist();
  }

  clearProjectMappings(projectId: string) {
    const entityMappingIds = new Set(
      this.state.entityMappings.filter((m) => m.projectId === projectId).map((m) => m.id),
    );
    this.state.entityMappings = this.state.entityMappings.filter((m) => m.projectId !== projectId);
    this.state.fieldMappings = this.state.fieldMappings.filter((m) => !entityMappingIds.has(m.entityMappingId));
    this.persist();
  }

  upsertMappings(projectId: string, entityMappings: AppState['entityMappings'], fieldMappings: FieldMapping[]) {
    this.clearProjectMappings(projectId);
    this.state.entityMappings.push(...entityMappings);
    this.state.fieldMappings.push(...fieldMappings);
    this.updateProjectTimestamp(projectId);
  }

  patchFieldMapping(
    fieldMappingId: string,
    patch: Partial<Pick<FieldMapping, 'status' | 'confidence' | 'rationale' | 'targetFieldId' | 'sourceFieldId' | 'transform'>>,
  ): FieldMapping | undefined {
    const mapping = this.state.fieldMappings.find((m) => m.id === fieldMappingId);
    if (!mapping) return undefined;
    Object.assign(mapping, patch);
    this.persist();
    return mapping;
  }
}
