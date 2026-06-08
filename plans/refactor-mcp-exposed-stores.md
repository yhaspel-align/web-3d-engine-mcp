# Refactor Plan: web-3d-engine-mcp via Exposed Stores and Dispatch

Target workspace file requested: `hackathon/refactor-mcp-exposed-stores.md`.

## Goal

Refactor `C:\W\Git_Managed\web-3d-engine-mcp` so MCP tools no longer control the live 3D engine by invoking `IThreeObjectsService` methods directly from `browser-bridge/engine-bridge.js`. The MCP must instead control the engine through the newly exposed `<web-3d-engine>` public API:

- `host.web3dEngineApi.dispatch(action)` for engine-context and plugin-preset changes.
- `host.web3dEngineApi.stores.*.getState()` for read snapshots and selected store action methods that update engine state coherently.
- `host.web3dEngineApi.stores.*.subscribe(cb)` for lifecycle/readiness tracking.

## Validated Facts

- MCP repo design: `C:\W\Git_Managed\web-3d-engine-mcp\plans\web-3d-engine-mcp-plan.md` describes a Node stdio MCP server with a WebSocket relay at `ws://localhost:3333`.
- The MCP server cannot directly access browser DOM or `web3dEngineApi`; the WebSocket relay and browser bridge must remain.
- Current browser bridge: `C:\W\Git_Managed\web-3d-engine-mcp\browser-bridge\engine-bridge.js` stores an `IThreeObjectsService` in `service` and maps command strings to direct service calls.
- Current tool modules call `relay.execute('IThreeObjectsServiceMethodName', params)`, including `focusCameraToObject`, `cameraManipulation`, `toggleObjectVisibility`, `changeUniformColor`, `changeObjectMaterialProps`, `changeModelObjectTransformation`, `createAndAddGeometryToScene`, `moveLoupeToPoint`, and `selectImageById`.
- New web engine exports exist: `Web3DEngineApi`, `EngineContextReducerActionTypes`, `UpdateOrigin`, `EngineInstanceType`, and `SupportedPlugins` from `src/index.ts`.
- `ReadOnlyStore<T>` hides store-level `setState`, but `getState()` returns Zustand state objects that include action methods. Treat these as internal-but-available and expose only an explicit allowlist through the browser bridge.

## Target Architecture

Keep this topology:

`MCP client -> Node MCP server -> WebSocketRelay -> browser-bridge -> web3dEngineApi -> engine stores/dispatch`

Do not remove `WebSocketRelay`. Replace only the browser-side command executor.

## Browser Bridge Refactor

Modify `C:\W\Git_Managed\web-3d-engine-mcp\browser-bridge\engine-bridge.js`:

1. Replace `service` with `engineApi`.
2. Add API binding:
   - Listen for `web3d-engine-ready` on `document` because the event bubbles and is composed.
   - Store `event.detail` as `engineApi`.
   - Also support `window.mcpBridge.setEngineElement(elementOrSelector)` for explicit binding.
   - If `element.web3dEngineApi` already exists, bind immediately.
   - Listen for `web3d-engine-destroyed`; if the destroyed instance matches, clear `engineApi` and wait for the next ready event.
3. Add `waitForApi()` used before every command.
4. Add a dispatch-readiness guard:
   - Do not invoke meaningful dispatch synchronously inside `web3d-engine-ready`.
   - At API bind time, capture `initialDispatch = engineApi.stores.engineStore.getState().dispatchEngineContextUpdate`. This is usually the engine-store no-op default.
   - Implement `waitForDispatchReady()` that resolves only when `engineApi.stores.engineStore.getState().dispatchEngineContextUpdate !== initialDispatch` and `engineContext` is non-empty. This confirms `ContextManager` has mounted and replaced the no-op with the real reducer.
   - For tools that require a rendered model, additionally wait until `engineApi.stores.engineStore.getState().isModelLoaded === true`.
5. Replace the current direct `dispatch(method, params)` switch with semantic engine API commands.
6. Preserve WebSocket reconnect behavior and `BridgeResponse` shape.
7. Preserve event forwarding, but forward events from the web component host or supplied event container, not from `IThreeObjectsService`.

