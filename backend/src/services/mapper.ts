import { v4 as uuidv4 } from 'uuid';
import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  MappingProject,
  RetrievalSemanticMode,
  TransformType,
} from '../types.js';
import { bestStringMatch, jaccard } from '../utils/stringSim.js';
import { getAiSuggestions } from './llmAdapter.js';
import {
  buildFieldSemanticProfile,
  type FieldSemanticProfile,
} from './fieldSemantics.js';
import {
  DEFAULT_RETRIEVAL_TOP_K,
  retrieveCandidatesForSource,
  retrievalSummary,
  scoreRetrievalCandidate,
} from './candidateRetrieval.js';

const LOS_TYPE_PREFIX_RE = /^(AMT|NBR|DT|TYP|IND|CD|PCT|YN|NAME|DESC|CODE|PERC|DATE|ADDR|PHONE|EMAIL|Y)_/i;

interface CandidateScore {
  targetField: Field;
  base: number;
  retrievalScore: number;
  lexicalScore: number;
  semanticScore: number;
  semanticMode: RetrievalSemanticMode;
  typeScore: number;
  domainBoost: number;
  incompatible: boolean;
  evidence: string[];
  sourceProfile: FieldSemanticProfile;
}

function retrievalShortlistContainsTarget(
  targetFieldId: string,
  shortlist: FieldMapping['retrievalShortlist'] | undefined,
): boolean {
  return Boolean(shortlist?.candidates.some((candidate) => candidate.targetFieldId === targetFieldId));
}

export async function suggestMappings(input: {
  project: MappingProject;
  sourceEntities: Entity[];
  targetEntities: Entity[];
  fields: Field[];
}): Promise<{ entityMappings: EntityMapping[]; fieldMappings: FieldMapping[] }> {
  const entityMappings: EntityMapping[] = [];
  const fieldMappings: FieldMapping[] = [];
  const entityNamesById = new Map<string, string>([
    ...input.sourceEntities.map((entity) => [entity.id, entity.name] as const),
    ...input.targetEntities.map((entity) => [entity.id, entity.name] as const),
  ]);

  for (const sourceEntity of input.sourceEntities) {
    const targetMatch = chooseTargetEntity(sourceEntity, input.targetEntities);
    if (!targetMatch) continue;
    const targetEntity = targetMatch.target;
    const sourceFields = input.fields.filter((f) => f.entityId === sourceEntity.id);
    const targetFields = input.fields.filter((f) => f.entityId === targetEntity.id);

    const ai = await getAiSuggestions(sourceEntity, sourceFields, targetEntity, targetFields);

    const entityConfidence = ai
      ? clamp(0.6 * targetMatch.score + 0.4 * ai.confidence)
      : clamp(0.75 * targetMatch.score + 0.25);

    const entityMappingId = uuidv4();
    entityMappings.push({
      id: entityMappingId,
      projectId: input.project.id,
      sourceEntityId: sourceEntity.id,
      targetEntityId: targetEntity.id,
      confidence: entityConfidence,
      rationale:
        ai?.rationale ??
        `${targetMatch.reason}. Combined score ${targetMatch.score.toFixed(2)}`,
    });

    for (const sourceField of sourceFields) {
      const sourceProfile = buildFieldSemanticProfile(sourceField);
      const retrieval = retrieveCandidatesForSource(sourceField, targetFields, {
        entityNamesById,
        topK: DEFAULT_RETRIEVAL_TOP_K,
      });
      const candidateScores: CandidateScore[] = retrieval.rankedCandidates.map((candidate) => {
        const domainBoost = domainFieldBoost(
          sourceEntity.name,
          targetEntity.name,
          sourceField.name,
          candidate.targetField.name,
        );
        return {
          targetField: candidate.targetField as Field,
          base: clamp(candidate.retrievalScore + domainBoost),
          retrievalScore: candidate.retrievalScore,
          lexicalScore: candidate.lexicalScore,
          semanticScore: candidate.semanticScore,
          semanticMode: candidate.semanticMode,
          typeScore: candidate.typeScore,
          domainBoost,
          incompatible: candidate.incompatible,
          evidence: candidate.evidence,
          sourceProfile,
        };
      });

      candidateScores.sort((a, b) => b.base - a.base);
      const best = candidateScores[0];
      if (!best) continue;

      const minThreshold = isCoreToFscPair(sourceEntity.name, targetEntity.name)
        ? 0.5
        : isLosToFscPair(sourceEntity.name, targetEntity.name)
          ? 0.44
          : 0.42;
      if (best.base < minThreshold || best.incompatible) continue;

      const aiField = ai?.fields.find(
        (f) =>
          normalize(f.sourceFieldName) === normalize(sourceField.name) &&
          targetFields.some((t) => normalize(t.name) === normalize(f.targetFieldName)),
      );

      let chosen = best;
      let usedAiCandidate = false;
      if (aiField) {
        const aiTarget = targetFields.find((t) => normalize(t.name) === normalize(aiField.targetFieldName));
        if (aiTarget && retrievalShortlistContainsTarget(aiTarget.id, retrieval.shortlist)) {
          const aiCandidate = candidateScores.find((candidate) => candidate.targetField.id === aiTarget.id)
            ?? scoreTargetCandidate(
              sourceEntity.name,
              targetEntity.name,
              sourceField,
              aiTarget,
              sourceProfile,
              entityNamesById,
            );
          if (!aiCandidate.incompatible && aiCandidate.base >= minThreshold * 0.85) {
            chosen = aiCandidate;
            usedAiCandidate = true;
          }
        }
      }

      const chosenTarget = chosen.targetField;
      const finalConfidence = clamp(
        aiField && usedAiCandidate
          ? (0.55 * aiField.confidence) + (0.45 * chosen.base)
          : chosen.base,
      );
      const transform = inferTransform(sourceField, chosenTarget, aiField && usedAiCandidate ? aiField.transformType : undefined);

      fieldMappings.push({
        id: uuidv4(),
        entityMappingId,
        sourceFieldId: sourceField.id,
        targetFieldId: chosenTarget.id,
        transform,
        confidence: finalConfidence,
        rationale:
          aiField && usedAiCandidate && aiField.rationale
            ? `${aiField.rationale} | ${retrievalSummary(retrieval)}`
            : `${buildCandidateRationale(chosen)} | ${retrievalSummary(retrieval)}`,
        status: 'suggested',
        retrievalShortlist: retrieval.shortlist,
      });
    }
  }

  return { entityMappings, fieldMappings };
}

