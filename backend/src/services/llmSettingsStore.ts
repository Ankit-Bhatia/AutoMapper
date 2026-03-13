import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LLMUsageCapture, RuntimeLLMConfig, RuntimeLLMProvider } from './llmRuntimeContext.js';

type LLMMode = 'default' | 'byol';

export interface UserLLMConfig {
  userId: string;
  mode: LLMMode;
  paused: boolean;
  provider?: RuntimeLLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredUserLLMConfig extends UserLLMConfig {}

interface ConfigPatch {
  mode?: LLMMode;
  paused?: boolean;
  provider?: RuntimeLLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface LLMUsageEvent {
  id: string;
  createdAt: string;
  userId: string;
  projectId?: string;
  requestId?: string;
  provider: string;
  model?: string;
  tokensUsed?: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface LLMUsageSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
  callsByProvider: Record<string, number>;
  windowHours: number;
}

function defaultDataDir(): string {
  return path.resolve(process.env.DATA_DIR || './data');
}

function resolvePath(envKey: string, fallbackFile: string): string {
  const configured = process.env[envKey];
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.join(defaultDataDir(), fallbackFile);
}

function ensureFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8');
}

function loadJsonArray<T>(filePath: string): T[] {
  ensureFile(filePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function persistJsonArray<T>(filePath: string, rows: T[]): void {
  ensureFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
}

function normalizeProvider(raw: unknown): RuntimeLLMProvider | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'openai' || v === 'anthropic' || v === 'gemini' || v === 'custom') return v;
  return undefined;
}

function normalizeMode(raw: unknown): LLMMode {
  return raw === 'byol' ? 'byol' : 'default';
}

function redactApiKey(apiKey: string | undefined): string | null {
  if (!apiKey) return null;
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export class LLMSettingsStore {
  private readonly configFilePath: string;
  private readonly usageFilePath: string;
  private readonly maxUsageEvents: number;
  private configs: StoredUserLLMConfig[];
  private usageEvents: LLMUsageEvent[];

  constructor(options?: {
    configFilePath?: string;
    usageFilePath?: string;
    maxUsageEvents?: number;
  }) {
    this.configFilePath = options?.configFilePath ?? resolvePath('LLM_CONFIGS_FILE', 'llm-configs.json');
    this.usageFilePath = options?.usageFilePath ?? resolvePath('LLM_USAGE_FILE', 'llm-usage.json');
    this.maxUsageEvents = options?.maxUsageEvents ?? 20_000;
    this.configs = loadJsonArray<StoredUserLLMConfig>(this.configFilePath)
      .filter((row) => row && typeof row.userId === 'string');
    this.usageEvents = loadJsonArray<LLMUsageEvent>(this.usageFilePath)
      .filter((row) => row && typeof row.userId === 'string');
  }

  getUserConfig(userId: string): UserLLMConfig {
    const existing = this.configs.find((row) => row.userId === userId);
    if (existing) return { ...existing };

    const now = new Date().toISOString();
    return {
      userId,
      mode: 'default',
      paused: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  upsertUserConfig(userId: string, patch: ConfigPatch): UserLLMConfig {
    const now = new Date().toISOString();
    const existingIndex = this.configs.findIndex((row) => row.userId === userId);
    const existing = existingIndex >= 0 ? this.configs[existingIndex] : null;

    const next: StoredUserLLMConfig = {
      userId,
      mode: normalizeMode(patch.mode ?? existing?.mode),
      paused: typeof patch.paused === 'boolean' ? patch.paused : (existing?.paused ?? false),
      provider: normalizeProvider(patch.provider ?? existing?.provider),
      apiKey:
        typeof patch.apiKey === 'string'
          ? patch.apiKey.trim() || undefined
          : existing?.apiKey,
      baseUrl:
        typeof patch.baseUrl === 'string'
          ? patch.baseUrl.trim() || undefined
          : existing?.baseUrl,
      model:
        typeof patch.model === 'string'
          ? patch.model.trim() || undefined
          : existing?.model,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (next.mode === 'default') {
      next.provider = undefined;
      next.apiKey = undefined;
      next.baseUrl = undefined;
      next.model = undefined;
      next.paused = false;
    }

    if (next.mode === 'byol' && !next.provider) {
      next.provider = 'openai';
    }

    if (next.provider !== 'custom') {
      next.baseUrl = undefined;
    }

    if (existingIndex >= 0) {
      this.configs[existingIndex] = next;
    } else {
      this.configs.push(next);
    }
    persistJsonArray(this.configFilePath, this.configs);
    return { ...next };
  }

  getRuntimeConfig(userId: string): RuntimeLLMConfig {
    const cfg = this.getUserConfig(userId);
    if (cfg.mode !== 'byol') {
      return {
        useDefault: true,
        paused: false,
      };
    }

    if (cfg.paused) {
      return {
        useDefault: true,
        paused: true,
      };
    }

    return {
      useDefault: false,
      paused: false,
      provider: cfg.provider,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
    };
  }

  getPublicConfig(userId: string): {
    userId: string;
    mode: LLMMode;
    paused: boolean;
    provider?: RuntimeLLMProvider;
    model?: string;
    baseUrl?: string;
    hasApiKey: boolean;
    apiKeyPreview: string | null;
    updatedAt: string;
  } {
    const cfg = this.getUserConfig(userId);
    return {
      userId: cfg.userId,
      mode: cfg.mode,
      paused: cfg.paused,
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      hasApiKey: Boolean(cfg.apiKey),
      apiKeyPreview: redactApiKey(cfg.apiKey),
      updatedAt: cfg.updatedAt,
    };
  }

  captureUsage(
    userId: string,
    capture: LLMUsageCapture,
    meta?: { projectId?: string; requestId?: string },
  ): LLMUsageEvent {
    const event: LLMUsageEvent = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      userId,
      projectId: meta?.projectId,
      requestId: meta?.requestId,
      provider: capture.provider,
      model: capture.model,
      tokensUsed: capture.tokensUsed,
      durationMs: capture.durationMs,
      success: capture.success,
      error: capture.error,
    };

    this.usageEvents.unshift(event);
    if (this.usageEvents.length > this.maxUsageEvents) {
      this.usageEvents = this.usageEvents.slice(0, this.maxUsageEvents);
    }
    persistJsonArray(this.usageFilePath, this.usageEvents);
    return event;
  }

  listUsage(userId: string, limit = 100): LLMUsageEvent[] {
    const bounded = Math.max(1, Math.min(limit, 500));
    return this.usageEvents
      .filter((row) => row.userId === userId)
      .slice(0, bounded);
  }

  summarizeUsage(userId: string, windowHours = 24): LLMUsageSummary {
    const boundedHours = Math.max(1, Math.min(windowHours, 24 * 30));
    const cutoff = Date.now() - boundedHours * 3_600_000;
    const recent = this.usageEvents.filter(
      (row) => row.userId === userId && Date.parse(row.createdAt) >= cutoff,
    );

    const callsByProvider: Record<string, number> = {};
    let successfulCalls = 0;
    let failedCalls = 0;
    let totalTokens = 0;

    for (const event of recent) {
      callsByProvider[event.provider] = (callsByProvider[event.provider] ?? 0) + 1;
      if (event.success) successfulCalls += 1;
      else failedCalls += 1;
      totalTokens += event.tokensUsed ?? 0;
    }

    return {
      totalCalls: recent.length,
      successfulCalls,
      failedCalls,
      totalTokens,
      callsByProvider,
      windowHours: boundedHours,
    };
  }
}

export const llmSettingsStore = new LLMSettingsStore();
