import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FsStore } from '../utils/fsStore.js';

describe('retrieval shortlist persistence', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('persists retrievalShortlist and rerankerDecision on field mappings in FsStore mode', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-retrieval-'));
    const store = new FsStore(tempDir);
    const project = store.createProject('Test');
    const entityMappingId = 'em-1';

    store.upsertMappings(
      project.id,
      [
        {
          id: entityMappingId,
          projectId: project.id,
          sourceEntityId: 'src-ent',
          targetEntityId: 'tgt-ent',
          confidence: 0.81,
          rationale: 'seeded',
        },
      ],
      [
        {
          id: 'fm-1',
          entityMappingId,
          sourceFieldId: 'src-field',
          targetFieldId: 'tgt-field',
          transform: { type: 'direct', config: {} },
          confidence: 0.77,
          rationale: 'retrieval top-3: Target(0.80)',
          status: 'suggested',
          retrievalShortlist: {
            sourceFieldId: 'src-field',
            topK: 5,
            candidates: [
              {
                targetFieldId: 'tgt-field',
                targetFieldName: 'Target',
                retrievalScore: 0.8,
                semanticMode: 'alias',
                evidence: ['semantic 0.81 (alias)'],
              },
            ],
          },
          rerankerDecision: {
            sourceFieldId: 'src-field',
            candidateCount: 3,
            selectedTargetFieldId: 'tgt-field',
            selectedTargetFieldName: 'Target',
            finalRank: 1,
            confidence: 0.86,
            evidenceSignals: ['retrieval', 'sibling'],
            reasoning: 'Sibling cluster confirmed target selection.',
            provider: 'gemini',
          },
          optimizerDisplacement: {
            originalTargetFieldId: 'legacy-target',
            reason: 'duplicate_displaced',
            finalAssignment: 'tgt-field',
          },
          lowConfidenceFallback: true,
        },
      ],
    );

    const reloaded = new FsStore(tempDir).getState();
    expect(reloaded.fieldMappings[0]?.retrievalShortlist).toEqual({
      sourceFieldId: 'src-field',
      topK: 5,
      candidates: [
        {
          targetFieldId: 'tgt-field',
          targetFieldName: 'Target',
          retrievalScore: 0.8,
          semanticMode: 'alias',
          evidence: ['semantic 0.81 (alias)'],
        },
      ],
    });
    expect(reloaded.fieldMappings[0]?.rerankerDecision).toEqual({
      sourceFieldId: 'src-field',
      candidateCount: 3,
      selectedTargetFieldId: 'tgt-field',
      selectedTargetFieldName: 'Target',
      finalRank: 1,
      confidence: 0.86,
      evidenceSignals: ['retrieval', 'sibling'],
      reasoning: 'Sibling cluster confirmed target selection.',
      provider: 'gemini',
    });
    expect(reloaded.fieldMappings[0]?.optimizerDisplacement).toEqual({
      originalTargetFieldId: 'legacy-target',
      reason: 'duplicate_displaced',
      finalAssignment: 'tgt-field',
    });
    expect(reloaded.fieldMappings[0]?.lowConfidenceFallback).toBe(true);
  });
});