function chooseTargetEntity(
  sourceEntity: Entity,
  targetEntities: Entity[],
): { target: Entity; score: number; reason: string } | null {
  if (targetEntities.length === 0) return null;

  const hasFscModel = targetEntities.some((e) => FSC_OBJECTS.has(normalize(e.name)));
  if (!hasFscModel) {
    const labels = targetEntities.map((e) => `${e.name} ${e.label ?? ''}`);
    const fallback = bestStringMatch(sourceEntity.name, labels);
    if (fallback.index < 0) return null;
    return {
      target: targetEntities[fallback.index],
      score: fallback.score,
      reason: 'Name similarity',
    };
  }

  let best: { target: Entity; score: number; reason: string } | null = null;
  const sourceText = `${sourceEntity.name} ${sourceEntity.label ?? ''}`;

  for (const candidate of targetEntities) {
    const targetText = `${candidate.name} ${candidate.label ?? ''}`;
    const nameScore = jaccard(sourceText, targetText);
    const boost = fscEntityBoost(sourceEntity.name, candidate.name) + sameDomainEntityBoost(sourceEntity.name, candidate.name);
    const combined = clamp(nameScore + boost);
    const reason = boost > 0
      ? `FSC domain preference (${sourceEntity.name} -> ${candidate.name})`
      : 'Name similarity';

    if (!best || combined > best.score) {
      best = { target: candidate, score: combined, reason };
    }
  }

  return best;
}

const FSC_OBJECTS = new Set([
  'financialaccount',
  'accountparticipant',
  'partyprofile',
  'individualapplication',
  'financialgoal',
]);