## Bridge Command Methods

Recommended command method names:

- `get_engine_snapshot`
- `get_engine_context`
- `get_plugin_presets`
- `get_feature_flags`
- `get_render_views`
- `get_plugin_sync_state`
- `get_review_tool_state`
- `dispatch_engine_action`
- `update_engine_context`
- `update_plugin_preset`
- `call_store_action`

`call_store_action` must be allowlisted. Do not accept arbitrary `{ store, action }` from MCP and execute blindly.

## Store Action Allowlist

Allow these actions only after validating params:

`rendererStore`:
- `setRenderViews(renderViewProps)`
- `resetRenderViewToDefault(caseType)`
- `updateRenderViewCameraProps(row, col, cameraProps)`
- `setModelVisible(visible)` if whole-model visibility control is required

Camera/render-view caution: `RenderViewProps.cameraProps.position` and `.up` are not just plain DTOs in the engine runtime; `view-render.tsx` reads their `x/y/z` fields and also calls `.copy(...)` on them. Therefore any bridge command that writes camera props must either reuse existing in-browser `Vector3` instances from the current render-view state or reconstruct compatible `THREE.Vector3` values before calling renderer-store actions. Do not pass raw JSON `{ x, y, z }` directly into `setRenderViews` or `updateRenderViewCameraProps`.

Do not expose `addExternalGeometry`, `removeExternalGeometry`, `setThreeObjects`, `setGlobalScene`, `setModel`, `setRawMeshes`, or `setMergedGeometries` through MCP.

`pluginsSyncStore`:
- `multiBiteToggle(multiBiteActive)`
- `jawsSelection(allJawsUnselected)`
- `selectedActiveJaw(activeJaw, mode)`
- `reviewToolActive(isActive)`
- `prepActive(selectedPrepId)`
- `setImageSelection(imageId, rotationDegrees?, rotationByQuarters?)`

Do not expose `requestCallForFunction` or `resolveCallForFunction` initially.

`reviewToolStore`:
- Read only for MCP v1. Prefer `pluginsSyncStore.setImageSelection` over refs like `imageContainer`.

`cameraStore`:
- Read only. It is listener/emitter oriented and does not expose camera setters.

## Dispatch Helpers

`update_engine_context` should dispatch:

`{ type: 'UPDATE_ENGINE_CONTEXT', payload: { data: partialEngineContext } }`

Nested objects are replaced, not deep-merged. The bridge or MCP tool must read current context first and merge nested fields like `featuresAvailability`, `UI`, `bizCtx`, and `preset`.

`update_plugin_preset` should dispatch:

`{ type: 'UPDATE_PLUGIN_PRESET', payload: { pluginId, data: partialPluginProps, updateOrigin: 'local' } }`

Use this for generic active state via `isDefaultActive`. Caveat: `isForcedDisabled` is not centralized by `usePlugin`; individual plugins may or may not react uniformly. Document plugin-specific behavior.

## MCP Tool Refactor

Modify `C:\W\Git_Managed\web-3d-engine-mcp\src\index.ts` to register new state/context/plugin/camera-view tools and stop registering direct mutation tools.

Recommended new modules:

- `src/tools/state-tools.ts`
- `src/tools/context-tools.ts`
- `src/tools/plugin-tools.ts`
- `src/tools/camera-view-tools.ts`
- Refactor `src/tools/review-tools.ts` to use `pluginsSyncStore.setImageSelection` and plugin/context state.

### State Tools

- `get_engine_snapshot`: returns engine instance key, context summary, feature flags, plugin presets, render views, model loaded/rendered state, plugin sync state, review tool summary.
- `get_engine_context`: returns `engineStore.getState().engineContext`.
- `get_plugin_presets`: returns `engineContext.preset`.
- `get_render_views`: returns `rendererStore.getState().renderViewProps` serialized.
- `get_plugin_sync_state`: returns selected fields from `pluginsSyncStore` excluding functions and large notification payloads unless requested.

### Context Tools

