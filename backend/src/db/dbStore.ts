import { v4 as uuidv4 } from 'uuid';
import type { PrismaClient } from '@prisma/client';
import type {
  AppState,
  Entity,
  Field,
  FieldMapping,
  MappingProject,
  Relationship,
  System,
  TransformType,
} from '../types.js';

function toSystem(s: { id: string; name: string; type: string }): System {
  return { id: s.id, name: s.name, type: s.type as System['type'] };
}

function toEntity(e: { id: string; systemId: string; name: string; label: string | null; description: string | null }): Entity {
  return {
    id: e.id,
    systemId: e.systemId,
    name: e.name,
    label: e.label ?? undefined,
    description: e.description ?? undefined,
  };
}

function toField(f: {
  id: string;
  entityId: string;
  name: string;
  label: string | null;
  dataType: string;
  length: number | null;
  precision: number | null;
  scale: number | null;
  required: boolean;
  isKey: boolean;
  isExternalId: boolean;
  picklistValues: string[];
  jxchangeXPath: string | null;
  jxchangeXtendElemKey: string | null;
  iso20022Name: string | null;
  complianceTags: string[];
  complianceNote: string | null;
}): Field {
  return {
    id: f.id,
    entityId: f.entityId,
    name: f.name,
    label: f.label ?? undefined,
    dataType: f.dataType as Field['dataType'],
    length: f.length ?? undefined,
    precision: f.precision ?? undefined,
    scale: f.scale ?? undefined,
    required: f.required,
    isKey: f.isKey,
    isExternalId: f.isExternalId,
    picklistValues: f.picklistValues,
    jxchangeXPath: f.jxchangeXPath ?? undefined,
    jxchangeXtendElemKey: f.jxchangeXtendElemKey ?? undefined,
    iso20022Name: f.iso20022Name ?? undefined,
    complianceTags: f.complianceTags.length ? f.complianceTags : undefined,
    complianceNote: f.complianceNote ?? undefined,
  };
}

function toRelationship(r: {
  id?: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  viaField: string | null;
}): Relationship {
  return {
    fromEntityId: r.fromEntityId,
    toEntityId: r.toEntityId,
    type: r.type as Relationship['type'],
    viaField: r.viaField ?? undefined,
  };
}

function toFieldMapping(fm: {
  id: string;
  entityMappingId: string;
  sourceFieldId: string;
  targetFieldId: string;
  transform: unknown;
  confidence: number;
  rationale: string;
  status: string;
}): FieldMapping {
  const transform = (fm.transform ?? { type: 'direct', config: {} }) as {
    type: TransformType;
    config: Record<string, unknown>;
  };
  return {
    id: fm.id,
    entityMappingId: fm.entityMappingId,
    sourceFieldId: fm.sourceFieldId,
    targetFieldId: fm.targetFieldId,
    transform,
    confidence: fm.confidence,
    rationale: fm.rationale,
    status: fm.status as FieldMapping['status'],
  };
}

export class DbStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getState(): Promise<AppState> {
    const [systems, entities, fields, relationships, projects, entityMappings, fieldMappings] =
      await Promise.all([
        this.prisma.system.findMany(),
        this.prisma.entity.findMany(),
        this.prisma.field.findMany(),
        this.prisma.relationship.findMany(),
        this.prisma.mappingProject.findMany(),
        this.prisma.entityMapping.findMany(),
        this.prisma.fieldMapping.findMany(),
      ]);

