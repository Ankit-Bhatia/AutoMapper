/**
 * ConnectorSessionStore — credentials storage per user per connector.
 *
 * Stores OAuth tokens and API credentials obtained during user sessions.
 * Credentials are keyed by userId and connectorId.
 * Track connection timestamps for status reporting.
 */

import type { ConnectorCredentials } from '../connectors/IConnector.js';

interface StoredCredentials {
  credentials: ConnectorCredentials;
  connectedAt: string; // ISO 8601 timestamp
}

export class ConnectorSessionStore {
  private store: Map<string, Map<string, StoredCredentials>> = new Map();

  /**
   * Store credentials for a user + connector pair.
   * @param userId - unique user identifier
   * @param connectorId - connector type (e.g., 'salesforce', 'sap')
   * @param credentials - connector-specific credentials (tokens, URLs, etc.)
   */
  set(userId: string, connectorId: string, credentials: ConnectorCredentials): void {
    if (!this.store.has(userId)) {
      this.store.set(userId, new Map());
    }
    const userMap = this.store.get(userId)!;
    userMap.set(connectorId, {
      credentials,
      connectedAt: new Date().toISOString(),
    });
  }

  /**
   * Retrieve stored credentials for a user + connector pair.
   * @param userId - unique user identifier
   * @param connectorId - connector type
   * @returns credentials if found, undefined otherwise
   */
  get(userId: string, connectorId: string): ConnectorCredentials | undefined {
    return this.store.get(userId)?.get(connectorId)?.credentials;
  }

  /**
   * Clear credentials for a user + connector, or all connectors for a user if connectorId is omitted.
   * @param userId - unique user identifier
   * @param connectorId - optional: clear only this connector; if omitted, clears all
   */
  clear(userId: string, connectorId?: string): void {
    if (!connectorId) {
      // Clear all connectors for this user
      this.store.delete(userId);
    } else {
      // Clear specific connector for this user
      const userMap = this.store.get(userId);
      if (userMap) {
        userMap.delete(connectorId);
        // Clean up empty maps
        if (userMap.size === 0) {
          this.store.delete(userId);
        }
      }
    }
  }

  /**
   * Get list of connected system IDs for a user.
   * @param userId - unique user identifier
   * @returns array of connector IDs that have stored credentials
   */
  connectedSystems(userId: string): string[] {
    const userMap = this.store.get(userId);
    return userMap ? Array.from(userMap.keys()) : [];
  }

  /**
   * Get connection status for all systems for a user.
   * @param userId - unique user identifier
   * @returns object mapping connectorId to { connected: true, connectedAt: ISO timestamp }
   */
  status(userId: string): Record<string, { connected: boolean; connectedAt: string }> {
    const userMap = this.store.get(userId);
    if (!userMap) {
      return {};
    }

    const result: Record<string, { connected: boolean; connectedAt: string }> = {};
    for (const [connectorId, stored] of userMap) {
      result[connectorId] = {
        connected: true,
        connectedAt: stored.connectedAt,
      };
    }
    return result;
  }
}

/**
 * Singleton instance used throughout the application.
 */
export const defaultSessionStore = new ConnectorSessionStore();
