import type { FieldMapping, FieldMappingStatus } from '../types.js';

export function isInactiveFieldMappingStatus(status: FieldMappingStatus): boolean {
  return status === 'rejected' || status === 'unmatched';
}

export function isActiveFieldMappingStatus(status: FieldMappingStatus): boolean {
  return !isInactiveFieldMappingStatus(status);
}

export function isActiveFieldMapping(mapping: Pick<FieldMapping, 'status'>): boolean {
  return isActiveFieldMappingStatus(mapping.status);
}
