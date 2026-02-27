import type { IConnector, ConnectorCredentials } from './IConnector.js';
import type { SystemType } from '../types.js';

/**
 * Metadata about a registered connector — surfaced by GET /api/connectors.
 */
export interface ConnectorMeta {
  /** Unique connector identifier (matches SystemType or a subtype like 'jackhenry-silverlake') */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Category grouping */
  category: 'crm' | 'erp' | 'banking' | 'generic';
  /** Brief description of the connected system */
  description: string;
  /** Whether this connector has a mock mode (no credentials required for demo) */
  hasMockMode: boolean;
  /** Required credential keys for live mode */
  requiredCredentials: string[];
  /** API protocol */
  protocol: string;
}

export type ConnectorFactory = (credentials?: ConnectorCredentials) => IConnector;

/**
 * ConnectorRegistry — maps connector IDs to factory functions and metadata.
 *
 * Usage:
 *   registry.register('jackhenry-silverlake', meta, factory);
 *   const connector = registry.instantiate('jackhenry-silverlake');
 */
export class ConnectorRegistry {
  private readonly factories = new Map<string, ConnectorFactory>();
  private readonly metadata = new Map<string, ConnectorMeta>();

  /**
   * Register a connector.
   * @param id - unique identifier (e.g. 'jackhenry-silverlake', 'salesforce', 'sap')
   * @param meta - display metadata
   * @param factory - factory function that creates a new IConnector instance
   */
  register(id: string, meta: ConnectorMeta, factory: ConnectorFactory): void {
    this.factories.set(id, factory);
    this.metadata.set(id, meta);
  }

  /**
   * Create a new connector instance for the given ID.
   * @throws if no connector is registered for the ID
   */
  instantiate(id: string, credentials?: ConnectorCredentials): IConnector {
    const factory = this.factories.get(id);
    if (!factory) {
      throw new Error(`No connector registered for id: "${id}". Registered: ${[...this.factories.keys()].join(', ')}`);
    }
    return factory(credentials);
  }

  /** Check whether a connector is registered. */
  has(id: string): boolean {
    return this.factories.has(id);
  }

  /** Return metadata for all registered connectors. */
  listAll(): ConnectorMeta[] {
    return [...this.metadata.values()];
  }

  /** Return metadata for a single connector, or undefined if not registered. */
  getMeta(id: string): ConnectorMeta | undefined {
    return this.metadata.get(id);
  }

  /** Map a SystemType to the primary connector ID for that type. */
  resolveSystemType(systemType: SystemType | string): string | undefined {
    const typeMap: Record<string, string> = {
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
