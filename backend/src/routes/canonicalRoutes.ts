import type { Express, Request, Response } from 'express';
import { prisma } from '../db/prismaClient.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import { sendHttpError } from '../utils/httpErrors.js';

interface CanonicalTransitiveMapping {
  sourceEntity: string;
  sourceField: string;
  canonicalDomain: string;
  canonicalConcept: string;
  targetEntity: string;
  targetField: string;
  confidence: number;
  complianceTags: string[];
}

export async function buildCanonicalTransitiveMappings(
  sourceSystemId: string,
  targetSystemId: string,
): Promise<CanonicalTransitiveMapping[]> {
  const sourceMappings = await prisma.fieldCanonicalMap.findMany({
    where: {
      field: {
        entity: {
          systemId: sourceSystemId,
        },
      },
    },
    include: {
      field: {
        include: {
          entity: true,
        },
      },
      canonicalField: {
        include: {
          domain: true,
          fieldMappings: {
            where: {
              field: {
                entity: {
                  systemId: targetSystemId,
                },
              },
            },
            include: {
              field: {
                include: {
                  entity: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const transitiveMappings: CanonicalTransitiveMapping[] = [];

  for (const sourceMapping of sourceMappings) {
    for (const targetMapping of sourceMapping.canonicalField.fieldMappings) {
      transitiveMappings.push({
        sourceEntity: sourceMapping.field.entity.name,
        sourceField: sourceMapping.field.name,
        canonicalDomain: sourceMapping.canonicalField.domain.name,
        canonicalConcept: sourceMapping.canonicalField.conceptName,
        targetEntity: targetMapping.field.entity.name,
        targetField: targetMapping.field.name,
        confidence: Number(Math.min(sourceMapping.confidence, targetMapping.confidence).toFixed(4)),
        complianceTags: sourceMapping.canonicalField.complianceTags,
      });
    }
  }

  return transitiveMappings;
}

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

export function setupCanonicalRoutes(app: Express): void {
  app.get('/api/canonical/domains', authMiddleware, async (req: Request, res: Response) => {
    const domains = await prisma.canonicalDomain.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { canonicalFields: true },
        },
      },
    });

    res.json({
      domains: domains.map((domain) => ({
        id: domain.id,
        name: domain.name,
        description: domain.description,
        fieldCount: domain._count.canonicalFields,
      })),
    });
  });

  app.get('/api/canonical/domains/:domainId/fields', authMiddleware, async (req: Request, res: Response) => {
    const domain = await prisma.canonicalDomain.findUnique({ where: { id: req.params.domainId } });
    if (!domain) {
      sendError(req, res, 404, 'CANONICAL_DOMAIN_NOT_FOUND', 'Canonical domain not found');
      return;
    }

    const fields = await prisma.canonicalField.findMany({
      where: { domainId: req.params.domainId },
      orderBy: { conceptName: 'asc' },
      select: {
        id: true,
        conceptName: true,
        displayLabel: true,
        dataType: true,
        complianceTags: true,
        isDeprecated: true,
      },
    });

    res.json({ fields });
  });

  app.get('/api/systems/:systemId/canonical-map', authMiddleware, async (req: Request, res: Response) => {
    const sourceSystemId = req.params.systemId;
    const targetSystemId = typeof req.query.targetSystemId === 'string' ? req.query.targetSystemId : '';

    if (!targetSystemId) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'targetSystemId query parameter is required');
      return;
    }

    const transitiveMappings = await buildCanonicalTransitiveMappings(sourceSystemId, targetSystemId);

    res.json({ mappings: transitiveMappings, count: transitiveMappings.length });
  });
}
