import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

export type ErrorSource =
  | 'frontend'
  | 'backend'
  | 'api'
  | 'auth'
  | 'connector'
  | 'oauth'
  | 'orchestrator'
  | 'runtime';

export interface ErrorReportContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  userId?: string;
  projectId?: string;
  ip?: string;
  userAgent?: string;
  [key: string]: unknown;
}

export interface ErrorReport {
  id: string;
  timestamp: string;
  severity: ErrorSeverity;
  source: ErrorSource;
  code: string;
  message: string;
  stack?: string;
  context?: ErrorReportContext;
  metadata?: Record<string, unknown>;
}

export interface ErrorReportInput {
  severity?: ErrorSeverity;
  source?: ErrorSource;
  code?: string;
  message: string;
  stack?: string;
  context?: ErrorReportContext;
  metadata?: unknown;
}

export interface ErrorReportListQuery {
  limit?: number;
  severity?: ErrorSeverity;
  source?: ErrorSource;
  projectId?: string;
  requestId?: string;
  sinceIso?: string;
}

export interface ErrorReportSummary {
  total: number;
  inWindow: number;
  windowHours: number;
  bySeverity: Record<ErrorSeverity, number>;
  bySource: Record<string, number>;
  latest: Pick<ErrorReport, 'id' | 'timestamp' | 'severity' | 'source' | 'code' | 'message'> | null;
}

const DEFAULT_MAX_REPORTS = 5000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 12000;
const MAX_CODE_LENGTH = 120;
const MAX_CONTEXT_BYTES = 12000;
const MAX_METADATA_BYTES = 24000;

function clampText(value: string | undefined, maxLen: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 3))}...`;
}

function toPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return undefined;
    return cloned as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function truncateObject(value: Record<string, unknown> | undefined, maxBytes: number): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const raw = JSON.stringify(value);
  if (raw.length <= maxBytes) return value;
  return {
    truncated: true,
    preview: raw.slice(0, maxBytes),
  };
}

function isValidSeverity(value: unknown): value is ErrorSeverity {
  return value === 'fatal' || value === 'error' || value === 'warning' || value === 'info';
}

function isValidSource(value: unknown): value is ErrorSource {
  return (
    value === 'frontend'
    || value === 'backend'
    || value === 'api'
    || value === 'auth'
    || value === 'connector'
    || value === 'oauth'
    || value === 'orchestrator'
    || value === 'runtime'
  );
}

function normalizeReport(raw: unknown): ErrorReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  if (typeof row.id !== 'string' || typeof row.timestamp !== 'string' || typeof row.message !== 'string') {
    return null;
  }

  const severity = isValidSeverity(row.severity) ? row.severity : 'error';
  const source = isValidSource(row.source) ? row.source : 'backend';

  const report: ErrorReport = {
    id: row.id,
    timestamp: row.timestamp,
    severity,
    source,
    code: typeof row.code === 'string' ? row.code : 'UNKNOWN',
    message: row.message,
  };

  if (typeof row.stack === 'string') report.stack = row.stack;
  const context = toPlainObject(row.context);
  if (context) report.context = context as ErrorReportContext;
  const metadata = toPlainObject(row.metadata);
  if (metadata) report.metadata = metadata;

  return report;
}

function resolveFilePath(): string {
  const configured = process.env.ERROR_REPORTS_FILE;
  if (configured) return path.resolve(configured);

  const dataDir = process.env.DATA_DIR || './data';
  return path.resolve(dataDir, 'error-reports.json');
}

export class ErrorReportingService {
  private readonly filePath: string;
  private readonly maxReports: number;
  private reports: ErrorReport[] = [];

  constructor(filePath = resolveFilePath(), maxReports = DEFAULT_MAX_REPORTS) {
    this.filePath = filePath;
    this.maxReports = maxReports;
    this.reports = this.load();
  }

  capture(input: ErrorReportInput): ErrorReport {
    const report: ErrorReport = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      severity: input.severity ?? 'error',
      source: input.source ?? 'backend',
      code: clampText(input.code || 'UNKNOWN', MAX_CODE_LENGTH) ?? 'UNKNOWN',
      message: clampText(input.message, MAX_MESSAGE_LENGTH) ?? 'Unknown error',
      stack: clampText(input.stack, MAX_STACK_LENGTH),
      context: truncateObject(toPlainObject(input.context), MAX_CONTEXT_BYTES) as ErrorReportContext | undefined,
      metadata: truncateObject(toPlainObject(input.metadata), MAX_METADATA_BYTES),
    };

    this.reports.unshift(report);
    if (this.reports.length > this.maxReports) {
      this.reports = this.reports.slice(0, this.maxReports);
    }

    this.persist();
    return report;
  }

  list(query: ErrorReportListQuery = {}): ErrorReport[] {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const sinceMs = query.sinceIso ? Date.parse(query.sinceIso) : Number.NaN;

    const filtered = this.reports.filter((report) => {
      if (query.severity && report.severity !== query.severity) return false;
      if (query.source && report.source !== query.source) return false;
      if (query.projectId && report.context?.projectId !== query.projectId) return false;
      if (query.requestId && report.context?.requestId !== query.requestId) return false;
      if (!Number.isNaN(sinceMs) && Date.parse(report.timestamp) < sinceMs) return false;
      return true;
    });

    return filtered.slice(0, limit);
  }

  summary(windowHours = 24): ErrorReportSummary {
    const hours = Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const bySeverity: Record<ErrorSeverity, number> = {
      fatal: 0,
      error: 0,
      warning: 0,
      info: 0,
    };

    const bySource: Record<string, number> = {};
    let inWindow = 0;

    for (const report of this.reports) {
      bySeverity[report.severity] += 1;
      bySource[report.source] = (bySource[report.source] ?? 0) + 1;

      if (Date.parse(report.timestamp) >= cutoff) {
        inWindow += 1;
      }
    }

    const latest = this.reports[0]
      ? {
          id: this.reports[0].id,
          timestamp: this.reports[0].timestamp,
          severity: this.reports[0].severity,
          source: this.reports[0].source,
          code: this.reports[0].code,
          message: this.reports[0].message,
        }
      : null;

    return {
      total: this.reports.length,
      inWindow,
      windowHours: hours,
      bySeverity,
      bySource,
      latest,
    };
  }

  private load(): ErrorReport[] {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, '[]', 'utf8');
        return [];
      }

      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed
        .map((row) => normalizeReport(row))
        .filter((row): row is ErrorReport => row !== null)
        .slice(0, this.maxReports);
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.reports, null, 2), 'utf8');
    } catch {
      // Best-effort persistence. Request flow should not fail if telemetry persistence fails.
    }
  }
}

export const errorReportingService = new ErrorReportingService();
