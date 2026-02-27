import type { Entity, Field, Relationship, SystemType } from '../types.js';

/**
 * Compliance tag applied to fields that require regulatory protection.
 * Multiple tags can apply to a single field.
 */
export type ComplianceTag =
  | 'GLBA_NPI'       // Non-Public Personal Information (Gramm-Leach-Bliley Act)
  | 'FFIEC_AUDIT'    // Must appear in audit trail (FFIEC)
  | 'SOX_FINANCIAL'  // Financial field requiring change-control (Sarbanes-Oxley)
  | 'PCI_CARD'       // Card data — must never appear in plain text (PCI-DSS)
  | 'BSA_AML'        // Suspicious activity indicator (Bank Secrecy Act / AML);

/**
 * Extended field metadata returned by connectors. Carries compliance tags
 * and domain-specific hints used by the mapping agents.
 */
export interface ConnectorField extends Field {
  complianceTags?: ComplianceTag[];
  /** Human-readable note about the field's regulatory significance */
  complianceNote?: string;
  /** ISO 20022 canonical name, if applicable (e.g. "CreditorName") */
  iso20022Name?: string;
  /**
   * The actual XPath element within the jXchange SOAP message for this field.
   * e.g. "CustInq.Rs.CustRec.PersonInfo.TaxId"
   * Set by Jack Henry connectors. Consumed by BankingDomainAgent in live mode.
   */
  jxchangeXPath?: string;
  /**
   * The x_ XtendElem key needed to include this field in a jXchange inquiry response.
   * Fields behind XtendElem are not returned by default — add to XtendElemInfoArray.
   * e.g. "x_TaxDetail" must be added to request for the TaxDetail complex.
   */
  jxchangeXtendElemKey?: string;
}

/**
 * Credentials passed to a connector. Exact keys depend on the connector type.
 */
export type ConnectorCredentials = Record<string, string>;

/**
 * System-level metadata returned by getSystemInfo().
 */
export interface ConnectorSystemInfo {
  /** Human-readable display name (e.g. "Jack Henry SilverLake 2024.2") */
  displayName: string;
  /** The SystemType this connector provides */
  systemType: SystemType;
  /** Connection mode: live = real credentials used, mock = sample data */
  mode: 'live' | 'mock';
  /** API protocol (e.g. "SOAP/jXchange", "REST/SymXchange", "REST/jsforce") */
  protocol: string;
  /** Connector version string */
  version: string;
  /** Additional system-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a schema fetch operation.
 */
export interface ConnectorSchema {
  entities: Entity[];
  fields: ConnectorField[];
  relationships: Relationship[];
  mode: 'live' | 'mock';
}

/**
 * Sample data row for a single object — useful for preview and validation.
 */
export type SampleRow = Record<string, unknown>;

/**
 * IConnector — the universal plugin interface for all system connectors.
 *
 * Every connector (Salesforce, SAP, Jack Henry SilverLake, Symitar, Workday, …)
 * must implement this interface. Connectors may operate in:
 *   - live mode: authenticated against a real system
 *   - mock mode: returning representative synthetic data when credentials are absent
 *
 * All methods are async to accommodate both local parsing and remote API calls.
 */
export interface IConnector {
  /**
   * Authenticate with the system. Must be called before other operations
   * unless the connector supports auto-mock fallback.
   * @param credentials - system-specific credential key/value pairs
   * @throws if live credentials are invalid and mock mode is disabled
   */
  connect(credentials?: ConnectorCredentials): Promise<void>;

  /**
   * Return the list of top-level object names available in this system
   * (e.g. Salesforce SObject names, SAP entity names, Jack Henry account types).
   */
  listObjects(): Promise<string[]>;

  /**
   * Fetch the full schema for the specified object names.
   * @param objectNames - objects to describe. If empty, describes all objects.
   */
  fetchSchema(objectNames?: string[]): Promise<ConnectorSchema>;

  /**
   * Return a small sample of real or synthetic data rows for a given object.
   * Used by the Schema Discovery Agent to infer data patterns.
   * @param objectName - the object to sample
   * @param limit - maximum rows to return (default 5)
   */
  getSampleData(objectName: string, limit?: number): Promise<SampleRow[]>;

  /**
   * Test whether the connection is alive and credentials are valid.
   * Should return quickly (< 3 s) and never throw — return false on failure.
   */
  testConnection(): Promise<{ connected: boolean; latencyMs: number; message?: string }>;

  /**
   * Return human-readable metadata about this connector and the connected system.
   */
  getSystemInfo(): Promise<ConnectorSystemInfo>;
}
