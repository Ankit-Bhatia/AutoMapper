/**
 * SchemaIntelligenceAgent — enterprise schema understanding for FSC integrations.
 *
 * This agent implements the 6-step Schema Intelligence Pipeline from the
 * automapper-schema-intelligence skill:
 *
 *   Step 1: Field Classification
 *           Identify system audit fields (never map), formula fields (no inbound
 *           write), Person Account fields (__pc), and FSC namespace fields.
 *
 *   Step 2: XML Taxonomy Recognition
 *           Detect source field prefix (AMT_, CODE_, DATE_, NAME_, PERC_, Y_, NBR_,
 *           DESC_, PHONE_, ADDRESS_) and validate against expected Salesforce data
 *           type. Emit prefix-type compatibility annotation.
 *
 *   Step 3: Confirmed Pattern Boost
 *           Apply a +0.30 confidence boost when the (sourceField, targetField) pair
 *           exactly matches a confirmed mapping from the 212-entry BOSL→FSC corpus
 *           in schemaIntelligenceData.ts.
 *
 *   Step 4: One-to-Many Detection
 *           Flag source fields that map to multiple Salesforce targets. Annotate
 *           with REVIEW_REQUIRED metadata so the UI can surface the routing decision
 *           to the user rather than auto-selecting.
 *
 *   Step 5: Domain Glossary Annotation
 *           Detect Caribbean banking domain tokens (BOSL, CIF, HP, boarding, ECCB,
 *           FATCA/CRS) in field names and enrich the rationale with terminology
 *           context.
 *
 *   Step 6: Confidence & Rationale Enrichment
 *           Assemble the final confidence delta and a structured rationale string
 *           that explains exactly why the mapping was scored as it was.
 *
 * Activation: runs whenever targetSystemType === 'salesforce' (not gated to
 * riskclam — any source system that targets Salesforce FSC benefits from the
 * confirmed pattern corpus).
 *
 * Pipeline position: after SchemaDiscoveryAgent, before ComplianceAgent.
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { Field, FieldMapping } from '../types.js';
import type { ConnectorField } from '../../../packages/connectors/IConnector.js';
import {
  CONFIRMED_PATTERNS,
  ONE_TO_MANY_FIELDS,
  FORMULA_FIELD_TARGETS,
  SYSTEM_AUDIT_FIELDS,
  PERSON_ACCOUNT_FIELD_SUFFIX,
  FSC_NAMESPACE_PREFIX,
  CARIBBEAN_DOMAIN_TOKENS,
  type ConfirmedPattern,
} from './schemaIntelligenceData.js';
import {
  COREDIR_FSC_PATTERNS,
  COREDIR_ONE_TO_MANY_FIELDS,
} from './coreDirSchemaData.js';

// ─── Scoring constants ────────────────────────────────────────────────────────

/** Confidence boost when (srcField, tgtField) is an exact confirmed pattern match */
const CONFIRMED_EXACT_BOOST = 0.30;
/** Confidence boost when source field family matches (same XML prefix, different target) */
const CONFIRMED_FAMILY_BOOST = 0.08;
/** Penalty when target is a formula/calculated field (cannot receive inbound data) */
const FORMULA_TARGET_PENALTY = -0.28;
/** Penalty when target is a system audit field (should never be a mapping target) */
const SYSTEM_AUDIT_PENALTY = -0.40;
/** Boost when both source and target are FSC-namespace aware */
const FSC_NAMESPACE_BOOST = 0.06;

const BOSL_PREFIXES = ['AMT_', 'PERC_', 'DATE_', 'CODE_', 'NAME_', 'NBR_', 'Y_', 'PHONE_', 'ADDRESS_', 'DESC_'];
const COREDIR_PREFIXES = ['CUST_', 'CIF_', 'LOAN_', 'ACCT_', 'COL_', 'COLL_', 'EMPL_', 'LIAB_', 'ADDR_', 'DEP_'];
const BOSL_INDICATORS = new Set(['AMT_NET_WORTH', 'DATE_BOARDING', 'CODE_ENTITY_TYPE']);

type CorpusName = 'bosl' | 'coredir';

