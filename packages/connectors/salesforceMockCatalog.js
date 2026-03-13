import fs from 'node:fs';
import path from 'node:path';
import { normalizeSalesforceType } from './utils/typeUtils.js';
let cachedCatalog = null;
const EXTERNAL_ID_DESCRIPTION = 'External ID — use as upsert key for deduplication during migration.';
const CUSTOM_MOCK_OBJECT_BUNDLES = {
    FinServ__FinancialAccount__c: {
        fields: [
            { name: 'AccountNumber', dataType: 'string', required: true },
            { name: 'CurrentBalance', dataType: 'decimal', precision: 18, scale: 2 },
            { name: 'OpenDate', dataType: 'date' },
            { name: 'Status', dataType: 'picklist', picklistValues: ['Open', 'Closed', 'Inactive'] },
            { name: 'Type', dataType: 'picklist', picklistValues: ['Checking', 'Savings', 'Loan', 'Certificate', 'LineOfCredit'] },
            { name: 'FinServ__PrimaryOwner__c', dataType: 'reference' },
            {
                name: 'ExternalAccountId__c',
                dataType: 'string',
                isExternalId: true,
                isUpsertKey: true,
                description: EXTERNAL_ID_DESCRIPTION,
            },
        ],
        recordTypes: [
            { sfRecordTypeId: '012FA_CHECKING', name: 'Checking', label: 'Checking', isDefault: true, isActive: true },
            { sfRecordTypeId: '012FA_SAVINGS', name: 'Savings', label: 'Savings', isDefault: false, isActive: true },
            { sfRecordTypeId: '012FA_LOAN', name: 'Loan', label: 'Loan', isDefault: false, isActive: true },
            { sfRecordTypeId: '012FA_CERTIFICATE', name: 'Certificate', label: 'Certificate', isDefault: false, isActive: true },
        ],
    },
    FinServ__FinancialAccountTransaction__c: {
        fields: [
            { name: 'Amount', dataType: 'decimal', precision: 18, scale: 2 },
            { name: 'TransactionDate', dataType: 'date' },
            { name: 'Description', dataType: 'text' },
            { name: 'TransactionType', dataType: 'picklist', picklistValues: ['Credit', 'Debit', 'Fee', 'Interest'] },
            { name: 'FinServ__FinancialAccount__c', dataType: 'reference', required: true },
        ],
    },
    FinServ__BillingStatement__c: {
        fields: [
            { name: 'StatementDate', dataType: 'date' },
            { name: 'BalanceDue', dataType: 'decimal', precision: 18, scale: 2 },
            { name: 'MinimumPaymentDue', dataType: 'decimal', precision: 18, scale: 2 },
            { name: 'FinServ__FinancialAccount__c', dataType: 'reference', required: true },
        ],
    },
    FinServ__IndividualApplication__c: {
        fields: [
            {
                name: 'ApplicationNumber',
                dataType: 'string',
                required: true,
                isExternalId: true,
                isUpsertKey: true,
                description: EXTERNAL_ID_DESCRIPTION,
            },
            { name: 'Status', dataType: 'picklist', picklistValues: ['Draft', 'Submitted', 'UnderReview', 'Approved', 'Declined'] },
            { name: 'RequestedAmount', dataType: 'decimal', precision: 18, scale: 2 },
            { name: 'FinServ__PrimaryApplicant__c', dataType: 'reference' },
            { name: 'RecordTypeId', dataType: 'reference' },
        ],
        recordTypes: [
            { sfRecordTypeId: '012IA_MORTGAGE', name: 'Mortgage', label: 'Mortgage', isDefault: true, isActive: true },
            { sfRecordTypeId: '012IA_PERSONAL', name: 'PersonalLoan', label: 'Personal Loan', isDefault: false, isActive: true },
            { sfRecordTypeId: '012IA_AUTO', name: 'AutoLoan', label: 'Auto Loan', isDefault: false, isActive: true },
        ],
    },
    FinServ__FinancialGoal__c: {
        fields: [
            { name: 'Name', dataType: 'string', required: true },
            { name: 'TargetAmount', dataType: 'decimal', precision: 18, scale: 2 },
            { name: 'TargetDate', dataType: 'date' },
            { name: 'CurrentProgress', dataType: 'decimal', precision: 18, scale: 2 },
            { name: 'Status', dataType: 'picklist', picklistValues: ['Planned', 'InProgress', 'Achieved', 'Cancelled'] },
            { name: 'FinServ__PrimaryOwner__c', dataType: 'reference' },
        ],
    },
    FinServ__ReciprocalRole__c: {
        fields: [
            { name: 'Name', dataType: 'string', required: true },
            { name: 'InverseRole', dataType: 'string' },
            { name: 'RelationshipType', dataType: 'string' },
        ],
    },
};
const CUSTOM_MOCK_RECORD_TYPES = {
    Account: [
        { sfRecordTypeId: '012AC_BUSINESS', name: 'Business', label: 'Business Account', isDefault: true, isActive: true },
        { sfRecordTypeId: '012AC_PERSON', name: 'PersonAccount', label: 'Person Account', isDefault: false, isActive: true },
    ],
    FinServ__FinancialAccount__c: CUSTOM_MOCK_OBJECT_BUNDLES.FinServ__FinancialAccount__c.recordTypes ?? [],
    FinServ__IndividualApplication__c: CUSTOM_MOCK_OBJECT_BUNDLES.FinServ__IndividualApplication__c.recordTypes ?? [],
    FinancialAccount: CUSTOM_MOCK_OBJECT_BUNDLES.FinServ__FinancialAccount__c.recordTypes ?? [],
    IndividualApplication: CUSTOM_MOCK_OBJECT_BUNDLES.FinServ__IndividualApplication__c.recordTypes ?? [],
};
function resolveCatalogPath() {
    const candidates = [
        path.resolve(process.cwd(), 'data/salesforce-object-reference.json'),
        path.resolve(process.cwd(), 'backend/data/salesforce-object-reference.json'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate))
            return candidate;
    }
    return null;
}
function loadCatalogFile() {
    const filePath = resolveCatalogPath();
    if (!filePath)
        return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(parsed.objects))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function toTemplateField(field) {
    const properties = new Set((field.properties ?? []).map((p) => p.toLowerCase()));
    const rawType = field.type ?? 'string';
    const isExternalId = properties.has('external id');
    return {
        name: field.name,
        dataType: normalizeSalesforceType(rawType.toLowerCase()),
        required: !properties.has('nillable'),
        isExternalId,
        isUpsertKey: isExternalId && field.name !== 'Id',
        description: isExternalId ? EXTERNAL_ID_DESCRIPTION : undefined,
        isKey: field.name === 'Id',
    };
}
function getCatalog() {
    if (cachedCatalog)
        return cachedCatalog;
    const loaded = loadCatalogFile();
    const map = new Map();
    if (loaded) {
        for (const obj of loaded.objects) {
            map.set(obj.name, obj.fields.map(toTemplateField));
        }
    }
    cachedCatalog = map;
    return map;
}
export function getSalesforceMockObjectTemplates(objectNames) {
    const catalog = getCatalog();
    const templates = {};
    for (const name of objectNames) {
        const customFields = CUSTOM_MOCK_OBJECT_BUNDLES[name]?.fields;
        if (customFields?.length) {
            templates[name] = customFields;
            continue;
        }
        const catalogFields = catalog.get(name);
        if (catalogFields?.length) {
            templates[name] = catalogFields;
        }
    }
    return templates;
}
export function getSalesforceMockObjectTemplatesForConnector(objectNames) {
    return Object.fromEntries(objectNames.map((name) => {
        const customFields = CUSTOM_MOCK_OBJECT_BUNDLES[name]?.fields;
        if (customFields?.length) {
            return [name, customFields];
        }
        const baseFields = getSalesforceMockObjectTemplates([name])[name] ?? [];
        return [name, baseFields];
    }));
}
export function getSalesforceMockRecordTypeTemplates(objectNames) {
    return Object.fromEntries(objectNames
        .map((name) => [name, CUSTOM_MOCK_RECORD_TYPES[name] ?? []])
        .filter(([, recordTypes]) => recordTypes.length > 0));
}
export function listSalesforceMockObjectNames() {
    return Array.from(new Set([
        ...getCatalog().keys(),
        ...Object.keys(CUSTOM_MOCK_OBJECT_BUNDLES),
    ])).sort((a, b) => a.localeCompare(b));
}
