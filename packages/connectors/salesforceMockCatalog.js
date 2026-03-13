import fs from 'node:fs';
import path from 'node:path';
import { normalizeSalesforceType } from './utils/typeUtils.js';
let cachedCatalog = null;
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
    return {
        name: field.name,
        dataType: normalizeSalesforceType(rawType.toLowerCase()),
        required: !properties.has('nillable'),
        isExternalId: properties.has('external id'),
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
        const fields = catalog.get(name);
        if (fields?.length) {
            templates[name] = fields;
        }
    }
    return templates;
}
export function getSalesforceMockObjectTemplatesForConnector(objectNames) {
    const base = getSalesforceMockObjectTemplates(objectNames);
    return Object.fromEntries(Object.entries(base).map(([name, fields]) => [name, fields]));
}
export function listSalesforceMockObjectNames() {
    return Array.from(getCatalog().keys()).sort((a, b) => a.localeCompare(b));
}
