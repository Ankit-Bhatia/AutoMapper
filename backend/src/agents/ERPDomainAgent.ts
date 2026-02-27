/**
 * ERPDomainAgent — SAP S/4HANA mapping intelligence.
 *
 * Applies SAP-specific heuristics:
 *   - BAPI/IDoc field naming conventions (LIFNR, KUNNR, BUKRS, etc.)
 *   - Business Partner (BP) model field alignment
 *   - G/L account and cost center identification
 *   - Material/product catalog fields
 *   - Currency and amount pair detection (DMBTR / WAERS)
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { Field, FieldMapping } from '../types.js';
import type { ConnectorField } from '../connectors/IConnector.js';

/**
 * SAP technical field name → semantic purpose + confidence boost when mapping
 * from or to this field.
 */
const SAP_FIELD_SEMANTICS: Record<string, { purpose: string; boost: number }> = {
  // Business Partner / Customer
  KUNNR: { purpose: 'customer_id', boost: 0.15 },
  LIFNR: { purpose: 'vendor_id', boost: 0.15 },
  PARNR: { purpose: 'partner_id', boost: 0.12 },
  NAME1: { purpose: 'primary_name', boost: 0.15 },
  NAME2: { purpose: 'secondary_name', boost: 0.1 },
  STRAS: { purpose: 'address_street', boost: 0.12 },
  ORT01: { purpose: 'address_city', boost: 0.12 },
  REGIO: { purpose: 'address_state', boost: 0.12 },
  PSTLZ: { purpose: 'address_postal', boost: 0.12 },
  LAND1: { purpose: 'address_country', boost: 0.12 },
  TELF1: { purpose: 'phone_main', boost: 0.13 },
  SMTP_ADDR: { purpose: 'email', boost: 0.15 },

  // Company code / org
  BUKRS: { purpose: 'company_code', boost: 0.1 },
  WERKS: { purpose: 'plant', boost: 0.1 },
  KOSTL: { purpose: 'cost_center', boost: 0.1 },
  PRCTR: { purpose: 'profit_center', boost: 0.1 },

  // Financial
  DMBTR: { purpose: 'financial_amount', boost: 0.13 },
  WRBTR: { purpose: 'financial_amount_doc_currency', boost: 0.13 },
  WAERS: { purpose: 'currency_code', boost: 0.08 },
  HKONT: { purpose: 'gl_account', boost: 0.1 },
  BLDAT: { purpose: 'document_date', boost: 0.1 },
  BUDAT: { purpose: 'posting_date', boost: 0.1 },

  // Material
  MATNR: { purpose: 'material_number', boost: 0.13 },
  MAKTX: { purpose: 'material_description', boost: 0.12 },
  MEINS: { purpose: 'unit_of_measure', boost: 0.08 },
};

/** Semantic purpose → Salesforce/CRM field targets with boost */
const PURPOSE_TO_CRM: Record<string, string[]> = {
  customer_id: ['AccountId', 'ExternalId', 'CustomerId'],
  primary_name: ['Name', 'AccountName'],
  address_street: ['BillingStreet', 'MailingStreet'],
  address_city: ['BillingCity', 'MailingCity'],
  email: ['Email', 'EmailAddress'],
  phone_main: ['Phone', 'PhoneNumber'],
  financial_amount: ['Amount', 'AnnualRevenue', 'Balance'],
};

function fieldById(id: string, fields: (Field | ConnectorField)[]): Field | ConnectorField | undefined {
  return fields.find((f) => f.id === id);
}

export class ERPDomainAgent extends AgentBase {
  readonly name = 'ERPDomainAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, sourceSystemType } = context;

    if (sourceSystemType !== 'sap') {
      this.info(context, 'skip', `Source system is ${sourceSystemType} — ERPDomainAgent not applicable`);
      return this.noOp(fieldMappings);
    }

    this.info(context, 'start', 'Applying SAP S/4HANA BAPI/IDoc field naming heuristics...');

    const updatedMappings: FieldMapping[] = [];
    let improved = 0;
    const steps: AgentStep[] = [];

    for (const mapping of fieldMappings) {
      if (!mapping.sourceFieldId) {
        updatedMappings.push(mapping);
        continue;
      }

      const srcField = fieldById(mapping.sourceFieldId, fields);
      if (!srcField) {
        updatedMappings.push(mapping);
        continue;
      }

      const sapSemantic = SAP_FIELD_SEMANTICS[srcField.name.toUpperCase()];
      if (!sapSemantic) {
        updatedMappings.push(mapping);
        continue;
      }

      // Check if the target field aligns with the SAP semantic purpose
      const tgtField = mapping.targetFieldId ? fieldById(mapping.targetFieldId, fields) : undefined;
      const crmTargets = PURPOSE_TO_CRM[sapSemantic.purpose] ?? [];
      const isGoodMatch = tgtField
        ? crmTargets.some((t) => t.toLowerCase() === tgtField.name.toLowerCase())
        : false;

      const boost = isGoodMatch ? sapSemantic.boost : sapSemantic.boost * 0.4;
      const newConfidence = Math.min(1.0, mapping.confidence + boost);

      if (newConfidence !== mapping.confidence) {
        const reason = isGoodMatch
          ? `SAP BAPI field "${srcField.name}" (${sapSemantic.purpose}) matched to Salesforce "${tgtField?.name}"`
          : `SAP BAPI field "${srcField.name}" recognised as ${sapSemantic.purpose} — partial boost applied`;

        const step: Omit<AgentStep, 'agentName'> = {
          action: 'rescore_up',
          detail: reason,
          fieldMappingId: mapping.id,
          before: { confidence: mapping.confidence },
          after: { confidence: newConfidence },
          durationMs: 0,
          metadata: { sapField: srcField.name, purpose: sapSemantic.purpose },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings.push({ ...mapping, confidence: newConfidence });
        improved++;
      } else {
        updatedMappings.push(mapping);
      }
    }

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'erp_domain_complete',
      detail: `Applied SAP field semantics — ${improved} mappings improved`,
      durationMs: Date.now() - start,
      metadata: { improved },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return { agentName: this.name, updatedFieldMappings: updatedMappings, steps, totalImproved: improved };
  }
}