- `set_feature_flag`: read current `featuresAvailability`, merge one key, dispatch `UPDATE_ENGINE_CONTEXT`.
- `set_feature_flags`: merge multiple keys. Known keys: `useNewJawsNavigation`, `useNewMultiLayers`, `useAssetsSdkCaching`, `showNiriAndIocProgressBar`, `useCanvasImageContainer`, `lazyLoadReviewToolImages`, `isRotationEnabled`.
- `update_engine_context_partial`: restricted partial update for approved paths only. Do not allow arbitrary replacement of `logging`, `security`, or function-valued fields without explicit approval.

### Plugin Tools

- `set_plugin_active`: `UPDATE_PLUGIN_PRESET` with `{ isDefaultActive }`.
- `set_plugin_disabled`: `UPDATE_PLUGIN_PRESET` with `{ isForcedDisabled }`, documented as plugin-dependent.
- `set_plugin_zone`: read current preset, replace matching preset zone, dispatch `UPDATE_ENGINE_CONTEXT` with merged preset.
- `add_or_update_plugin_preset`: read current preset, upsert one preset, dispatch merged preset.
- `remove_plugin_preset`: remove one preset by `component.id`, dispatch merged preset.
- `set_stage_splitter_view`: `UPDATE_PLUGIN_PRESET` for `StageSplitter` with `{ activeView, cameraPositions?, ignoreModels? }`.

### Camera / Rotation / Zoom Tools

Do not recreate current direct camera tools as direct scene mutations.

Replace:
- `focus_camera_to_object`: deprecate for v1 unless implemented as a stateful view preset. Return guidance to use `set_stage_splitter_view` or future engine-owned focus intent.
- `rotate_camera`: replace with preset orientation tools using `CameraPositions`: `Frontal`, `Left-Buccal`, `Right-Buccal`, `Upper-Occlusal`, `Lower-Occlusal`.
- `move_camera`: replace with `set_render_view_camera_props` only if the bridge can construct valid camera props and validation proves the renderer consumes them safely. Otherwise defer.
- `toggle_camera_static`: defer; no stateful public camera static-mode action exists.

Implement:
- `set_stage_camera_positions`: dispatch `UPDATE_PLUGIN_PRESET` for `StageSplitter` with `cameraPositions` and optional `activeView`.
- `set_render_view_camera_props`: allowlisted `rendererStore.getState().updateRenderViewCameraProps(row, col, cameraProps)`, but only after the browser bridge converts incoming JSON vector DTOs into compatible `Vector3` objects or reuses existing `Vector3` instances. Smoke-test this before shipping because the renderer calls `.copy(...)` on `cameraProps.position` and `cameraProps.up`.
- `reset_render_views`: allowlisted `rendererStore.getState().resetRenderViewToDefault(caseType)`.
- `set_render_view_fit_padding`: clone current `renderViewProps` inside the browser bridge (not in the Node MCP process), update `modelPaddingFactor`, then call `setRenderViews`. This preserves in-browser `Vector3` instances. This is the stateful zoom/fit control. It is not arbitrary live camera zoom.
- `set_rotation_enabled`: feature flag command for `featuresAvailability.isRotationEnabled`. This enables review-tool rotation behavior; it does not rotate the Three.js scene.

### Review Tools

Replace direct service calls:
- `select_image` -> `pluginsSyncStore.getState().setImageSelection(imageId, rotationDegrees?, rotationByQuarters?)`.
- `highlight_loupe` and `move_loupe` -> defer unless the engine exposes a stateful loupe intent. Do not call `moveLoupeToPoint` or `highLightLoupe` directly.

### Direct Mutation Tools To Remove Or Mark Unsupported

Remove from registration or return clear unsupported messages:
- `toggle_object_visibility`
- `change_object_color`
- `change_material_props`
- `change_object_transformation`
- `reset_object_transformation`
- `remove_object`
- `create_geometry_in_scene`
- `create_geometry_in_group`
- direct `focus_camera_to_object`, `rotate_camera`, `move_camera`, `toggle_camera_static`
- direct `move_loupe`, `highlight_loupe`

If compatibility aliases are needed, keep tool names but return `isError: true` with a message explaining the state-safe replacement.

## MCP Repo File Plan

