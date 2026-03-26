import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbStore } from '../db/dbStore.js';
import { setupAgentRoutes } from '../routes/agentRoutes.js';

vi.mock('../agents/OrchestratorAgent.js', () => ({
  OrchestratorAgent: class OrchestratorAgent {
    async orchestrate(context: {
      fieldMappings: Array<Record<string, unknown>>;
      onStep: (step: Record<string, unknown>) => void;
    }) {
      context.onStep({
        agentName: 'SchemaDiscoveryAgent',
        action: 'start',
        detail: 'Starting schema checks',
      });
      context.onStep({
        agentName: 'SchemaDiscoveryAgent',
        action: 'schema_complete',
        detail: 'Schema complete',
      });
      return {
        updatedFieldMappings: context.fieldMappings.map((mapping) => ({
          ...mapping,
          status: 'accepted',
        })),
        totalImproved: 1,
        agentsRun: ['SchemaDiscoveryAgent'],
        durationMs: 12,
        complianceReport: null,
      };
    }
  },
}));

vi.mock('../services/llmSettingsStore.js', () => ({
  llmSettingsStore: {
    getRuntimeConfig: vi.fn(async () => ({
      useDefault: true,
      paused: false,
    })),
    captureUsage: vi.fn(async () => undefined),
  },
}));

interface SseEvent {
  type?: string;
  [key: string]: unknown;
}

async function readSseUntilComplete(response: Response, timeoutMs = 30_000): Promise<SseEvent[]> {
  if (!response.body) {
    throw new Error('Missing SSE response body');
  }

  const events: SseEvent[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx = buffer.indexOf('\n\n');
    while (idx >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const dataLine = frame
        .split('\n')
        .find((line) => line.startsWith('data: '));
      if (dataLine) {
        const parsed = JSON.parse(dataLine.slice(6)) as SseEvent;
        events.push(parsed);
      }

      idx = buffer.indexOf('\n\n');
    }

    if (events.some((event) => event.type === 'complete')) {
      break;
    }
  }

  await reader.cancel();
  return events;
}

describe('orchestration SSE route', () => {
  const previousRequireAuth = process.env.REQUIRE_AUTH;
  let server: ReturnType<typeof express.application.listen> | null = null;
  let baseUrl = '';

  beforeEach(() => {
    process.env.REQUIRE_AUTH = 'false';

    const project = {
      id: 'project-1',
      name: 'Test',
      sourceSystemId: 'sys-source',
      targetSystemId: 'sys-target',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockStore = {
      getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      getState: vi.fn(async () => ({
        systems: [
          { id: 'sys-source', name: 'Source', type: 'sap' },
          { id: 'sys-target', name: 'Target', type: 'salesforce' },
        ],
        entities: [
          { id: 'ent-source', systemId: 'sys-source', name: 'SourceEntity' },
          { id: 'ent-target', systemId: 'sys-target', name: 'TargetEntity' },
        ],
        fields: [
          { id: 'sf-1', entityId: 'ent-source', name: 'SourceField', dataType: 'string' },
          { id: 'tf-1', entityId: 'ent-target', name: 'TargetField', dataType: 'string' },
        ],
        relationships: [],
        projects: [project],
        entityMappings: [
          {
            id: 'em-1',
            projectId: project.id,
            sourceEntityId: 'ent-source',
            targetEntityId: 'ent-target',
            confidence: 0.8,
            rationale: 'seed',
          },
        ],
        fieldMappings: [
          {
            id: 'fm-1',
            entityMappingId: 'em-1',
            sourceFieldId: 'sf-1',
            targetFieldId: 'tf-1',
            transform: { type: 'direct', config: {} },
            confidence: 0.8,
            rationale: 'seed',
            status: 'suggested',
          },
        ],
      })),
      upsertMappings: vi.fn(async () => undefined),
    } as unknown as DbStore;

    const app = express();
    app.use(express.json());
    setupAgentRoutes(app, mockStore);

    server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    process.env.REQUIRE_AUTH = previousRequireAuth;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
  });

  it('streams complete payload with entityMappings and fieldMappings in auth bypass mode', async () => {
    const response = await fetch(`${baseUrl}/api/projects/project-1/orchestrate`, {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = await readSseUntilComplete(response);
    const complete = events.find((event) => event.type === 'complete');
    expect(complete).toBeDefined();
    expect(Array.isArray(complete?.entityMappings)).toBe(true);
    expect(Array.isArray(complete?.fieldMappings)).toBe(true);
  });
});
