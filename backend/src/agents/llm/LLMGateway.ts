/**
 * LLMGateway — multi-provider LLM abstraction with built-in PII guard.
 *
 * Provider resolution order:
 *   1. ANTHROPIC_API_KEY present → Claude claude-haiku-4-5
 *   2. OPENAI_API_KEY present    → GPT-4o-mini
 *   3. Neither                   → heuristic mode (returns null, caller falls back)
 *
 * All prompts are PII-scrubbed via PIIGuard before transmission.
 * Provider calls are retried up to MAX_RETRIES times with exponential backoff.
 */
import type { LLMMessage, LLMResponse, LLMProvider } from '../types.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

// ─── Provider detection ───────────────────────────────────────────────────────

function detectProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'heuristic';
}

// ─── OpenAI provider ──────────────────────────────────────────────────────────

async function callOpenAI(
  messages: LLMMessage[],
  model = 'gpt-4o-mini',
): Promise<LLMResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const body = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 1024,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
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

// ─── Anthropic provider ───────────────────────────────────────────────────────

async function callAnthropic(
  messages: LLMMessage[],
  model = 'claude-haiku-4-5-20251001',
): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  // Separate system message from conversation messages
  const systemMsg = messages.find((m) => m.role === 'system');
  const convoMessages = messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    messages: convoMessages,
  };
  if (systemMsg) body['system'] = systemMsg.content;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const totalTokens =
    (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

  return {
    content: data.content[0]?.text ?? '',
    provider: 'anthropic',
    tokensUsed: totalTokens || undefined,
  };
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a prompt to the best available LLM provider.
 *
 * @param messages - The conversation. PIIGuard should have already been applied
 *                   to the content before calling this function.
 * @returns LLMResponse if a provider is available, or null if heuristic mode.
 */
export async function llmComplete(
  messages: LLMMessage[],
): Promise<LLMResponse | null> {
  const provider = detectProvider();

  if (provider === 'heuristic') return null;

  return withRetry(async () => {
    if (provider === 'anthropic') return callAnthropic(messages);
    return callOpenAI(messages);
  });
}

/**
 * Return the currently active provider (useful for logging + tests).
 */
export function activeProvider(): LLMProvider {
  return detectProvider();
}

/**
 * Build a concise field-mapping prompt for LLM providers.
 * The caller is responsible for passing PII-scrubbed descriptions.
 */
export function buildMappingPrompt(
  sourceDescription: string,
  targetDescription: string,
  fieldMappingHints: string[],
): LLMMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are an enterprise integration expert specializing in financial systems. ' +
        'Given a source schema and target schema, suggest which source fields should map to which target fields. ' +
        'Return JSON array: [{"sourceField":"...","targetField":"...","confidence":0.0-1.0,"reasoning":"..."}]. ' +
        'Only return the JSON array, no markdown, no commentary.',
    },
    {
      role: 'user',
      content:
        `SOURCE SCHEMA:\n${sourceDescription}\n\n` +
        `TARGET SCHEMA:\n${targetDescription}\n\n` +
        (fieldMappingHints.length
          ? `EXISTING HINTS (partial mappings already identified):\n${fieldMappingHints.join('\n')}\n\n`
          : '') +
        'Return only the JSON array of additional mapping suggestions.',
    },
  ];
}
