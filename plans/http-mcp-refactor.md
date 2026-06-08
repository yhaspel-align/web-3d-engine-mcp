# HTTP MCP Refactor Plan

## Goal

Change `web-3d-engine-mcp` so the MCP server is exposed over Streamable HTTP on port `3232` instead of stdio. Preserve current MCP tool behavior and keep the browser bridge unchanged.

The resulting topology should be:

```text
MCP client -> HTTP MCP endpoint on http://127.0.0.1:3232/mcp -> Node MCP server -> WebSocketRelay -> browser bridge -> web3dEngineApi
```

The browser bridge topology remains:

```text
Node WebSocketRelay on ws://localhost:3333 <-> browser-bridge/engine-bridge.js
```

## Validated Facts From The Current Repo

- `src/index.ts` is the only current MCP process entry point.
- `src/index.ts` imports `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`, creates `new StdioServerTransport()`, and calls `await server.connect(transport)`.
- `src/index.ts` creates `new WebSocketRelay(WS_PORT)` before registering tools.
- `WS_PORT` defaults to `3333` and is independent from the MCP transport.
- `src/websocket-relay.ts` owns the browser-facing WebSocket server. It listens on the configured port, tracks one connected browser client, correlates bridge command responses by UUID, forwards engine events, and has no MCP stdio dependency.
- `browser-bridge/engine-bridge.js` connects to `ws://localhost:${window.MCP_BRIDGE_PORT ?? 3333}`. It does not connect to the MCP stdio transport and should not need changes for this refactor.
- Current MCP tools already call semantic bridge commands such as `get_engine_snapshot`, `update_engine_context`, `refresh_engine_context`, `call_store_action`, and `rotate_camera_to_jaw_view` through `relay.execute(...)`.
- The installed `@modelcontextprotocol/sdk` package resolved in `package-lock.json` is `1.29.0`, even though `package.json` allows `^1.10.2`.
- The installed SDK exposes `StreamableHTTPServerTransport` at `@modelcontextprotocol/sdk/server/streamableHttp.js`.
- The installed SDK exposes `createMcpExpressApp` at `@modelcontextprotocol/sdk/server/express.js`.
- The installed SDK examples use `app.all('/mcp', ...)`, `StreamableHTTPServerTransport`, `isInitializeRequest`, and the `mcp-session-id` header for stateful Streamable HTTP sessions.
- The installed SDK declaration for `McpServer` includes `close(): Promise<void>` and `sendLoggingMessage(params, sessionId?): Promise<void>`, so per-session server cleanup and best-effort engine event logging are supported by the API.
- Current VS Code MCP config in the consumer workspace uses stdio:

```json
{
  "servers": {
    "web-3d-engine": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/W/Git_Managed/web-3d-engine-mcp/dist/index.js"],
      "env": {
        "WS_PORT": "3333"
      }
    }
  }
}
```

## Non-Goals

- Do not change `browser-bridge/engine-bridge.js` for this transport refactor.
- Do not change the browser bridge WebSocket port. It remains `3333` by default and remains configurable through `WS_PORT` on the Node side and `window.MCP_BRIDGE_PORT` on the browser side.
- Do not change existing MCP tool names, schemas, or bridge command semantics unless HTTP transport verification exposes a transport-specific bug.
- Do not reintroduce direct `IThreeObjectsService` calls.
- Do not add legacy HTTP+SSE endpoints unless a target MCP client cannot use Streamable HTTP. The requested endpoint should be Streamable HTTP MCP.
- Do not expose the MCP HTTP server on all network interfaces by default.

## Architectural Decision

Use the SDK's Streamable HTTP transport, not a custom JSON-RPC HTTP adapter.

Recommended endpoint:

```text
http://127.0.0.1:3232/mcp
```

Recommended defaults:

```text
MCP_HOST=127.0.0.1
MCP_PORT=3232
WS_PORT=3333
```

Use stateful Streamable HTTP sessions rather than stateless per-request servers because the current stdio process behaves like a persistent server and the code forwards engine events into MCP logging. Stateful transports preserve the MCP session ID, support long-lived GET streams, and give a place to clean up per-client server instances.

## Files To Modify

### Required

- `src/index.ts`
  - Replace stdio transport startup with HTTP server startup.
  - Keep `WebSocketRelay` creation.
  - Extract MCP server construction into a function so each HTTP session can get its own `McpServer` connected to its own HTTP transport.
  - Register all existing tools exactly as today.
  - Route engine event logging per session without leaking listeners.
  - Add graceful shutdown for HTTP server, active HTTP transports, and the WebSocket relay.

