import type { ConnectorField } from '../../../packages/connectors/IConnector.js';
import { llmComplete } from '../agents/llm/LLMGateway.js';
import { sanitizeFields } from '../agents/llm/PIIGuard.js';
import type { LLMMessage } from '../agents/types.js';
import type {
  Field,
  RetrievalShortlist,
  RetrievalShortlistCandidate,
  RerankerDecision,
} from '../types.js';

export interface RerankerFieldSummary {
  id: string;
  name: string;
  label: string;
  dataType: string;
  required: boolean;
  isKey: boolean;
  isExternalId: boolean;
  complianceTags: string[];
  redacted: boolean;
  redactReason?: string;
}

export interface RerankerSiblingSummary extends RerankerFieldSummary {
  relation: 'before' | 'after';
  offset: number;
}

export interface RerankerCandidateSummary extends RerankerFieldSummary {
  retrievalRank: number;
  retrievalScore: number;
  semanticMode: RetrievalShortlistCandidate['semanticMode'];
  evidence: string[];
}

export interface RerankerPayload {
  sourceField: RerankerFieldSummary;
  currentTargetFieldId?: string;
  entityRoute: {
    sourceSystemType: string;
    targetSystemType: string;
    sourceEntityName: string;
    targetEntityName: string;
    entityConfidence: number;
  };
  siblingContext: RerankerSiblingSummary[];
  candidates: RerankerCandidateSummary[];
}

export interface StructuredRerankerResult {
  payload: RerankerPayload;
  decision: RerankerDecision;
  provider: string;
}

export interface BuildRerankerPayloadInput {
  sourceField: Field | ConnectorField;
  siblingFields: Array<{ field: Field | ConnectorField; relation: 'before' | 'after'; offset: number }>;
  candidateFields: Array<Field | ConnectorField>;
  shortlist: RetrievalShortlist;
  currentTargetFieldId?: string;
  sourceSystemType: string;
  targetSystemType: string;
  sourceEntityName: string;
  targetEntityName: string;
  entityConfidence: number;
}

function clamp01(score: number): number {
  return Math.max(0, Math.min(0.99, score));
}

function safeSummary(field: Field | ConnectorField): RerankerFieldSummary {
  const [safeField] = sanitizeFields([field]);
  return {
    id: field.id,
    name: safeField?.name ?? field.name,
    label: safeField?.label ?? field.label ?? field.name,
    dataType: field.dataType,
    required: Boolean(field.required),
    isKey: Boolean(field.isKey),
    isExternalId: Boolean(field.isExternalId),
    complianceTags: [...(field.complianceTags ?? [])],
    redacted: Boolean(safeField?.redacted),
    redactReason: safeField?.redactReason,
  };
}

function buildSiblingSummary(
  sibling: { field: Field | ConnectorField; relation: 'before' | 'after'; offset: number },
): RerankerSiblingSummary {
  return {
    ...safeSummary(sibling.field),
    relation: sibling.relation,
    offset: sibling.offset,
  };
}

function lookupShortlistCandidate(
  shortlist: RetrievalShortlist,
  targetFieldId: string,
): RetrievalShortlistCandidate | undefined {
  return shortlist.candidates.find((candidate) => candidate.targetFieldId === targetFieldId);
}

function buildCandidateSummary(
  targetField: Field | ConnectorField,
  shortlistCandidate: RetrievalShortlistCandidate,
  retrievalRank: number,
): RerankerCandidateSummary {
  return {
    ...safeSummary(targetField),
    retrievalRank,
    retrievalScore: shortlistCandidate.retrievalScore,
    semanticMode: shortlistCandidate.semanticMode,
    evidence: [...shortlistCandidate.evidence],
  };
}

