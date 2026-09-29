#!/usr/bin/env node
/**
 * HTTP gateway: the same computer-use server as index.ts, over HTTP instead of
 * stdio. Only the transport differs - tools, policy and coordinate handling all
 * come from server.ts, so the gateway cannot drift from the stdio server or
 * bypass its allowlist and key blocklist.
 *
 * Endpoints:
 *   POST/GET/DELETE /mcp       Streamable HTTP (current MCP transport)
 *   GET /sse + POST /messages  SSE (legacy transport)
 *   GET /health                liveness probe
 *
 * Each client session gets its own Server and SessionState, so one client's
 * request_access grants never leak to another. Display geometry and the
 * installed-app list are measured once at startup and shared.
 *
 * Binds 127.0.0.1 by default, with DNS-rebinding protection from the SDK's
 * createMcpExpressApp. There is no authentication: anything that can reach the
 * port can drive this Mac's mouse and keyboard, so do not expose it beyond
 * localhost without putting authentication in front of it.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { createServer, loadEnvironment, type ServerEnvironment } from './server.js';
import { closeScrollHelper } from './scroll.js';

const PORT = Number(process.env.PORT ?? 3100);
const HOST = process.env.HOST ?? '127.0.0.1';

interface Session {
  server: Server;
  transport: StreamableHTTPServerTransport | SSEServerTransport;
}

const sessions = new Map<string, Session>();

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  await s.server.close().catch(() => {});
}

export async function startHttpServer(env: ServerEnvironment): Promise<void> {
  const app = createMcpExpressApp({ host: HOST });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', server: 'computer-use', sessions: sessions.size });
  });

  // ── Streamable HTTP ────────────────────────────────────────────────────────

  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.header('mcp-session-id');
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
      if (!(existing.transport instanceof StreamableHTTPServerTransport)) {
        jsonRpcError(res, 400, 'Session uses the SSE transport; post to /messages instead.');
        return;
      }
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId || !isInitializeRequest(req.body)) {
      jsonRpcError(res, 400, 'Unknown or missing session. Send an initialize request first.');
      return;
    }

    const { server } = await createServer(env);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) void closeSession(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET opens the server->client notification stream; DELETE ends the session.
  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.header('mcp-session-id');
    const s = sessionId ? sessions.get(sessionId) : undefined;
    if (!s || !(s.transport instanceof StreamableHTTPServerTransport)) {
      jsonRpcError(res, 400, 'Unknown or missing session.');
      return;
    }
    await s.transport.handleRequest(req, res);
  };
  app.get('/mcp', handleSessionRequest);
  app.delete('/mcp', handleSessionRequest);

  // ── SSE (legacy) ───────────────────────────────────────────────────────────

  app.get('/sse', async (_req: Request, res: Response) => {
    const { server } = await createServer(env);
    const transport = new SSEServerTransport('/messages', res);
    sessions.set(transport.sessionId, { server, transport });
    res.on('close', () => void closeSession(transport.sessionId));
    await server.connect(transport);
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId ?? '');
    const s = sessions.get(sessionId);
    if (!s || !(s.transport instanceof SSEServerTransport)) {
      jsonRpcError(res, 400, `Unknown SSE session "${sessionId}".`);
      return;
    }
    await s.transport.handlePostMessage(req, res, req.body);
  });

  await new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(PORT, HOST, () => resolve());
    httpServer.on('error', reject);

    const shutdown = async () => {
      closeScrollHelper();
      await Promise.all([...sessions.keys()].map(closeSession));
      httpServer.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

  const base = `http://${HOST.includes(':') ? `[${HOST}]` : HOST}:${PORT}`;
  process.stderr.write(
    `computer-use MCP gateway listening on ${base}\n` +
      `  Streamable HTTP: ${base}/mcp\n` +
      `  SSE (legacy):    ${base}/sse\n` +
      `  Health:          ${base}/health\n`,
  );
}

loadEnvironment()
  .then(startHttpServer)
  .catch((error: unknown) => {
    process.stderr.write(
      `computer-use MCP gateway failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