- `src/websocket-relay.ts`
  - Keep WebSocket command behavior unchanged.
  - Add an unsubscribe path for engine event listeners so HTTP sessions can be cleaned up.
  - This is not a browser bridge change and does not affect port `3333` behavior.

- `package.json`
  - Ensure the SDK version range clearly supports `StreamableHTTPServerTransport` and `createMcpExpressApp`.
  - Keep `dev`, `build`, and `start` scripts unless a new script name is useful.
  - Optionally add `MCP_PORT` and HTTP usage notes through documentation rather than scripts.

- `package-lock.json`
  - Update only if package dependency ranges are changed or install is run.

- Documentation, preferably `README.md` and/or `plans/web-3d-engine-mcp-plan.md`
  - Replace stdio MCP setup instructions with HTTP MCP setup instructions.
  - Keep the browser bridge section on WebSocket port `3333`.

### Consumer Workspace Follow-Up

- Update `.vscode/mcp.json` in the consumer workspace from stdio to HTTP after the server starts independently:

```json
{
  "servers": {
    "web-3d-engine": {
      "type": "http",
      "url": "http://127.0.0.1:3232/mcp"
    }
  }
}
```

If the MCP client supports custom headers or environment fields for HTTP servers, they are not needed for the local default. If the MCP client expects to spawn the process itself, add a separate task or startup script because HTTP MCP servers are long-running URL endpoints rather than stdio child processes.

## Implementation Design

### 1. Refactor Server Construction

Create a function in `src/index.ts` that returns a configured `McpServer` and registers all existing tools against the shared relay.

Target shape:

```ts
function createMcpServer(relay: WebSocketRelay): McpServer {
  const server = new McpServer({
    name: 'web-3d-engine-mcp',
    version: '2.0.0',
  }, {
    capabilities: { logging: {} },
  });

  registerStateTools(server, relay);
  registerContextTools(server, relay);
  registerPluginTools(server, relay);
  registerCameraViewTools(server, relay);
  registerReviewTools(server, relay);

  return server;
}
```

Keep the relay process-global:

```ts
const WS_PORT = parseInt(process.env['WS_PORT'] ?? '3333', 10);
const MCP_PORT = parseInt(process.env['MCP_PORT'] ?? '3232', 10);
const MCP_HOST = process.env['MCP_HOST'] ?? '127.0.0.1';

const relay = new WebSocketRelay(WS_PORT);
```

### 2. Add Engine Event Listener Cleanup

Current `WebSocketRelay.onEngineEvent(listener)` pushes a listener into an array and returns `void`. Under stdio this is fine because there is one MCP server. Under HTTP, every session may create its own `McpServer`; if each session registers a listener, closed sessions must be removed.

Change the method to return an unsubscribe function:

```ts
onEngineEvent(listener: EngineEventListener): () => void {
  this.eventListeners.push(listener);
  return () => {
    this.eventListeners = this.eventListeners.filter((registered) => registered !== listener);
  };
}
```

This requires changing `eventListeners` from a mutable array property that can be reassigned, or using `splice` instead:

```ts
const index = this.eventListeners.indexOf(listener);
if (index >= 0) this.eventListeners.splice(index, 1);
```

Prefer `splice` if keeping `eventListeners` readonly-by-reference.

### 3. Register Event Logging Per HTTP Session

Move the current event logging block into a helper:

```ts
function attachEngineEventLogging(server: McpServer, relay: WebSocketRelay): () => void {
  return relay.onEngineEvent((eventName, detail) => {
    server.server.sendLoggingMessage({
      level: 'info',
      data: `Engine event: ${eventName} - ${JSON.stringify(detail)}`,
    }).catch((error) => {
      process.stderr.write(`[web-3d-engine-mcp] Failed to send engine event log: ${String(error)}\n`);
    });
  });
}
```

Note: the current code uses an em dash in the log string. Use ASCII in the refactor unless there is a specific reason to preserve the character.

The installed SDK declares `sendLoggingMessage(params, sessionId?)`, so this helper can send without a session id for the per-session `McpServer`. Keep logging best-effort because MCP clients may choose how prominently to display log notifications.

### 4. Add Streamable HTTP Session Management

