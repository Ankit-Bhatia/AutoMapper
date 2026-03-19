import type {
  FieldMapping,
  LLMConfigResponse,
  LLMUsageEvent,
  LLMUsageResponse,
  MappingConflict,
  OneToManyResolution,
  Project,
  ProjectListResponse,
  ProjectPayload,
  ProjectPreflight,
} from '@contracts';
import { mockProjectPayload, mockOrchestrationEvents } from './mockData';
import { reportApiError } from '../../apps/web/src/telemetry/errorReporting';

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';

function inferApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  const { protocol, hostname } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && hostname) {
    return `${protocol}//${hostname}:4000`;
  }
  return 'http://localhost:4000';
}

export const API_BASE = import.meta.env.VITE_API_BASE || inferApiBase();

// ── In-memory mutable state for standalone demo ──────────────────────────────
// Cloned on first use so optimistic updates (accept/reject) persist within session
let _liveMappings: FieldMapping[] | null = null;
function getLiveMappings(): FieldMapping[] {
  if (!_liveMappings) {
    _liveMappings = mockProjectPayload.fieldMappings.map((fm) => ({ ...fm }));
  }
  return _liveMappings;
}

let _mockLlmConfig: LLMConfigResponse = {
  config: {
    userId: 'standalone-user',
    mode: 'default',
    paused: false,
    provider: undefined,
    model: undefined,
    baseUrl: undefined,
    hasApiKey: false,
    apiKeyPreview: null,
    updatedAt: new Date().toISOString(),
  },
  effectiveProvider: 'heuristic',
  usingDefaultProvider: true,
};

let _mockLlmUsageEvents: LLMUsageEvent[] = [];

let _mockProject: Project = {
  ...mockProjectPayload.project,
  resolvedOneToManyMappings: {},
};

function isOneToManyMapping(mapping: FieldMapping): boolean {
  return mapping.rationale.includes('⚠️ One-to-Many field:');
}

function getMockOneToManyMappings(mappings = getLiveMappings()): FieldMapping[] {
  return mappings.filter((mapping) => mapping.status !== 'rejected' && mapping.status !== 'unmatched' && isOneToManyMapping(mapping));
}

function getMockProjectPayload(): ProjectPayload {
  return { ...mockProjectPayload, project: _mockProject, fieldMappings: getLiveMappings() };
}

function summarizeUsage(events: LLMUsageEvent[]): LLMUsageResponse['summary'] {
  const callsByProvider: Record<string, number> = {};
  let successfulCalls = 0;
  let failedCalls = 0;
  let totalTokens = 0;

  for (const event of events) {
    callsByProvider[event.provider] = (callsByProvider[event.provider] ?? 0) + 1;
    if (event.success) successfulCalls += 1;
    else failedCalls += 1;
    totalTokens += event.tokensUsed ?? 0;
  }

  return {
    totalCalls: events.length,
    successfulCalls,
    failedCalls,
    totalTokens,
    callsByProvider,
    windowHours: 24,
  };
}

function buildMockProjectList(): ProjectListResponse {
  const mappings = getLiveMappings();
  const unresolvedConflicts = buildMockConflicts(mappings).length;
  const preflight = buildMockPreflight(mappings);
  return {
    projects: [
      {
        project: _mockProject,
        sourceSystem: {
          id: _mockProject.sourceSystemId,
          name: 'SilverLake',
          type: 'core-banking',
        },
        targetSystem: {
          id: _mockProject.targetSystemId,
          name: 'Salesforce',
          type: 'crm',
        },
        fieldMappingCount: mappings.length,
        entityMappingCount: mockProjectPayload.entityMappings.length,
        canExport: preflight.canExport,
        unresolvedConflicts,
        unresolvedRoutingDecisions: preflight.unresolvedRoutingDecisions,
      },
    ],
  };
}

