/**
 * BankingDomainAgent — Jack Henry banking platform mapping intelligence.
 *
 * Supports all three Jack Henry platforms:
 *   - SilverLake  (commercial banks)  AcctType: "D"=deposit, "L"=loan
 *   - Core Director (community banks) AcctType: "10"=deposit, "40"=loan
 *   - Symitar/Episys (credit unions)  Share-based terminology
 *
 * Applies banking-specific heuristics to improve field mapping confidence:
 *   - CIF ↔ Member / Customer normalisation
 *   - DDA ↔ Share / Deposit normalisation
 *   - SilverLake / Core Director ISO 20022 canonical name matching
 *   - Credit-union terminology enforcement (DividendRate ≠ InterestRate)
 *   - CIFNumber / MemberNumber → CRM account ID patterns
 *   - Core Director AcctType numeric code warning ("10","40" → picklist transform required)
 *   - Core Director CustomerType short code mapping ("Indv","Bus" → "Individual","Business")
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { ConnectorField } from '../connectors/IConnector.js';
import type { Field, FieldMapping } from '../types.js';

/** Banking field synonyms: source field name → semantically equivalent target field names */
const BANKING_SYNONYMS: Record<string, string[]> = {
  // Core identity
  CIFNumber: ['AccountId', 'CustomerId', 'PartyId', 'ExternalId'],
  MemberNumber: ['AccountId', 'CustomerId', 'MemberId', 'ExternalId'],
  LegalName: ['Name', 'AccountName', 'FullName', 'CustomerName'],
  ShortName: ['Nickname', 'ShortName'],

  // Contact
  PrimaryEmail: ['Email', 'EmailAddress', 'PersonEmail'],
  PrimaryPhone: ['Phone', 'PhoneNumber', 'HomePhone'],

  // Balances (SilverLake DDA / Symitar Share)
  CurrentBalance: ['Balance', 'CurrentBalance', 'Amount', 'OpenBalance'],
  AvailableBalance: ['AvailableBalance', 'CreditAvailable'],
  OriginalBalance: ['Amount', 'LoanAmount', 'OriginalLoanAmount'],

  // Rates — CRITICAL: DividendRate (CU) ≠ InterestRate (bank)
  DividendRate: ['Rate', 'APY'],      // Symitar shares pay dividends
  InterestRate: ['Rate', 'APR', 'LoanRate'],  // Loans always use interest

  // Status
  CustomerStatus: ['Status', 'AccountStatus', 'Active'],
  MemberStatus: ['Status', 'AccountStatus', 'Active'],
  ShareStatus: ['Status', 'AccountStatus'],
  LoanStatus: ['Status', 'LoanStatus'],

  // Addresses
  AddressLine1: ['BillingStreet', 'ShippingStreet', 'Street', 'Address'],
  City: ['BillingCity', 'ShippingCity', 'City'],
  StateCode: ['BillingState', 'ShippingState', 'State'],
  PostalCode: ['BillingPostalCode', 'ShippingPostalCode', 'PostalCode', 'Zip'],
};

/**
 * Core Director AcctType numeric codes that require a value-level transform
 * when mapping to targets that expect string labels ("Checking", "Savings", etc.).
 * Mapping these directly without a lookup transform will silently produce wrong values.
 */
const CORE_DIRECTOR_ACCT_TYPE_CODES = new Set(['10', '40', '50', '60']);

/**
 * Core Director CustomerType short-code → full label.
 * Core Director uses abbreviated codes; SilverLake uses full words.
 * Targets (e.g. Salesforce Type) may expect either form.
 */
const CORE_DIRECTOR_CUSTOMER_TYPE_MAP: Record<string, string> = {
  Indv: 'Individual',
  Bus: 'Business',
  Trust: 'Trust',
  Govt: 'Government',
};

/** ISO 20022 canonical → target field name patterns */
const ISO20022_PATTERNS: Record<string, string[]> = {
  Name: ['Name', 'AccountName', 'FullName'],
  TaxIdentification: ['TaxId', 'TIN', 'TaxNumber'],
  BirthDate: ['Birthdate', 'DOB', 'DateOfBirth'],
  EmailAddress: ['Email', 'EmailAddress'],
  PhoneNumber: ['Phone', 'PhoneNumber'],
};

function boostConfidence(current: number, boost: number): number {
  return Math.min(1.0, current + boost);
}

function fieldName(id: string, fields: (Field | ConnectorField)[]): string | undefined {
  return fields.find((f) => f.id === id)?.name;
}

export class BankingDomainAgent extends AgentBase {
  readonly name = 'BankingDomainAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, sourceSystemType } = context;

    if (sourceSystemType !== 'jackhenry') {
      this.info(context, 'skip', `Source system is ${sourceSystemType} — BankingDomainAgent not applicable`);
      return this.noOp(fieldMappings);
    }

    this.info(context, 'start', 'Applying Jack Henry SilverLake / Core Director / Symitar domain heuristics...');

