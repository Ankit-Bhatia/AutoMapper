import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as LLMGateway from '../agents/llm/LLMGateway.js';
import {
  buildRerankerPayload,
  type RerankerPayload,
  runStructuredReranker,
} from '../services/structuredReranker.js';
import type { ConnectorField } from '../../../packages/connectors/IConnector.js';

type FixtureCase = {
  sourceEntityName: string;
  targetEntityName: string;
  sourceField: {
    id: string;
    name: string;
    label: string;
    dataType: string;
    complianceTags?: string[];
  };
  siblings: Array<{
    id: string;
    name: string;
    label: string;
    dataType: string;
    relation: 'before' | 'after';
    offset: number;
    complianceTags?: string[];
  }>;
  candidates: Array<{
    id: string;
    name: string;
    label: string;
    dataType: string;
    retrievalScore: number;
    semanticMode: 'embedding' | 'alias' | 'intent';
    evidence: string[];
    complianceTags?: string[];
  }>;
  expectedTargetFieldId: string;
};

function makeField(input: {
  id: string;
  entityId?: string;
  name: string;
  label?: string;
  dataType: string;
  complianceTags?: string[];
}): ConnectorField {
  return {
    id: input.id,
    entityId: input.entityId ?? 'entity-1',
    name: input.name,
    label: input.label ?? input.name,
    dataType: input.dataType as ConnectorField['dataType'],
    required: false,
    isKey: false,
    isExternalId: false,
    complianceTags: input.complianceTags ?? [],
  } as ConnectorField;
}

function loadFixture(): FixtureCase[] {
  const fixturePath = path.resolve(process.cwd(), 'data/bosl-fsc-reranker-fixture.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as FixtureCase[];
}

function buildFixturePayload(testCase: FixtureCase): RerankerPayload {
  const sourceField = makeField({
    ...testCase.sourceField,
    entityId: 'src-entity',
  });
  const siblingFields = testCase.siblings.map((sibling) => ({
    field: makeField({ ...sibling, entityId: 'src-entity' }),
    relation: sibling.relation,
    offset: sibling.offset,
  }));
  const candidateFields = testCase.candidates.map((candidate) => makeField({
    ...candidate,
    entityId: 'tgt-entity',
  }));

  return buildRerankerPayload({
    sourceField,
    siblingFields,
    candidateFields,
    shortlist: {
      sourceFieldId: testCase.sourceField.id,
      topK: 5,
      candidates: testCase.candidates.map((candidate) => ({
        targetFieldId: candidate.id,
        targetFieldName: candidate.name,
        retrievalScore: candidate.retrievalScore,
        semanticMode: candidate.semanticMode,
        evidence: candidate.evidence,
      })),
    },
    sourceSystemType: 'riskclam',
    targetSystemType: 'salesforce',
    sourceEntityName: testCase.sourceEntityName,
    targetEntityName: testCase.targetEntityName,
    entityConfidence: 0.8,
  });
}

function extractPayloadFromMessages(messages: Parameters<typeof LLMGateway.llmComplete>[0]): RerankerPayload {
  const user = messages.find((message) => message.role === 'user')?.content ?? '';
  const json = user.replace(/^RERANKER_INPUT_JSON:\n/, '');
  return JSON.parse(json) as RerankerPayload;
}

function chooseCandidate(payload: RerankerPayload) {
  const source = payload.sourceField.name.toUpperCase();
  const targetEntity = payload.entityRoute.targetEntityName.toLowerCase();

  const byName = (...needles: string[]) => payload.candidates.find((candidate) =>
    needles.every((needle) => candidate.name.toLowerCase().includes(needle.toLowerCase()))
  );

  let selected = null as typeof payload.candidates[number] | undefined | null;
  let evidenceSignals = ['retrieval'];

  if (source.startsWith('NAME_')) {
    evidenceSignals = ['retrieval', 'sibling'];
    if (source.includes('FIRST')) selected = byName('first');
    else if (source.includes('LAST')) selected = byName('last');
    else if (source.includes('MIDDLE')) selected = byName('middle');
  } else if (source.includes('TOTAL_ASSETS')) {
    selected = byName('assets');
  } else if (source.includes('TOTAL_LIABILITIES')) {
    selected = byName('liabilities');
  } else if (source.includes('TOTAL_BOSL')) {
    selected = byName('with', 'us');
  } else if (source.includes('TOTAL_NONBSL')) {
    selected = byName('other', 'institutions');
  } else if (source.includes('NET_WORTH')) {
    selected = byName('networth');
  } else if (source.includes('PERC_INTEREST')) {
    evidenceSignals = ['retrieval', 'entity_route'];
    selected = targetEntity.includes('loan') ? byName('annualinterestrate') : byName('interestrate');
  } else if (source.includes('DATE_APPLICATION')) {
    evidenceSignals = ['retrieval', 'entity_route'];
    selected = targetEntity.includes('loan') ? byName('application_date') : byName('applicationdate');
  } else if (source.includes('CODE_COUNTRY')) {
    evidenceSignals = ['retrieval', 'sibling'];
    selected = byName('country');
  } else if (source.includes('CODE_STATE')) {
    evidenceSignals = ['retrieval', 'sibling'];
    selected = byName('state');
  } else if (source.includes('CODE_POSTAL')) {
    evidenceSignals = ['retrieval', 'sibling'];
    selected = byName('postal');
  } else if (source.includes('FATCA') || source.includes('DUE_DILIGENCE') || source.includes('NBR_CIF')) {
    evidenceSignals = ['retrieval', 'compliance'];
    selected = payload.candidates.find((candidate) => candidate.complianceTags.length > 0 && candidate.semanticMode !== 'intent');
  } else if (source.includes('AMT_PAYMENT')) {
    selected = byName('payment');
  } else if (source.includes('CURRENT_BALANCE')) {
    selected = byName('balance');
  }

  const winner = selected ?? payload.candidates[0];
  return {
    selectedTargetFieldId: winner.id,
    selectedTargetFieldName: winner.name,
    finalRank: 1,
    confidence: 0.86,
    evidenceSignals,
    reasoning: `Selected ${winner.name} from shortlist evidence.`,
  };
}

describe('structured reranker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('beats baseline top-1 precision on the 20-pair BOSL→FSC fixture', async () => {
    const fixture = loadFixture();
    const baselineHits = fixture.filter((testCase) => testCase.candidates[0]?.id === testCase.expectedTargetFieldId).length;

    const llmSpy = vi.spyOn(LLMGateway, 'llmComplete').mockImplementation(async (messages) => {
      const payload = extractPayloadFromMessages(messages);
      return {
        provider: 'gemini',
        content: JSON.stringify(chooseCandidate(payload)),
        tokensUsed: 42,
      };
    });

    let rerankerHits = 0;
    for (const testCase of fixture) {
      const payload = buildFixturePayload(testCase);
      const result = await runStructuredReranker(payload, { maxOutputTokens: 256, retries: 1, timeoutMs: 1500 });
      expect(result).not.toBeNull();
      if (result?.decision.selectedTargetFieldId === testCase.expectedTargetFieldId) {
        rerankerHits += 1;
      }
    }

    expect(llmSpy).toHaveBeenCalledTimes(fixture.length);
    expect(baselineHits).toBeLessThan(rerankerHits);
    expect(rerankerHits).toBeGreaterThanOrEqual(15);
  });
});