Use `createMcpExpressApp({ host: MCP_HOST })` so localhost DNS rebinding protection is applied by the SDK helper for `127.0.0.1`, `localhost`, and `::1`.

Implementation outline:

```ts
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
```

Session state shape:

```ts
type HttpMcpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  detachEngineEventLogging: () => void;
};

const sessions = new Map<string, HttpMcpSession>();
```

Route shape:

```ts
const app = createMcpExpressApp({ host: MCP_HOST });

app.all('/mcp', async (req, res) => {
  try {
    const rawSessionId = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session && req.method === 'POST' && isInitializeRequest(req.body)) {
      const server = createMcpServer(relay);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, session!);
          process.stderr.write(`[web-3d-engine-mcp] HTTP MCP session initialized: ${newSessionId}\n`);
        },
      });

      const detachEngineEventLogging = attachEngineEventLogging(server, relay);
      session = { server, transport, detachEngineEventLogging };

      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) sessions.delete(closedSessionId);
        detachEngineEventLogging();
        server.close().catch((error) => {
          process.stderr.write(`[web-3d-engine-mcp] Error closing MCP server: ${String(error)}\n`);
        });
      };

      await server.connect(transport);
    }

    if (!session) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: missing or invalid MCP session. Initialize with POST /mcp first.',
        },
        id: null,
      });
      return;
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error) {
    process.stderr.write(`[web-3d-engine-mcp] Error handling HTTP MCP request: ${String(error)}\n`);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});
```

Implementation caution: the `onsessioninitialized` callback closes over `session`. In TypeScript strict mode, initialize `let session: HttpMcpSession | undefined` before constructing the transport, assign it before `handleRequest`, and guard in the callback if necessary:

```ts
onsessioninitialized: (newSessionId) => {
  if (!session) return;
  sessions.set(newSessionId, session);
}
```

### 5. Start HTTP Server On Port 3232

Use the configured host and port:

```ts
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
```

The old stdio startup should be removed:

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 6. Add Graceful Shutdown

On `SIGINT` and `SIGTERM`:

1. Stop accepting HTTP connections.
2. Close all active Streamable HTTP transports.
3. Detach all per-session engine event listeners.
4. Close all per-session MCP servers.
5. Close the WebSocket relay.
6. Exit after cleanup.

Implementation outline:

```ts
async function shutdown(signal: string): Promise<void> {
  process.stderr.write(`[web-3d-engine-mcp] Received ${signal}; shutting down\n`);

  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  for (const [sessionId, session] of sessions) {
    sessions.delete(sessionId);
    session.detachEngineEventLogging();
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  }

  relay.close();
}

process.on('SIGINT', () => { void shutdown('SIGINT').finally(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown('SIGTERM').finally(() => process.exit(0)); });
```

Avoid calling `process.exit(0)` before asynchronous cleanup completes.

### 7. Dependency And Package Plan

Current `package.json` allows `@modelcontextprotocol/sdk` `^1.10.2`; current lockfile resolves `1.29.0`. The HTTP implementation relies on APIs verified in `1.29.0`:

- `@modelcontextprotocol/sdk/server/streamableHttp.js`
- `@modelcontextprotocol/sdk/server/express.js`
- `@modelcontextprotocol/sdk/types.js` with `isInitializeRequest`

Recommended package action:

```json
"@modelcontextprotocol/sdk": "^1.29.0"
```

Then run:

```powershell
npm install
npm run build
```

Direct `express` dependency is optional if only importing `createMcpExpressApp` from the SDK, because the SDK package currently declares `express` as its own dependency. If TypeScript or package policy requires all runtime modules visible in generated declarations to be direct dependencies, add:

```json
"express": "^5.2.1"
```

and, only if type resolution fails:

```json
"@types/express": "^5.0.0"
```

Do not add these unless the build or project dependency policy requires them.

## HTTP MCP Client Configuration

### VS Code MCP

After the server is running separately with `npm start` or `npm run dev`, configure the client as HTTP:

```json
{
  "servers": {
    "web-3d-engine": {
      "type": "http",
      "url": "http://127.0.0.1:3232/mcp"
    }
  }
}
```

The old stdio fields are no longer used:

```json
"command": "node",
"args": ["C:/W/Git_Managed/web-3d-engine-mcp/dist/index.js"]
```

Important operational change: with stdio, the MCP client launched the Node process. With HTTP, the Node process must already be listening on port `3232`, unless the client has its own mechanism for launching HTTP servers.