function buildMockConflicts(mappings = getLiveMappings()): MappingConflict[] {
  const targetFieldById = new Map(mockProjectPayload.fields.map((field) => [field.id, field]));
  const entityById = new Map(
    [...mockProjectPayload.sourceEntities, ...mockProjectPayload.targetEntities].map((entity) => [entity.id, entity]),
  );

  const grouped = new Map<string, FieldMapping[]>();
  for (const mapping of mappings) {
    if (mapping.status === 'rejected') continue;
    const current = grouped.get(mapping.targetFieldId) ?? [];
    current.push(mapping);
    grouped.set(mapping.targetFieldId, current);
  }

  const conflicts: MappingConflict[] = [];
  const detectedAt = new Date().toISOString();
  for (const [targetFieldId, competing] of grouped) {
    if (competing.length < 2) continue;
    const targetField = targetFieldById.get(targetFieldId);
    const targetEntity = targetField ? entityById.get(targetField.entityId) : undefined;
    conflicts.push({
      id: `conflict-${targetFieldId}`,
      targetFieldId,
      targetFieldName: targetField?.name ?? targetFieldId,
      targetEntityName: targetEntity?.name ?? 'Unknown Entity',
      competingMappingIds: competing.map((mapping) => mapping.id),
      resolvedWinnerId: null,
      detectedAt,
      resolvedAt: null,
    });
  }

  return conflicts;
}

function buildMockPreflight(mappings = getLiveMappings()): ProjectPreflight {
  const targetEntityIds = new Set(mockProjectPayload.targetEntities.map((entity) => entity.id));
  const targetFields = mockProjectPayload.fields.filter((field) => targetEntityIds.has(field.entityId));
  const targetFieldIds = new Set(targetFields.map((field) => field.id));
  const requiredTargetFields = targetFields.filter((field) => field.required);
  const scopedMappings = mappings.filter((mapping) => targetFieldIds.has(mapping.targetFieldId));
  const nonRejectedMappings = scopedMappings.filter((mapping) => mapping.status !== 'rejected');

  const mappingsByTargetField = new Map<string, FieldMapping[]>();
  for (const mapping of nonRejectedMappings) {
    const existing = mappingsByTargetField.get(mapping.targetFieldId) ?? [];
    existing.push(mapping);
    mappingsByTargetField.set(mapping.targetFieldId, existing);
  }

  const unmappedRequiredFields = requiredTargetFields
    .filter((field) => (mappingsByTargetField.get(field.id) ?? []).length === 0)
    .map((field) => ({ id: field.id, name: field.name, label: field.label }));

  const unresolvedConflicts = buildMockConflicts(mappings).length;
  const unresolvedRoutingDecisions = getMockOneToManyMappings(mappings).filter((mapping) => {
    const resolution = _mockProject.resolvedOneToManyMappings?.[mapping.sourceFieldId];
    return resolution?.targetFieldId !== mapping.targetFieldId;
  }).length;
  return {
    projectId: _mockProject.id,
    mappedTargetCount: new Set(nonRejectedMappings.map((mapping) => mapping.targetFieldId)).size,
    targetFieldCount: targetFields.length,
    acceptedMappingsCount: scopedMappings.filter((mapping) => mapping.status === 'accepted').length,
    suggestedMappingsCount: scopedMappings.filter(
      (mapping) => mapping.status === 'suggested' || mapping.status === 'modified',
    ).length,
    rejectedMappingsCount: scopedMappings.filter((mapping) => mapping.status === 'rejected').length,
    unmappedRequiredFields,
    unresolvedConflicts,
    unresolvedRoutingDecisions,
    canExport: unmappedRequiredFields.length === 0 && unresolvedConflicts === 0 && unresolvedRoutingDecisions === 0,
  };
}

