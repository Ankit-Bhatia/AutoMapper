/**
 * MCPConnectorAdapter
 * ===================
 * Implements the IConnector interface by delegating all operations to an
 * external MCP (Model Context Protocol) server via StreamableHTTP transport.
 *
 * This is the "consumer" side of AutoMapper's MCP integration. When a vendor
 * like Jack Henry ships an MCP server for their jXchange API, AutoMapper can
 * plug it in here with zero changes to the rest of the pipeline.
 *
 * Usage:
 *   const connector = new MCPConnectorAdapter({
 *     serverUrl: 'http://jxchange-mcp.jackhenry.dev/mcp',
 *     toolPrefix: 'jxchange',  // tool names: jxchange_list_objects, jxchange_fetch_schema, …
 *     displayName: 'Jack Henry jXchange (MCP)',
 *     systemType: 'jackhenry',
 *   });
 *   await connector.connect();
 *   const schema = await connector.fetchSchema(['CIF', 'DDA']);
 *
 * The adapter maps IConnector methods to MCP tool calls using a naming
 * convention: `{toolPrefix}_{method}`. For the Jack Henry jXchange MCP server
 * the expected tool names are:
 *   jxchange_list_objects   → listObjects()
 *   jxchange_fetch_schema   → fetchSchema()
 *   jxchange_get_sample     → getSampleData()
 *   jxchange_test_conn      → testConnection()
 *   jxchange_system_info    → getSystemInfo()
 *
 * If the remote server does not implement a tool, the adapter falls back to
 * safe defaults (empty list / empty schema / mock system info).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export class MCPConnectorAdapter {
    opts;
    client = null;
    transport = null;
    mode = 'mock';
    connected = false;
    constructor(opts) {
        this.opts = opts;
    }
    // ─── Connection lifecycle ────────────────────────────────────────────────────
    async connect(_credentials) {
        try {
            this.client = new Client({ name: 'automapper-client', version: '1.0.0' });
            this.transport = new StreamableHTTPClientTransport(new URL(this.opts.serverUrl));
            await this.client.connect(this.transport);
            this.mode = 'live';
            this.connected = true;
        }
        catch (err) {
            // Fall back to mock mode — the adapter still returns empty schemas
            console.warn(`[MCPConnectorAdapter] Could not connect to ${this.opts.serverUrl}: ${err}. Running in mock mode.`);
            this.client = null;
            this.transport = null;
            this.mode = 'mock';
            this.connected = false;
        }
    }
    async callTool(toolName, args = {}) {
        if (!this.client || !this.connected)
            return null;
        try {
            const result = await this.client.callTool({ name: toolName, arguments: args });
            // MCP tool results come back as content array — first text content is the JSON payload
            const textContent = result.content?.find((c) => c.type === 'text');
            if (!textContent || textContent.type !== 'text')
                return null;
            return JSON.parse(textContent.text);
        }
        catch (err) {
            console.warn(`[MCPConnectorAdapter] Tool "${toolName}" failed: ${err}`);
            return null;
        }
    }
    // ─── IConnector implementation ───────────────────────────────────────────────
    async listObjects() {
        const result = await this.callTool(`${this.opts.toolPrefix}_list_objects`);
        return result?.objects ?? [];
    }
    async fetchSchema(objectNames) {
        const result = await this.callTool(`${this.opts.toolPrefix}_fetch_schema`, {
            ...(objectNames?.length ? { objects: objectNames } : {}),
        });
        if (!result) {
            return { entities: [], fields: [], relationships: [], mode: this.mode };
        }
        // Flatten fields from map format { EntityName: [fields] } → ConnectorField[]
        const flatFields = [];
        if (result.fields) {
            for (const [entityName, fields] of Object.entries(result.fields)) {
                const entity = result.entities?.find((e) => e.name === entityName);
                if (entity) {
                    flatFields.push(...fields.map((f) => ({ ...f, entityId: entity.id })));
                }
            }
        }
        return {
            entities: result.entities ?? [],
            fields: flatFields,
            relationships: result.relationships ?? [],
            mode: this.mode,
        };
    }
    async getSampleData(objectName, limit = 5) {
        const result = await this.callTool(`${this.opts.toolPrefix}_get_sample`, { object: objectName, limit });
        return result?.rows ?? [];
    }
    async testConnection() {
        if (this.mode === 'mock' || !this.client) {
            return { connected: false, latencyMs: 0, message: `MCP server unreachable: ${this.opts.serverUrl}` };
        }
        const start = Date.now();
        const result = await this.callTool(`${this.opts.toolPrefix}_test_conn`);
        return {
            connected: result?.connected ?? true,
            latencyMs: Date.now() - start,
            message: result?.message,
        };
    }
    async getSystemInfo() {
        const result = await this.callTool(`${this.opts.toolPrefix}_system_info`);
        return {
            displayName: result?.displayName ?? this.opts.displayName,
            systemType: result?.systemType ?? this.opts.systemType,
            mode: this.mode,
            protocol: result?.protocol ?? this.opts.protocol ?? 'MCP',
            version: result?.version ?? this.opts.version ?? '1.0.0',
            metadata: {
                mcpServerUrl: this.opts.serverUrl,
                toolPrefix: this.opts.toolPrefix,
                ...(result?.metadata ?? {}),
            },
        };
    }
}