export function buildRerankerPayload(input: BuildRerankerPayloadInput): RerankerPayload {
  const candidates = input.candidateFields
    .map((targetField) => {
      const shortlistCandidate = lookupShortlistCandidate(input.shortlist, targetField.id);
      if (!shortlistCandidate) return null;
      return buildCandidateSummary(
        targetField,
        shortlistCandidate,
        input.shortlist.candidates.findIndex((candidate) => candidate.targetFieldId === targetField.id) + 1,
      );
    })
    .filter((candidate): candidate is RerankerCandidateSummary => Boolean(candidate))
    .sort((left, right) => left.retrievalRank - right.retrievalRank);

  return {
    sourceField: safeSummary(input.sourceField),
    currentTargetFieldId: input.currentTargetFieldId,
    entityRoute: {
      sourceSystemType: input.sourceSystemType,
      targetSystemType: input.targetSystemType,
      sourceEntityName: input.sourceEntityName,
      targetEntityName: input.targetEntityName,
      entityConfidence: clamp01(input.entityConfidence),
    },
    siblingContext: input.siblingFields.map(buildSiblingSummary),
    candidates,
  };
}

export function buildStructuredRerankerPrompt(payload: RerankerPayload): LLMMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are a schema-matching reranker. Choose the single best target field from the supplied shortlist only. '
        + 'Never invent a field outside the candidates. Prefer retrieval evidence first, then sibling context, compliance compatibility, and entity routing context. '
        + 'Return strict JSON only with this shape: '
        + '{"selectedTargetFieldId":"...","selectedTargetFieldName":"...","finalRank":1,"confidence":0.0-1.0,"evidenceSignals":["retrieval","sibling","compliance","entity_route"],"reasoning":"..."}.',
    },
    {
      role: 'user',
      content: `RERANKER_INPUT_JSON:\n${JSON.stringify(payload, null, 2)}`,
    },
  ];
}

function extractJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!direct) return null;
  try {
    const parsed = JSON.parse(direct) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeEvidenceSignals(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return clamp01(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return clamp01(parsed);
  }
  return 0.5;
}

function matchCandidateByIdOrName(
  payload: RerankerPayload,
  selectedTargetFieldId: unknown,
  selectedTargetFieldName: unknown,
): RerankerCandidateSummary | undefined {
  if (typeof selectedTargetFieldId === 'string') {
    const byId = payload.candidates.find((candidate) => candidate.id === selectedTargetFieldId);
    if (byId) return byId;
  }

  if (typeof selectedTargetFieldName === 'string') {
    const lowered = selectedTargetFieldName.trim().toLowerCase();
    if (lowered) {
      return payload.candidates.find((candidate) => candidate.name.toLowerCase() === lowered);
    }
  }

  return undefined;
}

export function parseStructuredRerankerResponse(
  content: string,
  payload: RerankerPayload,
  provider?: string,
): RerankerDecision | null {
  const parsed = extractJsonObject(content);
  if (!parsed) return null;

  const selectedCandidate = matchCandidateByIdOrName(
    payload,
    parsed.selectedTargetFieldId,
    parsed.selectedTargetFieldName,
  );
  if (!selectedCandidate) return null;

  const finalRankRaw = parsed.finalRank;
  const fallbackRank = payload.candidates.findIndex((candidate) => candidate.id === selectedCandidate.id) + 1;
  const finalRank = typeof finalRankRaw === 'number' && Number.isInteger(finalRankRaw) && finalRankRaw > 0
    ? finalRankRaw
    : fallbackRank;

  return {
    sourceFieldId: payload.sourceField.id,
    candidateCount: payload.candidates.length,
    selectedTargetFieldId: selectedCandidate.id,
    selectedTargetFieldName: selectedCandidate.name,
    finalRank,
    confidence: normalizeConfidence(parsed.confidence),
    evidenceSignals: normalizeEvidenceSignals(parsed.evidenceSignals),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() || undefined : undefined,
    provider,
  };
}

export async function runStructuredReranker(
  payload: RerankerPayload,
  options: { timeoutMs?: number; retries?: number; maxOutputTokens?: number } = {},
): Promise<StructuredRerankerResult | null> {
  const response = await llmComplete(
    buildStructuredRerankerPrompt(payload),
    options,
  );
  if (!response) return null;

  const decision = parseStructuredRerankerResponse(response.content, payload, response.provider);
  if (!decision) return null;

  return {
    payload,
    decision,
    provider: response.provider,
  };
}
