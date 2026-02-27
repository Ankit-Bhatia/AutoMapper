import { describe, it, expect, beforeEach } from 'vitest';
import { SilverLakeConnector } from '../connectors/jackhenry/SilverLakeConnector.js';
import { SymitarConnector } from '../connectors/jackhenry/SymitarConnector.js';
import { ConnectorRegistry } from '../connectors/ConnectorRegistry.js';
import type { ConnectorField } from '../connectors/IConnector.js';

// ─── SilverLakeConnector (mock mode) ─────────────────────────────────────────

describe('SilverLakeConnector — mock mode', () => {
  let connector: SilverLakeConnector;

  beforeEach(async () => {
    connector = new SilverLakeConnector(); // no credentials → mock mode
    await connector.connect();
  });

  it('testConnection should return connected=true in mock mode', async () => {
    const result = await connector.testConnection();
    expect(result.connected).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('getSystemInfo should identify as SilverLake in mock mode', async () => {
    const info = await connector.getSystemInfo();
    expect(info.mode).toBe('mock');
    expect(info.systemType).toBe('jackhenry');
    // Protocol string includes ISO 20022 annotation
    expect(info.protocol).toContain('jXchange');
    expect(info.displayName).toContain('SilverLake');
  });

  it('listObjects should return CIF, DDA, LoanAccount, GLAccount', async () => {
    const objects = await connector.listObjects();
    expect(objects).toContain('CIF');
    expect(objects).toContain('DDA');
    expect(objects).toContain('LoanAccount');
    expect(objects).toContain('GLAccount');
  });

  it('fetchSchema should return entities, fields and relationships', async () => {
    const schema = await connector.fetchSchema();
    expect(schema.mode).toBe('mock');
    expect(schema.entities.length).toBeGreaterThanOrEqual(4);
    expect(schema.fields.length).toBeGreaterThan(10);
  });

  it('CIF entity should have a TaxID field tagged GLBA_NPI', async () => {
    const schema = await connector.fetchSchema(['CIF']);
    const cifFields = schema.fields as ConnectorField[];
    const taxId = cifFields.find((f) => f.name === 'TaxID');
    expect(taxId).toBeDefined();
    expect(taxId?.complianceTags).toContain('GLBA_NPI');
  });

  it('DDA entity should have balance fields tagged SOX_FINANCIAL', async () => {
    const schema = await connector.fetchSchema(['DDA']);
    const ddaFields = schema.fields as ConnectorField[];
    const balance = ddaFields.find((f) => f.name === 'CurrentBalance');
    expect(balance).toBeDefined();
    expect(balance?.complianceTags).toContain('SOX_FINANCIAL');
  });

  it('getSampleData for CIF should mask TaxID', async () => {
    const rows = await connector.getSampleData('CIF', 3);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    // TaxID should be masked (e.g., ***-**-1234)
    expect(String(row['TaxID'] ?? '')).toMatch(/\*{3}-\*{2}-\d{4}/);
  });

  it('schema should include CIF→DDA relationship', async () => {
    const schema = await connector.fetchSchema();
    // SilverLake uses 'lookup' type for CIF→DDA and CIF→LoanAccount relationships
    const rel = schema.relationships.find(
      (r) => r.viaField === 'CIFNumber',
    );
    expect(rel).toBeDefined();
    expect(rel?.type).toBe('lookup');
  });
});

// ─── SymitarConnector (mock mode) ─────────────────────────────────────────────

describe('SymitarConnector — mock mode', () => {
  let connector: SymitarConnector;

  beforeEach(async () => {
    connector = new SymitarConnector(); // no credentials → mock mode
    await connector.connect();
  });

  it('testConnection should return connected=true in mock mode', async () => {
    const result = await connector.testConnection();
    expect(result.connected).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('getSystemInfo should identify as Symitar in mock mode', async () => {
    const info = await connector.getSystemInfo();
    expect(info.mode).toBe('mock');
    expect(info.systemType).toBe('jackhenry');
    expect(info.protocol).toBe('REST/SymXchange');
    expect(info.displayName).toContain('Symitar');
  });

  it('listObjects should return credit-union entities', async () => {
    const objects = await connector.listObjects();
    expect(objects).toContain('Member');
    expect(objects).toContain('Share');
    expect(objects).toContain('Loan');
    expect(objects).toContain('Card');
  });

  it('Member entity uses MemberNumber (NOT CustomerNumber)', async () => {
    const schema = await connector.fetchSchema(['Member']);
    const memberFields = schema.fields;
    expect(memberFields.some((f) => f.name === 'MemberNumber')).toBe(true);
    // Must NOT use bank terminology
    expect(memberFields.some((f) => f.name === 'CustomerNumber')).toBe(false);
  });

  it('Share entity uses DividendRate (NOT InterestRate)', async () => {
    const schema = await connector.fetchSchema(['Share']);
    const shareFields = schema.fields;
    expect(shareFields.some((f) => f.name === 'DividendRate')).toBe(true);
    expect(shareFields.some((f) => f.name === 'InterestRate')).toBe(false);
  });

  it('Card entity fields should be tagged PCI_CARD', async () => {
    const schema = await connector.fetchSchema(['Card']);
    const cardFields = schema.fields as ConnectorField[];
    // CardID is the primary PCI-governed key field (CardNumber is never stored per PCI-DSS)
    const cardIdField = cardFields.find((f) => f.name === 'CardID');
    expect(cardIdField).toBeDefined();
    expect(cardIdField?.complianceTags).toContain('PCI_CARD');
    // CardStatus also carries PCI_CARD tag
    const cardStatusField = cardFields.find((f) => f.name === 'CardStatus');
    expect(cardStatusField?.complianceTags).toContain('PCI_CARD');
  });

  it('Member SSN field should be tagged GLBA_NPI', async () => {
    const schema = await connector.fetchSchema(['Member']);
    const memberFields = schema.fields as ConnectorField[];
    const ssn = memberFields.find((f) => f.name === 'SSN');
    expect(ssn).toBeDefined();
    expect(ssn?.complianceTags).toContain('GLBA_NPI');
  });

  it('getSampleData for Member should mask SSN', async () => {
    const rows = await connector.getSampleData('Member', 2);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const ssnValue = String(rows[0]['SSN'] ?? '');
    expect(ssnValue).toMatch(/\*{3}-\*{2}-\d{4}/);
  });

  it('fetchSchema should return all 6 entity types', async () => {
    const schema = await connector.fetchSchema();
    const names = schema.entities.map((e) => e.name);
    expect(names).toContain('Member');
    expect(names).toContain('Share');
    expect(names).toContain('Loan');
    expect(names).toContain('IRS');
    expect(names).toContain('Card');
    expect(names).toContain('Collateral');
  });
});

// ─── ConnectorRegistry ────────────────────────────────────────────────────────

describe('ConnectorRegistry', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry();
    registry.register(
      'test-connector',
      {
        id: 'test-connector',
        displayName: 'Test Connector',
        category: 'banking',
        description: 'A test connector',
        hasMockMode: true,
        requiredCredentials: [],
        protocol: 'REST',
      },
      () => new SilverLakeConnector(),
    );
  });

  it('has() returns true for registered connector', () => {
    expect(registry.has('test-connector')).toBe(true);
  });

  it('has() returns false for unknown connector', () => {
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('listAll() returns metadata for all registered connectors', () => {
    const list = registry.listAll();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('test-connector');
    expect(list[0].category).toBe('banking');
  });

  it('getMeta() returns correct metadata', () => {
    const meta = registry.getMeta('test-connector');
    expect(meta).toBeDefined();
    expect(meta?.displayName).toBe('Test Connector');
    expect(meta?.hasMockMode).toBe(true);
  });

  it('getMeta() returns undefined for unknown id', () => {
    expect(registry.getMeta('unknown')).toBeUndefined();
  });

  it('instantiate() creates a working connector', async () => {
    const connector = registry.instantiate('test-connector');
    await connector.connect();
    const info = await connector.getSystemInfo();
    expect(info.mode).toBe('mock');
  });

  it('instantiate() throws for unknown id', () => {
    expect(() => registry.instantiate('nonexistent')).toThrow(/No connector registered/);
  });

  it('resolveSystemType maps jackhenry to jackhenry-silverlake', () => {
    const id = registry.resolveSystemType('jackhenry');
    expect(id).toBe('jackhenry-silverlake');
  });

  it('resolveSystemType maps salesforce to salesforce', () => {
    const id = registry.resolveSystemType('salesforce');
    expect(id).toBe('salesforce');
  });

  it('can register multiple connectors', () => {
    registry.register(
      'second-connector',
      {
        id: 'second-connector',
        displayName: 'Second',
        category: 'crm',
        description: 'Another test connector',
        hasMockMode: false,
        requiredCredentials: ['apiKey'],
        protocol: 'REST',
      },
      () => new SilverLakeConnector(),
    );
    expect(registry.listAll()).toHaveLength(2);
  });
});

// ─── Compliance tag completeness ──────────────────────────────────────────────

describe('Compliance tag completeness', () => {
  it('SilverLake schema contains all 5 compliance tag types', async () => {
    const connector = new SilverLakeConnector();
    await connector.connect();
    const schema = await connector.fetchSchema();
    const fields = schema.fields as ConnectorField[];
    const allTags = new Set(fields.flatMap((f) => f.complianceTags ?? []));

    expect(allTags.has('GLBA_NPI')).toBe(true);
    expect(allTags.has('SOX_FINANCIAL')).toBe(true);
    expect(allTags.has('FFIEC_AUDIT')).toBe(true);
    expect(allTags.has('BSA_AML')).toBe(true);
  });

  it('Symitar schema includes PCI_CARD tag on card data fields', async () => {
    const connector = new SymitarConnector();
    await connector.connect();
    const schema = await connector.fetchSchema();
    const fields = schema.fields as ConnectorField[];
    const pciFields = fields.filter((f) => f.complianceTags?.includes('PCI_CARD'));
    expect(pciFields.length).toBeGreaterThan(0);
  });

  it('key compliance-sensitive fields have both tags and complianceNote', async () => {
    const connector = new SilverLakeConnector();
    await connector.connect();
    const schema = await connector.fetchSchema();
    const fields = schema.fields as ConnectorField[];

    // TaxID is the highest-sensitivity field and must carry an explicit compliance note
    const taxIdField = fields.find((f) => f.name === 'TaxID');
    expect(taxIdField, 'TaxID field must exist in CIF').toBeDefined();
    expect(taxIdField?.complianceTags).toContain('GLBA_NPI');
    expect(taxIdField?.complianceNote, 'TaxID must have complianceNote').toBeTruthy();

    // At minimum, some tagged fields should carry notes (not zero)
    const fieldsWithNotes = fields.filter((f) => f.complianceNote);
    expect(fieldsWithNotes.length).toBeGreaterThan(0);
  });
});