const LOS_ENTITY_NAMES = new Set([
  'loan',
  'borrower',
  'coborrower',
  'collateral',
  'employment',
  'income',
  'declarations',
  'product',
  'signer',
  'group',
  'debts',
  'finstmt',
]);

const LOS_PARTY_ENTITY_NAMES = new Set(['borrower', 'coborrower', 'signer', 'group']);
const LOS_ACCOUNT_ENTITY_NAMES = new Set(['loan', 'product', 'collateral', 'debts', 'finstmt']);
const LOS_APPLICATION_ENTITY_NAMES = new Set(['employment', 'income', 'declarations']);

function fscEntityBoost(sourceEntityName: string, targetEntityName: string): number {
  // RiskClam / BOSL entities get their own entity-pairing boost table
  const rcBoost = riskClamToSfEntityBoost(sourceEntityName, targetEntityName);
  if (rcBoost > 0) return rcBoost;

  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);

  const isPartyEntity =
    src === 'cif' ||
    src.includes('customer') ||
    src.includes('member') ||
    src.includes('party') ||
    LOS_PARTY_ENTITY_NAMES.has(src);
  const isFinancialAccountEntity =
    src.includes('dda') ||
    src.includes('loan') ||
    src.includes('certificate') ||
    src.includes('lineofcredit') ||
    src.includes('share') ||
    src.includes('deposit') ||
    src.includes('account') ||
    LOS_ACCOUNT_ENTITY_NAMES.has(src);
  const isApplicationEntity = LOS_APPLICATION_ENTITY_NAMES.has(src);

  if (isPartyEntity && tgt === 'partyprofile') return 0.5;
  if (isPartyEntity && tgt === 'accountparticipant') return 0.18;
  if (isPartyEntity && (tgt === 'account' || tgt === 'contact')) return 0.1;

  if (isFinancialAccountEntity && tgt === 'financialaccount') return 0.55;
  if (isFinancialAccountEntity && tgt === 'individualapplication') return 0.22;
  if (isFinancialAccountEntity && tgt === 'accountparticipant') return 0.16;
  if (isFinancialAccountEntity && tgt === 'financialgoal') return 0.1;
  if (isFinancialAccountEntity && tgt === 'account') return 0.06;

  if (isApplicationEntity && tgt === 'individualapplication') return 0.4;
  if (isApplicationEntity && tgt === 'partyprofile') return 0.12;

  if (src.includes('gl') && src.includes('account') && tgt === 'financialaccount') return 0.25;

  return 0;
}

function isCoreToFscPair(sourceEntityName: string, targetEntityName: string): boolean {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);
  return CORE_ENTITY_NAMES.has(src) && FSC_OBJECTS.has(tgt);
}

function isLosToFscPair(sourceEntityName: string, targetEntityName: string): boolean {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);
  return LOS_ENTITY_NAMES.has(src) && FSC_OBJECTS.has(tgt);
}

function sameDomainEntityBoost(sourceEntityName: string, targetEntityName: string): number {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);

  if (LOS_ENTITY_NAMES.has(src) && LOS_ENTITY_NAMES.has(tgt)) return 0.12;
  if (CORE_ENTITY_NAMES.has(src) && CORE_ENTITY_NAMES.has(tgt)) return 0.12;
  return 0;
}

const CORE_ENTITY_NAMES = new Set([
  'cif',
  'dda',
  'loanaccount',
  'glaccount',
  'certificate',
  'lineofcredit',
  'member',
  'share',
]);

// ─── RiskClam (BOSL) entity → Salesforce FSC boost ────────────────────────────
const RISKCLAM_ENTITY_NAMES = new Set([
  'account',
  'financialaccount',
  'loan',
  'loanpackage',
  'partyliabilities',
  'partyinvolvedintransaction',
  'collateral',
  'fee',
  'branch',
  'riskclam',
]);

