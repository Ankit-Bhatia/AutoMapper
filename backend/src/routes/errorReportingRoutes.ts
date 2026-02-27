import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authMiddleware.js';
import { errorReportingService } from '../services/errorReporting.js';
import { sendHttpError } from '../utils/httpErrors.js';

const SeveritySchema = z.enum(['fatal', 'error', 'warning', 'info']);
const SourceSchema = z.enum([
  'frontend',
  'backend',
  'api',
  'auth',
  'connector',
  'oauth',
  'orchestrator',
  'runtime',
]);

const FrontendReportSchema = z.object({
  severity: SeveritySchema.optional(),
  source: SourceSchema.optional(),
  code: z.string().min(1).max(120).optional(),
  message: z.string().min(1).max(2000),
  stack: z.string().max(12000).optional(),
  projectId: z.string().max(120).optional(),
  context: z.record(z.unknown()).optional(),
  metadata: z.unknown().optional(),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  severity: SeveritySchema.optional(),
  source: SourceSchema.optional(),
  projectId: z.string().max(120).optional(),
  requestId: z.string().max(120).optional(),
  sinceHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
});

const SummaryQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
});

function getRequestId(req: Request): string | undefined {
  if (typeof req.res?.locals.requestId === 'string') return req.res.locals.requestId;
  const header = req.header('x-request-id');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

export function setupErrorReportingRoutes(app: Express): void {
  // Public ingest endpoint so frontend startup/login errors can still be reported.
  app.post('/api/error-reports', (req: Request, res: Response) => {
    const parsed = FrontendReportSchema.safeParse(req.body);
    if (!parsed.success) {
      sendHttpError(req, res, 400, 'VALIDATION_ERROR', 'Invalid error report payload', parsed.error.issues, 'api');
      return;
    }

    const data = parsed.data;

    const report = errorReportingService.capture({
      severity: data.severity ?? 'error',
      source: data.source ?? 'frontend',
      code: data.code ?? 'FRONTEND_ERROR',
      message: data.message,
      stack: data.stack,
      context: {
        ...(data.context ?? {}),
        requestId: getRequestId(req),
        projectId: data.projectId,
        method: req.method,
        path: req.originalUrl || req.url,
        userAgent: req.get('user-agent') ?? undefined,
      },
      metadata: data.metadata,
    });

    res.status(201).json({ reportId: report.id });
  });

  // Query endpoints are protected.
  app.get('/api/error-reports', authMiddleware, (req: Request, res: Response) => {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendHttpError(req, res, 400, 'VALIDATION_ERROR', 'Invalid error report query', parsed.error.issues, 'api');
      return;
    }

    const query = parsed.data;
    const sinceIso = query.sinceHours
      ? new Date(Date.now() - query.sinceHours * 60 * 60 * 1000).toISOString()
      : undefined;

    const reports = errorReportingService.list({
      limit: query.limit,
      severity: query.severity,
      source: query.source,
      projectId: query.projectId,
      requestId: query.requestId,
      sinceIso,
    });

    res.json({ reports, count: reports.length });
  });

  app.get('/api/error-reports/summary', authMiddleware, (req: Request, res: Response) => {
    const parsed = SummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendHttpError(req, res, 400, 'VALIDATION_ERROR', 'Invalid summary query', parsed.error.issues, 'api');
      return;
    }

    const summary = errorReportingService.summary(parsed.data.windowHours ?? 24);
    res.json({ summary });
  });
}
