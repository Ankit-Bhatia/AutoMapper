/**
 * JXchangeMCPConnector
 * ====================
 * Pre-wired MCPConnectorAdapter for Jack Henry's jXchange API.
 *
 * This connector is a placeholder ready to activate the moment Jack Henry
 * ships an official MCP server for their jXchange API. Until then it
 * gracefully falls back to mock mode.
 *
 * Configuration via environment variables:
 *   JH_MCP_SERVER_URL     URL of the jXchange MCP server endpoint
 *                         e.g. "https://api.jackhenry.dev/mcp" or
 *                              "http://localhost:5000/mcp" for self-hosted
 *   JH_MCP_TOOL_PREFIX    Tool name prefix (default: "jxchange")
 *                         Change if JH uses a different convention, e.g. "jh"
 *
 * Expected tool naming convention on the remote jXchange MCP server:
 *   jxchange_list_objects   — returns { objects: string[] }
 *   jxchange_fetch_schema   — returns { entities, fields, relationships }
 *   jxchange_get_sample     — returns { rows: SampleRow[] }
 *   jxchange_test_conn      — returns { connected: boolean, message?: string }
 *   jxchange_system_info    — returns ConnectorSystemInfo shape
 *
 * If Jack Henry's MCP server uses different tool names, override the
 * toolPrefix environment variable accordingly.
 *
 * Future note: if Jack Henry integrates AutoMapper's own MCP server
 * (mcp-server.mjs), set JH_MCP_TOOL_PREFIX=automapper and point
 * JH_MCP_SERVER_URL at the AutoMapper MCP server to federate schemas.
 */

import { MCPConnectorAdapter } from '../MCPConnectorAdapter.js';
import type { ConnectorCredentials } from '../IConnector.js';

/**
 * JXchangeMCPConnector — wraps the MCPConnectorAdapter with Jack Henry defaults.
 *
 * Env vars are read at constructor time (not module load time) so that test
 * code can set process.env values before instantiation and have them reflected.
 *
 * Register in ConnectorRegistry as 'jackhenry-mcp':
 *   defaultRegistry.register('jackhenry-mcp', metadata, (creds) => new JXchangeMCPConnector(creds));
 */
export class JXchangeMCPConnector extends MCPConnectorAdapter {
  constructor(credentials?: ConnectorCredentials) {
    // Read env vars at instantiation time, not module load time
    const serverUrl = credentials?.mcpServerUrl
      ?? process.env.JH_MCP_SERVER_URL
      ?? 'http://localhost:4001/mcp';
    const toolPrefix = credentials?.mcpToolPrefix
      ?? process.env.JH_MCP_TOOL_PREFIX
      ?? 'jxchange';

    super({
      serverUrl,
      toolPrefix,
      displayName: 'Jack Henry jXchange (MCP)',
      systemType: 'jackhenry',
      protocol: 'SOAP/jXchange via MCP',
      version: '1.0.0',
    });
  }
}

/**
 * CoreDirectorMCPConnector — same adapter, different display name.
 * Jack Henry may expose separate MCP servers per product line.
 * Env vars are read at constructor time so tests can override them.
 */
export class CoreDirectorMCPConnector extends MCPConnectorAdapter {
  constructor(credentials?: ConnectorCredentials) {
    const serverUrl = credentials?.mcpServerUrl
      ?? process.env.JH_CD_MCP_SERVER_URL
      ?? process.env.JH_MCP_SERVER_URL
      ?? 'http://localhost:4001/mcp';
    const toolPrefix = credentials?.mcpToolPrefix
      ?? process.env.JH_CD_MCP_TOOL_PREFIX
      ?? process.env.JH_MCP_TOOL_PREFIX
      ?? 'jxchange';

    super({
      serverUrl,
      toolPrefix,
      displayName: 'Jack Henry Core Director (MCP)',
      systemType: 'jackhenry',
      protocol: 'SOAP/jXchange via MCP (Core Director)',
      version: '1.0.0',
    });
  }
}
