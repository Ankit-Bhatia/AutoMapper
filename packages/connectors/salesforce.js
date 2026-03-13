import { SalesforceConnector } from './SalesforceConnector.js';
export async function fetchSalesforceSchema(systemId, input) {
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
