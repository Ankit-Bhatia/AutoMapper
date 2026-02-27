import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErrorReportingService } from '../services/errorReporting.js';

function createTempReportFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-errors-'));
  return path.join(dir, 'reports.json');
}

describe('ErrorReportingService', () => {
  it('captures reports and persists them to disk', () => {
    const filePath = createTempReportFile();
    const service = new ErrorReportingService(filePath);

    const captured = service.capture({
      source: 'api',
      severity: 'warning',
      code: 'VALIDATION_ERROR',
      message: 'Invalid payload',
      context: { projectId: 'p1', requestId: 'req-1' },
    });

    expect(captured.id).toBeTruthy();
    expect(service.list({ limit: 10 })).toHaveLength(1);

    const reloaded = new ErrorReportingService(filePath);
    const reports = reloaded.list({ limit: 10 });
    expect(reports).toHaveLength(1);
    expect(reports[0].code).toBe('VALIDATION_ERROR');
    expect(reports[0].context?.projectId).toBe('p1');
  });

  it('truncates oversized metadata payloads', () => {
    const filePath = createTempReportFile();
    const service = new ErrorReportingService(filePath);

    service.capture({
      source: 'frontend',
      severity: 'error',
      code: 'UI_RUNTIME_ERROR',
      message: 'Unhandled runtime error',
      metadata: {
        huge: 'x'.repeat(30_000),
      },
    });

    const [report] = service.list({ limit: 1 });
    expect(report.metadata).toBeDefined();
    expect(report.metadata?.truncated).toBe(true);
    expect(typeof report.metadata?.preview).toBe('string');
  });

  it('filters by severity/project and returns summary counts', () => {
    const filePath = createTempReportFile();
    const service = new ErrorReportingService(filePath);

    service.capture({
      source: 'connector',
      severity: 'error',
      code: 'CONNECTOR_ERROR',
      message: 'Connector timed out',
      context: { projectId: 'alpha' },
    });

    service.capture({
      source: 'frontend',
      severity: 'warning',
      code: 'PIPELINE_STALL',
      message: 'Pipeline stalled',
      context: { projectId: 'beta' },
    });

    const filtered = service.list({ severity: 'error', projectId: 'alpha', limit: 10 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].code).toBe('CONNECTOR_ERROR');

    const summary = service.summary(24);
    expect(summary.total).toBe(2);
    expect(summary.bySeverity.error).toBe(1);
    expect(summary.bySeverity.warning).toBe(1);
    expect(summary.bySource.connector).toBe(1);
    expect(summary.bySource.frontend).toBe(1);
  });
});
