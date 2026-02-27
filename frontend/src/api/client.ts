import type { FieldMapping, ProjectPayload } from '../types';
import { mockProjectPayload, mockOrchestrationEvents } from './mockData';

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const AUTO_AUTH = import.meta.env.VITE_AUTO_AUTH !== 'false';
const AUTH_TOKEN_KEY = 'automapper_demo_token';
const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL || 'demo@automapper.local';
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD || 'DemoPass123!';
const DEMO_NAME = import.meta.env.VITE_DEMO_NAME || 'Demo User';

let authBootstrapPromise: Promise<void> | null = null;

// ── In-memory mutable state for standalone demo ──────────────────────────────
// Cloned on first use so optimistic updates (accept/reject) persist within session
let _liveMappings: FieldMapping[] | null = null;
function getLiveMappings(): FieldMapping[] {
  if (!_liveMappings) {
    _liveMappings = mockProjectPayload.fieldMappings.map((fm) => ({ ...fm }));
  }
  return _liveMappings;
}

// ── Mock request router ───────────────────────────────────────────────────────
function mockApiCall<T>(path: string, init?: RequestInit): T {
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(init.body as string) : {};

  // POST /api/projects → create project
  if (method === 'POST' && path === '/api/projects') {
    const name = (body.name as string | undefined) ?? mockProjectPayload.project.name;
    return { project: { ...mockProjectPayload.project, name } } as T;
  }

  // POST /api/projects/:id/schema/:connectorId → no-op
  if (method === 'POST' && /\/schema\/[^/]+$/.test(path)) {
    if (path.endsWith('/schema/upload-file')) {
      return { ok: true, entities: [], fields: [], relationships: [], mode: 'uploaded' } as T;
    }
    return { ok: true, entities: [], fields: [], relationships: [] } as T;
  }

  // POST /api/projects/:id/suggest-mappings → early heuristic mappings
  if (method === 'POST' && path.includes('/suggest-mappings')) {
    return {
      entityMappings: mockProjectPayload.entityMappings,
      fieldMappings: getLiveMappings(),
      validation: {
        warnings: [],
        summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 },
      },
    } as T;
  }

  // GET /api/projects/:id → full project payload
  if (method === 'GET' && /\/api\/projects\/[^/]+$/.test(path)) {
    const payload: ProjectPayload = { ...mockProjectPayload, fieldMappings: getLiveMappings() };
    return payload as T;
  }

  // PATCH /api/field-mappings/:id → update a mapping
  if (method === 'PATCH' && path.includes('/api/field-mappings/')) {
    const id = path.split('/').pop()!;
    const mappings = getLiveMappings();
    const idx = mappings.findIndex((fm) => fm.id === id);
    if (idx !== -1) {
      mappings[idx] = { ...mappings[idx], ...body };
      return mappings[idx] as T;
    }
    throw new Error('Field mapping not found');
  }

  // GET /api/projects/:id/export → CSV blob text
  if (method === 'GET' && path.includes('/export')) {
    const fmt = path.split('format=')[1]?.split('&')[0] ?? 'json';
    if (fmt === 'csv') {
      const rows = getLiveMappings().map((fm) => `${fm.id},${fm.sourceFieldId},${fm.targetFieldId},${fm.status},${fm.confidence}`);
      return ['id,sourceFieldId,targetFieldId,status,confidence', ...rows].join('\n') as T;
    }
    return JSON.stringify({ mappings: getLiveMappings() }, null, 2) as T;
  }

  // Fallback
  return {} as T;
}

function getAuthToken(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(AUTH_TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

function setAuthToken(token: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    }
  } catch {
    // Ignore localStorage failures and keep request-scoped behavior.
  }
}

function shouldAutoBootstrapAuth(path: string): boolean {
  return !path.startsWith('/api/auth/');
}

async function ensureDemoAuth(): Promise<void> {
  if (STANDALONE || !AUTO_AUTH) return;
  if (getAuthToken()) return;
  if (authBootstrapPromise) return authBootstrapPromise;

  authBootstrapPromise = (async () => {
    const payload = {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      name: DEMO_NAME,
    };

    const registerResp = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (registerResp.ok) {
      const registerData = (await registerResp.json()) as { token?: string };
      if (!registerData.token) throw new Error('Demo registration succeeded but no token was returned');
      setAuthToken(registerData.token);
      return;
    }

    if (registerResp.status !== 409) {
      const errBody = await registerResp.json().catch(() => ({}));
      const msg = (errBody as { error?: { message?: string } }).error?.message || 'Demo registration failed';
      throw new Error(msg);
    }

    const loginResp = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });

    if (!loginResp.ok) {
      const errBody = await loginResp.json().catch(() => ({}));
      const msg = (errBody as { error?: { message?: string } }).error?.message || 'Demo login failed';
      throw new Error(msg);
    }

    const loginData = (await loginResp.json()) as { token?: string };
    if (!loginData.token) throw new Error('Demo login succeeded but no token was returned');
    setAuthToken(loginData.token);
  })().finally(() => {
    authBootstrapPromise = null;
  });

  return authBootstrapPromise;
}

// ── api() ─────────────────────────────────────────────────────────────────────
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (STANDALONE) {
    // Simulate realistic network latency
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
    return mockApiCall<T>(path, init);
  }

  if (shouldAutoBootstrapAuth(path)) {
    await ensureDemoAuth();
  }

  const token = getAuthToken();

  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const message =
      (errBody as { error?: { message?: string } }).error?.message ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function apiBase(): string {
  return STANDALONE ? '' : API_BASE;
}

export function isDemoUiMode(): boolean {
  return STANDALONE || AUTO_AUTH;
}

// ── MockEventSource ───────────────────────────────────────────────────────────
// Fires the pre-recorded orchestration events using setTimeout,
// mimicking the SSE stream produced by the real backend.

export class MockEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState: number = 1; // OPEN

  private timers: ReturnType<typeof setTimeout>[] = [];
  private closed = false;

  constructor(_url: string) {
    for (const evt of mockOrchestrationEvents) {
      const t = setTimeout(() => {
        if (this.closed) return;
        if (this.onmessage) {
          this.onmessage(new MessageEvent('message', { data: JSON.stringify(evt.data) }));
        }
      }, evt.delay);
      this.timers.push(t);
    }
  }

  close() {
    this.closed = true;
    this.readyState = 2; // CLOSED
    for (const t of this.timers) clearTimeout(t);
  }

  // Satisfy EventSource interface duck-typing used in the component
  addEventListener(_type: string, _fn: EventListenerOrEventListenerObject): void { /* no-op */ }
  removeEventListener(_type: string, _fn: EventListenerOrEventListenerObject): void { /* no-op */ }
  dispatchEvent(_e: Event): boolean { return false; }
}

// ── Factory used by components ────────────────────────────────────────────────
export function getEventSource(url: string): EventSource | MockEventSource {
  if (STANDALONE) return new MockEventSource(url);
  return new EventSource(url);
}

/** Call this when the user resets the workflow (e.g. "Change connectors") */
export function resetMockState(): void {
  _liveMappings = null;
}
