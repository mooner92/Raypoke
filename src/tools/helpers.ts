/**
 * Shared contracts and helpers for MCP tool definitions.
 */
import type { ZodRawShape } from 'zod';
import { logger } from '../utils/logger.js';
import { describeError, toUserMessage } from '../utils/errors.js';

/** MCP tool call result shape (text content + optional error flag). */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * A self-describing MCP tool. Registered with the server in `server.ts`.
 *
 * @typeParam TArgs - The validated argument object passed to the handler.
 */
export interface ToolDefinition<TArgs = Record<string, unknown>> {
  /** Unique tool name exposed to MCP clients. */
  name: string;
  /** Human-readable description shown to the model. */
  description: string;
  /** Zod raw shape describing the tool's input parameters. */
  inputSchema: ZodRawShape;
  /** The tool implementation. */
  handler: (args: TArgs) => Promise<ToolResult>;
}

/** Build a successful text result. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Build an error result carrying a user-friendly Korean message. */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Wraps a tool handler with structured logging and uniform error handling.
 * Every tool runs through this so failures surface as `isError` results with
 * a Korean message rather than throwing across the MCP boundary.
 *
 * @param name - The tool name (for logging).
 * @param fn - The raw handler.
 * @returns A guarded handler.
 */
export function guard<TArgs>(
  name: string,
  fn: (args: TArgs) => Promise<ToolResult>,
): (args: TArgs) => Promise<ToolResult> {
  return async (args: TArgs): Promise<ToolResult> => {
    const start = Date.now();
    logger.info('Tool invoked', { tool: name });
    logger.debug('Tool arguments', { tool: name, args: args as Record<string, unknown> });
    try {
      const result = await fn(args);
      logger.info('Tool completed', { tool: name, ms: Date.now() - start });
      return result;
    } catch (error) {
      logger.error('Tool failed', {
        tool: name,
        ms: Date.now() - start,
        error: describeError(error),
      });
      return errorResult(toUserMessage(error));
    }
  };
}
