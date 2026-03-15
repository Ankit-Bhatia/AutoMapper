import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildEmbeddingCache, fieldEmbeddingText } from '../services/EmbeddingService.js';

const ENV_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GEMINI_KEY', 'GOOGLE_API_KEY'] as const;
const envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
});

describe('EmbeddingService', () => {
  it('includes richer field context in embedding text', () => {
    const text = fieldEmbeddingText({
      entityId: 'loan',
      name: 'CUST_TENURE_MONTHS',
      label: 'Customer Tenure Months',
      description: 'How long the borrower has been with the institution',
      dataType: 'integer',
      jxchangeXPath: 'LOAN.PRI.CUST_TENURE_MONTHS',
      complianceTags: ['GLBA_NPI'],
      required: true,
      isKey: true,
    }, { entityName: 'Borrower' });

    expect(text).toContain('Customer Tenure Months');
    expect(text).toContain('entity Borrower');
    expect(text).toContain('type integer');
    expect(text).toContain('path loan pri cust tenure months');
    expect(text).toContain('source key');
  });

  it('falls back to Gemini when OpenAI embeddings fail', async () => {
    process.env.OPENAI_API_KEY = 'test-openai';
    process.env.GEMINI_API_KEY = 'test-gemini';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ embeddings: [{ values: [0.25, 0.75] }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await buildEmbeddingCache(
      [{ id: 'fld-1', entityId: 'entity-1', name: 'CUST_TENURE_MONTHS', dataType: 'string' }],
      { entityNamesById: new Map([['entity-1', 'Borrower']]) },
    );

    expect(result.status).toBe('ready');
    expect(result.provider).toBe('gemini');
    expect(result.fallbackFrom).toBe('openai');
    expect(result.cache?.get('fld-1')).toEqual([0.25, 0.75]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns disabled when no embedding provider keys are present', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_KEY;
    delete process.env.GOOGLE_API_KEY;

    const result = await buildEmbeddingCache([
      { id: 'fld-1', name: 'TaxID', dataType: 'string' },
    ]);

    expect(result.status).toBe('disabled');
    expect(result.reason).toContain('no embedding provider key');
    expect(result.cache).toBeNull();
  });
});
