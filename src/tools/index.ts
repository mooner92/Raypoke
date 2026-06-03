/**
 * Central registry of all MCP tools exposed by the PokeBOT server.
 */
import type { ToolDefinition } from './helpers.js';
import { webSearchTool } from './search.js';
import { analyzeImageTool, analyzeSceneTool } from './vision.js';
import { searchEventsTool, getTicketInfoTool } from './events.js';
import { translateTool } from './translate.js';
import { askAiTool } from './ask.js';
import { navigateTool } from './navigate.js';
import { priceSearchTool } from './price.js';

/**
 * Erases a tool's argument type to the registry's loose form. Sound at runtime
 * because MCP validates args against `inputSchema` before invoking the handler.
 */
function erase<T>(tool: ToolDefinition<T>): ToolDefinition {
  return tool as unknown as ToolDefinition;
}

/** All tools, in registration order. */
export const allTools: ToolDefinition[] = [
  erase(webSearchTool),
  erase(analyzeImageTool),
  erase(analyzeSceneTool),
  erase(searchEventsTool),
  erase(getTicketInfoTool),
  erase(translateTool),
  erase(askAiTool),
  erase(navigateTool),
  erase(priceSearchTool),
];

/** Tool names, used by the /health endpoint. */
export const toolNames: string[] = allTools.map((t) => t.name);

export {
  webSearchTool,
  analyzeImageTool,
  analyzeSceneTool,
  searchEventsTool,
  getTicketInfoTool,
  translateTool,
  askAiTool,
  navigateTool,
  priceSearchTool,
};
