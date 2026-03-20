import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { renderBenchmarkSummary, runBenchmarkHarness } from './harness.ts';

describe('benchmark harness', () => {
  it('runs end-to-end and writes machine-readable benchmark results', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-benchmark-'));
    const outputPath = path.join(tempDir, 'benchmark-results.json');

    const result = await runBenchmarkHarness({ outputPath });
    const written = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as {
      metrics?: { pairCount?: number };
    };
    const summary = renderBenchmarkSummary(result);

    expect(result.metrics.pairCount).toBeGreaterThanOrEqual(50);
    expect(result.metrics.top1Precision.ratio).toBeGreaterThanOrEqual(0);
    expect(result.metrics.recallAt3.ratio).toBeGreaterThanOrEqual(result.metrics.top1Precision.ratio);
    expect(result.metrics.duplicateTargetRate.ratio).toBeGreaterThanOrEqual(0);
    expect(result.metrics.requiredFieldCoverage.total).toBeGreaterThan(0);
    expect(written.metrics?.pairCount).toBe(result.metrics.pairCount);
    expect(summary).toContain('Top-1 precision:');
    expect(summary).toContain('Recall@3:');
  });
});
