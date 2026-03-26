import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AppState,
  AuditEntry,
  Entity,
  Field,
  FieldMapping,
  MappingProject,
  OneToManyResolution,
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
  auditEntries: [],
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
    const loaded = JSON.parse(fs.readFileSync(this.dbPath, 'utf8')) as Partial<AppState>;
    return {
      ...EMPTY_STATE,
      ...loaded,
      projects: Array.isArray(loaded.projects)
        ? loaded.projects.map((project) => ({
          ...project,
          archived: project.archived ?? false,
        }))
        : [],
      auditEntries: Array.isArray(loaded.auditEntries) ? loaded.auditEntries : [],
    };
  }

  private persist() {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  getState(): AppState {
    return this.state;
  }

  appendAuditEntry(entry: AuditEntry) {
    this.state.auditEntries.push(entry);
    this.persist();
  }

  listAuditEntries(
    projectId: string,
    opts: { limit: number; before?: string | null },
  ): { entries: AuditEntry[]; nextBefore: string | null } {
    const beforeMs = opts.before ? Date.parse(opts.before) : Number.NaN;
    const filtered = this.state.auditEntries
      .filter((entry) => entry.projectId === projectId)
      .filter((entry) => Number.isNaN(beforeMs) || Date.parse(entry.timestamp) < beforeMs)
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
    const entries = filtered.slice(0, opts.limit);
    const nextBefore = filtered.length > opts.limit
      ? entries[entries.length - 1]?.timestamp ?? null
      : null;
    return { entries, nextBefore };
  }

  createProject(
    name: string,
    _userId?: string,
    sourceSystemName = 'SAP',
    targetSystemName = 'Salesforce',
  ): MappingProject {
    const now = new Date().toISOString();
    const sourceSystem: System = {
      id: uuidv4(),
      name: sourceSystemName,
      type: inferSystemType(sourceSystemName),
    };
    const targetSystem: System = {
      id: uuidv4(),
      name: targetSystemName,
      type: inferSystemType(targetSystemName),
    };

    this.state.systems.push(sourceSystem, targetSystem);

    const project: MappingProject = {
      id: uuidv4(),
      name,
      sourceSystemId: sourceSystem.id,
      targetSystemId: targetSystem.id,
      createdAt: now,
      updatedAt: now,
      archived: false,
      resolvedOneToManyMappings: {},
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

  updateProjectResolvedOneToManyMappings(
    projectId: string,
    resolvedOneToManyMappings: Record<string, OneToManyResolution>,
  ): MappingProject | undefined {
    const project = this.state.projects.find((candidate) => candidate.id === projectId);
    if (!project) return undefined;
    project.resolvedOneToManyMappings = resolvedOneToManyMappings;
    project.updatedAt = new Date().toISOString();
    this.persist();
    return project;
  }

  patchProject(
    projectId: string,
    patch: Partial<Pick<MappingProject, 'name' | 'archived'>>,
  ): MappingProject | undefined {
    const project = this.state.projects.find((candidate) => candidate.id === projectId);
    if (!project) return undefined;
    if (patch.name !== undefined) {
      project.name = patch.name;
    }
    if (patch.archived !== undefined) {
      project.archived = patch.archived;
    }
    project.updatedAt = new Date().toISOString();
    this.persist();
    return project;
  }

  duplicateProject(projectId: string): MappingProject | undefined {
    const original = this.state.projects.find((candidate) => candidate.id === projectId);
    if (!original) return undefined;

    const now = new Date().toISOString();
    const duplicate: MappingProject = {
      ...structuredClone(original),
      id: uuidv4(),
      name: `Copy of ${original.name}`,
      createdAt: now,
      updatedAt: now,
      archived: false,
      resolvedOneToManyMappings: structuredClone(original.resolvedOneToManyMappings ?? {}),
    };

    const entityMappings = this.state.entityMappings.filter((mapping) => mapping.projectId === projectId);
    const entityMappingIds = new Set(entityMappings.map((mapping) => mapping.id));
    const fieldMappings = this.state.fieldMappings.filter((mapping) => entityMappingIds.has(mapping.entityMappingId));
    const entityMappingIdMap = new Map<string, string>();

    const duplicatedEntityMappings = entityMappings.map((mapping) => {
      const nextId = uuidv4();
      entityMappingIdMap.set(mapping.id, nextId);
      return {
        ...structuredClone(mapping),
        id: nextId,
        projectId: duplicate.id,
      };
    });

    const duplicatedFieldMappings = fieldMappings.map((mapping) => ({
      ...structuredClone(mapping),
      id: uuidv4(),
      entityMappingId: entityMappingIdMap.get(mapping.entityMappingId) ?? mapping.entityMappingId,
    }));

    this.state.projects.push(duplicate);
    this.state.entityMappings.push(...duplicatedEntityMappings);
    this.state.fieldMappings.push(...duplicatedFieldMappings);
    this.persist();
    return duplicate;
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
    patch: Partial<Pick<FieldMapping, 'status' | 'confidence' | 'rationale' | 'targetFieldId' | 'sourceFieldId' | 'transform' | 'retrievalShortlist' | 'rerankerDecision' | 'optimizerDisplacement' | 'lowConfidenceFallback'>>,
  ): FieldMapping | undefined {
    const mapping = this.state.fieldMappings.find((m) => m.id === fieldMappingId);
    if (!mapping) return undefined;
    Object.assign(mapping, patch);
    this.persist();
    return mapping;
  }

  patchField(
    fieldId: string,
    patch: Partial<Pick<Field, 'required' | 'complianceTags'>>,
  ): Field | undefined {
    const field = this.state.fields.find((candidate) => candidate.id === fieldId);
    if (!field) return undefined;
    if (patch.required !== undefined) {
      field.required = patch.required;
    }
    if (patch.complianceTags !== undefined) {
      field.complianceTags = [...patch.complianceTags];
    }
    this.persist();
    return field;
  }
}

function inferSystemType(name: string): System['type'] {
  const n = name.toLowerCase();
  if (n.includes('salesforce')) return 'salesforce';
  if (n.includes('sap')) return 'sap';
  if (n.includes('jackhenry') || n.includes('silverlake') || n.includes('coredirector') || n.includes('symitar')) {
    return 'jackhenry';
  }
  if (n.includes('riskclam') || n.includes('risk clam') || n.includes('bosl')) {
    return 'riskclam';
  }
  return 'generic';
}
