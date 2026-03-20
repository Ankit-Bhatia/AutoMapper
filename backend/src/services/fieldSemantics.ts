import type { DataType } from '../types.js';
import { typeCompatibilityScore } from '../utils/typeUtils.js';
import { getReviewDecisionAdjustment } from './reviewDecisionLearning.js';

export type FieldIntent =
  | 'amount'
  | 'balance'
  | 'rate'
  | 'term'
  | 'date'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'id'
  | 'status'
  | 'type'
  | 'email'
  | 'phone'
  | 'address'
  | 'boolean'
  | 'picklist'
  | 'unknown';

export interface SemanticFieldLike {
  name: string;
  label?: string;
  description?: string;
  dataType: DataType;
}

export interface FieldSemanticProfile {
  intents: Set<FieldIntent>;
  inferredType: DataType;
  typeReliability: number;
  strongSignal: boolean;
  tokens: Set<string>;
  concepts: Set<string>;
  text: string;
}

const FIELD_INTENT_KEYWORDS: Array<{ intent: FieldIntent; keywords: string[] }> = [
  { intent: 'amount', keywords: ['amt', 'amount', 'principal', 'payment', 'loanamount', 'approvedloan'] },
  { intent: 'balance', keywords: ['balance', 'currentbalance', 'availablebalance', 'openbalance'] },
  { intent: 'rate', keywords: ['rate', 'apr', 'apy', 'interest', 'dividend', 'percent', 'pct', 'perc'] },
  { intent: 'term', keywords: ['term', 'months', 'month', 'tenor', 'maturity', 'duration'] },
  { intent: 'date', keywords: ['date', 'dt', 'dob', 'birthdate', 'opendate', 'closedate', 'origination'] },
  { intent: 'first_name', keywords: ['firstname', 'first'] },
  { intent: 'last_name', keywords: ['lastname', 'last', 'surname'] },
  { intent: 'name', keywords: ['name', 'fullname', 'legalname', 'displayname'] },
  { intent: 'id', keywords: ['id', 'number', 'nbr', 'num', 'identifier', 'accountnumber', 'cifnumber', 'membernumber'] },
  { intent: 'status', keywords: ['status', 'state', 'lifecycle'] },
  { intent: 'type', keywords: ['type', 'typ', 'category', 'class'] },
  { intent: 'email', keywords: ['email', 'mail'] },
  { intent: 'phone', keywords: ['phone', 'telephone', 'mobile', 'tel'] },
  { intent: 'address', keywords: ['address', 'addr', 'street', 'city', 'statecode', 'postal', 'zip', 'country'] },
  { intent: 'boolean', keywords: ['yn', 'ind', 'flag', 'active', 'enabled', 'is'] },
  { intent: 'picklist', keywords: ['code', 'cd', 'enum', 'list'] },
];

const LOS_PREFIX_INTENT: Array<{ pattern: RegExp; intent: FieldIntent }> = [
  { pattern: /^(AMT|AMOUNT)_/i, intent: 'amount' },
  { pattern: /^(PCT|PERC)_/i, intent: 'rate' },
  { pattern: /^NBR_/i, intent: 'id' },
  { pattern: /^(DT|DATE)_/i, intent: 'date' },
  { pattern: /^(IND|YN|Y)_/i, intent: 'boolean' },
  { pattern: /^(CD|CODE)_/i, intent: 'picklist' },
  { pattern: /^TYP_/i, intent: 'type' },
  { pattern: /^NAME_/i, intent: 'name' },
  { pattern: /^ADDR_/i, intent: 'address' },
  { pattern: /^PHONE_/i, intent: 'phone' },
  { pattern: /^EMAIL_/i, intent: 'email' },
];

const INTENT_TYPE_HINT: Record<FieldIntent, DataType> = {
  amount: 'decimal',
  balance: 'decimal',
  rate: 'decimal',
  term: 'integer',
  date: 'date',
  name: 'string',
  first_name: 'string',
  last_name: 'string',
  id: 'id',
  status: 'picklist',
  type: 'picklist',
  email: 'email',
  phone: 'phone',
  address: 'string',
  boolean: 'boolean',
  picklist: 'picklist',
  unknown: 'unknown',
};

