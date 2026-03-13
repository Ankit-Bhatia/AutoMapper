import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../auth/authMiddleware.js';
import { activeProvider } from '../agents/llm/LLMGateway.js';
import { runWithLLMRuntimeContext } from '../services/llmRuntimeContext.js';
import { llmSettingsStore } from '../services/llmSettingsStore.js';
import { sendHttpError } from '../utils/httpErrors.js';

function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  sendHttpError(req, res, status, code, message, details, 'api');
}

function toUserId(req: Request): string {
  return req.user?.userId ?? 'demo-admin';
}

function isValidProvider(value: unknown): value is 'openai' | 'anthropic' | 'gemini' | 'custom' {
  return value === 'openai' || value === 'anthropic' || value === 'gemini' || value === 'custom';
}

function isValidMode(value: unknown): value is 'default' | 'byol' {
  return value === 'default' || value === 'byol';
}

export function setupLLMRoutes(app: Express): void {
  app.get('/api/llm/config', authMiddleware, (req: Request, res: Response) => {
    const userId = toUserId(req);
    const runtimeConfig = llmSettingsStore.getRuntimeConfig(userId);
    const effectiveProvider = runWithLLMRuntimeContext(
      { llmConfig: runtimeConfig },
      () => activeProvider(),
    );
    const config = llmSettingsStore.getPublicConfig(userId);
    res.json({
      config,
      effectiveProvider,
      usingDefaultProvider: runtimeConfig.useDefault,
    });
  });

  app.put('/api/llm/config', authMiddleware, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const modeRaw = body.mode;
    const providerRaw = body.provider;
    const pausedRaw = body.paused;
    const apiKeyRaw = body.apiKey;
    const baseUrlRaw = body.baseUrl;
    const modelRaw = body.model;

    if (modeRaw !== undefined && !isValidMode(modeRaw)) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'mode must be "default" or "byol"');
      return;
    }
    if (providerRaw !== undefined && !isValidProvider(providerRaw)) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'provider must be openai|anthropic|gemini|custom');
      return;
    }
    if (pausedRaw !== undefined && typeof pausedRaw !== 'boolean') {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'paused must be a boolean');
      return;
    }
    if (apiKeyRaw !== undefined && typeof apiKeyRaw !== 'string') {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'apiKey must be a string');
      return;
    }
    if (baseUrlRaw !== undefined && typeof baseUrlRaw !== 'string') {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'baseUrl must be a string');
      return;
    }
    if (modelRaw !== undefined && typeof modelRaw !== 'string') {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'model must be a string');
      return;
    }
    const userId = toUserId(req);
    const existingConfig = llmSettingsStore.getUserConfig(userId);
    const effectiveMode = (modeRaw ?? existingConfig.mode) as 'default' | 'byol';
    const nextProvider = (providerRaw ?? existingConfig.provider) as 'openai' | 'anthropic' | 'gemini' | 'custom' | undefined;
    const effectiveBaseUrl =
      typeof baseUrlRaw === 'string'
        ? (baseUrlRaw.trim() || undefined)
        : existingConfig.baseUrl;

    if (effectiveMode === 'byol' && nextProvider === 'custom' && !effectiveBaseUrl) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'custom provider requires a non-empty baseUrl');
      return;
    }

    llmSettingsStore.upsertUserConfig(userId, {
      mode: modeRaw as 'default' | 'byol' | undefined,
      provider: providerRaw as 'openai' | 'anthropic' | 'gemini' | 'custom' | undefined,
      paused: pausedRaw as boolean | undefined,
      apiKey: apiKeyRaw as string | undefined,
      baseUrl: baseUrlRaw as string | undefined,
      model: modelRaw as string | undefined,
    });

    const runtimeConfig = llmSettingsStore.getRuntimeConfig(userId);
    const effectiveProvider = runWithLLMRuntimeContext(
      { llmConfig: runtimeConfig },
      () => activeProvider(),
    );

    res.json({
      config: llmSettingsStore.getPublicConfig(userId),
      effectiveProvider,
      usingDefaultProvider: runtimeConfig.useDefault,
    });
  });

  app.get('/api/llm/usage', authMiddleware, (req: Request, res: Response) => {
    const userId = toUserId(req);
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
    const hoursRaw = typeof req.query.windowHours === 'string' ? Number.parseInt(req.query.windowHours, 10) : 24;
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const windowHours = Number.isFinite(hoursRaw) ? hoursRaw : 24;

    const summary = llmSettingsStore.summarizeUsage(userId, windowHours);
    const events = llmSettingsStore.listUsage(userId, limit);

    res.json({
      summary,
      events,
    });
  });
}