    const updatedMappings: FieldMapping[] = [];
    let improved = 0;
    const steps: AgentStep[] = [];

    for (const mapping of fieldMappings) {
      if (!mapping.sourceFieldId || !mapping.targetFieldId) {
        updatedMappings.push(mapping);
        continue;
      }

      const srcName = fieldName(mapping.sourceFieldId, fields);
      const tgtName = fieldName(mapping.targetFieldId, fields);
      if (!srcName || !tgtName) {
        updatedMappings.push(mapping);
        continue;
      }

      // Check direct synonym match
      const synonyms = BANKING_SYNONYMS[srcName] ?? [];
      const isSynonymMatch = synonyms.some(
        (s) => s.toLowerCase() === tgtName.toLowerCase(),
      );

      // Check ISO 20022 match
      const srcField = fields.find((f) => f.id === mapping.sourceFieldId);
      const iso20022 = (srcField as ConnectorField | undefined)?.iso20022Name;
      const isoSynonyms = iso20022 ? (ISO20022_PATTERNS[iso20022] ?? []) : [];
      const isIsoMatch = isoSynonyms.some(
        (s) => s.toLowerCase() === tgtName.toLowerCase(),
      );

      let newConfidence = mapping.confidence;
      let reason = '';

      if (isSynonymMatch) {
        newConfidence = boostConfidence(mapping.confidence, 0.15);
        reason = `Banking synonym: ${srcName} → ${tgtName}`;
      } else if (isIsoMatch) {
        newConfidence = boostConfidence(mapping.confidence, 0.12);
        reason = `ISO 20022 match: ${iso20022} → ${tgtName}`;
      }

      // Special case: warn about DividendRate being mapped to InterestRate
      if (
        srcName === 'DividendRate' &&
        tgtName.toLowerCase().includes('interest')
      ) {
        newConfidence = Math.max(0.1, mapping.confidence - 0.25);
        reason = 'TERMINOLOGY WARNING: DividendRate (CU) ≠ InterestRate — credit unions pay dividends, not interest on savings';
      }

      // Special case: Core Director numeric AcctType codes need a value transform
      // AcctType "10" = deposit, "40" = loan — cannot be mapped directly to string labels
      if (srcName === 'AccountType' || srcName === 'AcctType') {
        const srcField2 = fields.find((f) => f.id === mapping.sourceFieldId) as ConnectorField | undefined;
        const picklistVals = srcField2?.picklistValues ?? [];
        const hasCoreDirectorCodes = picklistVals.some((v) => CORE_DIRECTOR_ACCT_TYPE_CODES.has(v));
        if (hasCoreDirectorCodes && newConfidence > 0.5) {
          newConfidence = Math.max(0.45, newConfidence - 0.2);
          reason = (reason ? reason + ' | ' : '') +
            'CORE DIRECTOR WARNING: AcctType uses numeric codes ("10"=deposit, "40"=loan). ' +
            'A lookup transform is required — direct mapping will produce incorrect values in the target.';
        }
      }

      // Special case: Core Director CustomerType short codes need a value transform
      // "Indv" → "Individual", "Bus" → "Business" etc. — targets may expect full labels
      if (srcName === 'CustomerType' || srcName === 'PersonType') {
        const srcField3 = fields.find((f) => f.id === mapping.sourceFieldId) as ConnectorField | undefined;
        const picklistVals = srcField3?.picklistValues ?? [];
        const hasCDShortCodes = picklistVals.some((v) => Object.keys(CORE_DIRECTOR_CUSTOMER_TYPE_MAP).includes(v));
        if (hasCDShortCodes && newConfidence > 0.5) {
          newConfidence = Math.max(0.45, newConfidence - 0.15);
          reason = (reason ? reason + ' | ' : '') +
            'CORE DIRECTOR WARNING: CustomerType uses short codes (Indv, Bus, Trust, Govt). ' +
            'A lookup transform is required to convert to full labels expected by target systems.';
        }
      }

      if (newConfidence !== mapping.confidence) {
        const step: Omit<AgentStep, 'agentName'> = {
          action: newConfidence > mapping.confidence ? 'rescore_up' : 'rescore_down',
          detail: reason,
          fieldMappingId: mapping.id,
          before: { confidence: mapping.confidence },
          after: { confidence: newConfidence },
          durationMs: 0,
          metadata: { srcName, tgtName, iso20022 },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings.push({ ...mapping, confidence: newConfidence });
        if (newConfidence > mapping.confidence) improved++;
      } else {
        updatedMappings.push(mapping);
      }
    }

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'banking_domain_complete',
      detail: `Applied Jack Henry banking rules (SilverLake/CoreDirector/Symitar) — ${improved} mappings improved`,
      durationMs: Date.now() - start,
      metadata: { improved },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return { agentName: this.name, updatedFieldMappings: updatedMappings, steps, totalImproved: improved };
  }
}
