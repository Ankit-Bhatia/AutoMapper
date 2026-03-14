import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db/prismaClient.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import { buildCanonicalTransitiveMappings } from './canonicalRoutes.js';
import { sendHttpError } from '../utils/httpErrors.js';
import { parseWorkbookFieldMappings } from '../services/mappingWorkbookParser.js';
import type { SeedSummary } from '../types.js';

const TRANSFORM_TYPES = ['direct', 'concat', 'formatDate', 'lookup', 'static', 'regex', 'split', 'trim'] as const;
const workbookUpload = multer({ limits: { fileSize: 12 * 1024 * 1024 } });

const MappingEventSchema = z.object({
  projectId: z.string().uuid(),
  fieldMappingId: z.string().uuid(),
  action: z.enum(['accepted', 'rejected', 'modified']),
  sourceSystemId: z.string(),
  sourceEntityName: z.string(),
  sourceFieldName: z.string(),
  targetSystemId: z.string(),
  targetEntityName: z.string(),
  targetFieldName: z.string(),
  transformType: z.enum(TRANSFORM_TYPES),
});

type _MappingEventInput = z.infer<typeof MappingEventSchema>;

function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  sendHttpError(req, res, status, code, message, details, 'api');
}

function computeConfidence(dm: {
  acceptCount: number;
  rejectCount: number;
  lastAcceptedAt: Date | null;
}): number {
  const total = dm.acceptCount + dm.rejectCount;
  if (total === 0) return 0;
  const rawRate = dm.acceptCount / total;
  const daysSinceAccepted = dm.lastAcceptedAt
    ? (Date.now() - dm.lastAcceptedAt.getTime()) / 86_400_000
    : 365;
  const recencyFactor = Math.exp(-daysSinceAccepted / 90);
  const volumeFactor = Math.min(total / 20, 1.0);
  return rawRate * (0.7 + 0.2 * recencyFactor + 0.1 * volumeFactor);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function similarityScore(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.75;

  const leftSet = new Set(left.match(/[a-z]+|\d+/g) ?? [left]);
  const rightSet = new Set(right.match(/[a-z]+|\d+/g) ?? [right]);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

async function resolveField(systemId: string, entityName: string, fieldName: string) {
  return prisma.field.findFirst({
    where: {
      name: fieldName,
      entity: {
        systemId,
        name: entityName,
      },
    },
    include: {
      entity: true,
    },
  });
}

async function ensureEntityMapping(projectId: string, sourceEntityId: string, targetEntityId: string) {
  const existing = await prisma.entityMapping.findFirst({
    where: {
      projectId,
      sourceEntityId,
      targetEntityId,
    },
  });

  if (existing) return existing;

  return prisma.entityMapping.create({
    data: {
      id: randomUUID(),
      projectId,
      sourceEntityId,
      targetEntityId,
      confidence: 0.85,
      rationale: 'Seeded via learning loop',
    },
  });
}

async function loadUserOrg(userId: string): Promise<{ id: string; slug: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organisation: true },
  });

  if (!user?.organisation) return null;
  return {
    id: user.organisation.id,
    slug: user.organisation.slug,
  };
}

async function getOrCreateDefaultOrg(): Promise<{ id: string; slug: string }> {
  const organisation = await prisma.organisation.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      id: randomUUID(),
      slug: 'default',
      name: 'Default Organisation',
    },
  });

  return { id: organisation.id, slug: organisation.slug };
}

function isAdminRole(role: string): boolean {
  const normalized = role.toUpperCase();
  return normalized === 'ADMIN' || normalized === 'OWNER';
}

function getPreferredTransform(events: Array<{ transformType: string | null }>): string | null {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.transformType) continue;
    counts.set(event.transformType, (counts.get(event.transformType) ?? 0) + 1);
  }

  let winner: string | null = null;
  let best = -1;
  for (const [transform, count] of counts) {
    if (count > best) {
      best = count;
      winner = transform;
    }
  }

  return winner;
}

