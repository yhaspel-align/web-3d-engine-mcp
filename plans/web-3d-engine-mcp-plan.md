# web-3d-engine-mcp — Design Document

## 1. Project Purpose

This project is an **MCP (Model Context Protocol) server** that exposes natural-language-friendly tools for controlling a browser-based 3D engine (built on Three.js via an `IThreeObjectsService` interface). It allows LLM agents to query, manipulate, and inspect a live 3D scene running in a web browser — without the agent needing direct browser access.

The primary domain is **dental 3D visualization** (ITR/NIRI review workflows), though the architecture is generic enough to drive any Three.js-based scene that implements `IThreeObjectsService`.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        LLM / Agent                           │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTP (Streamable HTTP MCP)
                                │ http://127.0.0.1:3232/mcp
                                ▼
┌──────────────────────────────────────────────────────────────┐
│              web-3d-engine-mcp  (Node.js process)            │
│                                                              │
│  ┌─────────────┐  ┌───────────────────────────────────────┐ │
│  │  MCP Server │──│  Tool Registrations (state, context,  │ │
│  │  (HTTP)     │  │  plugin, camera-view, review)         │ │
│  └──────┬──────┘  └───────────────────────────────────────┘ │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────┐                                │
│  │   WebSocket Relay        │  (ws://localhost:3333)         │
│  │   - sends BridgeCommand  │                                │
│  │   - receives BridgeResp  │                                │
│  │   - forwards events      │                                │
│  └────────────┬─────────────┘                                │
└───────────────┼──────────────────────────────────────────────┘
                │ WebSocket
                ▼
┌──────────────────────────────────────────────────────────────┐
│         Browser (consumer app)                               │
│                                                              │
│  ┌────────────────────────────┐   ┌────────────────────────┐│
│  │   engine-bridge.js         │──▶│  web3dEngineApi        ││
│  │   (WebSocket client)       │   │  (Three.js scene)      ││
│  └────────────────────────────┘   └────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Communication Flow

1. The LLM calls an MCP tool (e.g., `get_engine_snapshot`) over Streamable HTTP at `http://127.0.0.1:3232/mcp`.
2. The MCP server translates this into a `BridgeCommand` (JSON with a UUID, method name, and params).
3. The `WebSocketRelay` sends the command to the single connected browser client.
4. `engine-bridge.js` dispatches the method to the real engine API.
5. The browser serializes the result and sends a `BridgeResponse` back.
6. The relay resolves the pending promise and the MCP tool returns the result to the agent.

Engine events (camera moves, load progress, etc.) flow in the opposite direction — the browser bridge forwards them as `BridgeEvent` messages, and the relay notifies each active MCP session for logging.

---

## 3. Project Structure

```
web-3d-engine-mcp/
├── browser-bridge/
│   └── engine-bridge.js        # Browser-side WS client — include in consumer app
├── src/
│   ├── index.ts                # Entry point: creates MCP server + relay, registers tools
│   ├── websocket-relay.ts      # WebSocket server bridging MCP ↔ browser
│   ├── types/
│   │   └── bridge.types.ts     # BridgeCommand, BridgeResponse, BridgeEvent interfaces
│   └── tools/
│       ├── scene-tools.ts      # get_scene_objects, get_cameras, get_groups, get_materials, get_object_transformation
│       ├── camera-tools.ts     # focus_camera_to_object, rotate_camera, move_camera, toggle_camera_static
│       ├── visibility-tools.ts # toggle_object_visibility
│       ├── material-tools.ts   # change_object_color, change_material_props
│       ├── transformation-tools.ts # change_object_transformation, reset_object_transformation
│       ├── geometry-tools.ts   # remove_object, create_geometry_in_scene, create_geometry_in_group
│       └── review-tools.ts     # move_loupe, highlight_loupe, select_image
├── plans/                      # Design documents (this file)
├── package.json
└── tsconfig.json
```

---

## 4. Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ES2022 modules) |
| Language | TypeScript 5.8 (strict mode) |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.29.0 (Streamable HTTP) |
| WebSocket | `ws` ^8.18.0 |
| Validation | `zod` ^3.24.3 |
| Dev runner | `tsx` for development |
| Build | `tsc` → `dist/` |

---

## 5. How to Use

### 5.1 Build & Run

```bash
# Install dependencies
npm install

# Development (tsx with hot reload)
npm run dev

# Production build
npm run build
npm start
```

### 5.2 MCP Client Configuration

The MCP server runs as a long-lived HTTP process. Start it first, then configure your MCP client.

**VS Code / Kiro (HTTP):**

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

**Important:** Unlike stdio, the HTTP server must be running before the MCP client connects. Start with `npm start` or `npm run dev`.

### 5.3 Browser Integration

In the consumer web app:

```html
<script type="module" src="/engine-bridge.js"></script>
```

Then wire the service:

```javascript
// Inside your ThreeObjectsAdapter callback
getThreeObjectsServiceCallback = {
  updateThreeObjects(service) {
    window.mcpBridge?.setService(service, document.getElementById('engine-container'));
  }
};
```

Optionally set the port before loading:

```javascript
window.MCP_BRIDGE_PORT = 3333;
```

The bridge auto-reconnects if the WebSocket connection drops (3-second delay).

### 5.4 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `3232` | HTTP port for MCP Streamable HTTP endpoint |
| `MCP_HOST` | `127.0.0.1` | Bind address for MCP HTTP server |
| `WS_PORT` | `3333` | WebSocket relay port (browser bridge) |

---

## 6. Available MCP Tools

### 6.1 Scene Query Tools (`scene-tools.ts`)

| Tool | Description | Params |
|------|-------------|--------|
| `get_scene_objects` | Get the full scene tree of all rendered 3D objects | (none) |
| `get_cameras` | List all cameras (uuid, name, position, group) | (none) |
| `get_groups` | List all named groups `{ name, uuid }` | (none) |
| `get_materials` | Get material/shader properties for all objects | (none) |
| `get_object_transformation` | Get the 4×4 matrix for a specific object | `uuid`, `index?` |

### 6.2 Camera Tools (`camera-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `focus_camera_to_object` | Focus/zoom camera on object | `name?`, `uuid?`, `zoomParam?`, `zoomPercentage?`, `focusPoint?`, `shouldFacePoint?` |
| `rotate_camera` | Rotate camera around axis by degrees | `axis` (x/y/z), `cameraUUID`, `degree?` |
| `move_camera` | Set camera to explicit position | `cameraUUID`, `position`, `up?`, `target?`, `zoom?` |
| `toggle_camera_static` | Lock/unlock camera from user interaction | `isStaticMode`, `cameraUUID` |

### 6.3 Visibility Tools (`visibility-tools.ts`)

| Tool | Description | Params |
|------|-------------|--------|
| `toggle_object_visibility` | Show/hide an object | `name?`, `uuid?`, `isVisible?` |

### 6.4 Material Tools (`material-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `change_object_color` | Set uniform RGBA color (0–1 range) | `color {r,g,b,a?}`, `objectName?`, `objectUuid?` |
| `change_material_props` | Set arbitrary material properties | `properties` (record), `objectName?`, `objectUuid?` |

### 6.5 Transformation Tools (`transformation-tools.ts`)

| Tool | Description | Params |
|------|-------------|--------|
| `change_object_transformation` | Apply a 16-element Matrix4 | `uuid`, `transformationMatrix` (number[16]) |
| `reset_object_transformation` | Reset to default/identity | `uuid` |

### 6.6 Geometry Tools (`geometry-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `remove_object` | Remove an object from the scene | `name?`, `uuid?` |
| `create_geometry_in_scene` | Create primitive at scene root | `params` (type, position, rotation, scale, color, dimensions), `uuid?`, `name?` |
| `create_geometry_in_group` | Create primitive inside a group | Same as above + `groupName?`, `groupUuid?` |

Supported geometry types: `box`, `sphere`, `cylinder`, `cone`, `plane`, `torus`, `line`, `points`.

### 6.7 Review / Loupe Tools (`review-tools.ts`)

| Tool | Description | Params |
|------|-------------|--------|
| `move_loupe` | Position the inspection loupe at a 3D point | `position`, `width?`, `height?`, `tolerance?` |
| `highlight_loupe` | Toggle loupe highlight state | `isHighlight` |
| `select_image` | Select a NIRI image by ID | `imageId` |

---

## 7. Protocol & Types

### BridgeCommand (MCP → Browser)

```typescript
interface BridgeCommand {
  id: string;           // UUID for request/response correlation
  method: string;       // IThreeObjectsService method name
  params: unknown;      // Serializable arguments
}
```

### BridgeResponse (Browser → MCP)

```typescript
interface BridgeResponse {
  id: string;           // Matches BridgeCommand.id
  result?: unknown;     // Success payload
  error?: string;       // Error message on failure
}
```

### BridgeEvent (Browser → MCP, unsolicited)

```typescript
interface BridgeEvent {
  type: 'engine-event';
  eventName: string;
  detail: unknown;
}
```

### Forwarded Engine Events

The browser bridge forwards these DOM events when an `eventContainer` is provided:

- `app-loaded`, `itr-loaded`, `niri-loaded`
- `camera-move`, `camera-stopped`
- `bi-log-event`, `context-update`, `model-rendered`
- `rotation-preference-changed`
- `itr-loading-progress`, `niri-loading-progress`

---

## 8. Key Design Decisions

1. **Single-client WebSocket** — Only one browser tab connects at a time. The relay tracks a single `client` reference. New connections replace the old one.

2. **30-second command timeout** — If the browser doesn't respond within 30 seconds, the pending promise rejects. This prevents the agent from hanging indefinitely.

3. **Serialization at the boundary** — Three.js objects (Matrix4, scene trees, cameras) are serialized into plain JSON in `engine-bridge.js` before transmission. The MCP side only ever sees serializable values.

4. **Tool-per-action pattern** — Each user-facing operation is a discrete MCP tool with its own Zod schema. The agent picks tools based on natural-language descriptions.

5. **Streamable HTTP transport** — The MCP server exposes a single `/mcp` endpoint over HTTP on port 3232. Each MCP client session gets its own `McpServer` instance with stateful session tracking via the `mcp-session-id` header. The server must be started independently before the MCP client connects.

6. **Auto-reconnect** — The browser bridge reconnects automatically with a 3-second backoff. The MCP server degrades gracefully when no browser is connected (tools return "No browser bridge connected").

---

## 9. Limitations & Known Constraints

- **No multi-client support** — Only one browser tab can be connected at a time.
- **No authentication** — The WebSocket relay has no auth; it's assumed to run on localhost.
- **No persistence** — Scene state is entirely in the browser; the MCP server is stateless.
- **No image/screenshot capture** — There's no tool to take a screenshot of the current viewport.
- **No undo/redo** — Transformations and color changes cannot be rolled back programmatically.
- **Geometry creation is limited to primitives** — Cannot import meshes, GLTF, or complex models.
- **Events are fire-and-forget** — Engine events are logged but not exposed as MCP notifications or resources.

---

## 10. Baseline for Upcoming Changes

This document establishes the current state of the MCP server. Planned enhancements can be tracked against this baseline:

| Area | Current State | Potential Enhancement |
|------|--------------|----------------------|
| Screenshot/capture | Not supported | Add `capture_viewport` tool |
| Multi-tab | Single client only | Queue or broadcast to multiple clients |
| Scene persistence | Stateless | Save/load scene snapshots |
| Undo/redo | Not supported | Transaction-based undo stack |
| Model import | Primitives only | GLTF/OBJ import via URL |
| Authentication | None (localhost assumed) | Token-based WS auth |
| Event subscriptions | Logging only | MCP notifications / resources |
| Animation | Not supported | Keyframe / tween animation tools |
| Lighting | Not exposed | Light creation and manipulation |
| Text/annotations | Not supported | 3D text and labels |