interface ActiveCorpus {
  name: CorpusName;
  label: string;
  patterns: Record<string, ConfirmedPattern[]>;
  oneToManyFields: Set<string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clamp(v: number): number {
  return Math.min(1.0, Math.max(0.0, v));
}

function getField(id: string, fields: (Field | ConnectorField)[]): Field | ConnectorField | undefined {
  return fields.find((f) => f.id === id);
}

function countPrefixMatches(fieldNames: string[], prefixes: string[]): number {
  return fieldNames.filter((name) => {
    const upper = name.toUpperCase();
    return prefixes.some((prefix) => upper.startsWith(prefix));
  }).length;
}

function detectCoreDirSection(fieldName: string): { prefix: string; category: string } | null {
  const PREFIXES: Array<[string, string]> = [
    ['CUST_', 'demographic'],
    ['CIF_', 'demographic'],
    ['LOAN_', 'financial'],
    ['ACCT_', 'account'],
    ['DEP_', 'account'],
    ['COL_', 'collateral'],
    ['COLL_', 'collateral'],
    ['EMPL_', 'employment'],
    ['LIAB_', 'liability'],
    ['ADDR_', 'address'],
  ];

  const upper = fieldName.toUpperCase();
  for (const [prefix, category] of PREFIXES) {
    if (upper.startsWith(prefix)) return { prefix, category };
  }
  return null;
}

function selectCorpus(sourceFieldNames: string[]): ActiveCorpus | null {
  if (sourceFieldNames.length === 0) return null;

  const upperNames = sourceFieldNames.map((name) => name.toUpperCase());
  const boslRatio = countPrefixMatches(sourceFieldNames, BOSL_PREFIXES) / sourceFieldNames.length;
  const coreDirRatio = countPrefixMatches(sourceFieldNames, COREDIR_PREFIXES) / sourceFieldNames.length;
  const hasBoslIndicator = upperNames.some((name) => BOSL_INDICATORS.has(name));

  if (coreDirRatio > 0.30 && !hasBoslIndicator && boslRatio <= 0.30) {
    return {
      name: 'coredir',
      label: 'CoreDirector→FSC',
      patterns: COREDIR_FSC_PATTERNS,
      oneToManyFields: new Set(COREDIR_ONE_TO_MANY_FIELDS.map((value) => normalize(value))),
    };
  }

  if (hasBoslIndicator || boslRatio > 0.30) {
    return {
      name: 'bosl',
      label: 'BOSL→FSC',
      patterns: CONFIRMED_PATTERNS,
      oneToManyFields: ONE_TO_MANY_FIELDS,
    };
  }

  return null;
}

/**
 * Detect the RiskClam / Jack Henry XML prefix category from a field name.
 * Returns null if the field doesn't follow the prefix convention.
 */
function detectXmlPrefix(fieldName: string): { prefix: string; category: string } | null {
  const PREFIXES: Array<[string, string]> = [
    ['AMT_',     'monetary amount'],
    ['PERC_',    'percentage / rate'],
    ['DATE_',    'date / datetime'],
    ['CODE_',    'code / picklist'],
    ['NAME_',    'name / label text'],
    ['NBR_',     'numeric count / identifier'],
    ['Y_',       'boolean flag'],
    ['PHONE_',   'phone number'],
    ['ADDRESS_', 'address component'],
    ['DESC_',    'free-text description'],
  ];
  const upper = fieldName.toUpperCase();
  for (const [prefix, category] of PREFIXES) {
    if (upper.startsWith(prefix)) return { prefix, category };
  }
  return null;
}

/**
 * Check whether a source XML prefix is type-compatible with a Salesforce field
 * data type. Returns true = compatible, false = mismatch, null = no opinion.
 */
function isPrefixTypeCompatible(prefix: string, sfDataType: string): boolean | null {
  const TYPE_MAP: Record<string, string[]> = {
    'AMT_':     ['currency', 'double', 'percent', 'integer', 'number', 'decimal'],
    'PERC_':    ['percent', 'double', 'number', 'currency'],
    'DATE_':    ['date', 'datetime'],
    'CODE_':    ['picklist', 'multipicklist', 'string', 'text', 'varchar', 'id'],
    'NAME_':    ['string', 'text', 'varchar', 'reference', 'lookup'],
    'NBR_':     ['integer', 'double', 'number', 'string', 'id', 'text'],
    'Y_':       ['boolean', 'checkbox'],
    'PHONE_':   ['phone', 'string', 'text'],
    'ADDRESS_': ['string', 'text', 'address', 'textarea'],
    'DESC_':    ['textarea', 'string', 'text', 'longtextarea', 'richtext'],
  };
  const compatible = TYPE_MAP[prefix];
  if (!compatible) return null;
  return compatible.includes(sfDataType.toLowerCase());
}

/**
 * Look up confirmed patterns for a normalized XML field name.
 * Returns the best matching confirmed pattern for the given target field name,
 * or null if there is no confirmed pattern for this (source, target) pair.
 */
function findConfirmedPattern(
  patterns: Record<string, ConfirmedPattern[]>,
  srcNorm: string,
  tgtName: string,
): ConfirmedPattern | null {
  const candidatePatterns = patterns[srcNorm];
  if (!candidatePatterns || candidatePatterns.length === 0) return null;

  const tgtNorm = normalize(tgtName);

  // First pass: exact API name match
  for (const pattern of candidatePatterns) {
    if (pattern.sfApiNames.some((api) => normalize(api) === tgtNorm)) {
      return pattern;
    }
  }

  // Second pass: partial match (handles minor variations)
  for (const pattern of candidatePatterns) {
    if (pattern.sfApiNames.some((api) => {
      const n = normalize(api);
      return tgtNorm.includes(n) || n.includes(tgtNorm);
    })) {
      return pattern;
    }
  }

  return null;
}

function formatConfirmedPatternReason(corpusLabel: string, srcName: string, pattern: ConfirmedPattern): string {
  const note = pattern.notes.trim();
  return note
    ? `✅ Confirmed ${corpusLabel} pattern: '${srcName}' → '${pattern.sfApiNames[0]}' on ${pattern.sfObject} [${pattern.confidence}]. ${note}`
    : `✅ Confirmed ${corpusLabel} pattern: '${srcName}' → '${pattern.sfApiNames[0]}' on ${pattern.sfObject} [${pattern.confidence}].`;
}

/**
 * Detect Caribbean domain tokens in a field name and return context strings.
 */
function detectCaribbeanTokens(fieldName: string): string[] {
  const lower = fieldName.toLowerCase();
  const hits: string[] = [];
  for (const [token, meaning] of CARIBBEAN_DOMAIN_TOKENS) {
    if (lower.includes(token)) {
      hits.push(meaning);
    }
  }
  return hits;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class SchemaIntelligenceAgent extends AgentBase {
  readonly name = 'SchemaIntelligenceAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, targetSystemType, sourceEntities } = context;

    // Only active when the target is Salesforce
    if (targetSystemType !== 'salesforce') {
      this.info(
        context,
        'skip',
        `Target system is '${targetSystemType}' — SchemaIntelligenceAgent is FSC-specific`,
      );
      return this.noOp(fieldMappings);
    }

    this.info(
      context,
      'start',
      `Applying 6-step Schema Intelligence pipeline (${Object.keys(CONFIRMED_PATTERNS).length} BOSL keys, ${Object.keys(COREDIR_FSC_PATTERNS).length} CoreDirector keys loaded)`,
    );

    const updatedMappings: FieldMapping[] = [];
    let improved = 0;
    let flaggedFormulaTargets = 0;
    let flaggedOneToMany = 0;
    let flaggedSystemAudit = 0;
    let confirmedPatternHits = 0;
    let confirmedFamilyHits = 0;
    const steps: AgentStep[] = [];
    const sourceEntityIds = new Set(sourceEntities.map((entity) => entity.id));
    const sourceFieldNames = fields
      .filter((field) => sourceEntityIds.has(field.entityId))
      .map((field) => field.name);
    const activeCorpus = selectCorpus(sourceFieldNames);
    const corpusLabel = activeCorpus?.label ?? 'corpus';

    for (const mapping of fieldMappings) {
      if (!mapping.sourceFieldId || !mapping.targetFieldId) {
        updatedMappings.push(mapping);
        continue;
      }

      const srcField = getField(mapping.sourceFieldId, fields);
      const tgtField = getField(mapping.targetFieldId, fields);

      if (!srcField || !tgtField) {
        updatedMappings.push(mapping);
        continue;
      }

      const srcName = srcField.name;
      const tgtName = tgtField.name;
      const tgtDataType = (tgtField as Field).dataType ?? '';

      const srcNorm = normalize(srcName);
      const tgtNorm = normalize(tgtName);

      let delta = 0;
      const reasons: string[] = [];
      const metadata: Record<string, unknown> = { srcName, tgtName };

      // ── Step 1: Field Classification ────────────────────────────────────
      // 1a. System audit field target
      if (SYSTEM_AUDIT_FIELDS.has(tgtNorm)) {
        delta += SYSTEM_AUDIT_PENALTY;
        reasons.push(`⛔ System audit field '${tgtName}' should never be a mapping target`);
        metadata.systemAuditTarget = true;
        flaggedSystemAudit++;
      }

      // 1b. Formula / calculated field target
      const isFormulaName = tgtName.toLowerCase().includes('formula') || tgtName.toLowerCase().includes('calculated');
      const isFormulaInRegistry = FORMULA_FIELD_TARGETS.has(tgtNorm);
      if (isFormulaName || isFormulaInRegistry) {
        delta += FORMULA_TARGET_PENALTY;
        reasons.push(
          `⚠️ Formula field target: '${tgtName}' appears to be a calculated field — inbound writes will fail. ` +
          `Map the source fields that feed this formula instead.`,
        );
        metadata.formulaTarget = true;
        flaggedFormulaTargets++;
      }

      // 1c. Person Account field annotation
      if (tgtName.endsWith(PERSON_ACCOUNT_FIELD_SUFFIX)) {
        reasons.push(
          `ℹ️ Person Account field: '${tgtName}' (__pc suffix) only exists on Person Account records — ` +
          `not available for business/organisation accounts.`,
        );
        metadata.personAccountOnly = true;
      }

      // 1d. FSC namespace field — adds context to rationale
      if (tgtName.startsWith(FSC_NAMESPACE_PREFIX)) {
        delta += FSC_NAMESPACE_BOOST;
        reasons.push(`✓ FSC standard field: '${tgtName}' is in the FinServ__ namespace — known FSC integration target.`);
        metadata.fscStandardField = true;
      }

      // ── Step 2: XML Taxonomy Recognition ────────────────────────────────
      const coreDirSection = activeCorpus?.name === 'coredir' ? detectCoreDirSection(srcName) : null;
      if (coreDirSection) {
        reasons.push(
          `ℹ️ CoreDirector section prefix '${coreDirSection.prefix}' classifies '${srcName}' as ${coreDirSection.category}.`,
        );
        metadata.sectionPrefix = coreDirSection.prefix;
        metadata.sectionCategory = coreDirSection.category;
      } else {
        const prefixInfo = detectXmlPrefix(srcName);
        if (prefixInfo && tgtDataType) {
          const compatible = isPrefixTypeCompatible(prefixInfo.prefix, tgtDataType);
          if (compatible === true) {
            delta += 0.08;
            reasons.push(
              `✓ Type taxonomy: source prefix '${prefixInfo.prefix}' (${prefixInfo.category}) ` +
              `is type-compatible with SF field type '${tgtDataType}'.`,
            );
          } else if (compatible === false) {
            delta -= 0.15;
            reasons.push(
              `⚠️ Type mismatch: source prefix '${prefixInfo.prefix}' (${prefixInfo.category}) ` +
              `is NOT compatible with SF field type '${tgtDataType}' — a transform is required.`,
            );
            metadata.typeMismatch = true;
          }
          metadata.xmlPrefix = prefixInfo.prefix;
          metadata.xmlCategory = prefixInfo.category;
        }
      }

      // ── Step 3: Confirmed Pattern Boost ──────────────────────────────────
      const confirmedPattern = activeCorpus
        ? findConfirmedPattern(activeCorpus.patterns, srcNorm, tgtName)
        : null;
      if (confirmedPattern) {
        delta += CONFIRMED_EXACT_BOOST;
        confirmedPatternHits++;
        reasons.push(formatConfirmedPatternReason(corpusLabel, srcName, confirmedPattern));
        metadata.confirmedPattern = true;
        metadata.confirmedConfidenceTier = confirmedPattern.confidence;
        metadata.confirmedSfObject = confirmedPattern.sfObject;

        if (confirmedPattern.isFormulaTarget && delta > 0) {
          // Re-apply formula penalty from the pattern data (belt and suspenders)
          delta += FORMULA_TARGET_PENALTY;
          reasons.push(`(formula field warning from pattern corpus)`);
        }
      } else if (activeCorpus?.patterns[srcNorm]) {
        // Source field is in the corpus but this target isn't the confirmed one
        const allPatterns = activeCorpus.patterns[srcNorm];
        const preferredTargets = allPatterns.flatMap((p) => p.sfApiNames).join(', ');
        delta += CONFIRMED_FAMILY_BOOST;
        confirmedFamilyHits++;
        reasons.push(
          `ℹ️ Source '${srcName}' is in the ${corpusLabel} confirmed corpus — preferred targets: ${preferredTargets}`,
        );
        metadata.confirmedFamilyMatch = true;
      }

      // ── Step 4: One-to-Many Detection ────────────────────────────────────
      if (activeCorpus?.oneToManyFields.has(srcNorm)) {
        flaggedOneToMany++;
        reasons.push(
          `⚠️ One-to-Many field: '${srcName}' maps to multiple Salesforce targets in the ${corpusLabel} corpus. ` +
          `Human routing decision required — validate this specific target is correct for your lifecycle stage.`,
        );
        metadata.isOneToMany = true;
      }

      // ── Step 5: Caribbean Domain Glossary ────────────────────────────────
      const caribbeanHits = detectCaribbeanTokens(srcName);
      if (caribbeanHits.length > 0) {
        reasons.push(`🏝 Caribbean domain: ${caribbeanHits.join(' | ')}`);
        metadata.caribbeanDomain = caribbeanHits;
      }

      // ── Step 6: Confidence & Rationale Enrichment ─────────────────────────
      if (delta === 0 && reasons.length === 0) {
        updatedMappings.push(mapping);
        continue;
      }

      const newConfidence = clamp(mapping.confidence + delta);
      const rationalePrefix = reasons.join(' | ');
      const newRationale = mapping.rationale
        ? `${rationalePrefix} | ${mapping.rationale}`
        : rationalePrefix;

      if (newConfidence !== mapping.confidence || newRationale !== mapping.rationale) {
        const action = newConfidence > mapping.confidence
          ? 'schema_intelligence_boost'
          : newConfidence < mapping.confidence
            ? 'schema_intelligence_penalty'
            : 'schema_intelligence_annotate';

        const step: Omit<AgentStep, 'agentName'> = {
          action,
          detail: reasons[0] ?? 'Schema intelligence annotation',
          fieldMappingId: mapping.id,
          before: { confidence: mapping.confidence },
          after: { confidence: newConfidence },
          durationMs: 0,
          metadata,
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings.push({ ...mapping, confidence: newConfidence, rationale: newRationale });
        if (newConfidence > mapping.confidence) improved++;
        continue;
      }

      updatedMappings.push(mapping);
    }

    const corpusStep: Omit<AgentStep, 'agentName'> = activeCorpus
      ? {
          action: 'schema_intelligence_corpus',
          detail: `Applied ${activeCorpus.name} corpus: ${confirmedPatternHits + confirmedFamilyHits} boosts, ${flaggedOneToMany} one-to-many`,
          durationMs: 0,
          metadata: {
            corpus: activeCorpus.name,
            boosts: confirmedPatternHits + confirmedFamilyHits,
            oneToMany: flaggedOneToMany,
          },
        }
      : {
          action: 'schema_intelligence_corpus',
          detail: 'No corpus matched',
          durationMs: 0,
          metadata: { corpus: 'none' },
        };
    this.emit(context, corpusStep);
    steps.push({ agentName: this.name, ...corpusStep });

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'schema_intelligence_complete',
      detail:
        `Schema Intelligence pipeline complete — ` +
        `${confirmedPatternHits} confirmed pattern hits, ` +
        `${confirmedFamilyHits} family boosts, ` +
        `${improved} mappings improved, ` +
        `${flaggedOneToMany} one-to-many flags, ` +
        `${flaggedFormulaTargets} formula target warnings, ` +
        `${flaggedSystemAudit} system audit field penalties`,
      durationMs: Date.now() - start,
      metadata: {
        confirmedPatternHits,
        confirmedFamilyHits,
        improved,
        flaggedOneToMany,
        flaggedFormulaTargets,
        flaggedSystemAudit,
      },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return {
      agentName: this.name,
      updatedFieldMappings: updatedMappings,
      steps,
      totalImproved: improved,
      metadata: {
        confirmedPatternHits,
        confirmedFamilyHits,
        flaggedOneToMany,
        flaggedFormulaTargets,
        flaggedSystemAudit,
      },
    };
  }
}