### Browser Bridge

No change:

```js
window.MCP_BRIDGE_PORT = 3333;
```

No change to script inclusion:

```html
<script type="module" src="/engine-bridge.js"></script>
```

No change to explicit engine binding:

```js
window.mcpBridge?.setEngineElement(document.querySelector('web-3d-engine'));
```

## Validation Plan

### Static Checks

Run in `C:\W\Git_Managed\web-3d-engine-mcp`:

```powershell
npm run build
```

Expected:

- TypeScript build succeeds.
- No import of `@modelcontextprotocol/sdk/server/stdio.js` remains in `src/index.ts`.
- `src/index.ts` imports `StreamableHTTPServerTransport`.
- `src/index.ts` listens on `MCP_PORT` default `3232`.
- `src/websocket-relay.ts` still defaults to WebSocket port `3333` through `src/index.ts`.
- `browser-bridge/engine-bridge.js` has no changes for this refactor.

PowerShell checks:

```powershell
Select-String -Path src\index.ts -Pattern 'StdioServerTransport'
Select-String -Path src\index.ts -Pattern 'StreamableHTTPServerTransport'
Select-String -Path src\index.ts -Pattern '3232'
Select-String -Path browser-bridge\engine-bridge.js -Pattern 'MCP_BRIDGE_PORT|3333'
```

Expected:

- First command returns no matches.
- Other commands return the expected HTTP and bridge references.

### Manual HTTP Protocol Smoke Test

Start the server:

```powershell
npm run dev
```

Expected stderr includes:

```text
[web-3d-engine-mcp] WebSocket relay listening on ws://localhost:3333
[web-3d-engine-mcp] MCP server running (streamable HTTP) at http://127.0.0.1:3232/mcp. WebSocket relay on ws://localhost:3333
```

Initialize an MCP session:

```powershell
$headers = @{
  'Content-Type' = 'application/json'
  'Accept' = 'application/json, text/event-stream'
}
$initBody = @{
  jsonrpc = '2.0'
  id = 1
  method = 'initialize'
  params = @{
    protocolVersion = '2025-11-25'
    capabilities = @{}
    clientInfo = @{ name = 'manual-smoke'; version = '0.0.0' }
  }
} | ConvertTo-Json -Depth 10
$response = Invoke-WebRequest -Uri 'http://127.0.0.1:3232/mcp' -Method Post -Headers $headers -Body $initBody
$response.StatusCode
$response.Headers['mcp-session-id']
$response.Content
```

Expected:

- Status `200`.
- Response has an `mcp-session-id` header.
- Response body contains an MCP initialize result.

Call `tools/list` using the returned session id:

```powershell
$sessionId = $response.Headers['mcp-session-id']
$headers['mcp-session-id'] = $sessionId
$toolsBody = @{
  jsonrpc = '2.0'
  id = 2
  method = 'tools/list'
  params = @{}
} | ConvertTo-Json -Depth 10
Invoke-WebRequest -Uri 'http://127.0.0.1:3232/mcp' -Method Post -Headers $headers -Body $toolsBody
```

Expected:

- Status `200`.
- Tool list contains existing tools such as `get_engine_snapshot`, `get_engine_context`, `set_feature_flag`, `set_plugin_props`, `set_jaw_visibility`, and `select_image`.

### Browser Bridge Smoke Test

With the HTTP server still running:

1. Load the consumer web app with `engine-bridge.js` included.
2. Confirm browser console logs:

```text
[engine-bridge] Connected to MCP WebSocket relay
[engine-bridge] web3dEngineApi bound
```

3. Confirm Node stderr logs:

```text
[web-3d-engine-mcp] Browser bridge connected
```

4. From the MCP client or manual HTTP call, call `get_engine_snapshot`.
5. Expected result:
   - If the browser bridge is connected and the engine API is ready, the tool returns engine state.
   - If the browser bridge is not connected, the tool returns the same bridge connection error behavior as before.

### End-To-End MCP Client Smoke Test

1. Start the HTTP MCP server:

```powershell
npm run build
npm start
```

2. Configure VS Code MCP as HTTP at `http://127.0.0.1:3232/mcp`.
3. Reload or restart the MCP client connection.
4. Verify the tool list is available.
5. Load the browser app and connect the bridge.
6. Call read-only tools first:
   - `get_engine_snapshot`
   - `get_engine_context`
   - `get_render_views`
