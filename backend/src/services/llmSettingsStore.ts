import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../db/prismaClient.js';
import type { LLMUsageCapture, RuntimeLLMConfig, RuntimeLLMProvider } from './llmRuntimeContext.js';

type LLMMode = 'default' | 'byol';

type PrismaClientLike = {
  lLMUserConfig: {
    findUnique: (args: unknown) => Promise<{
      id: string;
      userId: string;
      mode: string;
      provider: string | null;
      encryptedApiKey: string | null;
      apiKeyHint: string | null;
      baseUrl: string | null;
      model: string | null;
      paused: boolean;
      createdAt: Date;
      updatedAt: Date;
    } | null>;
    upsert: (args: unknown) => Promise<{
      id: string;
      userId: string;
      mode: string;
      provider: string | null;
      encryptedApiKey: string | null;
      apiKeyHint: string | null;
      baseUrl: string | null;
      model: string | null;
      paused: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>;
  };
  lLMUsageEvent: {
    create: (args: unknown) => Promise<{
      id: string;
      createdAt: Date;
      userId: string;
      projectId: string | null;
      requestId: string | null;
      provider: string;
      model: string | null;
      tokensUsed: number | null;
      durationMs: number;
      success: boolean;
      error: string | null;
    }>;
    findMany: (args: unknown) => Promise<Array<{
      id: string;
      createdAt: Date;
      userId: string;
      projectId: string | null;
      requestId: string | null;
      provider: string;
      model: string | null;
      tokensUsed: number | null;
      durationMs: number;
      success: boolean;
      error: string | null;
    }>>;
  };
};

export interface UserLLMConfig {
  userId: string;
  mode: LLMMode;
  paused: boolean;
  provider?: RuntimeLLMProvider;
  apiKey?: string;
  apiKeyHint?: string;
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

function loadJsonArrayIfExists<T>(filePath: string): T[] | null {
  if (!fs.existsSync(filePath)) return null;
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

function apiKeyHint(apiKey: string | undefined): string | undefined {
  if (!apiKey) return undefined;
  return apiKey.length <= 4 ? apiKey : apiKey.slice(-4);
}

function deriveEncryptionKey(explicit?: string): Buffer | null {
  const source = explicit?.trim()
    || process.env.LLM_CONFIG_ENCRYPTION_KEY?.trim()
    || process.env.JWT_SECRET?.trim()
    || (process.env.NODE_ENV === 'test' ? 'automapper-test-llm-settings-key' : '');
  if (!source) return null;
  return createHash('sha256').update(source).digest();
}

function toUsageEvent(row: {
  id: string;
  createdAt: string | Date;
  userId: string;
  projectId?: string | null;
  requestId?: string | null;
  provider: string;
  model?: string | null;
  tokensUsed?: number | null;
  durationMs: number;
  success: boolean;
  error?: string | null;
}): LLMUsageEvent {
  return {
    id: row.id,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    userId: row.userId,
    projectId: row.projectId ?? undefined,
    requestId: row.requestId ?? undefined,
    provider: row.provider,
    model: row.model ?? undefined,
    tokensUsed: row.tokensUsed ?? undefined,
    durationMs: row.durationMs,
    success: row.success,
    error: row.error ?? undefined,
  };
}

export class LLMSettingsStore {
  private readonly configFilePath: string;
  private readonly usageFilePath: string;
  private readonly maxUsageEvents: number;
  private readonly prismaClient: PrismaClientLike | null;
  private readonly encryptionKey: Buffer | null;
  private configs: StoredUserLLMConfig[];
  private usageEvents: LLMUsageEvent[];

  constructor(options?: {
    configFilePath?: string;
    usageFilePath?: string;
    maxUsageEvents?: number;
    prismaClient?: PrismaClientLike | null;
    encryptionKey?: string;
  }) {
    this.configFilePath = options?.configFilePath ?? resolvePath('LLM_CONFIGS_FILE', 'llm-configs.json');
    this.usageFilePath = options?.usageFilePath ?? resolvePath('LLM_USAGE_FILE', 'llm-usage.json');
    this.maxUsageEvents = options?.maxUsageEvents ?? 20_000;
    this.prismaClient = options && 'prismaClient' in options
      ? (options.prismaClient ?? null)
      : (process.env.DATABASE_URL ? (prisma as unknown as PrismaClientLike) : null);
    this.encryptionKey = deriveEncryptionKey(options?.encryptionKey);
    this.configs = this.prismaClient
      ? []
      : loadJsonArray<StoredUserLLMConfig>(this.configFilePath).filter((row) => row && typeof row.userId === 'string');
    this.usageEvents = this.prismaClient
      ? []
      : loadJsonArray<LLMUsageEvent>(this.usageFilePath).filter((row) => row && typeof row.userId === 'string');
    if (this.prismaClient) {
      void this.seedFromLegacyFiles().catch(() => undefined);
    }
  }

  private encryptApiKey(apiKey: string): string {
    if (!this.encryptionKey) {
      throw new Error('LLM_CONFIG_ENCRYPTION_KEY or JWT_SECRET must be set to persist BYOL API keys in database mode');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
  }

  private decryptApiKey(payload: string | null | undefined): string | undefined {
    if (!payload || !this.encryptionKey) return undefined;
    try {
      const [ivRaw, tagRaw, encryptedRaw] = payload.split('.');
      if (!ivRaw || !tagRaw || !encryptedRaw) return undefined;
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(ivRaw, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, 'base64')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      return undefined;
    }
  }

  private async setConfig(userId: string, patch: ConfigPatch): Promise<UserLLMConfig> {
    return this.upsertUserConfig(userId, patch);
  }

  async seedFromLegacyFiles(): Promise<void> {
    if (!this.prismaClient) return;

    const legacyConfigs = loadJsonArrayIfExists<StoredUserLLMConfig>(this.configFilePath);
    const legacyUsage = loadJsonArrayIfExists<LLMUsageEvent>(this.usageFilePath);
    if (!legacyConfigs && !legacyUsage) return;

    const configRows = (legacyConfigs ?? []).filter((row) => row && typeof row.userId === 'string');
    const usageRows = (legacyUsage ?? []).filter((row) => row && typeof row.userId === 'string');

    const seeded = new Set<string>();
    for (const row of configRows) {
      if (seeded.has(row.userId)) continue;
      seeded.add(row.userId);
      const existing = await this.prismaClient.lLMUserConfig.findUnique({ where: { userId: row.userId } });
      if (existing) continue;
      await this.setConfig(row.userId, {
        mode: row.mode,
        paused: row.paused,
        provider: row.provider,
        apiKey: row.apiKey,
        baseUrl: row.baseUrl,
        model: row.model,
      });
    }

    for (const row of usageRows) {
      if (seeded.has(row.userId)) continue;
      seeded.add(row.userId);
      const existing = await this.prismaClient.lLMUserConfig.findUnique({ where: { userId: row.userId } });
      if (existing) continue;
      await this.setConfig(row.userId, {});
    }
  }

  async getUserConfig(userId: string): Promise<UserLLMConfig> {
    if (this.prismaClient) {
      const existing = await this.prismaClient.lLMUserConfig.findUnique({ where: { userId } });
      if (!existing) {
        const now = new Date().toISOString();
        return {
          userId,
          mode: 'default',
          paused: false,
          createdAt: now,
          updatedAt: now,
        };
      }

      return {
        userId: existing.userId,
        mode: normalizeMode(existing.mode),
        paused: existing.paused,
        provider: normalizeProvider(existing.provider),
        apiKey: this.decryptApiKey(existing.encryptedApiKey),
        apiKeyHint: existing.apiKeyHint ?? undefined,
        baseUrl: existing.baseUrl ?? undefined,
        model: existing.model ?? undefined,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: existing.updatedAt.toISOString(),
      };
    }

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

  async upsertUserConfig(userId: string, patch: ConfigPatch): Promise<UserLLMConfig> {
    if (this.prismaClient) {
      const existing = await this.prismaClient.lLMUserConfig.findUnique({ where: { userId } });
      const now = new Date().toISOString();
      const mode = normalizeMode(patch.mode ?? existing?.mode);
      const provider = normalizeProvider(patch.provider ?? existing?.provider);
      let encryptedApiKey = existing?.encryptedApiKey ?? undefined;
      let nextApiKeyHint = existing?.apiKeyHint ?? undefined;

      if (typeof patch.apiKey === 'string') {
        const trimmed = patch.apiKey.trim();
        if (trimmed) {
          encryptedApiKey = this.encryptApiKey(trimmed);
          nextApiKeyHint = apiKeyHint(trimmed);
        }
      }

      const next = {
        mode,
        paused: typeof patch.paused === 'boolean' ? patch.paused : (existing?.paused ?? false),
        provider,
        encryptedApiKey,
        apiKeyHint: nextApiKeyHint,
        baseUrl:
          typeof patch.baseUrl === 'string'
            ? (patch.baseUrl.trim() || undefined)
            : (existing?.baseUrl ?? undefined),
        model:
          typeof patch.model === 'string'
            ? (patch.model.trim() || undefined)
            : (existing?.model ?? undefined),
      };

      if (next.mode === 'default') {
        next.provider = undefined;
        next.encryptedApiKey = undefined;
        next.apiKeyHint = undefined;
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

      await this.prismaClient.lLMUserConfig.upsert({
        where: { userId },
        create: {
          id: randomUUID(),
          userId,
          mode: next.mode,
          paused: next.paused,
          provider: next.provider,
          encryptedApiKey: next.encryptedApiKey,
          apiKeyHint: next.apiKeyHint,
          baseUrl: next.baseUrl,
          model: next.model,
          createdAt: new Date(now),
        },
        update: {
          mode: next.mode,
          paused: next.paused,
          provider: next.provider,
          encryptedApiKey: next.encryptedApiKey,
          apiKeyHint: next.apiKeyHint,
          baseUrl: next.baseUrl,
          model: next.model,
        },
      });

      return this.getUserConfig(userId);
    }

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
      apiKeyHint:
        typeof patch.apiKey === 'string'
          ? apiKeyHint(patch.apiKey.trim() || undefined)
          : existing?.apiKeyHint,
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
      next.apiKeyHint = undefined;
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

  async getRuntimeConfig(userId: string): Promise<RuntimeLLMConfig> {
    const cfg = await this.getUserConfig(userId);
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

    if (!cfg.apiKey) {
      return {
        useDefault: true,
        paused: false,
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

  async getPublicConfig(userId: string): Promise<{
    userId: string;
    mode: LLMMode;
    paused: boolean;
    provider?: RuntimeLLMProvider;
    model?: string;
    baseUrl?: string;
    hasApiKey: boolean;
    apiKeyPreview: string | null;
    updatedAt: string;
  }> {
    const cfg = await this.getUserConfig(userId);
    return {
      userId: cfg.userId,
      mode: cfg.mode,
      paused: cfg.paused,
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      hasApiKey: Boolean(cfg.apiKey || cfg.apiKeyHint),
      apiKeyPreview: redactApiKey(cfg.apiKey) ?? (cfg.apiKeyHint ? `****${cfg.apiKeyHint}` : null),
      updatedAt: cfg.updatedAt,
    };
  }

  async captureUsage(
    userId: string,
    capture: LLMUsageCapture,
    meta?: { projectId?: string; requestId?: string },
  ): Promise<LLMUsageEvent> {
    const event: LLMUsageEvent = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      userId,
      projectId: meta?.projectId,
      requestId: meta?.requestId,
      provider: capture.provider,
      model: capture.model,
      tokensUsed: capture.tokensUsed,
      durationMs: Math.max(0, Math.round(capture.durationMs)),
      success: capture.success,
      error: capture.error,
    };

    if (this.prismaClient) {
      const created = await this.prismaClient.lLMUsageEvent.create({
        data: {
          id: event.id,
          userId: event.userId,
          projectId: event.projectId,
          requestId: event.requestId,
          provider: event.provider,
          model: event.model,
          tokensUsed: event.tokensUsed,
          durationMs: event.durationMs,
          success: event.success,
          error: event.error,
          createdAt: new Date(event.createdAt),
        },
      });
      return toUsageEvent(created);
    }

    this.usageEvents.unshift(event);
    if (this.usageEvents.length > this.maxUsageEvents) {
      this.usageEvents = this.usageEvents.slice(0, this.maxUsageEvents);
    }
    persistJsonArray(this.usageFilePath, this.usageEvents);
    return event;
  }

  async listUsage(userId: string, limit = 100): Promise<LLMUsageEvent[]> {
    const bounded = Math.max(1, Math.min(limit, 500));
    if (this.prismaClient) {
      const events = await this.prismaClient.lLMUsageEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: bounded,
      });
      return events.map(toUsageEvent);
    }

    return this.usageEvents
      .filter((row) => row.userId === userId)
      .slice(0, bounded);
  }

  async summarizeUsage(userId: string, windowHours = 24): Promise<LLMUsageSummary> {
    const boundedHours = Math.max(1, Math.min(windowHours, 24 * 30));
    const cutoff = Date.now() - boundedHours * 3_600_000;
    const recent = this.prismaClient
      ? (await this.prismaClient.lLMUsageEvent.findMany({
          where: { userId, createdAt: { gte: new Date(cutoff) } },
          orderBy: { createdAt: 'desc' },
        })).map(toUsageEvent)
      : this.usageEvents.filter((row) => row.userId === userId && Date.parse(row.createdAt) >= cutoff);

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