interface FieldLookupCandidate {
  fieldName: string;
  entityName: string;
}

function buildFieldLookupIndex(
  rows: Array<{ name: string; entity: { name: string } }>,
): Map<string, FieldLookupCandidate[]> {
  const index = new Map<string, FieldLookupCandidate[]>();
  for (const row of rows) {
    const key = normalize(row.name);
    if (!key) continue;
    const bucket = index.get(key) ?? [];
    if (!bucket.some((candidate) => candidate.fieldName === row.name && candidate.entityName === row.entity.name)) {
      bucket.push({ fieldName: row.name, entityName: row.entity.name });
      index.set(key, bucket);
    }
  }
  return index;
}

function chooseBestCandidate(candidates: FieldLookupCandidate[], entityHint: string): FieldLookupCandidate {
  if (candidates.length <= 1) return candidates[0];

  const hint = entityHint.trim();
  if (!hint) return candidates[0];

  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = similarityScore(hint, candidate.entityName);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function parseConfidence(input: unknown): number {
  if (typeof input !== 'string') return 0.92;
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed)) return 0.92;
  return Math.min(Math.max(parsed, 0.5), 0.99);
}

export function setupOrgRoutes(app: Express): void {
  app.post('/api/org/:orgSlug/mapping-events', authMiddleware, async (req: Request, res: Response) => {
    const parsed = MappingEventSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid mapping-event payload', parsed.error.issues);
      return;
    }

    const orgSlug = req.params.orgSlug;
    const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } });
    if (!org) {
      sendError(req, res, 404, 'ORG_NOT_FOUND', 'Organisation not found');
      return;
    }

    if (process.env.REQUIRE_AUTH !== 'false') {
      const userId = req.user?.userId;
      if (!userId) {
        sendError(req, res, 401, 'UNAUTHORIZED', 'User not authenticated');
        return;
      }

      const userOrg = await loadUserOrg(userId);
      if (!userOrg || (userOrg.slug !== orgSlug && !isAdminRole(req.user?.role ?? ''))) {
        sendError(req, res, 403, 'FORBIDDEN', 'Not authorized for this organisation');
        return;
      }
    }

    const input = parsed.data;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      await tx.mappingEvent.create({
        data: {
          id: randomUUID(),
          organisationId: org.id,
          projectId: input.projectId,
          fieldMappingId: input.fieldMappingId,
          userId: process.env.REQUIRE_AUTH === 'false' ? null : req.user?.userId,
          action: input.action,
          sourceSystemId: input.sourceSystemId,
          sourceEntityName: input.sourceEntityName,
          sourceFieldName: input.sourceFieldName,
          targetSystemId: input.targetSystemId,
          targetEntityName: input.targetEntityName,
          targetFieldName: input.targetFieldName,
          transformType: input.transformType,
        },
      });

      const derived = await tx.derivedMapping.upsert({
        where: {
          organisationId_sourceSystemId_sourceEntityName_sourceFieldName_targetSystemId_targetEntityName_targetFieldName: {
            organisationId: org.id,
            sourceSystemId: input.sourceSystemId,
            sourceEntityName: input.sourceEntityName,
            sourceFieldName: input.sourceFieldName,
            targetSystemId: input.targetSystemId,
            targetEntityName: input.targetEntityName,
            targetFieldName: input.targetFieldName,
          },
        },
        create: {
          id: randomUUID(),
          organisationId: org.id,
          sourceSystemId: input.sourceSystemId,
          sourceEntityName: input.sourceEntityName,
          sourceFieldName: input.sourceFieldName,
          targetSystemId: input.targetSystemId,
          targetEntityName: input.targetEntityName,
          targetFieldName: input.targetFieldName,
          acceptCount: input.action === 'accepted' ? 1 : 0,
          rejectCount: input.action === 'rejected' ? 1 : 0,
          lastAcceptedAt: input.action === 'accepted' ? now : null,
          lastRejectedAt: input.action === 'rejected' ? now : null,
          preferredTransform: input.action === 'accepted' ? input.transformType : null,
          confidence: 0,
        },
        update: {
          acceptCount: input.action === 'accepted' ? { increment: 1 } : undefined,
          rejectCount: input.action === 'rejected' ? { increment: 1 } : undefined,
          lastAcceptedAt: input.action === 'accepted' ? now : undefined,
          lastRejectedAt: input.action === 'rejected' ? now : undefined,
        },
      });

      const acceptedEvents = await tx.mappingEvent.findMany({
        where: {
          organisationId: org.id,
          sourceSystemId: input.sourceSystemId,
          sourceEntityName: input.sourceEntityName,
          sourceFieldName: input.sourceFieldName,
          targetSystemId: input.targetSystemId,
          targetEntityName: input.targetEntityName,
          targetFieldName: input.targetFieldName,
          action: 'accepted',
        },
        select: { transformType: true },
      });

      const preferredTransform = getPreferredTransform(acceptedEvents);
      const confidence = computeConfidence({
        acceptCount: derived.acceptCount,
        rejectCount: derived.rejectCount,
        lastAcceptedAt: derived.lastAcceptedAt,
      });

      return tx.derivedMapping.update({
        where: { id: derived.id },
        data: {
          preferredTransform: preferredTransform ?? derived.preferredTransform,
          confidence,
        },
      });
    });

    res.status(201).json({ derivedMapping: result });
  });

  app.get('/api/org/:orgSlug/derived-mappings', authMiddleware, async (req: Request, res: Response) => {
    const orgSlug = req.params.orgSlug;
    const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } });
    if (!org) {
      sendError(req, res, 404, 'ORG_NOT_FOUND', 'Organisation not found');
      return;
    }

    if (process.env.REQUIRE_AUTH !== 'false') {
      const userId = req.user?.userId;
      if (!userId) {
        sendError(req, res, 401, 'UNAUTHORIZED', 'User not authenticated');
        return;
      }

      const userOrg = await loadUserOrg(userId);
      if (!userOrg || (userOrg.slug !== orgSlug && !isAdminRole(req.user?.role ?? ''))) {
        sendError(req, res, 403, 'FORBIDDEN', 'Not authorized for this organisation');
        return;
      }
    }

    const sourceSystem = typeof req.query.sourceSystem === 'string' ? req.query.sourceSystem : undefined;
    const targetSystem = typeof req.query.targetSystem === 'string' ? req.query.targetSystem : undefined;
    const minConfidence = Number.parseFloat(typeof req.query.minConfidence === 'string' ? req.query.minConfidence : '0.60');
    const limit = Math.min(Number.parseInt(typeof req.query.limit === 'string' ? req.query.limit : '200', 10), 500);

    const where = {
      organisationId: org.id,
      ...(sourceSystem ? { sourceSystemId: sourceSystem } : {}),
      ...(targetSystem ? { targetSystemId: targetSystem } : {}),
      confidence: { gte: Number.isFinite(minConfidence) ? minConfidence : 0.6 },
    };

    const [mappings, total] = await Promise.all([
      prisma.derivedMapping.findMany({
        where,
        orderBy: { confidence: 'desc' },
        take: Number.isFinite(limit) ? limit : 200,
      }),
      prisma.derivedMapping.count({ where }),
    ]);

    res.json({ mappings, total });
  });

  app.post(
    '/api/projects/:projectId/import-mapping-workbook',
    authMiddleware,
    workbookUpload.single('file'),
    async (req: Request, res: Response) => {
      const projectId = req.params.projectId;
      const project = await prisma.mappingProject.findUnique({
        where: { id: projectId },
        include: {
          user: {
            include: {
              organisation: true,
            },
          },
        },
      });

      if (!project) {
        sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
        return;
      }

      const organisation = project.organisationId
        ? await prisma.organisation.findUnique({ where: { id: project.organisationId } })
        : project.user.organisation ?? await getOrCreateDefaultOrg();

      if (!organisation) {
        sendError(req, res, 500, 'ORG_RESOLUTION_FAILED', 'Could not resolve project organisation');
        return;
      }

      if (process.env.REQUIRE_AUTH !== 'false') {
        const userId = req.user?.userId;
        if (!userId) {
          sendError(req, res, 401, 'UNAUTHORIZED', 'User not authenticated');
          return;
        }
        const userOrg = await loadUserOrg(userId);
        if (!userOrg || (userOrg.id !== organisation.id && !isAdminRole(req.user?.role ?? ''))) {
          sendError(req, res, 403, 'FORBIDDEN', 'Not authorized for this organisation');
          return;
        }
      }

      if (!req.file?.buffer) {
        sendError(req, res, 400, 'VALIDATION_ERROR', 'Missing workbook file upload');
        return;
      }

      const filename = req.file.originalname ?? 'mapping-workbook.xlsx';
      const lowerName = filename.toLowerCase();
      if (!(lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.xlsm'))) {
        sendError(req, res, 400, 'VALIDATION_ERROR', 'Workbook must be .xlsx, .xls, or .xlsm');
        return;
      }

      const confidence = parseConfidence(req.body?.confidence);
      let parsedMappings: ReturnType<typeof parseWorkbookFieldMappings>;
      try {
        parsedMappings = parseWorkbookFieldMappings(req.file.buffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not parse workbook';
        sendError(req, res, 400, 'WORKBOOK_PARSE_FAILED', message);
        return;
      }

      if (!parsedMappings.length) {
        sendError(req, res, 422, 'WORKBOOK_NO_MAPPINGS', 'No mapping rows were found in workbook');
        return;
      }

      const [sourceFields, targetFields] = await Promise.all([
        prisma.field.findMany({
          where: {
            entity: {
              systemId: project.sourceSystemId,
            },
          },
          select: {
            name: true,
            entity: {
              select: {
                name: true,
              },
            },
          },
        }),
        prisma.field.findMany({
          where: {
            entity: {
              systemId: project.targetSystemId,
            },
          },
          select: {
            name: true,
            entity: {
              select: {
                name: true,
              },
            },
          },
        }),
      ]);

      const sourceLookup = buildFieldLookupIndex(sourceFields);
      const targetLookup = buildFieldLookupIndex(targetFields);

      const now = new Date();
      let imported = 0;
      let skippedSourceNotFound = 0;
      let skippedTargetNotFound = 0;
      let skippedDuplicates = 0;
      const skipSamples: Array<{
        sheetName: string;
        rowNumber: number;
        sourceFieldName: string;
        targetFieldName: string;
        reason: string;
      }> = [];

      const seenResolved = new Set<string>();
      for (const mapping of parsedMappings) {
        const sourceCandidates = sourceLookup.get(normalize(mapping.sourceFieldName));
        if (!sourceCandidates?.length) {
          skippedSourceNotFound += 1;
          if (skipSamples.length < 8) {
            skipSamples.push({
              sheetName: mapping.sheetName,
              rowNumber: mapping.rowNumber,
              sourceFieldName: mapping.sourceFieldName,
              targetFieldName: mapping.targetFieldName,
              reason: 'source_field_not_found_in_project_schema',
            });
          }
          continue;
        }

        const targetCandidates = targetLookup.get(normalize(mapping.targetFieldName));
        if (!targetCandidates?.length) {
          skippedTargetNotFound += 1;
          if (skipSamples.length < 8) {
            skipSamples.push({
              sheetName: mapping.sheetName,
              rowNumber: mapping.rowNumber,
              sourceFieldName: mapping.sourceFieldName,
              targetFieldName: mapping.targetFieldName,
              reason: 'target_field_not_found_in_project_schema',
            });
          }
          continue;
        }

        const source = chooseBestCandidate(sourceCandidates, mapping.sheetName);
        const target = chooseBestCandidate(targetCandidates, mapping.targetEntityHint || mapping.sheetName);
        const resolvedKey = [
          source.entityName,
          source.fieldName,
          target.entityName,
          target.fieldName,
        ].join('|');

        if (seenResolved.has(resolvedKey)) {
          skippedDuplicates += 1;
          continue;
        }
        seenResolved.add(resolvedKey);

        await prisma.derivedMapping.upsert({
          where: {
            organisationId_sourceSystemId_sourceEntityName_sourceFieldName_targetSystemId_targetEntityName_targetFieldName: {
              organisationId: organisation.id,
              sourceSystemId: project.sourceSystemId,
              sourceEntityName: source.entityName,
              sourceFieldName: source.fieldName,
              targetSystemId: project.targetSystemId,
              targetEntityName: target.entityName,
              targetFieldName: target.fieldName,
            },
          },
          create: {
            id: randomUUID(),
            organisationId: organisation.id,
            sourceSystemId: project.sourceSystemId,
            sourceEntityName: source.entityName,
            sourceFieldName: source.fieldName,
            targetSystemId: project.targetSystemId,
            targetEntityName: target.entityName,
            targetFieldName: target.fieldName,
            preferredTransform: 'direct',
            confidence,
            acceptCount: 1,
            rejectCount: 0,
            lastAcceptedAt: now,
          },
          update: {
            preferredTransform: 'direct',
            confidence,
            lastAcceptedAt: now,
          },
        });

        imported += 1;
      }

      res.json({
        summary: {
          parsedRows: parsedMappings.length,
          imported,
          skippedSourceNotFound,
          skippedTargetNotFound,
          skippedDuplicates,
        },
        skipSamples,
      });
    },
  );

  app.post('/api/projects/:projectId/seed', authMiddleware, async (req: Request, res: Response) => {
    const projectId = req.params.projectId;
    const project = await prisma.mappingProject.findUnique({
      where: { id: projectId },
      include: {
        user: {
          include: {
            organisation: true,
          },
        },
      },
    });

    if (!project) {
      sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
      return;
    }

    const organisation = project.organisationId
      ? await prisma.organisation.findUnique({ where: { id: project.organisationId } })
      : project.user.organisation ?? await getOrCreateDefaultOrg();

    if (!organisation) {
      sendError(req, res, 500, 'ORG_RESOLUTION_FAILED', 'Could not resolve project organisation');
      return;
    }

    const summary: SeedSummary = {
      fromDerived: 0,
      fromCanonical: 0,
      fromAgent: 0,
      total: 0,
    };

    const coveredSourceFieldIds = new Set<string>();
    const coveredTargetFieldIds = new Set<string>();

    const derivedMappings = await prisma.derivedMapping.findMany({
      where: {
        organisationId: organisation.id,
        sourceSystemId: project.sourceSystemId,
        targetSystemId: project.targetSystemId,
        confidence: { gte: 0.85 },
      },
      orderBy: { confidence: 'desc' },
    });

    for (const derived of derivedMappings) {
      const sourceField = await resolveField(project.sourceSystemId, derived.sourceEntityName, derived.sourceFieldName);
      const targetField = await resolveField(project.targetSystemId, derived.targetEntityName, derived.targetFieldName);
      if (!sourceField || !targetField) continue;
      if (coveredTargetFieldIds.has(targetField.id)) continue;

      const entityMapping = await ensureEntityMapping(project.id, sourceField.entityId, targetField.entityId);
      const existing = await prisma.fieldMapping.findFirst({
        where: {
          entityMappingId: entityMapping.id,
          sourceFieldId: sourceField.id,
          targetFieldId: targetField.id,
        },
      });

      if (!existing) {
        await prisma.fieldMapping.create({
          data: {
            id: randomUUID(),
            entityMappingId: entityMapping.id,
            sourceFieldId: sourceField.id,
            targetFieldId: targetField.id,
            transform: {
              type: (derived.preferredTransform && TRANSFORM_TYPES.includes(derived.preferredTransform as (typeof TRANSFORM_TYPES)[number]))
                ? derived.preferredTransform
                : 'direct',
              config: {},
            },
            confidence: derived.confidence,
            rationale: 'Pre-seeded from historical accepted mappings',
            status: 'accepted',
            seedSource: 'derived',
          },
        });
      }

      coveredSourceFieldIds.add(sourceField.id);
      coveredTargetFieldIds.add(targetField.id);
      summary.fromDerived += 1;
    }

    const canonicalMappings = await buildCanonicalTransitiveMappings(project.sourceSystemId, project.targetSystemId);

    for (const canonical of canonicalMappings) {
      const sourceField = await resolveField(project.sourceSystemId, canonical.sourceEntity, canonical.sourceField);
      const targetField = await resolveField(project.targetSystemId, canonical.targetEntity, canonical.targetField);
      if (!sourceField || !targetField) continue;
      if (coveredTargetFieldIds.has(targetField.id)) continue;

      const entityMapping = await ensureEntityMapping(project.id, sourceField.entityId, targetField.entityId);
      const existing = await prisma.fieldMapping.findFirst({
        where: {
          entityMappingId: entityMapping.id,
          sourceFieldId: sourceField.id,
          targetFieldId: targetField.id,
        },
      });

      if (!existing) {
        await prisma.fieldMapping.create({
          data: {
            id: randomUUID(),
            entityMappingId: entityMapping.id,
            sourceFieldId: sourceField.id,
            targetFieldId: targetField.id,
            transform: { type: 'direct', config: {} },
            confidence: canonical.confidence,
            rationale: `Seeded from canonical concept ${canonical.canonicalConcept}`,
            status: 'suggested',
            seedSource: 'canonical',
          },
        });
      }

      coveredSourceFieldIds.add(sourceField.id);
      coveredTargetFieldIds.add(targetField.id);
      summary.fromCanonical += 1;
    }

    const [sourceFields, targetFields] = await Promise.all([
      prisma.field.findMany({
        where: {
          entity: {
            systemId: project.sourceSystemId,
          },
        },
        include: { entity: true },
      }),
      prisma.field.findMany({
        where: {
          entity: {
            systemId: project.targetSystemId,
          },
        },
        include: { entity: true },
      }),
    ]);

    for (const sourceField of sourceFields) {
      if (coveredSourceFieldIds.has(sourceField.id)) continue;

      let bestTarget = null as (typeof targetFields)[number] | null;
      let bestScore = 0;
      for (const candidate of targetFields) {
        if (coveredTargetFieldIds.has(candidate.id)) continue;
        const score = Math.max(
          similarityScore(sourceField.name, candidate.name),
          similarityScore(sourceField.label ?? '', candidate.label ?? ''),
        );
        if (score > bestScore) {
          bestScore = score;
          bestTarget = candidate;
        }
      }

      if (!bestTarget || bestScore < 0.2) continue;

      const entityMapping = await ensureEntityMapping(project.id, sourceField.entityId, bestTarget.entityId);
      const existing = await prisma.fieldMapping.findFirst({
        where: {
          entityMappingId: entityMapping.id,
          sourceFieldId: sourceField.id,
          targetFieldId: bestTarget.id,
        },
      });

      if (!existing) {
        await prisma.fieldMapping.create({
          data: {
            id: randomUUID(),
            entityMappingId: entityMapping.id,
            sourceFieldId: sourceField.id,
            targetFieldId: bestTarget.id,
            transform: { type: 'direct', config: {} },
            confidence: 0.45,
            rationale: 'Seeded from AI fallback for uncovered fields',
            status: 'suggested',
            seedSource: 'agent',
          },
        });
      }

      coveredSourceFieldIds.add(sourceField.id);
      coveredTargetFieldIds.add(bestTarget.id);
      summary.fromAgent += 1;
    }

    summary.total = summary.fromDerived + summary.fromCanonical + summary.fromAgent;

    res.json({ summary });
  });
}
