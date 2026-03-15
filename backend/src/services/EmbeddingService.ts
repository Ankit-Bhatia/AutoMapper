/**
 * EmbeddingService — batch field embedding generation for semantic similarity.
 *
 * Pre-computes embedding vectors for all fields at pipeline start (one API call),
 * then exposes cosineSimilarity for pair-wise comparison inside scoreTargetCandidate.
 *
 * Provider resolution (mirrors LLMGateway priority):
 *   1. OpenAI  — text-embedding-3-small (1536 dims, ~$0.00002/1K tokens, preferred)
 *   2. Gemini  — text-embedding-004     (768 dims, free tier available)
 *   3. null    — no provider; caller falls back to intent-only scoring
 *
 * Design constraints:
 *   - One batch call per pipeline run (not per field pair) — keep latency low
 *   - Graceful null return on any failure — pipeline continues without embeddings
 *   - No dependency on LLMGateway — standalone service with its own key resolution
 */

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const GEMINI_EMBED_MODEL = 'text-embedding-004';
const BATCH_SIZE = 256;

export type EmbeddingCache = Map<string, number[]>;
export type EmbeddingProvider = 'openai' | 'gemini';

export interface EmbeddingBuildResult {
  status: 'ready' | 'disabled' | 'failed';
  cache: EmbeddingCache | null;
  provider?: EmbeddingProvider;
  fallbackFrom?: EmbeddingProvider;
  attemptedProviders: EmbeddingProvider[];
  reason?: string;
}

interface EmbeddingFieldInput {
  id: string;
  entityId?: string;
  name: string;
  label?: string;
  description?: string;
  dataType?: string;
  iso20022Name?: string;
  jxchangeXPath?: string;
  complianceTags?: string[];
  required?: boolean;
  isKey?: boolean;
  isExternalId?: boolean;
  isUpsertKey?: boolean;
}

interface EmbeddingBuildOptions {
  entityNamesById?: Map<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function getGeminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GEMINI_KEY ?? process.env.GOOGLE_API_KEY;
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function expandToken(token: string): string[] {
  const expansions: Record<string, string[]> = {
    acct: ['account'],
    amt: ['amount'],
    cif: ['customer'],
    cust: ['customer'],
    dt: ['date'],
    ext: ['external'],
    finserv: ['financial', 'services'],
    nbr: ['number'],
    num: ['number'],
    pct: ['percent'],
    perc: ['percent'],
    sf: ['salesforce'],
    typ: ['type'],
    yrs: ['years'],
  };
  return expansions[token] ?? [token];
}

function describePath(path: string | undefined): string[] {
  if (!path) return [];
  return tokenize(path).slice(-10);
}

// ─── Provider fetchers ───────────────────────────────────────────────────────

async function fetchOpenAIEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const allVectors: number[][] = [];

  for (const chunk of chunkArray(texts, BATCH_SIZE)) {
    const res = await fetch(OPENAI_EMBED_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: chunk }),
    });

    if (!res.ok) throw new Error(`OpenAI embeddings HTTP ${res.status}`);

    const json = await res.json() as { data: Array<{ index: number; embedding: number[] }> };
    const ordered = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    allVectors.push(...ordered);
  }

  return allVectors;
}

async function fetchGeminiEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const allVectors: number[][] = [];

  for (const chunk of chunkArray(texts, BATCH_SIZE)) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/`
      + `${GEMINI_EMBED_MODEL}:batchEmbedContents?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: chunk.map((text) => ({
          model: `models/${GEMINI_EMBED_MODEL}`,
          content: { parts: [{ text }] },
        })),
      }),
    });

    if (!res.ok) throw new Error(`Gemini embeddings HTTP ${res.status}`);

    const json = await res.json() as { embeddings: Array<{ values: number[] }> };
    allVectors.push(...json.embeddings.map((e) => e.values));
  }

  return allVectors;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the embedding text for a field.
 * Combines name + label + description for a richer semantic signal than name alone.
 */
