/**
 * MCP server factory. Builds a fresh {@link McpServer} instance with all tools
 * registered. A new instance is created per SSE connection so each session gets
 * its own transport binding.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { allTools } from './tools/index.js';
import { logger } from './utils/logger.js';

/** Semantic version reported by the server and the /health endpoint. */
export const SERVER_VERSION = '1.0.0';

/**
 * Creates and configures a new MCP server instance with every tool registered.
 *
 * @returns A ready-to-connect {@link McpServer}.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'pokebot',
    version: SERVER_VERSION,
  });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      // The handler signature is compatible: validated args in, ToolResult out.
      tool.handler as Parameters<McpServer['registerTool']>[2],
    );
  }

  logger.info('MCP server created', { tools: allTools.map((t) => t.name) });
  return server;
}
