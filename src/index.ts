/**
 * PokeBOT MCP server entry point.
 *
 * Exposes an MCP server over SSE for Poke AI:
 *   GET  /sse              → establish SSE connection, create MCP transport
 *   POST /messages?sessionId → handle incoming MCP messages
 *   GET  /health           → JSON health/status report
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { loadConfig } from './config.js';
import { createMcpServer, SERVER_VERSION } from './server.js';
import { toolNames } from './tools/index.js';
import { pingAnthropic } from './utils/claude.js';
import { pingGemini } from './utils/gemini.js';
import { logger } from './utils/logger.js';
import { describeError } from './utils/errors.js';
import type { ApiStatus } from './types/index.js';

const config = loadConfig();
const app = express();
app.use(express.json({ limit: '25mb' })); // generous limit for base64 image payloads

/** Active SSE transports keyed by session id. */
const transports = new Map<string, SSEServerTransport>();

/**
 * Extracts an auth token from either the `Authorization: Bearer` header or a
 * `?token=` query parameter.
 */
function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  const queryToken = req.query.token;
  return typeof queryToken === 'string' ? queryToken : undefined;
}

/**
 * Auth middleware. Enforced only when `MCP_AUTH_TOKEN` is configured; otherwise
 * all requests pass through.
 */
function authenticate(req: Request, res: Response, next: NextFunction): void {
  if (!config.mcpAuthToken) {
    next();
    return;
  }
  const token = extractToken(req);
  if (token === config.mcpAuthToken) {
    next();
    return;
  }
  logger.warn('Unauthorized request rejected', { path: req.path, ip: req.ip });
  res.status(401).json({ error: 'unauthorized' });
}

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  const [anthropic, gemini] = await Promise.all([pingAnthropic(), pingGemini()]);
  const toStatus = (ok: boolean): ApiStatus => (ok ? 'connected' : 'disconnected');

  res.json({
    status: anthropic && gemini ? 'ok' : 'degraded',
    version: SERVER_VERSION,
    uptime: Math.floor(process.uptime()),
    tools: toolNames,
    apis: {
      anthropic: toStatus(anthropic),
      gemini: toStatus(gemini),
    },
    active_sessions: transports.size,
    timestamp: new Date().toISOString(),
  });
});

// ── SSE connection ─────────────────────────────────────────────────────────────

app.get('/sse', authenticate, async (_req: Request, res: Response) => {
  // SSE headers — X-Accel-Buffering disables nginx buffering (required).
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const transport = new SSEServerTransport('/messages', res);
  const server = createMcpServer();
  transports.set(transport.sessionId, transport);
  logger.info('SSE connection opened', {
    sessionId: transport.sessionId,
    activeSessions: transports.size,
  });

  res.on('close', () => {
    transports.delete(transport.sessionId);
    logger.info('SSE connection closed', {
      sessionId: transport.sessionId,
      activeSessions: transports.size,
    });
  });

  try {
    await server.connect(transport);
  } catch (error) {
    logger.error('Failed to connect MCP transport', {
      sessionId: transport.sessionId,
      error: describeError(error),
    });
    transports.delete(transport.sessionId);
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});

// ── Incoming MCP messages ────────────────────────────────────────────────────────

app.post('/messages', authenticate, async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId;
  if (typeof sessionId !== 'string') {
    res.status(400).json({ error: 'missing sessionId' });
    return;
  }
  const transport = transports.get(sessionId);
  if (!transport) {
    logger.warn('Message for unknown session', { sessionId });
    res.status(404).json({ error: 'unknown sessionId' });
    return;
  }
  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    logger.error('Failed to handle MCP message', { sessionId, error: describeError(error) });
    if (!res.headersSent) {
      res.status(500).json({ error: 'message handling failed' });
    }
  }
});

// ── Boot ─────────────────────────────────────────────────────────────────────

const httpServer = app.listen(config.port, config.host, () => {
  logger.info('PokeBOT MCP server listening', {
    host: config.host,
    port: config.port,
    version: SERVER_VERSION,
    nodeEnv: config.nodeEnv,
  });
});

/** Graceful shutdown: close all SSE transports, then the HTTP server. */
function shutdown(signal: string): void {
  logger.info('Shutting down', { signal, activeSessions: transports.size });
  for (const transport of transports.values()) {
    void transport.close();
  }
  transports.clear();
  httpServer.close(() => process.exit(0));
  // Force-exit if connections linger.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
