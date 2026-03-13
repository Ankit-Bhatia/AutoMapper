import type { DataType } from '../types.js';

const SF_TO_INTERNAL: Record<string, DataType> = {
  string: 'string',
  textarea: 'text',
  double: 'number',
  currency: 'decimal',
  int: 'integer',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  email: 'email',
  phone: 'phone',
  id: 'id',
  reference: 'reference',
  picklist: 'picklist',
  multipicklist: 'picklist',
};

const ODATA_TO_INTERNAL: Record<string, DataType> = {
  'Edm.String': 'string',
  'Edm.Int16': 'integer',
  'Edm.Int32': 'integer',
  'Edm.Int64': 'integer',
  'Edm.Decimal': 'decimal',
  'Edm.Double': 'number',
  'Edm.Boolean': 'boolean',
  'Edm.Date': 'date',
  'Edm.DateTime': 'datetime',
  'Edm.DateTimeOffset': 'datetime',
};

export function normalizeSalesforceType(input: string): DataType {
  return SF_TO_INTERNAL[input.toLowerCase()] ?? 'unknown';
}

export function normalizeODataType(input: string): DataType {
  return ODATA_TO_INTERNAL[input] ?? 'unknown';
}

export function typeCompatibilityScore(source: DataType, target: DataType): number {
  if (source === target) return 1;
  const groups: DataType[][] = [
    ['string', 'text', 'email', 'phone', 'id', 'picklist'],
    ['number', 'integer', 'decimal'],
    ['date', 'datetime', 'time'],
  ];
  const sameGroup = groups.some((g) => g.includes(source) && g.includes(target));
  if (sameGroup) return 0.75;
  if (source === 'unknown' || target === 'unknown') return 0.45;
  return 0.2;
}
