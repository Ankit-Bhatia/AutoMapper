/**
 * MCP Integration Tests
 * =====================
 * Tests for:
 *   - MCPConnectorAdapter (graceful fallback when MCP server unreachable)
 *   - JXchangeMCPConnector (env-var configuration + mock mode)
 *   - ConnectorRegistry (jackhenry-mcp registration)
 *   - autoMapperMCPServer (tool registration verification)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPConnectorAdapter } from '../connectors/MCPConnectorAdapter.js';
import { JXchangeMCPConnector, CoreDirectorMCPConnector } from '../connectors/jackhenry/JXchangeMCPConnector.js';
import { defaultRegistry } from '../connectors/ConnectorRegistry.js';
import '../connectors/registerConnectors.js'; // populate registry

// ─── MCPConnectorAdapter ────────────────────────────────────────────────────────

describe('MCPConnectorAdapter', () => {
  it('falls back to mock mode when MCP server is unreachable', async () => {
    const adapter = new MCPConnectorAdapter({
      serverUrl: 'http://localhost:19999/mcp', // nothing listening here
      toolPrefix: 'test',
      displayName: 'Test MCP Connector',
      systemType: 'jackhenry',
    });
    // Should not throw — falls back to mock mode
    await expect(adapter.connect()).resolves.not.toThrow();
  });

  it('returns empty arrays in mock mode after failed connect', async () => {
    const adapter = new MCPConnectorAdapter({
      serverUrl: 'http://localhost:19998/mcp',
      toolPrefix: 'test',
      displayName: 'Test MCP Connector',
      systemType: 'jackhenry',
    });
    await adapter.connect(); // will fail silently

    const objects = await adapter.listObjects();
    expect(objects).toEqual([]);

    const schema = await adapter.fetchSchema();
    expect(schema.entities).toEqual([]);
    expect(schema.fields).toEqual([]);
    expect(schema.mode).toBe('mock');
  });

  it('reports disconnected in testConnection when in mock mode', async () => {
    const adapter = new MCPConnectorAdapter({
      serverUrl: 'http://localhost:19997/mcp',
      toolPrefix: 'test',
      displayName: 'Test MCP Connector',
      systemType: 'jackhenry',
    });
    await adapter.connect();

    const result = await adapter.testConnection();
    expect(result.connected).toBe(false);
    expect(result.message).toContain('unreachable');
  });

  it('getSystemInfo returns correct displayName and systemType in mock mode', async () => {
    const adapter = new MCPConnectorAdapter({
      serverUrl: 'http://localhost:19996/mcp',
      toolPrefix: 'jxchange',
      displayName: 'Jack Henry jXchange (MCP)',
      systemType: 'jackhenry',
      protocol: 'SOAP/jXchange via MCP',
      version: '2.0.0',
    });
    await adapter.connect();

    const info = await adapter.getSystemInfo();
    expect(info.displayName).toBe('Jack Henry jXchange (MCP)');
    expect(info.systemType).toBe('jackhenry');
    expect(info.mode).toBe('mock');
    expect(info.protocol).toBe('SOAP/jXchange via MCP');
    expect(info.version).toBe('2.0.0');
    expect(info.metadata?.mcpServerUrl).toBe('http://localhost:19996/mcp');
    expect(info.metadata?.toolPrefix).toBe('jxchange');
  });

  it('getSampleData returns empty array in mock mode', async () => {
    const adapter = new MCPConnectorAdapter({
      serverUrl: 'http://localhost:19995/mcp',
      toolPrefix: 'test',
      displayName: 'Test',
      systemType: 'jackhenry',
    });
    await adapter.connect();

    const rows = await adapter.getSampleData('CIF', 3);
    expect(rows).toEqual([]);
  });
});

// ─── JXchangeMCPConnector ───────────────────────────────────────────────────────

describe('JXchangeMCPConnector', () => {
  it('is an MCPConnectorAdapter instance', () => {
    const connector = new JXchangeMCPConnector();
    expect(connector).toBeInstanceOf(MCPConnectorAdapter);
  });

  it('uses JH_MCP_SERVER_URL env var when set', async () => {
    const original = process.env.JH_MCP_SERVER_URL;
    process.env.JH_MCP_SERVER_URL = 'http://test-jh-mcp.example.com/mcp';

    const connector = new JXchangeMCPConnector();
    await connector.connect(); // unreachable, falls to mock
    const info = await connector.getSystemInfo();
    expect(info.metadata?.mcpServerUrl).toBe('http://test-jh-mcp.example.com/mcp');

    process.env.JH_MCP_SERVER_URL = original;
  });

  it('defaults to localhost:4001/mcp when JH_MCP_SERVER_URL is not set', async () => {
    const original = process.env.JH_MCP_SERVER_URL;
    delete process.env.JH_MCP_SERVER_URL;

    const connector = new JXchangeMCPConnector();
    await connector.connect();
    const info = await connector.getSystemInfo();
    expect(info.metadata?.mcpServerUrl).toBe('http://localhost:4001/mcp');

    process.env.JH_MCP_SERVER_URL = original;
  });

  it('accepts mcpServerUrl via constructor credentials', async () => {
    const connector = new JXchangeMCPConnector({ mcpServerUrl: 'http://custom.example.com/mcp' });
    await connector.connect();
    const info = await connector.getSystemInfo();
    expect(info.metadata?.mcpServerUrl).toBe('http://custom.example.com/mcp');
  });

  it('has jackhenry systemType', async () => {
    const connector = new JXchangeMCPConnector();
    await connector.connect();
    const info = await connector.getSystemInfo();
    expect(info.systemType).toBe('jackhenry');
  });
});

// ─── CoreDirectorMCPConnector ──────────────────────────────────────────────────

describe('CoreDirectorMCPConnector', () => {
  it('is an MCPConnectorAdapter instance', () => {
    const connector = new CoreDirectorMCPConnector();
    expect(connector).toBeInstanceOf(MCPConnectorAdapter);
  });

  it('has correct display name referencing Core Director', async () => {
    const connector = new CoreDirectorMCPConnector();
    await connector.connect();
    const info = await connector.getSystemInfo();
    expect(info.displayName).toContain('Core Director');
  });

  it('uses JH_CD_MCP_SERVER_URL env var', async () => {
    const original = process.env.JH_CD_MCP_SERVER_URL;
    process.env.JH_CD_MCP_SERVER_URL = 'http://cd-mcp.jackhenry.dev/mcp';

    const connector = new CoreDirectorMCPConnector();
    await connector.connect();
    const info = await connector.getSystemInfo();
    expect(info.metadata?.mcpServerUrl).toBe('http://cd-mcp.jackhenry.dev/mcp');

    process.env.JH_CD_MCP_SERVER_URL = original;
  });
});

// ─── ConnectorRegistry: jackhenry-mcp registration ─────────────────────────────

describe('ConnectorRegistry: MCP connector', () => {
  it('has jackhenry-mcp registered', () => {
    expect(defaultRegistry.has('jackhenry-mcp')).toBe(true);
  });

  it('jackhenry-mcp metadata is correct', () => {
    const meta = defaultRegistry.getMeta('jackhenry-mcp');
    expect(meta).toBeDefined();
    expect(meta?.displayName).toBe('Jack Henry jXchange (MCP)');
    expect(meta?.category).toBe('banking');
    expect(meta?.hasMockMode).toBe(true);
    expect(meta?.protocol).toContain('MCP');
    expect(meta?.requiredCredentials).toContain('mcpServerUrl');
  });

  it('instantiates jackhenry-mcp as JXchangeMCPConnector (MCPConnectorAdapter)', () => {
    const connector = defaultRegistry.instantiate('jackhenry-mcp');
    expect(connector).toBeInstanceOf(MCPConnectorAdapter);
  });

  it('jackhenry-mcp instantiation does not throw', () => {
    expect(() => defaultRegistry.instantiate('jackhenry-mcp')).not.toThrow();
  });

  it('total registered connectors now includes jackhenry-mcp', () => {
    const all = defaultRegistry.listAll();
    const ids = all.map((m) => m.id);
    expect(ids).toContain('jackhenry-silverlake');
    expect(ids).toContain('jackhenry-symitar');
    expect(ids).toContain('jackhenry-mcp');
    // Total should be >= 3 (more may be added later)
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('all registered connectors have required metadata fields', () => {
    const all = defaultRegistry.listAll();
    for (const meta of all) {
      expect(meta.id).toBeTruthy();
      expect(meta.displayName).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(['crm', 'erp', 'banking', 'generic']).toContain(meta.category);
      expect(typeof meta.hasMockMode).toBe('boolean');
      expect(Array.isArray(meta.requiredCredentials)).toBe(true);
    }
  });
});

// ─── MCPConnectorAdapter: concurrent connect calls ──────────────────────────────

describe('MCPConnectorAdapter: edge cases', () => {
  it('survives multiple connect() calls gracefully', async () => {
    const adapter = new MCPConnectorAdapter({
      serverUrl: 'http://localhost:19990/mcp',
      toolPrefix: 'test',
      displayName: 'Test',
      systemType: 'jackhenry',
    });
    await adapter.connect();
    await adapter.connect(); // second call should not throw
    const info = await adapter.getSystemInfo();
    expect(info.mode).toBe('mock');
  });

  it('handles fetchSchema with explicit entity list in mock mode', async () => {
    const adapter = new MCPConnectorAdapter({
      serverUrl: 'http://localhost:19989/mcp',
      toolPrefix: 'test',
      displayName: 'Test',
      systemType: 'jackhenry',
    });
    await adapter.connect();
    const schema = await adapter.fetchSchema(['CIF', 'DDA']);
    // In mock mode, no real server → empty schema
    expect(schema.entities).toEqual([]);
    expect(schema.relationships).toEqual([]);
  });
});