const RELATED_INTENTS: Array<[FieldIntent, FieldIntent]> = [
  ['amount', 'balance'],
  ['balance', 'amount'],
  ['status', 'picklist'],
  ['type', 'picklist'],
  ['first_name', 'name'],
  ['last_name', 'name'],
  ['name', 'first_name'],
  ['name', 'last_name'],
];

const TOKEN_CONCEPTS: Record<string, string[]> = {
  acct: ['account'],
  account: ['account'],
  accounts: ['account'],
  addr: ['address'],
  address: ['address'],
  amount: ['amount'],
  amt: ['amount'],
  applicant: ['borrower'],
  approval: ['approval'],
  approved: ['approval'],
  apr: ['rate'],
  apy: ['rate'],
  bal: ['balance'],
  balance: ['balance'],
  bank: ['institution'],
  birthdate: ['date'],
  borrower: ['borrower'],
  city: ['address'],
  class: ['classification'],
  client: ['customer'],
  closedate: ['date'],
  code: ['code'],
  collateral: ['collateral'],
  contact: ['contact'],
  country: ['address'],
  currentbalance: ['balance'],
  cust: ['customer'],
  customer: ['customer'],
  date: ['date'],
  debt: ['debt'],
  desc: ['description'],
  description: ['description'],
  displayname: ['name'],
  dob: ['date'],
  email: ['email'],
  employer: ['employment'],
  ext: ['external'],
  external: ['external'],
  fee: ['fee'],
  firm: ['relationship'],
  firstname: ['name', 'first_name'],
  fullname: ['name'],
  gl: ['ledger'],
  goal: ['goal'],
  identifier: ['identifier'],
  id: ['identifier'],
  individual: ['person'],
  institution: ['institution'],
  interest: ['rate'],
  lastname: ['name', 'last_name'],
  legalname: ['name'],
  lender: ['institution'],
  loan: ['loan'],
  maturity: ['term'],
  member: ['customer'],
  mobile: ['phone'],
  month: ['tenure'],
  months: ['tenure'],
  name: ['name'],
  nbr: ['identifier'],
  number: ['identifier'],
  openbalance: ['balance'],
  opendate: ['date'],
  origination: ['origination'],
  party: ['party'],
  payment: ['payment'],
  pct: ['rate'],
  perc: ['rate'],
  percent: ['rate'],
  phone: ['phone'],
  postal: ['address'],
  principal: ['amount'],
  profile: ['profile'],
  rate: ['rate'],
  relationship: ['relationship'],
  signer: ['borrower'],
  ssn: ['tax_id'],
  state: ['status', 'address'],
  status: ['status'],
  street: ['address'],
  surname: ['name', 'last_name'],
  tax: ['tax_id'],
  taxid: ['tax_id'],
  taxidentifier: ['tax_id'],
  tenure: ['tenure'],
  term: ['term'],
  tin: ['tax_id'],
  total: ['amount'],
  type: ['classification'],
  typ: ['classification'],
  upsert: ['external'],
  with: [],
  years: ['tenure'],
  year: ['tenure'],
  yearswithfirm: ['tenure', 'relationship'],
  yn: ['boolean'],
  zip: ['address'],
};