    return {
      systems: systems.map(toSystem),
      entities: entities.map(toEntity),
      fields: fields.map(toField),
      relationships: relationships.map(toRelationship),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        sourceSystemId: p.sourceSystemId,
        targetSystemId: p.targetSystemId,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      entityMappings: entityMappings.map((em) => ({
        id: em.id,
        projectId: em.projectId,
        sourceEntityId: em.sourceEntityId,
        targetEntityId: em.targetEntityId,
        confidence: em.confidence,
        rationale: em.rationale,
      })),
      fieldMappings: fieldMappings.map(toFieldMapping),
    };
  }

  async createProject(
    name: string,
    userId: string,
    sourceSystemName = 'SAP',
    targetSystemName = 'Salesforce',
  ): Promise<MappingProject> {
    const now = new Date();

    const [sourceSystem, targetSystem, project] = await this.prisma.$transaction(async (tx) => {
      const src = await tx.system.create({
        data: { id: uuidv4(), name: sourceSystemName, type: inferSystemType(sourceSystemName) },
      });
      const tgt = await tx.system.create({
        data: { id: uuidv4(), name: targetSystemName, type: inferSystemType(targetSystemName) },
      });
      const proj = await tx.mappingProject.create({
        data: {
          id: uuidv4(),
          name,
          userId,
          sourceSystemId: src.id,
          targetSystemId: tgt.id,
        },
      });
      return [src, tgt, proj] as const;
    });

    void sourceSystem;
    void targetSystem;

    return {
      id: project.id,
      name: project.name,
      sourceSystemId: project.sourceSystemId,
      targetSystemId: project.targetSystemId,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  async getProject(projectId: string): Promise<MappingProject | undefined> {
    const project = await this.prisma.mappingProject.findUnique({ where: { id: projectId } });
    if (!project) return undefined;
    return {
      id: project.id,
      name: project.name,
      sourceSystemId: project.sourceSystemId,
      targetSystemId: project.targetSystemId,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  async updateProjectTimestamp(projectId: string): Promise<void> {
    await this.prisma.mappingProject.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  }

  async replaceSystemSchema(
    systemId: string,
    entities: Entity[],
    fields: Field[],
    relationships: Relationship[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Delete existing entities (cascades to fields via FK)
      await tx.entity.deleteMany({ where: { systemId } });

      // Delete existing relationships referencing entities of this system
      // (They don't have FK to entity so we clean by matching IDs that were just deleted)
      // Since we just deleted entities, we can also clean dangling relationships.
      // For simplicity, insert new ones and let duplicates from prior runs be avoided via upsert.

      // Insert new entities
      await tx.entity.createMany({
        data: entities.map((e) => ({
          id: e.id,
          systemId: e.systemId,
          name: e.name,
          label: e.label ?? null,
          description: e.description ?? null,
        })),
      });

      // Insert new fields
      if (fields.length > 0) {
        await tx.field.createMany({
          data: fields.map((f) => ({
            id: f.id,
            entityId: f.entityId,
            name: f.name,
            label: f.label ?? null,
            dataType: f.dataType,
            length: f.length ?? null,
            precision: f.precision ?? null,
            scale: f.scale ?? null,
            required: f.required ?? false,
            isKey: f.isKey ?? false,
            isExternalId: f.isExternalId ?? false,
            picklistValues: f.picklistValues ?? [],
            jxchangeXPath: f.jxchangeXPath ?? null,
            jxchangeXtendElemKey: f.jxchangeXtendElemKey ?? null,
            iso20022Name: f.iso20022Name ?? null,
            complianceTags: f.complianceTags ?? [],
            complianceNote: f.complianceNote ?? null,
          })),
        });
      }

      // Insert new relationships
      if (relationships.length > 0) {
        await tx.relationship.createMany({
          data: relationships.map((r) => ({
            id: uuidv4(),
            fromEntityId: r.fromEntityId,
            toEntityId: r.toEntityId,
            type: r.type,
            viaField: r.viaField ?? null,
          })),
        });
      }
    });
  }

  async clearProjectMappings(projectId: string): Promise<void> {
    // EntityMapping deletion cascades to FieldMapping
    await this.prisma.entityMapping.deleteMany({ where: { projectId } });
  }

  async upsertMappings(
    projectId: string,
    entityMappings: AppState['entityMappings'],
    fieldMappings: FieldMapping[],
  ): Promise<void> {
    await this.clearProjectMappings(projectId);

    if (entityMappings.length > 0) {
      await this.prisma.entityMapping.createMany({
        data: entityMappings.map((em) => ({
          id: em.id,
          projectId: em.projectId,
          sourceEntityId: em.sourceEntityId,
          targetEntityId: em.targetEntityId,
          confidence: em.confidence,
          rationale: em.rationale,
        })),
      });
    }

    if (fieldMappings.length > 0) {
      await this.prisma.fieldMapping.createMany({
        data: fieldMappings.map((fm) => ({
          id: fm.id,
          entityMappingId: fm.entityMappingId,
          sourceFieldId: fm.sourceFieldId,
          targetFieldId: fm.targetFieldId,
          transform: fm.transform as object,
          confidence: fm.confidence,
          rationale: fm.rationale,
          status: fm.status,
        })),
      });
    }

    await this.updateProjectTimestamp(projectId);
  }

  async patchFieldMapping(
    fieldMappingId: string,
    patch: Partial<Pick<FieldMapping, 'status' | 'confidence' | 'rationale' | 'targetFieldId' | 'sourceFieldId' | 'transform'>>,
  ): Promise<FieldMapping | undefined> {
    try {
      const updated = await this.prisma.fieldMapping.update({
        where: { id: fieldMappingId },
        data: {
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.confidence !== undefined && { confidence: patch.confidence }),
          ...(patch.rationale !== undefined && { rationale: patch.rationale }),
          ...(patch.sourceFieldId !== undefined && { sourceFieldId: patch.sourceFieldId }),
          ...(patch.targetFieldId !== undefined && { targetFieldId: patch.targetFieldId }),
          ...(patch.transform !== undefined && { transform: patch.transform as object }),
        },
      });
      return toFieldMapping(updated);
    } catch {
      return undefined;
    }
  }
}

function inferSystemType(name: string): System['type'] {
  const n = name.toLowerCase();
  if (n.includes('salesforce')) return 'salesforce';
  if (n.includes('sap')) return 'sap';
  if (n.includes('jackhenry') || n.includes('silverlake') || n.includes('coredirector') || n.includes('symitar')) {
    return 'jackhenry';
  }
  return 'generic';
}
