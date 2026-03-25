/**
 * agentRoutes — REST/SSE API for the Phase 2 multi-agent orchestration pipeline.
 *
 * Endpoints:
 *   POST /api/projects/:id/orchestrate   Run the full agent pipeline (SSE stream)
 *   GET  /api/projects/:id/compliance    Return the latest compliance report
 */
import type { Express, Request, Response } from 'express';
import type { DbStore } from '../db/dbStore.js';
import type { FsStore } from '../utils/fsStore.js';
import { OrchestratorAgent } from '../agents/OrchestratorAgent.js';
import type { AgentContext } from '../agents/types.js';
import { activeProvider } from '../agents/llm/LLMGateway.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import type { SystemType } from '../types.js';
import { captureException, sendHttpError } from '../utils/httpErrors.js';
import { runWithLLMRuntimeContext } from '../services/llmRuntimeContext.js';
import { llmSettingsStore } from '../services/llmSettingsStore.js';

/** Compliance reports keyed by projectId — persisted in memory per server lifetime */
const complianceCache = new Map<string, unknown>();
const HEARTBEAT_INTERVAL_MS = 5000;
const DB_CALL_TIMEOUT_MS = 8000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function sendError(req: Request, res: Response, status: number, code: string, message: string): void {
  sendHttpError(req, res, status, code, message, null, 'orchestrator');
}

async function withLLMContext<T>(
  req: Request,
  res: Response,
  projectId: string | undefined,
  handler: () => Promise<T>,
): Promise<T> {
  const userId = req.user?.userId ?? 'demo-admin';
  const runtimeConfig = await llmSettingsStore.getRuntimeConfig(userId);
  return runWithLLMRuntimeContext(
    {
      llmConfig: runtimeConfig,
      usageMeta: {
        userId,
        projectId,
        requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined,
      },
      onUsage: (capture, meta) => {
        if (!meta?.userId) return;
        void llmSettingsStore.captureUsage(meta.userId, capture, {
          projectId: meta.projectId,
          requestId: meta.requestId,
        });
      },
    },
    handler,
  );
}

export function setupAgentRoutes(app: Express, store: DbStore | FsStore): void {
  const handleOrchestrationSse = async (req: Request, res: Response) => {
    let project;
    try {
      project = await withTimeout(Promise.resolve(store.getProject(req.params.id)), DB_CALL_TIMEOUT_MS, 'getProject');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not resolve project';
      sendError(req, res, 503, 'DB_TIMEOUT', message);
      return;
    }
    if (!project) {
      sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
      return;
    }

    let state;
    try {
      state = await withTimeout(Promise.resolve(store.getState()), DB_CALL_TIMEOUT_MS, 'getState');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load project state';
      sendError(req, res, 503, 'DB_TIMEOUT', message);
      return;
    }
    const sourceSystem = state.systems.find((s) => s.id === project.sourceSystemId);
    const targetSystem = state.systems.find((s) => s.id === project.targetSystemId);

    const sourceEntities = state.entities.filter((e) => e.systemId === project.sourceSystemId);
    const targetEntities = state.entities.filter((e) => e.systemId === project.targetSystemId);
    const scopedEntityIds = new Set([...sourceEntities, ...targetEntities].map((entity) => entity.id));
    const relationships = state.relationships.filter(
      (relationship) => scopedEntityIds.has(relationship.fromEntityId) && scopedEntityIds.has(relationship.toEntityId),
    );

    const entityMappings = state.entityMappings.filter((m) => m.projectId === project.id);
    const entityMappingIds = new Set(entityMappings.map((e) => e.id));
    const fieldMappings = state.fieldMappings.filter((f) => entityMappingIds.has(f.entityMappingId));

    if (!fieldMappings.length) {
      sendError(req, res, 400, 'NO_MAPPINGS', 'Run suggest-mappings first to generate initial field mappings');
      return;
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const writeEvent = (payload: object) => {
      if (res.writableEnded || req.destroyed) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      writeEvent({ type: 'heartbeat', ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
    });

    try {
      await withLLMContext(req, res, project.id, async () => {
        const llmProvider = activeProvider();
        writeEvent({
          type: 'start',
          projectId: project.id,
          totalMappings: fieldMappings.length,
          sourceSystemType: sourceSystem?.type,
          targetSystemType: targetSystem?.type,
          llmProvider,
          hasLLM: llmProvider !== 'heuristic',
        });

        const context: AgentContext = {
          projectId: project.id,
          sourceSystemType: (sourceSystem?.type ?? 'unknown') as SystemType,
          targetSystemType: (targetSystem?.type ?? 'unknown') as SystemType,
          sourceEntities,
          targetEntities,
          fields: state.fields,
          relationships,
          entityMappings,
          fieldMappings,
          onStep: (step) => {
            writeEvent({ type: 'step', ...step });
          },
        };

        const orchestrator = new OrchestratorAgent();
        const result = await orchestrator.orchestrate(context);

        // Persist updated mappings
        await withTimeout(
          Promise.resolve(store.upsertMappings(project.id, entityMappings, result.updatedFieldMappings)),
          DB_CALL_TIMEOUT_MS,
          'upsertMappings',
        );

        // Cache compliance report
        if (result.complianceReport) {
          complianceCache.set(project.id, result.complianceReport);
        }

        writeEvent({
          type: 'complete',
          entityMappings,
          fieldMappings: result.updatedFieldMappings,
          totalImproved: result.totalImproved,
          agentsRun: result.agentsRun,
          durationMs: result.durationMs,
          complianceSummary: result.complianceReport
            ? {
                errors: result.complianceReport.totalErrors,
                warnings: result.complianceReport.totalWarnings,
                piiFields: result.complianceReport.piiFieldCount,
              }
            : null,
        });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Orchestration failed';
      captureException('orchestrator', error, {
        code: 'ORCHESTRATION_ERROR',
        context: {
          requestId: res.locals.requestId as string | undefined,
          projectId: project.id,
          path: req.originalUrl || req.url,
          method: req.method,
          userId: req.user?.userId,
        },
      });
      writeEvent({ type: 'error', message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  };

  // ─── POST /api/projects/:id/orchestrate ───────────────────────────────────
  // Runs the full OrchestratorAgent pipeline and streams steps via SSE.
  app.post('/api/projects/:id/orchestrate', authMiddleware, handleOrchestrationSse);
  app.get('/api/projects/:id/orchestrate', authMiddleware, handleOrchestrationSse);

  // ─── GET /api/projects/:id/compliance ─────────────────────────────────────
  app.get(
    '/api/projects/:id/compliance',
    authMiddleware,
    async (req: Request, res: Response) => {
      const project = await store.getProject(req.params.id);
      if (!project) {
        sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
        return;
      }

      const report = complianceCache.get(project.id);
      if (!report) {
        sendError(req, res, 404, 'NO_COMPLIANCE_REPORT', 'Run orchestrate first to generate a compliance report');
        return;
      }

      res.json({ projectId: project.id, report });
    },
  );
}
