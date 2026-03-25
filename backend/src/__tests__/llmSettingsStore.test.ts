import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LLMSettingsStore } from '../services/llmSettingsStore.js';

function createMockPrisma() {
  const configRows = new Map<string, {
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
  }>();
  const usageRows: Array<{
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
  }> = [];

  return {
    rows: { configRows, usageRows },
    client: {
      lLMUserConfig: {
        async findUnique(args: { where: { userId: string } }) {
          return configRows.get(args.where.userId) ?? null;
        },
        async upsert(args: {
          where: { userId: string };
          create: typeof usageRows[number] & Record<string, unknown>;
          update: Record<string, unknown>;
        }) {
          const existing = configRows.get(args.where.userId);
          const next = existing
            ? {
                ...existing,
                ...args.update,
                updatedAt: new Date(),
              }
            : {
                ...args.create,
                updatedAt: (args.create.updatedAt as Date | undefined) ?? new Date(),
              };
          configRows.set(args.where.userId, next as never);
          return configRows.get(args.where.userId)!;
        },
      },
      lLMUsageEvent: {
        async create(args: { data: typeof usageRows[number] }) {
          usageRows.unshift(args.data);
          return args.data;
        },
        async findMany(args: {
          where?: { userId?: string; createdAt?: { gte: Date } };
          take?: number;
          orderBy?: { createdAt: 'desc' | 'asc' };
        }) {
          let rows = [...usageRows];
          if (args.where?.userId) {
            rows = rows.filter((row) => row.userId === args.where?.userId);
          }
          if (args.where?.createdAt?.gte) {
            rows = rows.filter((row) => row.createdAt >= args.where!.createdAt!.gte);
          }
          rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
          return typeof args.take === 'number' ? rows.slice(0, args.take) : rows;
        },
      },
    },
  };
}

function createTempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-llm-store-'));
  return {
    dir,
    configFilePath: path.join(dir, 'llm-configs.json'),
    usageFilePath: path.join(dir, 'llm-usage.json'),
  };
}

describe('LLMSettingsStore', () => {
  it('stores Prisma-backed BYOL config with encrypted API keys and public hints only', async () => {
    const mock = createMockPrisma();
    const store = new LLMSettingsStore({
      prismaClient: mock.client as never,
      encryptionKey: 'unit-test-key',
    });

    await store.upsertUserConfig('user-1', {
      mode: 'byol',
      provider: 'openai',
      apiKey: 'sk-test-987654321',
      model: 'gpt-4.1-mini',
    });

    const persisted = mock.rows.configRows.get('user-1');
    expect(persisted?.encryptedApiKey).toBeTruthy();
    expect(persisted?.encryptedApiKey).not.toContain('sk-test-987654321');
    expect(persisted?.apiKeyHint).toBe('4321');

    const runtimeConfig = await store.getRuntimeConfig('user-1');
    expect(runtimeConfig.useDefault).toBe(false);
    expect(runtimeConfig.apiKey).toBe('sk-test-987654321');

    const publicConfig = await store.getPublicConfig('user-1');
    expect(publicConfig.hasApiKey).toBe(true);
    expect(publicConfig.apiKeyPreview).not.toContain('sk-test-987654321');
    expect(publicConfig.apiKeyPreview).toContain('4321');
  });

  it('summarizes usage from the Prisma-backed event store', async () => {
    const mock = createMockPrisma();
    const store = new LLMSettingsStore({
      prismaClient: mock.client as never,
      encryptionKey: 'unit-test-key',
    });

    await store.captureUsage('user-2', {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      tokensUsed: 120,
      durationMs: 320,
      success: true,
    }, { projectId: 'project-1' });
    await store.captureUsage('user-2', {
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      tokensUsed: 80,
      durationMs: 210,
      success: false,
      error: 'quota',
    });

    const events = await store.listUsage('user-2', 10);
    const summary = await store.summarizeUsage('user-2', 24);

    expect(events).toHaveLength(2);
    expect(summary.totalCalls).toBe(2);
    expect(summary.successfulCalls).toBe(1);
    expect(summary.failedCalls).toBe(1);
    expect(summary.totalTokens).toBe(200);
    expect(summary.callsByProvider.openai).toBe(1);
    expect(summary.callsByProvider.anthropic).toBe(1);
  });

  it('reads and writes configs in file-backed mode', async () => {
    const paths = createTempPaths();
    const store = new LLMSettingsStore({
      prismaClient: null,
      configFilePath: paths.configFilePath,
      usageFilePath: paths.usageFilePath,
    });

    await store.upsertUserConfig('file-user', {
      mode: 'byol',
      provider: 'openai',
      apiKey: 'sk-file-mode-1234',
      model: 'gpt-4.1-mini',
      paused: true,
    });

    const raw = JSON.parse(fs.readFileSync(paths.configFilePath, 'utf8')) as Array<Record<string, unknown>>;
    expect(raw).toHaveLength(1);
    expect(raw[0]?.userId).toBe('file-user');
    expect(raw[0]?.apiKey).toBe('sk-file-mode-1234');

    const reloaded = new LLMSettingsStore({
      prismaClient: null,
      configFilePath: paths.configFilePath,
      usageFilePath: paths.usageFilePath,
    });
    const config = await reloaded.getUserConfig('file-user');

    expect(config.mode).toBe('byol');
    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('sk-file-mode-1234');
    expect(config.model).toBe('gpt-4.1-mini');
    expect(config.paused).toBe(true);
  });

  it('seeds Prisma-backed configs from legacy JSON files on startup', async () => {
    const mock = createMockPrisma();
    const paths = createTempPaths();
    fs.writeFileSync(paths.configFilePath, JSON.stringify([
      {
        userId: 'legacy-user',
        mode: 'byol',
        paused: false,
        provider: 'openai',
        apiKey: 'sk-legacy-987654321',
        apiKeyHint: '4321',
        model: 'gpt-4.1-mini',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ], null, 2));
    fs.writeFileSync(paths.usageFilePath, JSON.stringify([
      {
        id: 'usage-1',
        createdAt: '2026-03-01T00:00:00.000Z',
        userId: 'usage-only-user',
        provider: 'openai',
        durationMs: 100,
        success: true,
      },
    ], null, 2));

    const store = new LLMSettingsStore({
      prismaClient: mock.client as never,
      encryptionKey: 'unit-test-key',
      configFilePath: paths.configFilePath,
      usageFilePath: paths.usageFilePath,
    });

    await store.seedFromLegacyFiles();

    const seededConfig = mock.rows.configRows.get('legacy-user');
    expect(seededConfig?.encryptedApiKey).toBeTruthy();
    expect(seededConfig?.apiKeyHint).toBe('4321');

    const seededUsageOnly = mock.rows.configRows.get('usage-only-user');
    expect(seededUsageOnly?.mode).toBe('default');
    expect(seededUsageOnly?.provider).toBeUndefined();
  });
});
