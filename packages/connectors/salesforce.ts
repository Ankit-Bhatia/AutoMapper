import type { Entity, Field, RecordType, Relationship } from './types.js';
import { SalesforceConnector } from './SalesforceConnector.js';

export interface SalesforceConnectionInput {
  objects: string[];
  credentials?: {
    loginUrl?: string;
    username?: string;
    password?: string;
    securityToken?: string;
    accessToken?: string;
    instanceUrl?: string;
    refreshToken?: string;
  };
}

export async function fetchSalesforceSchema(
  systemId: string,
  input: SalesforceConnectionInput,
): Promise<{
  entities: Entity[];
  fields: Field[];
  recordTypes: RecordType[];
  relationships: Relationship[];
  upsertKeys: Record<string, string[]>;
  mode: 'live' | 'mock';
}> {
  const connector = new SalesforceConnector(input.credentials);
  await connector.connect(input.credentials);
  const schema = await connector.fetchSchema(input.objects);

  return {
    ...schema,
    entities: schema.entities.map((entity) => ({
      ...entity,
      systemId,
    })),
    recordTypes: schema.recordTypes ?? [],
    upsertKeys: schema.upsertKeys ?? {},
  };
}
