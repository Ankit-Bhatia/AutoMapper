const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const AUTH_TOKEN_KEY = 'automapper_demo_token';
const DEDUPE_WINDOW_MS = 5000;

interface FrontendErrorPayload {
  source?: 'frontend' | 'runtime' | 'api';
  severity?: 'fatal' | 'error' | 'warning' | 'info';
  code: string;
  message?: string;
  error?: unknown;
  projectId?: string;
  context?: Record<string, unknown>;
  metadata?: unknown;
}

const contextState: Record<string, unknown> = {};
const recentFingerprints = new Map<string, number>();
let globalInstalled = false;

function getToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }

  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: 'Unknown frontend error' };
  }
}

function cleanupFingerprints(now: number): void {
  for (const [fingerprint, ts] of recentFingerprints.entries()) {
    if (now - ts > DEDUPE_WINDOW_MS) {
      recentFingerprints.delete(fingerprint);
    }
  }
}

function shouldReport(code: string, message: string): boolean {
  const now = Date.now();
  cleanupFingerprints(now);
  const fingerprint = `${code}:${message}`;
  const seenAt = recentFingerprints.get(fingerprint);
  if (seenAt && now - seenAt < DEDUPE_WINDOW_MS) return false;
  recentFingerprints.set(fingerprint, now);
  return true;
}

function buildContext(payloadContext?: Record<string, unknown>, projectId?: string): Record<string, unknown> {
  return {
    ...contextState,
    ...payloadContext,
    projectId: projectId ?? contextState.projectId,
    pathname: typeof window !== 'undefined' ? window.location.pathname : undefined,
    href: typeof window !== 'undefined' ? window.location.href : undefined,
    timestampMs: Date.now(),
  };
}

export function setErrorReportingContext(patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') {
      delete contextState[key];
    } else {
      contextState[key] = value;
    }
  }
}

export async function reportFrontendError(payload: FrontendErrorPayload): Promise<void> {
  if (STANDALONE) return;
  if (payload.code === 'FRONTEND_REPORTING_FAILURE') return;

  const normalized = normalizeError(payload.error);
  const message = payload.message ?? normalized.message;
  if (!shouldReport(payload.code, message)) return;

  const requestBody = {
    source: payload.source ?? 'frontend',
    severity: payload.severity ?? 'error',
    code: payload.code,
    message,
    stack: normalized.stack,
    projectId: payload.projectId,
    context: buildContext(payload.context, payload.projectId),
    metadata: payload.metadata,
  };

  const token = getToken();

  try {
    await fetch(`${API_BASE}/api/error-reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(requestBody),
      keepalive: true,
    });
  } catch {
    // Intentionally swallow reporting transport failures.
  }
}

export async function reportApiError(payload: {
  path: string;
  method: string;
  status?: number;
  message: string;
  error?: unknown;
  responseBody?: unknown;
}): Promise<void> {
  if (payload.path.startsWith('/api/error-reports')) return;

  await reportFrontendError({
    source: 'api',
    severity: payload.status && payload.status < 500 ? 'warning' : 'error',
    code: payload.status ? `API_${payload.status}` : 'API_REQUEST_FAILED',
    message: payload.message,
    error: payload.error,
    context: {
      path: payload.path,
      method: payload.method,
      status: payload.status,
    },
    metadata: payload.responseBody ? { responseBody: payload.responseBody } : undefined,
  });
}

export function installGlobalErrorReporting(): void {
  if (globalInstalled || typeof window === 'undefined') return;
  globalInstalled = true;

  window.addEventListener('error', (event) => {
    void reportFrontendError({
      source: 'runtime',
      code: 'WINDOW_ERROR',
      message: event.message || 'Unhandled runtime error',
      error: event.error,
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const normalized = normalizeError(event.reason);
    void reportFrontendError({
      source: 'runtime',
      code: 'UNHANDLED_REJECTION',
      message: normalized.message,
      error: event.reason,
      context: {
        reasonType: typeof event.reason,
      },
    });
  });
}
