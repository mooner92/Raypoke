/**
 * Shared type definitions for the PokeBOT MCP server.
 */

/** Supported log severity levels, ordered from most to least verbose. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Runtime configuration resolved from environment variables. */
export interface AppConfig {
  geminiApiKey: string;
  port: number;
  host: string;
  nodeEnv: string;
  /** Optional bearer/query token; when empty, auth is disabled. */
  mcpAuthToken: string;
  logLevel: LogLevel;
}

/** Image media types supported by Gemini Vision. */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Connectivity state reported by the /health endpoint. */
export type ApiStatus = 'connected' | 'disconnected' | 'unknown';
