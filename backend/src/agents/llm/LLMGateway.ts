/**
 * LLMGateway — multi-provider LLM abstraction with built-in PII guard.
 *
 * Provider resolution order:
 *   1. Runtime BYOL context (if configured for current request)
 *   2. LLM_PROVIDER + env keys
 *   3. Auto-detected env key priority: Anthropic -> Gemini -> OpenAI
 *   4. Heuristic mode (returns null)
 *
 * All prompts are PII-scrubbed via PIIGuard before transmission.
 * Provider calls are retried up to MAX_RETRIES times with exponential backoff.
 */
import type { LLMMessage, LLMResponse, LLMProvider } from '../types.js';
import { getLLMRuntimeContext } from '../../services/llmRuntimeContext.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const BASE_DELAY_MS = 500;
const PROVIDER_ORDER: Array<Exclude<LLMProvider, 'heuristic' | 'custom'>> = ['anthropic', 'gemini', 'openai'];

type ConcreteProvider = Exclude<LLMProvider, 'heuristic'>;

interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface ProviderCandidate {
  provider: ConcreteProvider;
  settings: ProviderSettings;
}

export interface LLMCallOptions {
  timeoutMs?: number;
  retries?: number;
  maxOutputTokens?: number;
}

function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || process.env.GOOGLE_API_KEY;
}

function getEnvApiKey(provider: ConcreteProvider): string | undefined {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  if (provider === 'gemini') return getGeminiApiKey();
  if (provider === 'custom') return process.env.CUSTOM_LLM_API_KEY;
  return process.env.OPENAI_API_KEY;
}

function getEnvBaseUrl(provider: ConcreteProvider): string | undefined {
  if (provider === 'custom') return process.env.CUSTOM_LLM_BASE_URL;
  if (provider === 'anthropic') return process.env.ANTHROPIC_BASE_URL;
  if (provider === 'openai') return process.env.OPENAI_BASE_URL;
  return undefined;
}

function getApiKey(provider: ConcreteProvider, settings: ProviderSettings): string | undefined {
  return settings.apiKey || getEnvApiKey(provider);
}

function getBaseUrl(provider: ConcreteProvider, settings: ProviderSettings): string | undefined {
  return settings.baseUrl || getEnvBaseUrl(provider);
}

function hasProviderKey(provider: ConcreteProvider, settings: ProviderSettings = {}): boolean {
  const apiKey = getApiKey(provider, settings);
  if (!apiKey) return false;
  if (provider === 'custom') {
    return Boolean(getBaseUrl(provider, settings));
  }
  return true;
}

function resolveModel(provider: ConcreteProvider, settings: ProviderSettings): string {
  if (settings.model && settings.model.trim()) return settings.model.trim();
  if (provider === 'anthropic') return 'claude-haiku-4-5-20251001';
  if (provider === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  return 'gpt-4o-mini';
}

function normalizeProvider(raw: unknown): ConcreteProvider | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === 'openai' || value === 'anthropic' || value === 'gemini' || value === 'custom') {
    return value;
  }
  return null;
}

function getRuntimeCandidates(): ProviderCandidate[] | null {
  const runtime = getLLMRuntimeContext()?.llmConfig;
  if (!runtime || runtime.useDefault || runtime.paused) {
    return null;
  }

  const provider = runtime.provider ?? 'openai';
  const settings: ProviderSettings = {
    apiKey: runtime.apiKey,
    baseUrl: runtime.baseUrl,
    model: runtime.model,
  };

  if (!hasProviderKey(provider, settings)) {
    return [];
  }

  return [{ provider, settings }];
}

function getDefaultCandidates(): ProviderCandidate[] {
  const preferred = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (preferred === 'heuristic') return [];

  const preferredProvider = normalizeProvider(preferred);
  if (preferredProvider && hasProviderKey(preferredProvider)) {
    const rest = preferredProvider === 'custom'
      ? []
      : PROVIDER_ORDER
        .filter((provider) => provider !== preferredProvider && hasProviderKey(provider))
        .map((provider) => ({ provider, settings: {} as ProviderSettings }));

    return [{ provider: preferredProvider, settings: {} }, ...rest];
  }

  return PROVIDER_ORDER
    .filter((provider) => hasProviderKey(provider))
    .map((provider) => ({ provider, settings: {} }));
}

function getProviderCandidates(): ProviderCandidate[] {
  const runtimeCandidates = getRuntimeCandidates();
  if (runtimeCandidates) {
    return runtimeCandidates;
  }
  return getDefaultCandidates();
}

