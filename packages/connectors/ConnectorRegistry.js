/**
 * ConnectorRegistry — maps connector IDs to factory functions and metadata.
 *
 * Usage:
 *   registry.register('jackhenry-silverlake', meta, factory);
 *   const connector = registry.instantiate('jackhenry-silverlake');
 */
export class ConnectorRegistry {
    factories = new Map();
    metadata = new Map();
    /**
     * Register a connector.
     * @param id - unique identifier (e.g. 'jackhenry-silverlake', 'salesforce', 'sap')
     * @param meta - display metadata
     * @param factory - factory function that creates a new IConnector instance
     */
    register(id, meta, factory) {
        this.factories.set(id, factory);
        this.metadata.set(id, meta);
    }
    /**
     * Create a new connector instance for the given ID.
     * @throws if no connector is registered for the ID
     */
    instantiate(id, credentials) {
        const factory = this.factories.get(id);
        if (!factory) {
            throw new Error(`No connector registered for id: "${id}". Registered: ${[...this.factories.keys()].join(', ')}`);
        }
        return factory(credentials);
    }
    /** Check whether a connector is registered. */
    has(id) {
        return this.factories.has(id);
    }
    /** Return metadata for all registered connectors. */
    listAll() {
        return [...this.metadata.values()];
    }
    /** Return metadata for a single connector, or undefined if not registered. */
    getMeta(id) {
        return this.metadata.get(id);
    }
    /** Map a SystemType to the primary connector ID for that type. */
    resolveSystemType(systemType) {
        const typeMap = {
            salesforce: 'salesforce',
            sap: 'sap',
            jackhenry: 'jackhenry-silverlake', // default JH connector
            generic: 'sap',
        };
        return typeMap[systemType];
    }
}
// ─── Global singleton registry ────────────────────────────────────────────────
// Import side-effect: importing this module registers all built-in connectors.
export const defaultRegistry = new ConnectorRegistry();