Modify:
- `browser-bridge/engine-bridge.js`: replace service binding and command dispatch with `web3dEngineApi` binding and allowlisted commands.
- `src/types/bridge.types.ts`: update comments so `method` means semantic engine API command, not service method. Optionally add command method union types.
- `src/index.ts`: register new tools; stop registering direct mutation modules.
- `src/tools/review-tools.ts`: route image selection through plugin sync store command.
- `plans/web-3d-engine-mcp-plan.md`: update architecture and limitations after code changes.

Add:
- `src/tools/state-tools.ts`
- `src/tools/context-tools.ts`
- `src/tools/plugin-tools.ts`
- `src/tools/camera-view-tools.ts`
- optionally `src/utils/tool-response.ts` for shared MCP text/error responses
- optionally `src/types/engine-api-command.types.ts` for browser command method names and payloads

Deprecate or stop registering:
- `src/tools/visibility-tools.ts`
- `src/tools/material-tools.ts`
- `src/tools/transformation-tools.ts`
- `src/tools/geometry-tools.ts`
- most of `src/tools/camera-tools.ts`

## Browser Integration Change

Current integration:

`window.mcpBridge?.setService(service, eventContainer)`

New integration:

- Preferred: include bridge script after `<web-3d-engine>` is present and call `window.mcpBridge?.setEngineElement(document.querySelector('web-3d-engine'))`.
- Also support passive mode: bridge listens for `web3d-engine-ready` events and binds automatically.
- Keep optional event container for forwarding engine DOM events.

## Validation Checklist

In `C:\W\Git_Managed\web-3d-engine-mcp`:

1. Run `npm run build` and require zero TypeScript errors.
2. Grep regression checks:
   - No browser bridge calls to `service.focusCameraToObject`, `service.cameraManipulation`, `service.changeUniformColor`, `service.changeObjectMaterialProps`, `service.changeModelObjectTransformation`, `service.createAndAddGeometryToScene`, `service.toggleObjectVisibility`, `service.moveLoupeToPoint`.
   - No registered MCP tool uses `relay.execute` with direct service method names.
   - `setService` either removed or kept only as deprecated no-op with a warning.
3. Browser smoke:
   - Load consumer app with updated web engine and bridge.
   - Confirm bridge logs API bind after `web3d-engine-ready`.
   - Confirm `get_engine_snapshot` returns engine context and plugin presets.
   - Confirm `set_feature_flag isRotationEnabled=true` updates `engineStore.getState().engineContext.featuresAvailability`.
   - Confirm `set_plugin_active ReviewTool true` updates the ReviewTool preset props.
   - Confirm `select_image` updates `pluginsSyncStore.selectedImageId`.
   - Confirm remount on `orderId` change clears old API and rebinds a new API.
4. MCP client smoke:
   - Start MCP with `npm run dev` or built `npm start`.
   - Connect browser bridge.
   - Call new state/context/plugin/camera-view tools from an MCP client.
   - Verify no direct Three.js scene mutation occurs outside engine store/context paths.

## Explicit Non-Goals

- No arbitrary material/color mutation in MCP v1.
- No arbitrary object transformation matrices in MCP v1.
- No creating/removing geometry through MCP v1.
- No direct Three.js camera movement or static-mode control unless the web engine first exposes a stateful public intent.
- No direct loupe movement/highlight unless the web engine exposes a stateful public intent.
- No multi-browser-client support beyond existing single-client relay behavior.

## Implementation Order

1. Refactor browser bridge to bind `web3dEngineApi` and add safe command dispatcher.
2. Add state/context tools and verify snapshot + feature flag dispatch.
3. Add plugin tools and verify preset mutations.
4. Add camera-view tools limited to preset/render-view state.
5. Refactor review image selection through `pluginsSyncStore.setImageSelection`.
6. Stop registering direct mutation tools or convert them to explicit unsupported aliases.
7. Update MCP design doc.
8. Run validation checklist.

## Readiness

Plan ready for implementation.

This plan is ready for the MCP repo agent. The main caveats are intentional boundaries: camera/zoom support is stateful preset/render-view control, not live arbitrary camera mutation; review-tool rotation can be enabled via feature flags and image selection rotation fields, but scene rotation must not be implemented by direct Three.js mutation.