function riskClamToSfEntityBoost(sourceEntityName: string, targetEntityName: string): number {
  const src = normalize(sourceEntityName);
  const tgt = normalize(targetEntityName);
  if (!RISKCLAM_ENTITY_NAMES.has(src)) return 0;

  if ((src === 'account' || src === 'riskclam') && (tgt === 'account' || tgt === 'contact')) return 0.50;
  if (src === 'financialaccount' && tgt === 'financialaccount') return 0.60;
  if (src === 'loan' && (tgt === 'financialaccount' || tgt === 'opportunity')) return 0.55;
  if (src === 'loanpackage' && tgt === 'individualapplication') return 0.50;
  if (src === 'partyliabilities' && tgt === 'financialaccount') return 0.45;
  if (src === 'partyinvolvedintransaction' && (tgt === 'account' || tgt === 'contact')) return 0.45;
  if (src === 'collateral' && tgt === 'financialaccount') return 0.48;
  return 0;
}

const CORE_TO_FSC_FIELD_PREFS: Record<string, Record<string, string[]>> = {
  cif: {
    cifnumber: ['cifnumber'],
    taxid: ['taxid'],
    dateofbirth: ['birthdate'],
    legalname: ['legalname', 'name'],
    primaryemail: ['primaryemail'],
    primaryphone: ['primaryphone'],
    addressline1: ['addressline1'],
    city: ['city'],
    statecode: ['statecode'],
    postalcode: ['postalcode'],
    countrycode: ['countrycode'],
  },
  dda: {
    accountnumber: ['financialaccountnumber'],
    accounttype: ['financialaccounttype'],
    accountstatus: ['status'],
    currentbalance: ['currentbalance'],
    collectedbalance: ['currentbalance'],
    availablebalance: ['availablebalance'],
    opendate: ['opendate'],
    nickname: ['name'],
  },
  loanaccount: {
    loannumber: ['financialaccountnumber'],
    loantype: ['financialaccounttype'],
    loanstatus: ['status'],
    currentbalance: ['currentbalance'],
    originalprincipal: ['currentbalance'],
    originationdate: ['opendate'],
  },
  glaccount: {
    glaccountnumber: ['financialaccountnumber'],
    accountdescription: ['name'],
    accountcategory: ['financialaccounttype'],
    debitbalance: ['currentbalance'],
    creditbalance: ['currentbalance'],
    lastpostingdate: ['opendate'],
  },
};

const LOS_TO_FSC_FIELD_PREFS: Record<string, string[]> = {
  approvedloan: ['loanamount', 'loanamountc', 'currentbalance'],
  loanamount: ['loanamount', 'loanamountc', 'currentbalance'],
  term: ['loanterm', 'loantermc', 'termmonths'],
  terminmos: ['loanterm', 'loantermc', 'termmonths'],
  termmos: ['loanterm', 'loantermc', 'termmonths'],
  grossmonthlyincome: ['grossmonthlyincome', 'grossincome'],
  grossincome: ['grossmonthlyincome', 'grossincome'],
  debtincome: ['debtoincomeratio', 'dti'],
  dti: ['debtoincomeratio', 'dti'],
  first: ['firstname', 'name'],
  last: ['lastname', 'name'],
};

function coreToFscFieldBoost(
  sourceEntityName: string,
  targetEntityName: string,
  sourceFieldName: string,
  targetFieldName: string,
): number {
  if (!isCoreToFscPair(sourceEntityName, targetEntityName)) return 0;

  const srcEntity = normalize(sourceEntityName);
  const srcField = normalize(sourceFieldName);
  const tgtField = normalize(targetFieldName);
  const entityPrefs = CORE_TO_FSC_FIELD_PREFS[srcEntity];
  if (!entityPrefs) return 0;

  const preferred = entityPrefs[srcField];
  if (!preferred) return 0;
  if (preferred.includes(tgtField)) return 0.28;
  return -0.05;
}

