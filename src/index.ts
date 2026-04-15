#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketRelay } from './websocket-relay.js';
import { registerSceneTools } from './tools/scene-tools.js';
import { registerCameraTools } from './tools/camera-tools.js';
import { registerVisibilityTools } from './tools/visibility-tools.js';
import { registerMaterialTools } from './tools/material-tools.js';
import { registerTransformationTools } from './tools/transformation-tools.js';
import { registerGeometryTools } from './tools/geometry-tools.js';
import { registerReviewTools } from './tools/review-tools.js';

const WS_PORT = parseInt(process.env['WS_PORT'] ?? '3333', 10);

const relay = new WebSocketRelay(WS_PORT);

const server = new McpServer({
  name: 'web-3d-engine-mcp',
  version: '1.0.0',
});

registerSceneTools(server, relay);
registerCameraTools(server, relay);
registerVisibilityTools(server, relay);
registerMaterialTools(server, relay);
registerTransformationTools(server, relay);
registerGeometryTools(server, relay);
registerReviewTools(server, relay);

// Forward engine events to MCP server log
relay.onEngineEvent((eventName, detail) => {
  server.server.sendLoggingMessage({
    level: 'info',
    data: `Engine event: ${eventName} — ${JSON.stringify(detail)}`,
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(`[web-3d-engine-mcp] MCP server running (stdio). WebSocket relay on ws://localhost:${WS_PORT}\n`);
