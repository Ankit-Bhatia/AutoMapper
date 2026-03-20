import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ReviewDecisionAction = 'accepted' | 'rejected';

export interface ReviewDecisionRecord {
  ts: string;
  sourceFieldId: string;
  targetFieldId: string;
  action: ReviewDecisionAction;
  confidence: number;
}

export interface ReviewDecisionAdjustment {
  scoreDelta: number;
  evidence: string | null;
  action?: ReviewDecisionAction;
}

interface CachedDecisionState {
  path: string;
  mtimeMs: number;
  decisions: ReviewDecisionRecord[];
  latestByPair: Map<string, ReviewDecisionRecord>;
}

const DEFAULT_REVIEW_DECISIONS_PATH = fileURLToPath(
  new URL('../../data/review-decisions.jsonl', import.meta.url),
);

let cached: CachedDecisionState | null = null;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, '');
}

function pairKey(sourceFieldId: string, targetFieldId: string): string {
  return `${normalize(sourceFieldId)}::${normalize(targetFieldId)}`;
}

function resolveReviewDecisionPath(): string {
  return process.env.REVIEW_DECISIONS_FILE
    ? path.resolve(process.env.REVIEW_DECISIONS_FILE)
    : DEFAULT_REVIEW_DECISIONS_PATH;
}

function ensureReviewDecisionFile(filePath = resolveReviewDecisionPath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf8');
  }
}

function parseLine(line: string): ReviewDecisionRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<ReviewDecisionRecord>;
    if (
      typeof parsed.ts !== 'string'
      || typeof parsed.sourceFieldId !== 'string'
      || typeof parsed.targetFieldId !== 'string'
      || (parsed.action !== 'accepted' && parsed.action !== 'rejected')
      || typeof parsed.confidence !== 'number'
    ) {
      return null;
    }
    return {
      ts: parsed.ts,
      sourceFieldId: parsed.sourceFieldId,
      targetFieldId: parsed.targetFieldId,
      action: parsed.action,
      confidence: parsed.confidence,
    };
  } catch {
    return null;
  }
}

function rebuildCache(filePath: string): CachedDecisionState {
  ensureReviewDecisionFile(filePath);
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const decisions = content
    .split('\n')
    .map(parseLine)
    .filter((entry): entry is ReviewDecisionRecord => Boolean(entry))
    .sort((left, right) => left.ts.localeCompare(right.ts));

  const latestByPair = new Map<string, ReviewDecisionRecord>();
  for (const decision of decisions) {
    latestByPair.set(pairKey(decision.sourceFieldId, decision.targetFieldId), decision);
  }

  return {
    path: filePath,
    mtimeMs: stat.mtimeMs,
    decisions,
    latestByPair,
  };
}

function ensureLoaded(filePath = resolveReviewDecisionPath()): CachedDecisionState {
  ensureReviewDecisionFile(filePath);
  const stat = fs.statSync(filePath);
  if (!cached || cached.path !== filePath || cached.mtimeMs !== stat.mtimeMs) {
    cached = rebuildCache(filePath);
  }
  return cached;
}

function canonicalTargetFallback(targetFieldId: string): string | null {
  const segments = targetFieldId.split('.');
  if (segments.length < 2) return null;
  return segments[segments.length - 1] ?? null;
}

export function preloadReviewDecisionLearning(): { decisionCount: number } {
  const state = ensureLoaded();
  return { decisionCount: state.decisions.length };
}

export function getReviewDecisionAdjustment(
  sourceFieldId: string,
  targetFieldId: string,
): ReviewDecisionAdjustment {
  const state = ensureLoaded();
  const exact = state.latestByPair.get(pairKey(sourceFieldId, targetFieldId));
  const fallbackTarget = canonicalTargetFallback(targetFieldId);
  const fallback = !exact && fallbackTarget
    ? state.latestByPair.get(pairKey(sourceFieldId, fallbackTarget))
    : undefined;
  const match = exact ?? fallback;

  if (!match) {
    return { scoreDelta: 0, evidence: null };
  }

  if (match.action === 'accepted') {
    return {
      action: match.action,
      scoreDelta: 0.15,
      evidence: 'review learning +0.15 (accepted pair)',
    };
  }

  return {
    action: match.action,
    scoreDelta: -0.10,
    evidence: 'review learning -0.10 (rejected pair)',
  };
}

export function appendReviewDecision(
  record: ReviewDecisionRecord,
  filePath = resolveReviewDecisionPath(),
): ReviewDecisionRecord {
  ensureReviewDecisionFile(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  cached = rebuildCache(filePath);
  return record;
}

export function listReviewDecisions(filePath = resolveReviewDecisionPath()): ReviewDecisionRecord[] {
  return [...ensureLoaded(filePath).decisions];
}

export function buildReviewDecisionTargetId(targetEntityName: string | undefined, targetFieldName: string): string {
  void targetEntityName;
  return targetFieldName;
}