function losToFscFieldBoost(
  sourceEntityName: string,
  targetEntityName: string,
  sourceFieldName: string,
  targetFieldName: string,
): number {
  if (!isLosToFscPair(sourceEntityName, targetEntityName)) return 0;

  const sourceSemantic = normalize(stripLosTypePrefix(sourceFieldName));
  const targetSemantic = normalize(targetFieldName);
  if (!sourceSemantic || !targetSemantic) return 0;

  for (const [sourceToken, preferredTargets] of Object.entries(LOS_TO_FSC_FIELD_PREFS)) {
    if (sourceSemantic === sourceToken || sourceSemantic.includes(sourceToken)) {
      if (preferredTargets.some((targetToken) => targetSemantic.includes(targetToken))) {
        return 0.24;
      }
    }
  }

  return 0;
}

function domainFieldBoost(
  sourceEntityName: string,
  targetEntityName: string,
  sourceFieldName: string,
  targetFieldName: string,
): number {
  return coreToFscFieldBoost(sourceEntityName, targetEntityName, sourceFieldName, targetFieldName)
    + losToFscFieldBoost(sourceEntityName, targetEntityName, sourceFieldName, targetFieldName);
}

function scoreTargetCandidate(
  sourceEntityName: string,
  targetEntityName: string,
  sourceField: Field,
  targetField: Field,
  sourceProfile: FieldSemanticProfile,
  entityNamesById: Map<string, string>,
): CandidateScore {
  const retrievalCandidate = scoreRetrievalCandidate(sourceField, targetField, { entityNamesById });
  const domainBoost = domainFieldBoost(
    sourceEntityName,
    targetEntityName,
    sourceField.name,
    targetField.name,
  );
  const incompatible = retrievalCandidate.incompatible;
  const base = clamp(retrievalCandidate.retrievalScore + domainBoost);

  return {
    targetField,
    base,
    retrievalScore: retrievalCandidate.retrievalScore,
    lexicalScore: retrievalCandidate.lexicalScore,
    semanticScore: retrievalCandidate.semanticScore,
    semanticMode: retrievalCandidate.semanticMode,
    typeScore: retrievalCandidate.typeScore,
    domainBoost,
    incompatible,
    evidence: retrievalCandidate.evidence,
    sourceProfile,
  };
}

function buildCandidateRationale(candidate: CandidateScore): string {
  const segments = [
    `semantic ${candidate.semanticScore.toFixed(2)} (${candidate.semanticMode})`,
    `lexical ${candidate.lexicalScore.toFixed(2)}`,
    `type ${candidate.typeScore.toFixed(2)} (${candidate.sourceProfile.inferredType}→${candidate.targetField.dataType})`,
  ];

  if (candidate.domainBoost !== 0) {
    segments.push(`domain ${candidate.domainBoost.toFixed(2)}`);
  }
  if (candidate.semanticMode === 'alias' && candidate.semanticScore >= 0.6) {
    segments.push('concept-aligned');
  }
  if (candidate.incompatible) {
    segments.push('compatibility gate: borderline');
  }
  for (const evidence of candidate.evidence) {
    if (!segments.includes(evidence)) segments.push(evidence);
  }

  return segments.join(', ');
}

function inferTransform(source: Field, target: Field, aiTransform?: string): {
  type: TransformType;
  config: Record<string, unknown>;
} {
  if (aiTransform && isTransform(aiTransform)) {
    return { type: aiTransform, config: {} };
  }

  const sourceName = normalize(source.name);
  const targetName = normalize(target.name);

  if (targetName.includes('name') && (sourceName === 'name1' || sourceName === 'name2')) {
    return { type: 'concat', config: { separator: ' ', sourceFields: ['Name1', 'Name2'] } };
  }

  if (target.dataType === 'date' || target.dataType === 'datetime') {
    return { type: 'formatDate', config: { input: 'auto', output: target.dataType } };
  }

  if (target.dataType === 'picklist') {
    return { type: 'lookup', config: { mode: 'codeToPicklist' } };
  }

  if (source.dataType === 'string' && target.dataType === 'string') {
    return { type: 'trim', config: { side: 'both' } };
  }

  return { type: 'direct', config: {} };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripLosTypePrefix(value: string): string {
  return value.replace(LOS_TYPE_PREFIX_RE, '');
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function isTransform(value: string): value is TransformType {
  return ['direct', 'concat', 'formatDate', 'lookup', 'static', 'regex', 'split', 'trim'].includes(value);
}