export function fieldEmbeddingText(field: {
  entityId?: string;
  name: string;
  label?: string;
  description?: string;
  dataType?: string;
  iso20022Name?: string;
  jxchangeXPath?: string;
  complianceTags?: string[];
  required?: boolean;
  isKey?: boolean;
  isExternalId?: boolean;
  isUpsertKey?: boolean;
}, options: { entityName?: string } = {}): string {
  const parts: string[] = [];
  const tokenText = tokenize(`${field.name} ${field.label ?? ''}`)
    .flatMap((token) => expandToken(token))
    .join(' ');

  parts.push(field.name);
  if (tokenText && tokenText !== field.name.toLowerCase()) parts.push(tokenText);
  if (field.label && field.label !== field.name) parts.push(field.label);
  if (field.description) parts.push(field.description.slice(0, 180));
  if (options.entityName) parts.push(`entity ${options.entityName}`);
  if (field.dataType) parts.push(`type ${field.dataType}`);
  if (field.iso20022Name) parts.push(`canonical ${field.iso20022Name}`);

  const pathTokens = describePath(field.jxchangeXPath);
  if (pathTokens.length) parts.push(`path ${pathTokens.join(' ')}`);
  if (field.complianceTags?.length) parts.push(`compliance ${field.complianceTags.join(' ')}`);
  if (field.required) parts.push('required');
  if (field.isKey) parts.push('source key');
  if (field.isExternalId) parts.push('external id');
  if (field.isUpsertKey) parts.push('upsert key');

  return parts.join(' ').trim();
}

/**
 * Cosine similarity between two embedding vectors.
 * Clamps output to [0, 1] — negative similarity (opposite meaning) is treated as 0.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : Math.max(0, Math.min(1, dot / denom));
}

/**
 * Batch-compute and cache embedding vectors for all pipeline fields.
 *
 * Returns null when no embedding provider key is present — callers must
 * treat null as "embeddings unavailable" and continue with intent scoring.
 *
 * All errors are surfaced as null (never throws) so the pipeline degrades
 * gracefully rather than failing.
 */
export async function buildEmbeddingCache(
  fields: EmbeddingFieldInput[],
  options: EmbeddingBuildOptions = {},
): Promise<EmbeddingBuildResult> {
  if (fields.length === 0) {
    return { status: 'disabled', cache: null, attemptedProviders: [], reason: 'no fields supplied' };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = getGeminiKey();

  if (!openaiKey && !geminiKey) {
    return { status: 'disabled', cache: null, attemptedProviders: [], reason: 'no embedding provider key found' };
  }

  const entityNamesById = options.entityNamesById ?? new Map<string, string>();
  const texts = fields.map((field) => fieldEmbeddingText(field, {
    entityName: field.entityId ? entityNamesById.get(field.entityId) : undefined,
  }));

  const attempts: Array<{ provider: EmbeddingProvider; error: string }> = [];
  const tryProvider = async (
    provider: EmbeddingProvider,
    apiKey: string,
  ): Promise<EmbeddingBuildResult | null> => {
    try {
      const vectors = provider === 'openai'
        ? await fetchOpenAIEmbeddings(texts, apiKey)
        : await fetchGeminiEmbeddings(texts, apiKey);

      const cache: EmbeddingCache = new Map();
      for (let i = 0; i < fields.length; i++) {
        const vec = vectors[i];
        if (vec) cache.set(fields[i].id, vec);
      }

      return {
        status: 'ready',
        cache,
        provider,
        attemptedProviders: attempts.map((attempt) => attempt.provider).concat(provider),
        fallbackFrom: attempts[0]?.provider,
      };
    } catch (error) {
      attempts.push({
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  if (openaiKey) {
    const result = await tryProvider('openai', openaiKey);
    if (result) return result;
  }

  if (geminiKey) {
    const result = await tryProvider('gemini', geminiKey);
    if (result) return result;
  }

  const attemptedProviders = attempts.map((attempt) => attempt.provider);
  return {
    status: 'failed',
    cache: null,
    attemptedProviders,
    reason: attempts.map((attempt) => `${attempt.provider}: ${attempt.error}`).join(' | '),
  };
}
