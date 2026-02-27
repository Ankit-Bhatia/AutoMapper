/**
 * agentRoutes — REST/SSE API for the Phase 2 multi-agent orchestration pipeline.
 *
 * Endpoints:
 *   POST /api/projects/:id/orchestrate   Run the full agent pipeline (SSE stream)
 *   GET  /api/projects/:id/compliance    Return the latest compliance report
 */
import type { Express, Request, Response } from 'express';
import type { DbStore } from '../db/dbStore.js';
import { OrchestratorAgent } from '../agents/OrchestratorAgent.js';
import type { AgentContext } from '../agents/types.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import type { SystemType } from '../types.js';

/** Compliance reports keyed by projectId — persisted in memory per server lifetime */
const complianceCache = new Map<string, unknown>();

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function setupAgentRoutes(app: Express, store: DbStore): void {

  // ─── POST /api/projects/:id/orchestrate ───────────────────────────────────
  // Runs the full OrchestratorAgent pipeline and streams steps via SSE.
  app.post(
    '/api/projects/:id/orchestrate',
    authMiddleware,
    async (req: Request, res: Response) => {
      const project = await store.getProject(req.params.id);
      if (!project) {
        sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
        return;
      }

      const state = await store.getState();
      const sourceSystem = state.systems.find((s) => s.id === project.sourceSystemId);
      const targetSystem = state.systems.find((s) => s.id === project.targetSystemId);

      const sourceEntities = state.entities.filter((e) => e.systemId === project.sourceSystemId);
      const targetEntities = state.entities.filter((e) => e.systemId === project.targetSystemId);

      const entityMappings = state.entityMappings.filter((m) => m.projectId === project.id);
      const entityMappingIds = new Set(entityMappings.map((e) => e.id));
      const fieldMappings = state.fieldMappings.filter((f) => entityMappingIds.has(f.entityMappingId));

      if (!fieldMappings.length) {
        sendError(res, 400, 'NO_MAPPINGS', 'Run suggest-mappings first to generate initial field mappings');
        return;
      }

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeEvent = (payload: object) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      writeEvent({
        type: 'start',
        projectId: project.id,
        totalMappings: fieldMappings.length,
        sourceSystemType: sourceSystem?.type,
        targetSystemType: targetSystem?.type,
        hasLLM: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
      });

      const context: AgentContext = {
        projectId: project.id,
        sourceSystemType: (sourceSystem?.type ?? 'unknown') as SystemType,
        targetSystemType: (targetSystem?.type ?? 'unknown') as SystemType,
        sourceEntities,
        targetEntities,
        fields: state.fields,
        entityMappings,
        fieldMappings,
        onStep: (step) => {
          writeEvent({ type: 'step', ...step });
        },
      };

      try {
        const orchestrator = new OrchestratorAgent();
        const result = await orchestrator.orchestrate(context);

        // Persist updated mappings
        await store.upsertMappings(project.id, entityMappings, result.updatedFieldMappings);

        // Cache compliance report
        if (result.complianceReport) {
          complianceCache.set(project.id, result.complianceReport);
        }

        writeEvent({
          type: 'complete',
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Orchestration failed';
        writeEvent({ type: 'error', message });
      } finally {
        res.end();
      }
    },
  );

  // ─── GET /api/projects/:id/compliance ─────────────────────────────────────
  app.get(
    '/api/projects/:id/compliance',
    authMiddleware,
    async (req: Request, res: Response) => {
      const project = await store.getProject(req.params.id);
      if (!project) {
        sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
        return;
      }

      const report = complianceCache.get(project.id);
      if (!report) {
        sendError(res, 404, 'NO_COMPLIANCE_REPORT', 'Run orchestrate first to generate a compliance report');
        return;
      }

      res.json({ projectId: project.id, report });
    },
  );
}
