/**
 * CRMDomainAgent — Salesforce-specific mapping intelligence.
 *
 * Applies Salesforce field naming conventions and standard object heuristics:
 *   - Account standard fields (Name, BillingStreet, OwnerId, etc.)
 *   - Contact standard fields (Email, Phone, FirstName, LastName, etc.)
 *   - Opportunity standard fields (Amount, CloseDate, StageName, etc.)
 *   - Custom field detection (suffix __c) and confidence adjustment
 *   - Picklist value normalisation hints
 */
import { AgentBase } from './AgentBase.js';
import type { AgentContext, AgentResult, AgentStep } from './types.js';
import type { Field, FieldMapping } from '../types.js';
import type { ConnectorField } from '../connectors/IConnector.js';

/** Salesforce object → standard field → semantic purpose mapping */
const SF_STANDARD_FIELDS: Record<string, Record<string, string>> = {
  Account: {
    Name: 'primary_name',
    BillingStreet: 'address_street',
    BillingCity: 'address_city',
    BillingState: 'address_state',
    BillingPostalCode: 'address_postal',
    BillingCountry: 'address_country',
    Phone: 'phone_main',
    Website: 'web_url',
    Industry: 'classification',
    AnnualRevenue: 'financial',
    NumberOfEmployees: 'count',
    OwnerId: 'owner',
    Type: 'classification',
    AccountSource: 'classification',
  },
  Contact: {
    FirstName: 'first_name',
    LastName: 'last_name',
    Email: 'email',
    Phone: 'phone_main',
    MobilePhone: 'phone_mobile',
    Title: 'title',
    Department: 'classification',
    Birthdate: 'date_birth',
    MailingStreet: 'address_street',
    MailingCity: 'address_city',
    ReportsToId: 'reference',
    AccountId: 'parent_id',
  },
  Opportunity: {
    Name: 'primary_name',
    Amount: 'financial',
    CloseDate: 'date_close',
    StageName: 'lifecycle_status',
    Probability: 'percentage',
    AccountId: 'parent_id',
    OwnerId: 'owner',
    Type: 'classification',
    LeadSource: 'classification',
  },
  FinancialAccount: {
    Name: 'primary_name',
    FinancialAccountNumber: 'account_number',
    CurrentBalance: 'financial',
    AvailableBalance: 'financial',
    OpenDate: 'date_open',
    Status: 'lifecycle_status',
    FinancialAccountType: 'classification',
    PrimaryOwnerId: 'owner',
  },
  PartyProfile: {
    CIFNumber: 'external_id',
    LegalName: 'primary_name',
    TaxId: 'identifier',
    BirthDate: 'date_birth',
    PrimaryEmail: 'email',
    PrimaryPhone: 'phone_main',
    AddressLine1: 'address_street',
    City: 'address_city',
    StateCode: 'address_state',
    PostalCode: 'address_postal',
    CountryCode: 'address_country',
  },
  AccountParticipant: {
    FinancialAccountId: 'parent_id',
    PartyProfileId: 'reference',
    ParticipantRole: 'classification',
    StartDate: 'date_start',
    EndDate: 'date_end',
  },
};

/** Source field purpose → Salesforce standard field boosts */
const PURPOSE_BOOSTS: Record<string, Record<string, number>> = {
  primary_name: { Name: 0.15, AccountName: 0.1 },
  email: { Email: 0.18 },
  phone_main: { Phone: 0.15 },
  financial: { Amount: 0.12, AnnualRevenue: 0.1 },
  address_street: { BillingStreet: 0.15, MailingStreet: 0.12 },
};

function fieldById(id: string, fields: (Field | ConnectorField)[]): Field | ConnectorField | undefined {
  return fields.find((f) => f.id === id);
}

export class CRMDomainAgent extends AgentBase {
  readonly name = 'CRMDomainAgent';

  async run(context: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const { fields, fieldMappings, targetSystemType, targetEntities, sourceSystemType } = context;

    if (targetSystemType !== 'salesforce') {
      this.info(context, 'skip', `Target system is ${targetSystemType} — CRMDomainAgent not applicable`);
      return this.noOp(fieldMappings);
    }

    this.info(context, 'start', 'Applying Salesforce CRM standard object/field heuristics...');

    const entityNameById = new Map(targetEntities.map((e) => [e.id, e.name]));
    const hasFscTargets = targetEntities.some((e) =>
      ['FinancialAccount', 'PartyProfile', 'AccountParticipant'].includes(e.name),
    );

    const updatedMappings: FieldMapping[] = [];
    let improved = 0;
    const steps: AgentStep[] = [];

    for (const mapping of fieldMappings) {
      if (!mapping.targetFieldId) {
        updatedMappings.push(mapping);
        continue;
      }

      const tgtField = fieldById(mapping.targetFieldId, fields);
      if (!tgtField) {
        updatedMappings.push(mapping);
        continue;
      }

      const entityName = entityNameById.get(tgtField.entityId) ?? '';
      const sfStdFields = SF_STANDARD_FIELDS[entityName] ?? {};
      const fieldPurpose = sfStdFields[tgtField.name];

      let boost = 0;
      let reason = '';

      // Boost for mapping to a known standard Salesforce field
      if (fieldPurpose) {
        boost = 0.08;
        reason = `Salesforce standard field: ${entityName}.${tgtField.name} (${fieldPurpose})`;
      }

      // Additional boost if the source field's data type aligns with the target
      if (tgtField.name.endsWith('__c')) {
        // Custom fields are less certain — slight penalty unless confidence is already high
        if (mapping.confidence < 0.75) {
          boost -= 0.05;
          reason = `Custom field target ${tgtField.name} — confidence reduced pending manual review`;
        }
      }

      // For core-banking sources, prefer Salesforce FSC objects over generic CRM pipeline objects.
      if (sourceSystemType === 'jackhenry' && hasFscTargets) {
        if (['FinancialAccount', 'PartyProfile', 'AccountParticipant'].includes(entityName)) {
          boost += 0.1;
          if (!reason) reason = `FSC target preferred for core-banking source: ${entityName}`;
        } else if (['Opportunity', 'Lead', 'Case'].includes(entityName)) {
          boost -= 0.12;
          reason = `Generic CRM object penalized for core-banking source: ${entityName}`;
        }
      }

      const newConfidence = boost !== 0
        ? Math.min(1.0, Math.max(0.05, mapping.confidence + boost))
        : mapping.confidence;

      if (newConfidence !== mapping.confidence) {
        const step: Omit<AgentStep, 'agentName'> = {
          action: boost > 0 ? 'rescore_up' : 'rescore_down',
          detail: reason,
          fieldMappingId: mapping.id,
          before: { confidence: mapping.confidence },
          after: { confidence: newConfidence },
          durationMs: 0,
          metadata: { entityName, fieldPurpose },
        };
        this.emit(context, step);
        steps.push({ agentName: this.name, ...step });

        updatedMappings.push({ ...mapping, confidence: newConfidence });
        if (boost > 0) improved++;
      } else {
        updatedMappings.push(mapping);
      }
    }

    const summary: Omit<AgentStep, 'agentName'> = {
      action: 'crm_domain_complete',
      detail: `Applied Salesforce standard field rules — ${improved} mappings improved`,
      durationMs: Date.now() - start,
      metadata: { improved },
    };
    this.emit(context, summary);
    steps.push({ agentName: this.name, ...summary });

    return { agentName: this.name, updatedFieldMappings: updatedMappings, steps, totalImproved: improved };
  }
}
