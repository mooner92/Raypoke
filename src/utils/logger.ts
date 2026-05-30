/**
 * Structured logger with level filtering and sensitive-value masking.
 *
 * Output format: `[ISO_TIMESTAMP] [LEVEL] message {metadata}`
 */
import type { LogLevel } from '../types/index.js';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Substrings that mark a metadata key as sensitive (case-insensitive). */
const SENSITIVE_KEY_PATTERNS = ['key', 'token', 'secret', 'password', 'authorization'];

/** Resolve the active log level from the environment (defaults to `info`). */
function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

let activeLevel: LogLevel = resolveLevel();

/** Mask a secret string, preserving only a short prefix for identification. */
function maskValue(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return `${value.slice(0, 4)}…${'*'.repeat(4)}`;
}

/** Determine whether a metadata key should be masked. */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Recursively mask sensitive values within a metadata object. */
function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' && isSensitiveKey(key)) {
      out[key] = maskValue(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = sanitize(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Emit a single structured log line if the level passes the active threshold. */
function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[activeLevel]) {
    return;
  }
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    const safe = sanitize(meta);
    const target = level === 'error' || level === 'warn' ? console.error : console.log;
    target(prefix, JSON.stringify(safe));
  } else {
    const target = level === 'error' || level === 'warn' ? console.error : console.log;
    target(prefix);
  }
}

/** Structured logger. All tool calls, SSE events, and errors flow through here. */
export const logger = {
  /** Override the active level at runtime (used by config bootstrap). */
  setLevel(level: LogLevel): void {
    activeLevel = level;
  },
  debug(message: string, meta?: Record<string, unknown>): void {
    emit('debug', message, meta);
  },
  info(message: string, meta?: Record<string, unknown>): void {
    emit('info', message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    emit('warn', message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    emit('error', message, meta);
  },
};
