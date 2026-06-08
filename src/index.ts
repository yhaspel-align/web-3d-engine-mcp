#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Request, Response } from 'express';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketRelay } from './websocket-relay.js';
import { registerStateTools } from './tools/state-tools.js';
import { registerContextTools } from './tools/context-tools.js';
import { registerPluginTools } from './tools/plugin-tools.js';
import { registerCameraViewTools } from './tools/camera-view-tools.js';
import { registerReviewTools } from './tools/review-tools.js';

const WS_PORT = parseInt(process.env['WS_PORT'] ?? '3333', 10);
const MCP_PORT = parseInt(process.env['MCP_PORT'] ?? '3232', 10);
const MCP_HOST = process.env['MCP_HOST'] ?? '127.0.0.1';

const relay = new WebSocketRelay(WS_PORT);

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'web-3d-engine-mcp', version: '2.0.0' }, { capabilities: { logging: {} } });
  registerStateTools(server, relay);
  registerContextTools(server, relay);
  registerPluginTools(server, relay);
  registerCameraViewTools(server, relay);
  registerReviewTools(server, relay);
  return server;
}

function attachEngineEventLogging(server: McpServer): () => void {
  return relay.onEngineEvent((eventName, detail) => {
    server.server.sendLoggingMessage({
      level: 'info',
      data: `Engine event: ${eventName} - ${JSON.stringify(detail)}`,
    }).catch((error) => {
      process.stderr.write(`[web-3d-engine-mcp] Failed to send engine event log: ${String(error)}\n`);
    });
  });
}

type HttpMcpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  detachEngineEventLogging: () => void;
};

const sessions = new Map<string, HttpMcpSession>();

const app = createMcpExpressApp({ host: MCP_HOST });

app.all('/mcp', async (req: Request, res: Response) => {
  try {
    const rawSessionId = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session && req.method === 'POST' && isInitializeRequest(req.body)) {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          if (session) sessions.set(newSessionId, session);
          process.stderr.write(`[web-3d-engine-mcp] HTTP MCP session initialized: ${newSessionId}\n`);
        },
      });

      const detachEngineEventLogging = attachEngineEventLogging(server);
      session = { server, transport, detachEngineEventLogging };

      transport.onclose = () => {
        const closedId = transport.sessionId;
        if (closedId) sessions.delete(closedId);
        detachEngineEventLogging();
        server.close().catch(() => undefined);
      };

      await server.connect(transport);
    }

    if (!session) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: missing or invalid MCP session.' },
        id: null,
      });
      return;
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error) {
    process.stderr.write(`[web-3d-engine-mcp] Error handling HTTP MCP request: ${String(error)}\n`);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

const httpServer = app.listen(MCP_PORT, MCP_HOST, () => {
  process.stderr.write(
    `[web-3d-engine-mcp] MCP server running (streamable HTTP) at http://${MCP_HOST}:${MCP_PORT}/mcp. ` +
    `WebSocket relay on ws://localhost:${WS_PORT}\n`,
  );
});

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(`[web-3d-engine-mcp] ERROR: MCP HTTP port ${MCP_PORT} is already in use.\n`);
  } else {
    process.stderr.write(`[web-3d-engine-mcp] HTTP server error: ${error.message}\n`);
  }
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  process.stderr.write(`[web-3d-engine-mcp] Received ${signal}; shutting down\n`);
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  for (const [id, session] of sessions) {
    sessions.delete(id);
    session.detachEngineEventLogging();
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  }
  relay.close();
}

process.on('SIGINT', () => { void shutdown('SIGINT').finally(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown('SIGTERM').finally(() => process.exit(0)); });
