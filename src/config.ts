/**
 * Loads and validates runtime configuration from environment variables.
 */
import 'dotenv/config';
import { z } from 'zod';
import type { AppConfig } from './types/index.js';
import { ConfigError } from './utils/errors.js';
import { logger } from './utils/logger.js';

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.string().default('production'),
  MCP_AUTH_TOKEN: z.string().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

let cached: AppConfig | null = null;

/**
 * Resolves the application configuration, validating required variables.
 * The result is cached after the first successful load.
 *
 * @returns The validated {@link AppConfig}.
 * @throws {ConfigError} When required variables are missing or invalid.
 */
export function loadConfig(): AppConfig {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment configuration: ${issues}`);
  }

  const env = parsed.data;
  cached = {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    claudeModel: env.CLAUDE_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    port: env.PORT,
    host: env.HOST,
    nodeEnv: env.NODE_ENV,
    mcpAuthToken: env.MCP_AUTH_TOKEN,
    logLevel: env.LOG_LEVEL,
  };

  logger.setLevel(cached.logLevel);
  logger.info('Configuration loaded', {
    claudeModel: cached.claudeModel,
    port: cached.port,
    host: cached.host,
    nodeEnv: cached.nodeEnv,
    authEnabled: cached.mcpAuthToken.length > 0,
    logLevel: cached.logLevel,
  });

  return cached;
}
