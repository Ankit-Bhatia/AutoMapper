import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  errorReportingService,
  type ErrorReportContext,
  type ErrorSeverity,
  type ErrorSource,
} from '../services/errorReporting.js';

function resolveRequestId(req: Request, res: Response): string {
  const existingFromLocals = typeof res.locals.requestId === 'string' ? res.locals.requestId : null;
  if (existingFromLocals) return existingFromLocals;

  const header = req.header('x-request-id');
  const requestId = header && header.trim().length > 0 ? header.trim() : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}

function statusToSeverity(status: number): ErrorSeverity {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warning';
  return 'info';
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return { message: 'Unknown error' };
}

export function captureException(
  source: ErrorSource,
  error: unknown,
  options: {
    code?: string;
    severity?: ErrorSeverity;
    context?: ErrorReportContext;
    metadata?: unknown;
  } = {},
): string {
  const normalized = normalizeError(error);
  const report = errorReportingService.capture({
    source,
    severity: options.severity ?? 'error',
    code: options.code ?? 'UNHANDLED_EXCEPTION',
    message: normalized.message,
    stack: normalized.stack,
    context: options.context,
    metadata: options.metadata,
  });
  return report.id;
}

export function sendHttpError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
  source: ErrorSource = 'api',
): void {
  const requestId = resolveRequestId(req, res);
  const report = errorReportingService.capture({
    severity: statusToSeverity(status),
    source,
    code,
    message,
    context: {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: status,
      userId: req.user?.userId,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    },
    metadata: details == null ? undefined : { details },
  });

  res.status(status).json({
    error: {
      code,
      message,
      details,
      reportId: report.id,
      requestId,
    },
  });
}