// ── Mock request router ───────────────────────────────────────────────────────
function mockApiCall<T>(path: string, init?: RequestInit): T {
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(init.body as string) : {};

  // POST /api/projects → create project
  if (method === 'POST' && path === '/api/projects') {
    const name = (body.name as string | undefined) ?? _mockProject.name;
    _mockProject = { ..._mockProject, name, updatedAt: new Date().toISOString() };
    return { project: _mockProject } as T;
  }

  if (method === 'GET' && path === '/api/projects') {
    return buildMockProjectList() as T;
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
    return getMockProjectPayload() as T;
  }

  // GET /api/projects/:id/preflight
  if (method === 'GET' && /\/api\/projects\/[^/]+\/preflight$/.test(path)) {
    return buildMockPreflight() as T;
  }

  // GET /api/projects/:id/conflicts
  if (method === 'GET' && /\/api\/projects\/[^/]+\/conflicts$/.test(path)) {
    const conflicts = buildMockConflicts();
    return { conflicts, total: conflicts.length } as T;
  }

  // POST /api/projects/:id/conflicts/:conflictId/resolve
  if (method === 'POST' && /\/api\/projects\/[^/]+\/conflicts\/[^/]+\/resolve$/.test(path)) {
    const match = path.match(/\/api\/projects\/[^/]+\/conflicts\/([^/]+)\/resolve$/);
    const conflictId = match?.[1] ?? '';
    const targetFieldId = conflictId.startsWith('conflict-')
      ? conflictId.slice('conflict-'.length)
      : '';
    if (!targetFieldId) {
      throw new Error('Invalid conflict id');
    }

    const mappings = getLiveMappings();
    const competing = mappings.filter(
      (mapping) => mapping.targetFieldId === targetFieldId && mapping.status !== 'rejected',
    );
    if (competing.length < 2) {
      throw new Error('Conflict not found or already resolved');
    }

    if (body.action === 'pick') {
      if (typeof body.winnerMappingId !== 'string' || !competing.some((mapping) => mapping.id === body.winnerMappingId)) {
        throw new Error('winnerMappingId is required for pick action');
      }
      for (let index = 0; index < mappings.length; index += 1) {
        const mapping = mappings[index];
        if (mapping.targetFieldId !== targetFieldId || mapping.status === 'rejected') continue;
        mappings[index] = { ...mapping, status: mapping.id === body.winnerMappingId ? 'accepted' : 'rejected' };
      }
    } else {
      for (let index = 0; index < mappings.length; index += 1) {
        const mapping = mappings[index];
        if (mapping.targetFieldId !== targetFieldId || mapping.status === 'rejected') continue;
        mappings[index] = { ...mapping, status: 'rejected' };
      }
    }

    return { resolved: true, unresolvedConflicts: buildMockConflicts(mappings).length } as T;
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

  if (method === 'GET' && path.startsWith('/api/schema-intelligence/patterns')) {
    const url = new URL(path, 'http://mock.local');
    const field = url.searchParams.get('field') ?? undefined;
    const mappings = getLiveMappings();
    const candidates = field
      ? mappings
          .filter((mapping) => {
            const sourceField = mockProjectPayload.fields.find((item) => item.id === mapping.sourceFieldId);
            return sourceField?.name === field && isOneToManyMapping(mapping);
          })
          .map((mapping) => {
            const targetField = mockProjectPayload.fields.find((item) => item.id === mapping.targetFieldId);
            const targetEntity = targetField ? [...mockProjectPayload.sourceEntities, ...mockProjectPayload.targetEntities].find((entity) => entity.id === targetField.entityId) : undefined;
            return targetField
              ? {
                  xmlField: field,
                  normalizedFieldKey: field.toLowerCase().replace(/[^a-z0-9]/g, ''),
                  targetFieldName: targetField.name,
                  targetObject: targetEntity?.name ?? 'Unknown',
                  confidence: 'HIGH' as const,
                  notes: 'Standalone mock candidate',
                  isOneToMany: true,
                  isFormulaTarget: false,
                  isPersonAccountOnly: false,
                }
              : null;
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [];
    return { field, candidates } as T;
  }

  if (method === 'POST' && /\/api\/projects\/[^/]+\/one-to-many-resolutions$/.test(path)) {
    const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
    const mappings = getLiveMappings();
    const fieldsById = new Map(mockProjectPayload.fields.map((field) => [field.id, field]));
    const entitiesById = new Map([...mockProjectPayload.sourceEntities, ...mockProjectPayload.targetEntities].map((entity) => [entity.id, entity]));
    const nextResolved: Record<string, OneToManyResolution> = { ...(_mockProject.resolvedOneToManyMappings ?? {}) };

    for (const resolution of resolutions) {
      const idx = mappings.findIndex((mapping) => mapping.id === resolution.fieldMappingId);
      if (idx === -1) continue;
      const mapping = mappings[idx];
      const targetField = fieldsById.get(resolution.targetFieldId as string);
      const sourceField = fieldsById.get(resolution.sourceFieldId as string);
      if (!targetField || !sourceField) continue;
      mappings[idx] = {
        ...mapping,
        targetFieldId: targetField.id,
        status: mapping.status === 'unmatched' || mapping.targetFieldId !== targetField.id ? 'modified' : mapping.status,
      };
      nextResolved[sourceField.id] = {
        sourceFieldId: sourceField.id,
        sourceFieldName: sourceField.name,
        targetFieldId: targetField.id,
        targetFieldName: targetField.name,
        targetObject: entitiesById.get(targetField.entityId)?.name,
        resolvedAt: new Date().toISOString(),
      };
    }
    _mockProject = { ..._mockProject, resolvedOneToManyMappings: nextResolved, updatedAt: new Date().toISOString() };
    return { project: _mockProject, fieldMappings: mappings } as T;
  }

  // Auth endpoints for standalone preview
  if (method === 'GET' && path === '/api/auth/setup-status') {
    return { requiresSetup: false } as T;
  }

  if (method === 'GET' && path === '/api/auth/me') {
    return {
      user: {
        id: 'standalone-user',
        email: 'demo@automapper.local',
        name: 'Standalone Demo',
        role: 'ADMIN',
        orgSlug: 'default',
      },
    } as T;
  }

  if (method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/setup')) {
    return {
      user: {
        id: 'standalone-user',
        email: 'demo@automapper.local',
        name: 'Standalone Demo',
        role: 'ADMIN',
        orgSlug: 'default',
      },
    } as T;
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    return {} as T;
  }

  if (method === 'GET' && path === '/api/llm/config') {
    return _mockLlmConfig as T;
  }

  if (method === 'PUT' && path === '/api/llm/config') {
    const mode = body.mode === 'byol' ? 'byol' : 'default';
    const provider = body.provider as LLMConfigResponse['config']['provider'];
    const paused = Boolean(body.paused);
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null;
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';

    _mockLlmConfig = {
      config: {
        ..._mockLlmConfig.config,
        mode,
        paused: mode === 'byol' ? paused : false,
        provider: mode === 'byol' ? provider : undefined,
        model: mode === 'byol' && model ? model : undefined,
        baseUrl: mode === 'byol' && provider === 'custom' && baseUrl ? baseUrl : undefined,
        hasApiKey: apiKey ? true : _mockLlmConfig.config.hasApiKey,
        apiKeyPreview: apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : _mockLlmConfig.config.apiKeyPreview,
        updatedAt: new Date().toISOString(),
      },
      effectiveProvider: mode === 'byol' && !paused ? (provider ?? 'openai') : 'heuristic',
      usingDefaultProvider: mode !== 'byol' || paused,
    };
    return _mockLlmConfig as T;
  }

  if (method === 'GET' && path.startsWith('/api/llm/usage')) {
    return {
      summary: summarizeUsage(_mockLlmUsageEvents),
      events: _mockLlmUsageEvents,
    } as T;
  }

  // Fallback
  return {} as T;
}

export function getAuthTokenForSse(): string | null {
  return null;
}

// ── api() ─────────────────────────────────────────────────────────────────────
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (STANDALONE) {
    // Simulate realistic network latency
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
    return mockApiCall<T>(path, init);
  }

  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const method = (init?.method ?? 'GET').toUpperCase();

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: {
        ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    await reportApiError({
      path,
      method,
      message,
      error,
    });
    throw error;
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const message =
      (errBody as { error?: { message?: string } }).error?.message ||
      `Request failed (${response.status})`;
    await reportApiError({
      path,
      method,
      status: response.status,
      message,
      responseBody: errBody,
    });
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function apiBase(): string {
  return STANDALONE ? '' : API_BASE;
}

export function isDemoUiMode(): boolean {
  return STANDALONE;
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
  return new EventSource(url, { withCredentials: true });
}

/** Call this when the user resets the workflow (e.g. "Change connectors") */
export function resetMockState(): void {
  _liveMappings = null;
  _mockProject = { ...mockProjectPayload.project, resolvedOneToManyMappings: {} };
  _mockLlmUsageEvents = [];
  _mockLlmConfig = {
    config: {
      userId: 'standalone-user',
      mode: 'default',
      paused: false,
      provider: undefined,
      model: undefined,
      baseUrl: undefined,
      hasApiKey: false,
      apiKeyPreview: null,
      updatedAt: new Date().toISOString(),
    },
    effectiveProvider: 'heuristic',
    usingDefaultProvider: true,
  };
}