function resolveOpenAICompletionsUrl(baseUrl: string | undefined): string {
  if (!baseUrl || !baseUrl.trim()) return 'https://api.openai.com/v1/chat/completions';
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function resolveAnthropicMessagesUrl(baseUrl: string | undefined): string {
  if (!baseUrl || !baseUrl.trim()) return 'https://api.anthropic.com/v1/messages';
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

async function callOpenAI(
  messages: LLMMessage[],
  settings: ProviderSettings,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
): Promise<LLMResponse> {
  const apiKey = getApiKey('openai', settings);
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const body = {
    model: resolveModel('openai', settings),
    messages,
    temperature: 0.2,
    max_tokens: maxOutputTokens,
  };

  const response = await fetch(resolveOpenAICompletionsUrl(getBaseUrl('openai', settings)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? '',
    provider: 'openai',
    tokensUsed: data.usage?.total_tokens,
  };
}

async function callCustomOpenAICompatible(
  messages: LLMMessage[],
  settings: ProviderSettings,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
): Promise<LLMResponse> {
  const apiKey = getApiKey('custom', settings);
  const baseUrl = getBaseUrl('custom', settings);
  if (!apiKey) throw new Error('custom provider apiKey is not set');
  if (!baseUrl) throw new Error('custom provider baseUrl is not set');

  const body = {
    model: resolveModel('custom', settings),
    messages,
    temperature: 0.2,
    max_tokens: maxOutputTokens,
  };

  const response = await fetch(resolveOpenAICompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Custom LLM error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  };

  const tokensUsed =
    data.usage?.total_tokens
    ?? ((data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0) || undefined);

  return {
    content: data.choices[0]?.message?.content ?? '',
    provider: 'custom',
    tokensUsed,
  };
}

async function callAnthropic(
  messages: LLMMessage[],
  settings: ProviderSettings,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
): Promise<LLMResponse> {
  const apiKey = getApiKey('anthropic', settings);
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const systemMsg = messages.find((m) => m.role === 'system');
  const convoMessages = messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    model: resolveModel('anthropic', settings),
    max_tokens: maxOutputTokens,
    messages: convoMessages,
  };
  if (systemMsg) body.system = systemMsg.content;

  const response = await fetch(resolveAnthropicMessagesUrl(getBaseUrl('anthropic', settings)), {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const totalTokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

  return {
    content: data.content[0]?.text ?? '',
    provider: 'anthropic',
    tokensUsed: totalTokens || undefined,
  };
}

async function callGemini(
  messages: LLMMessage[],
  settings: ProviderSettings,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
): Promise<LLMResponse> {
  const apiKey = getApiKey('gemini', settings);
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const model = resolveModel('gemini', settings);
  const systemInstruction = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
    .trim();

  const conversation = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents: conversation.length ? conversation : [{ role: 'user', parts: [{ text: 'Respond in JSON.' }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    usageMetadata?: {
      totalTokenCount?: number;
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };

  const content =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('\n')
      .trim() ?? '';

  const tokensUsed =
    data.usageMetadata?.totalTokenCount
    ?? ((data.usageMetadata?.promptTokenCount ?? 0) + (data.usageMetadata?.candidatesTokenCount ?? 0) || undefined);

  return {
    content,
    provider: 'gemini',
    tokensUsed,
  };
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function callProvider(
  candidate: ProviderCandidate,
  messages: LLMMessage[],
  timeoutMs: number,
  maxOutputTokens: number,
): Promise<LLMResponse> {
  if (candidate.provider === 'anthropic') {
    return callAnthropic(messages, candidate.settings, timeoutMs, maxOutputTokens);
  }
  if (candidate.provider === 'gemini') {
    return callGemini(messages, candidate.settings, timeoutMs, maxOutputTokens);
  }
  if (candidate.provider === 'custom') {
    return callCustomOpenAICompatible(messages, candidate.settings, timeoutMs, maxOutputTokens);
  }
  return callOpenAI(messages, candidate.settings, timeoutMs, maxOutputTokens);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown LLM error';
}

export async function llmComplete(
  messages: LLMMessage[],
  options: LLMCallOptions = {},
): Promise<LLMResponse | null> {
  const candidates = getProviderCandidates();
  if (!candidates.length) return null;

  const retries = Math.max(1, options.retries ?? DEFAULT_MAX_RETRIES);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxOutputTokens = Math.max(32, options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS);

  const runtimeContext = getLLMRuntimeContext();
  let lastError: unknown = null;

  for (const candidate of candidates) {
    const startedAt = Date.now();
    const model = resolveModel(candidate.provider, candidate.settings);

    try {
      const response = await withRetry(
        async () => callProvider(candidate, messages, timeoutMs, maxOutputTokens),
        retries,
      );

      runtimeContext?.onUsage?.(
        {
          provider: response.provider,
          model,
          tokensUsed: response.tokensUsed,
          durationMs: Date.now() - startedAt,
          success: true,
        },
        runtimeContext.usageMeta,
      );

      return response;
    } catch (error) {
      lastError = error;
      runtimeContext?.onUsage?.(
        {
          provider: candidate.provider,
          model,
          durationMs: Date.now() - startedAt,
          success: false,
          error: errorMessage(error),
        },
        runtimeContext.usageMeta,
      );
    }
  }

  throw lastError ?? new Error('No LLM providers available');
}

export function activeProvider(): LLMProvider {
  const provider = getProviderCandidates()[0]?.provider;
  return provider ?? 'heuristic';
}

export function buildMappingPrompt(
  sourceDescription: string,
  targetDescription: string,
  fieldMappingHints: string[],
): LLMMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are an enterprise integration expert specializing in financial systems. '
        + 'Given a source schema and target schema, suggest which source fields should map to which target fields. '
        + 'Return JSON array: [{"sourceField":"...","targetField":"...","confidence":0.0-1.0,"reasoning":"..."}]. '
        + 'Only return the JSON array, no markdown, no commentary.',
    },
    {
      role: 'user',
      content:
        `SOURCE SCHEMA:\n${sourceDescription}\n\n`
        + `TARGET SCHEMA:\n${targetDescription}\n\n`
        + (fieldMappingHints.length
          ? `EXISTING HINTS (partial mappings already identified):\n${fieldMappingHints.join('\n')}\n\n`
          : '')
        + 'Return only the JSON array of additional mapping suggestions.',
    },
  ];
}
