import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../auth/authMiddleware.js';
import { CONFIRMED_PATTERNS, ONE_TO_MANY_FIELDS } from '../agents/schemaIntelligenceData.js';
import { sendHttpError } from '../utils/httpErrors.js';
import { normalizeSchemaIntelligenceField } from '../services/schemaIntelligenceSync.js';

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

export function setupSchemaIntelligenceRoutes(app: Express): void {
  app.get('/api/schema-intelligence/patterns', authMiddleware, (req: Request, res: Response) => {
    const field = typeof req.query.field === 'string' ? req.query.field.trim() : '';

    if (!field) {
      res.json({
        patterns: CONFIRMED_PATTERNS,
        count: Object.keys(CONFIRMED_PATTERNS).length,
      });
      return;
    }

    const normalizedField = normalizeSchemaIntelligenceField(field);
    const patterns = CONFIRMED_PATTERNS[normalizedField] ?? [];

    if (patterns.length === 0) {
      sendError(req, res, 404, 'SCHEMA_INTELLIGENCE_PATTERN_NOT_FOUND', `No schema intelligence patterns found for ${field}`);
      return;
    }

    res.json({
      field,
      normalizedField,
      patterns,
      count: patterns.length,
    });
  });

  app.get('/api/schema-intelligence/one-to-many', authMiddleware, (_req: Request, res: Response) => {
    const fields = Array.from(ONE_TO_MANY_FIELDS).sort();
    res.json({
      fields,
      count: fields.length,
    });
  });
}