7. Call one existing mutation tool with a reversible or low-risk action:
   - `set_feature_flag` for `isRotationEnabled`
   - or `set_plugin_props` with a known plugin prop in a test case
8. Confirm browser-side engine state changes and no bridge code was changed.

### Port Conflict Tests

MCP HTTP port conflict:

1. Start any process on port `3232`.
2. Start the MCP server.
3. Expected: process exits with a clear error mentioning MCP HTTP port `3232`.

Bridge WebSocket port conflict:

1. Start any process on port `3333`.
2. Start the MCP server.
3. Expected: existing `WebSocketRelay` warning remains unchanged and mentions browser bridge unavailable or `WS_PORT` override.

## Regression Risks And Mitigations

### Risk: HTTP sessions leak engine event listeners

Mitigation:

- Add an unsubscribe return from `WebSocketRelay.onEngineEvent`.
- Call it from `transport.onclose` and graceful shutdown.
- Add a quick manual test: initialize and close multiple MCP sessions, then trigger one engine event and verify it is not logged multiple times per active session unexpectedly.

### Risk: MCP clients expect the server to be spawned automatically

Mitigation:

- Document that HTTP MCP requires the server process to be started separately.
- Optionally add a VS Code task or npm script for convenience in a separate change.

### Risk: SDK API availability differs after clean install

Mitigation:

- Raise `@modelcontextprotocol/sdk` dependency to `^1.29.0`, because that is the version verified in the current lockfile and installed package.
- Run `npm install` and `npm run build` after changing the dependency.

### Risk: logging notifications behave differently over HTTP

Mitigation:

- Keep engine event logging best-effort.
- Catch rejected logging promises.
- Verify with the target MCP client whether logs are visible over Streamable HTTP.
- Do not block tool calls on log delivery.

### Risk: multiple HTTP MCP clients share one browser bridge

This is already effectively a single-live-engine process. The WebSocket relay currently tracks one browser client. Multiple MCP HTTP sessions can issue tools against the same connected browser engine. This should be documented as supported but shared-state behavior, not isolated sessions.

Mitigation:

- Keep one process-global `WebSocketRelay`.
- Do not create one relay per HTTP session.
- Preserve existing single-browser-client semantics.

## Rollback Plan

If HTTP MCP fails during implementation:

1. Revert `src/index.ts` to the previous stdio entry point.
2. Revert `src/websocket-relay.ts` only if the listener unsubscribe change caused issues.
3. Restore stdio MCP client config.
4. Leave browser bridge untouched, because this refactor should not require browser bridge edits.

## Implementation Checklist

1. Update `src/websocket-relay.ts` so `onEngineEvent` returns an unsubscribe function.
2. Refactor `src/index.ts` to expose `createMcpServer(relay)`.
3. Remove `StdioServerTransport` import and stdio startup.
4. Add `MCP_PORT` and `MCP_HOST` constants with defaults `3232` and `127.0.0.1`.
5. Add `createMcpExpressApp({ host: MCP_HOST })`.
6. Add `app.all('/mcp', ...)` with stateful `StreamableHTTPServerTransport` session handling.
7. Add `transport.onclose` cleanup.
8. Add HTTP server startup and listen error handling.
9. Add graceful shutdown for HTTP server, sessions, transports, MCP servers, event listeners, and relay.
10. Raise the SDK dependency to a version verified to include Streamable HTTP support, preferably `^1.29.0`.
11. Run `npm install` if dependency ranges changed.
12. Run `npm run build`.
13. Run manual HTTP initialize and `tools/list` smoke tests.
14. Run browser bridge smoke tests without changing bridge code.
15. Update MCP client config to `type: "http"` and `url: "http://127.0.0.1:3232/mcp"`.
16. Update docs to explain the two ports: MCP HTTP on `3232`, browser relay WebSocket on `3333`.

## Open Questions Before Implementation

These are not blockers for the plan, but they should be confirmed before shipping:

1. Does the target MCP client use Streamable HTTP at a single `/mcp` endpoint, or does it require deprecated HTTP+SSE endpoints?
2. Should the server bind strictly to `127.0.0.1`, or is there a real need to expose it on another interface with explicit `allowedHosts` and authentication?
3. Should the repo keep a temporary stdio compatibility entry point such as `src/index-stdio.ts`, or should stdio be fully removed from runtime support?
4. Should a VS Code task be added to start `npm run dev` before connecting the HTTP MCP client?