const PHRASE_CONCEPT_PATTERNS: Array<{ pattern: RegExp; concepts: string[] }> = [
  { pattern: /(yearswithfirm|yearswithinstitution|monthswithfirm|monthswithinstitution|relationshiplength|tenure)/i, concepts: ['tenure', 'relationship'] },
  { pattern: /(taxid|taxidentifier|tin|ssn)/i, concepts: ['tax_id', 'identifier'] },
  { pattern: /(legalname|fullname|displayname)/i, concepts: ['name'] },
  { pattern: /(currentbalance|availablebalance|openbalance)/i, concepts: ['balance'] },
  { pattern: /(paymentamount|monthlypayment|loanpayment)/i, concepts: ['payment', 'amount'] },
  { pattern: /(externalid|externalkey|upsertkey)/i, concepts: ['external', 'identifier'] },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokenize(value: string): string[] {
  const splitCamel = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  return splitCamel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function expandLosPrefix(name: string): string {
  return name
    .replace(/^AMT_/i, 'Amount_')
    .replace(/^PCT_/i, 'Percent_')
    .replace(/^PERC_/i, 'Percent_')
    .replace(/^NBR_/i, 'Number_')
    .replace(/^DT_/i, 'Date_')
    .replace(/^CD_/i, 'Code_')
    .replace(/^TYP_/i, 'Type_');
}

function addConcepts(target: Set<string>, values: string[]): void {
  for (const value of values) {
    if (value) target.add(value);
  }
}

function buildConceptSet(field: SemanticFieldLike, tokens: Set<string>, expandedName: string): Set<string> {
  const concepts = new Set<string>();
  const normalizedText = normalize(`${expandedName} ${field.label ?? ''} ${field.description ?? ''}`);

  for (const token of tokens) {
    const mapped = TOKEN_CONCEPTS[token];
    if (mapped) {
      addConcepts(concepts, mapped);
      continue;
    }
    if (token.length >= 4 && !['true', 'false'].includes(token)) {
      concepts.add(token);
    }
  }

  for (const { pattern, concepts: mapped } of PHRASE_CONCEPT_PATTERNS) {
    if (pattern.test(normalizedText)) {
      addConcepts(concepts, mapped);
    }
  }

  return concepts;
}

function hasAnyIntent(profile: FieldSemanticProfile, intents: FieldIntent[]): boolean {
  return intents.some((intent) => profile.intents.has(intent));
}

function inferType(
  field: SemanticFieldLike,
  intents: Set<FieldIntent>,
  prefixSignal: boolean,
): { inferredType: DataType; typeReliability: number; strongSignal: boolean } {
  if (field.dataType !== 'string' && field.dataType !== 'unknown') {
    return { inferredType: field.dataType, typeReliability: 0.92, strongSignal: true };
  }

  const orderedIntents: FieldIntent[] = [
    'amount',
    'balance',
    'rate',
    'date',
    'term',
    'id',
    'boolean',
    'email',
    'phone',
    'status',
    'type',
    'picklist',
    'name',
    'first_name',
    'last_name',
    'address',
  ];

  const inferredFromIntent = orderedIntents.find((intent) => intents.has(intent));
  if (!inferredFromIntent) {
    return { inferredType: 'string', typeReliability: 0.25, strongSignal: false };
  }

  const inferredType = INTENT_TYPE_HINT[inferredFromIntent] ?? 'string';
  const typeReliability = prefixSignal ? 0.84 : 0.62;
  return {
    inferredType,
    typeReliability,
    strongSignal: prefixSignal || intents.size >= 2,
  };
}

export function buildFieldSemanticProfile(field: SemanticFieldLike): FieldSemanticProfile {
  const fullText = `${field.name} ${field.label ?? ''} ${field.description ?? ''}`.trim();
  const expandedName = expandLosPrefix(field.name);
  const tokens = new Set([
    ...tokenize(fullText),
    ...tokenize(expandedName),
    normalize(field.name),
    normalize(expandedName),
  ].filter(Boolean));
  const concepts = buildConceptSet(field, tokens, expandedName);

  const intents = new Set<FieldIntent>();
  let prefixSignal = false;

  for (const { pattern, intent } of LOS_PREFIX_INTENT) {
    if (pattern.test(field.name)) {
      intents.add(intent);
      prefixSignal = true;
    }
  }

  for (const { intent, keywords } of FIELD_INTENT_KEYWORDS) {
    if (keywords.some((keyword) => tokens.has(keyword) || Array.from(tokens).some((token) => token.includes(keyword)))) {
      intents.add(intent);
    }
  }

  if (!intents.size) intents.add('unknown');

  if (intents.has('first_name') || intents.has('last_name')) {
    intents.add('name');
  }

  const { inferredType, typeReliability, strongSignal } = inferType(field, intents, prefixSignal);
  const comparableText = `${expandedName} ${field.label ?? ''} ${field.description ?? ''}`.trim();

  return {
    intents,
    inferredType,
    typeReliability,
    strongSignal,
    tokens,
    concepts,
    text: comparableText,
  };
}

export function semanticTypeScore(source: FieldSemanticProfile, targetDataType: DataType): number {
  return typeCompatibilityScore(source.inferredType, targetDataType);
}

export function intentSimilarity(source: FieldSemanticProfile, target: FieldSemanticProfile): number {
  const sourceIntents = [...source.intents];
  const targetIntents = [...target.intents];

  const exactShared = sourceIntents.filter((intent) => target.intents.has(intent));
  if (exactShared.length > 0) {
    return Math.min(1, 0.7 + (exactShared.length - 1) * 0.12);
  }

  const hasRelated = RELATED_INTENTS.some(
    ([left, right]) => source.intents.has(left) && target.intents.has(right),
  );
  if (hasRelated) return 0.7;

  if (sourceIntents.includes('unknown') || targetIntents.includes('unknown')) return 0.35;
  return 0.1;
}

export function conceptSimilarity(source: FieldSemanticProfile, target: FieldSemanticProfile): number {
  if (source.concepts.size === 0 || target.concepts.size === 0) {
    return 0.18;
  }

  let shared = 0;
  for (const concept of source.concepts) {
    if (target.concepts.has(concept)) shared += 1;
  }

  if (shared === 0) return 0.18;

  const overlap = (2 * shared) / (source.concepts.size + target.concepts.size);
  return Math.max(0.25, Math.min(1, 0.30 + (0.70 * overlap)));
}

export function hybridSemanticSimilarity(
  source: FieldSemanticProfile,
  target: FieldSemanticProfile,
  embeddingScore?: number,
  options: { sourceFieldId?: string; targetFieldId?: string } = {},
): {
  score: number;
  mode: 'embed' | 'concept' | 'intent';
  intentScore: number;
  conceptScore: number;
  reviewAdjustment: number;
} {
  const intentScore = intentSimilarity(source, target);
  const baseConceptScore = conceptSimilarity(source, target);
  const reviewAdjustment = options.sourceFieldId && options.targetFieldId
    ? getReviewDecisionAdjustment(options.sourceFieldId, options.targetFieldId).scoreDelta
    : 0;
  const conceptScore = Math.max(0, Math.min(1, baseConceptScore + reviewAdjustment));

  if (typeof embeddingScore === 'number') {
    return {
      score: Math.max(
        intentScore,
        conceptScore,
        Math.max(0, Math.min(1, (0.55 * embeddingScore) + (0.25 * conceptScore) + (0.20 * intentScore))),
      ),
      mode: 'embed',
      intentScore,
      conceptScore,
      reviewAdjustment,
    };
  }

  const score = Math.max(
    intentScore,
    conceptScore,
    Math.max(0, Math.min(1, (0.65 * conceptScore) + (0.35 * intentScore))),
  );
  return {
    score,
    mode: conceptScore > intentScore ? 'concept' : 'intent',
    intentScore,
    conceptScore,
    reviewAdjustment,
  };
}

export function isHardIncompatible(
  source: FieldSemanticProfile,
  target: FieldSemanticProfile,
): boolean {
  const sourceFinancial = hasAnyIntent(source, ['amount', 'balance', 'rate', 'term']);
  const targetNonFinancialDescriptor = hasAnyIntent(target, ['name', 'email', 'phone', 'address'])
    && !hasAnyIntent(target, ['amount', 'balance', 'rate', 'term']);
  if (sourceFinancial && targetNonFinancialDescriptor) return true;

  const sourceDate = source.intents.has('date');
  const targetDescriptor = hasAnyIntent(target, ['name', 'email', 'phone', 'address']);
  if (sourceDate && targetDescriptor && !target.intents.has('date')) return true;

  if (source.intents.has('email') && !target.intents.has('email') && !target.intents.has('id')) return true;
  if (source.intents.has('phone') && !target.intents.has('phone') && !target.intents.has('id')) return true;

  if (source.intents.has('id') && hasAnyIntent(target, ['name', 'address']) && !target.intents.has('id')) return true;

  return false;
}
