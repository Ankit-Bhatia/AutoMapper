import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockOkResponse(status = 201): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  } as Response;
}

describe('errorReporting telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => mockOkResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts frontend errors to backend ingest endpoint', async () => {
    const { reportFrontendError, setErrorReportingContext } = await import('./errorReporting');

    setErrorReportingContext({ projectId: 'p-1', workflowStep: 'orchestrate' });
    await reportFrontendError({
      source: 'frontend',
      severity: 'error',
      code: 'TEST_FRONTEND_ERROR',
      message: 'Something failed',
      context: { action: 'run-pipeline' },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/error-reports');

    const body = JSON.parse(String(init.body)) as {
      code: string;
      context: { projectId?: string; workflowStep?: string; action?: string };
    };

    expect(body.code).toBe('TEST_FRONTEND_ERROR');
    expect(body.context.projectId).toBe('p-1');
    expect(body.context.workflowStep).toBe('orchestrate');
    expect(body.context.action).toBe('run-pipeline');
  });

  it('dedupes identical error events in a short window', async () => {
    const { reportFrontendError } = await import('./errorReporting');

    await reportFrontendError({ code: 'DUPLICATE_ERROR', message: 'same message' });
    await reportFrontendError({ code: 'DUPLICATE_ERROR', message: 'same message' });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not recursively report failures for the ingest endpoint itself', async () => {
    const { reportApiError } = await import('./errorReporting');

    await reportApiError({
      path: '/api/error-reports',
      method: 'POST',
      status: 500,
      message: 'Endpoint unavailable',
    });

    expect(fetch).not.toHaveBeenCalled();
  });
});
