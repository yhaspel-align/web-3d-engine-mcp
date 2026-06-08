/**
 * engine-bridge.js
 *
 * Browser-side WebSocket client that bridges the web-3d-engine-mcp MCP server
 * to a <web-3d-engine> element's web3dEngineApi.
 *
 * USAGE:
 *   1. Include this script after the <web-3d-engine> element is present:
 *        <script type="module" src="/engine-bridge.js"></script>
 *
 *   2. The bridge auto-binds via `web3d-engine-ready` event, OR call explicitly:
 *        window.mcpBridge.setEngineElement(document.querySelector('web-3d-engine'));
 *
 *   3. Optionally configure the port before the script loads:
 *        window.MCP_BRIDGE_PORT = 3333; // default
 */

(function () {
  const WS_PORT = window.MCP_BRIDGE_PORT ?? 3333;
  const RECONNECT_DELAY_MS = 3000;

  let engineApi = null;
  let initialDispatch = null;
  let ws = null;
  let apiReadyResolve = null;
  let apiReadyPromise = newApiReadyPromise();
  let refreshContextFn = null;

  function newApiReadyPromise() {
    return new Promise((resolve) => { apiReadyResolve = resolve; });
  }

  // ------------------------------------------------------------------
  // API Binding
  // ------------------------------------------------------------------

  function bindApi(api) {
    engineApi = api;
    initialDispatch = api.stores.engineStore.getState().dispatchEngineContextUpdate;
    console.log('[engine-bridge] web3dEngineApi bound');
    if (apiReadyResolve) apiReadyResolve();
  }

  function unbindApi() {
    engineApi = null;
    initialDispatch = null;
    apiReadyPromise = newApiReadyPromise();
    console.log('[engine-bridge] web3dEngineApi unbound');
  }

  // Listen for web component lifecycle
  document.addEventListener('web3d-engine-ready', (e) => {
    if (e.detail) bindApi(e.detail);
  });

  document.addEventListener('web3d-engine-destroyed', (e) => {
    if (engineApi && e.detail === engineApi) unbindApi();
  });

  // ------------------------------------------------------------------
  // Readiness guards
  // ------------------------------------------------------------------

  async function waitForApi() {
    if (engineApi) return;
    await apiReadyPromise;
  }

  async function waitForDispatchReady() {
    await waitForApi();
    if (engineApi.stores.engineStore.getState().dispatchEngineContextUpdate !== initialDispatch &&
        engineApi.stores.engineStore.getState().engineContext) {
      return;
    }
    return new Promise((resolve) => {
      const unsub = engineApi.stores.engineStore.subscribe((state) => {
        if (state.dispatchEngineContextUpdate !== initialDispatch && state.engineContext) {
          unsub();
          resolve();
        }
      });
    });
  }

  async function waitForModelLoaded() {
    await waitForDispatchReady();
    if (engineApi.stores.engineStore.getState().isModelLoaded) return;
    return new Promise((resolve) => {
      const unsub = engineApi.stores.engineStore.subscribe((state) => {
        if (state.isModelLoaded) { unsub(); resolve(); }
      });
    });
  }

  // ------------------------------------------------------------------
  // Serialization helpers
  // ------------------------------------------------------------------

  function safeSerialize(value) {
    try { JSON.stringify(value); return value; } catch { return String(value); }
  }

  function serializeRenderViews(rvProps) {
    if (!rvProps) return null;
    return JSON.parse(JSON.stringify(rvProps, (key, val) => {
      if (val && typeof val === 'object' && ('x' in val) && ('y' in val) && ('z' in val)) {
        return { x: val.x, y: val.y, z: val.z };
      }
      if (typeof val === 'function') return undefined;
      return val;
    }));
  }

  function stripFunctions(obj) {
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(obj, (_, v) => {
      if (typeof v === 'function') return undefined;
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    }));
  }

  // ------------------------------------------------------------------
  // Store Action Allowlist
  // ------------------------------------------------------------------

  const STORE_ACTION_ALLOWLIST = {
    rendererStore: [
      'setRenderViews', 'resetRenderViewToDefault', 'updateRenderViewCameraProps', 'setModelVisible',
    ],
    pluginsSyncStore: [
      'multiBiteToggle', 'jawsSelection', 'selectedActiveJaw', 'reviewToolActive',
      'prepActive', 'setImageSelection',
    ],
  };

  // ------------------------------------------------------------------
  // Manual state tracking — persisted across Angular preset resets
  // ------------------------------------------------------------------

  // { row, col, posProps: { position, up } } — set by rotate_camera_to_jaw_view
  let lastManualCamera = null;
  // { upper_jaw: bool, lower_jaw: bool } — set by update_plugin_preset(JawsNavigation)
  let lastManualJawState = null;

  function reapplyManualCamera() {
    if (!lastManualCamera || !engineApi) return;
    const { row, col, posProps } = lastManualCamera;
    const state = engineApi.stores.rendererStore.getState();
    if (!state.renderViewProps?.[row]?.[col]) return;
    state.updateRenderViewCameraProps(row, col, {
      position: toVector3(posProps.position),
      up: toVector3(posProps.up),
    });
    const globalScene = state.globalScene;
    if (!globalScene) return;
    const maps = globalScene.getRebuildRenderedModelsMaps?.();
    if (!maps) return;
    const cameraRecords = maps.typeMap.get('OrthographicCamera') ?? [];
    const idx = row * (state.renderViewProps[0]?.length ?? 1) + col;
    const camRecord = cameraRecords[idx] ?? cameraRecords[0];
    if (!camRecord) return;
    const camera = camRecord.object3D;
    camera.position.set(posProps.position.x, posProps.position.y, posProps.position.z);
    camera.up.set(posProps.up.x, posProps.up.y, posProps.up.z);
    camera.updateProjectionMatrix();
    const { controls, callZoomCameraTo } = camera.userData ?? {};
    if (controls) {
      controls.dispatchEvent?.({ type: 'change' });
      controls.dispatchEvent?.({ type: 'end' });
    }
    if (callZoomCameraTo) callZoomCameraTo({});
  }

  // ------------------------------------------------------------------
  // Vector3 reconstruction for camera props
  // ------------------------------------------------------------------

  function toVector3(obj) {
    if (!obj) return obj;
    if (typeof window.THREE !== 'undefined' && window.THREE.Vector3) {
      return new window.THREE.Vector3(obj.x, obj.y, obj.z);
    }
    // Fallback: plain object with copy method for compatibility
    return { x: obj.x, y: obj.y, z: obj.z, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } };
  }

  // ------------------------------------------------------------------
  // Command dispatch
  // ------------------------------------------------------------------

  async function dispatch(method, params) {
    switch (method) {
      // ---- State reads ----
      case 'get_engine_snapshot': {
        await waitForDispatchReady();
        const es = engineApi.stores.engineStore.getState();
        const rs = engineApi.stores.rendererStore.getState();
        const ps = engineApi.stores.pluginsSyncStore.getState();
        return {
          isModelLoaded: es.isModelLoaded,
          engineContext: stripFunctions(es.engineContext ?? {}),
          featureFlags: es.engineContext?.featuresAvailability ?? {},
          pluginPresets: es.engineContext?.preset ?? [],
          renderViews: serializeRenderViews(rs.renderViewProps),
          pluginSyncState: stripFunctions({
            multiBiteActive: ps.multiBiteActive,
            allJawsUnselected: ps.allJawsUnselected,
            activeJaw: ps.activeJaw,
            isReviewToolActive: ps.isReviewToolActive,
            selectedPrepId: ps.selectedPrepId,
            selectedImageId: ps.selectedImageId,
          }),
        };
      }

      case 'get_engine_context': {
        await waitForDispatchReady();
        return stripFunctions(engineApi.stores.engineStore.getState().engineContext ?? {});
      }

      case 'get_plugin_presets': {
        await waitForDispatchReady();
        const raw = engineApi.stores.engineStore.getState().engineContext?.preset ?? [];
        // Serialize only safe scalar/plain-object props — skip anything referencing DOM/Angular internals
        function safeProps(obj, depth) {
          if (depth > 4 || obj === null || obj === undefined) return obj;
          if (Array.isArray(obj)) return obj.map(i => safeProps(i, depth + 1));
          if (typeof obj === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
              if (k.startsWith('__zone') || k.startsWith('__ngContext') || k.startsWith('__reactContainer')) continue;
              if (v && typeof v === 'object' && (v instanceof Node || v instanceof EventTarget)) continue;
              out[k] = safeProps(v, depth + 1);
            }
            return out;
          }
          return obj;
        }
        return raw.map(p => ({
          zone: p.zone,
          component: p.component,
          isExternalPlugin: p.isExternalPlugin ?? false,
          props: safeProps(p.props ?? {}, 0),
        }));
      }

      case 'get_feature_flags': {
        await waitForDispatchReady();
        return engineApi.stores.engineStore.getState().engineContext?.featuresAvailability ?? {};
      }

      case 'get_render_views': {
        await waitForApi();
        return serializeRenderViews(engineApi.stores.rendererStore.getState().renderViewProps);
      }

      case 'get_jaw_navigation_state': {
        await waitForDispatchReady();
        const preset = engineApi.stores.engineStore.getState().engineContext?.preset ?? [];
        const jawsPreset = preset.find(p => p.component?.id === 'JawsNavigation');
        const props = jawsPreset?.props ?? {};
        const ps = engineApi.stores.pluginsSyncStore.getState();
        const upperJaw = props.upper_jaw;
        const lowerJaw = props.lower_jaw;
        return {
          upper_jaw_visible: typeof upperJaw === 'object' ? (upperJaw?.selected ?? true) : (upperJaw ?? true),
          lower_jaw_visible: typeof lowerJaw === 'object' ? (lowerJaw?.selected ?? true) : (lowerJaw ?? true),
          activeJaw: ps.activeJaw ?? null,
          allJawsUnselected: ps.allJawsUnselected ?? false,
        };
      }

      case 'get_plugin_sync_state': {
        await waitForApi();
        const ps = engineApi.stores.pluginsSyncStore.getState();
        return stripFunctions({
          multiBiteActive: ps.multiBiteActive,
          allJawsUnselected: ps.allJawsUnselected,
          activeJaw: ps.activeJaw,
          isReviewToolActive: ps.isReviewToolActive,
          selectedPrepId: ps.selectedPrepId,
          selectedImageId: ps.selectedImageId,
        });
      }

      case 'get_review_tool_state': {
        await waitForApi();
        if (!engineApi.stores.reviewToolStore) return null;
        return stripFunctions(engineApi.stores.reviewToolStore.getState());
      }

      // ---- Dispatch actions ----
      case 'dispatch_engine_action': {
        await waitForDispatchReady();
        engineApi.dispatch(params.action);
        return { success: true };
      }

      case 'update_engine_context': {
        await waitForDispatchReady();
        engineApi.dispatch({ type: 'UPDATE_ENGINE_CONTEXT', payload: { data: params.data } });
        return { success: true };
      }

      case 'update_plugin_preset': {
        await waitForDispatchReady();
        const { pluginId, data } = params;
        if (pluginId === 'JawsNavigation') {
          lastManualJawState = lastManualJawState ?? {};
          if (data.upper_jaw !== undefined) lastManualJawState.upper_jaw = data.upper_jaw;
          if (data.lower_jaw !== undefined) lastManualJawState.lower_jaw = data.lower_jaw;
        }
        engineApi.dispatch({
          type: 'UPDATE_PLUGIN_PRESET',
          payload: { pluginId, data, updateOrigin: 'local' },
        });
        return { success: true };
      }

      // ---- Allowlisted store actions ----
      case 'call_store_action': {
        await waitForDispatchReady();
        const { store, action, args } = params;
        const allowed = STORE_ACTION_ALLOWLIST[store];
        if (!allowed || !allowed.includes(action)) {
          throw new Error(`Action "${store}.${action}" is not allowlisted`);
        }
        const storeInstance = engineApi.stores[store];
        if (!storeInstance) throw new Error(`Store "${store}" not found`);
        const state = storeInstance.getState();
        if (typeof state[action] !== 'function') throw new Error(`"${action}" is not a function on ${store}`);

        // Special handling for camera props - reconstruct Vector3
        if (store === 'rendererStore' && action === 'updateRenderViewCameraProps') {
          const [row, col, cameraProps] = args;
          const converted = { ...cameraProps };
          if (cameraProps.position) converted.position = toVector3(cameraProps.position);
          if (cameraProps.up) converted.up = toVector3(cameraProps.up);
          return safeSerialize(state[action](row, col, converted));
        }

        if (store === 'rendererStore' && action === 'setRenderViews') {
          // Reconstruct Vector3 instances in renderViewProps
          const rvp = args[0];
          if (rvp && Array.isArray(rvp.views)) {
            rvp.views = rvp.views.map(row => row.map(view => {
              if (view.cameraProps) {
                if (view.cameraProps.position) view.cameraProps.position = toVector3(view.cameraProps.position);
                if (view.cameraProps.up) view.cameraProps.up = toVector3(view.cameraProps.up);
              }
              return view;
            }));
          }
          return safeSerialize(state[action](rvp));
        }

        return safeSerialize(state[action](...(args || [])));
      }

      // ---- Angular context refresh (for Angular-owned [engineContext] binding) ----
      case 'refresh_engine_context': {
        if (!refreshContextFn) throw new Error('refreshContext not registered. Call window.mcpBridge.setRefreshContext(fn) from Angular ngOnInit.');

        const _logJawAndRV = (label) => {
          const preset = engineApi?.stores?.engineStore?.getState()?.engineContext?.preset ?? [];
          const jawProps = preset.find(p => p.component?.id === 'JawsNavigation')?.props;
          const rv = engineApi?.stores?.rendererStore?.getState()?.renderViewProps;
          const jawVis = rv?.[0]?.[0]?.jawsVisibility;
          console.log(`[MCP-bridge] ${label} | overrides: ${JSON.stringify(params.overrides)} | jaws.lower_jaw.selected: ${jawProps?.lower_jaw?.selected} | rv[0][0].jawsVisibility.lowerJaw: ${jawVis?.lowerJaw}`);
        };

        _logJawAndRV('BEFORE');
        refreshContextFn(params.overrides ?? null);
        requestAnimationFrame(() => {
          _logJawAndRV('AFTER 1rAF');
          setTimeout(() => _logJawAndRV('AFTER 300ms'), 300);
          setTimeout(() => _logJawAndRV('AFTER 1000ms'), 1000);
        });

        return { success: true };
      }

      // ---- Direct camera rotation via Three.js scene objects ----
      case 'rotate_camera_to_jaw_view': {
        await waitForModelLoaded();
        const { jaw, cameraPosition } = params;

        const globalScene = engineApi.stores.rendererStore.getState().globalScene;
        if (!globalScene) throw new Error('globalScene not available');

        const engineContext = engineApi.stores.engineStore.getState().engineContext;
        const caseType = ((engineContext?.bizCtx?.caseType) ?? 'ortho').toLowerCase();

        // Static camera position table — sourced from camera.utils.ts
        const CAMERA_POSITIONS = {
          ortho: {
            'Lower-Occlusal': { position: { x: 0, y: 0, z: 200 },  up: { x: 0, y: -1, z: 0 } },
            'Upper-Occlusal': { position: { x: 0, y: 0, z: -200 }, up: { x: 0, y: 1,  z: 0 } },
            'Frontal':        { position: { x: 0, y: 200, z: 0 },   up: { x: 0, y: 0,  z: 1 } },
            'Left-Buccal':    { position: { x: -100, y: 100, z: 0 }, up: { x: 0, y: 0, z: 1 } },
            'Right-Buccal':   { position: { x: 100,  y: 100, z: 0 }, up: { x: 0, y: 0, z: 1 } },
          },
          resto: {
            'Lower-Occlusal': { position: { x: 0, y: 0,   z: 200 },  up: { x: 0, y: 1,  z: 0 } },
            'Upper-Occlusal': { position: { x: 0, y: 50,  z: -200 }, up: { x: 0, y: -1, z: 0 } },
            'Frontal':        { position: { x: 0, y: -200, z: 0 },   up: { x: 0, y: 0,  z: 1 } },
            'Left-Buccal':    { position: { x: 100,  y: 0, z: 0 },   up: { x: 0, y: 0,  z: 1 } },
            'Right-Buccal':   { position: { x: -100, y: 0, z: 0 },   up: { x: 0, y: 0,  z: 1 } },
          },
        };

        const posTable = CAMERA_POSITIONS[caseType] ?? CAMERA_POSITIONS.ortho;
        const posProps = posTable[cameraPosition];
        if (!posProps) throw new Error(`Unknown cameraPosition "${cameraPosition}". Valid: ${Object.keys(posTable).join(', ')}`);

        // Find the camera slot associated with the requested jaw
        const maps = globalScene.getRebuildRenderedModelsMaps?.();
        if (!maps) throw new Error('getRebuildRenderedModelsMaps not available on scene');

        const cameraRecords = maps.typeMap.get('OrthographicCamera') ?? [];
        let camera = null;
        let cameraIdx = 0;
        for (let i = 0; i < cameraRecords.length; i++) {
          const cam = cameraRecords[i].object3D;
          const hasJaw = cam.parent?.children?.some(
            child => child.isGroup && child.name === jaw
          );
          if (hasJaw) { camera = cam; cameraIdx = i; break; }
        }

        if (!camera) {
          // Fallback: try any active camera if only one view
          if (cameraRecords.length === 1) { camera = cameraRecords[0].object3D; cameraIdx = 0; }
          else throw new Error(`Camera for jaw "${jaw}" not found in scene`);
        }

        // Apply target position and up
        camera.position.set(posProps.position.x, posProps.position.y, posProps.position.z);
        camera.up.set(posProps.up.x, posProps.up.y, posProps.up.z);
        camera.updateProjectionMatrix();

        // Notify controls of the change (no active manipulation — just a position snap)
        const { controls, callZoomCameraTo } = camera.userData ?? {};
        if (controls) {
          controls.dispatchEvent?.({ type: 'change' });
          controls.dispatchEvent?.({ type: 'end' });
        }

        // callZoomCameraTo → camera.lookAt(modelCenter) + sets orbit center + optimal zoom + invalidate
        if (callZoomCameraTo) {
          callZoomCameraTo({});
        }

        // Persist camera position to renderViewProps and remember it for future preset resets
        const rvp = engineApi.stores.rendererStore.getState().renderViewProps;
        if (rvp && rvp.length > 0) {
          const cols = rvp[0]?.length ?? 1;
          const row = Math.floor(cameraIdx / cols);
          const col = cameraIdx % cols;
          if (rvp[row]?.[col]) {
            engineApi.stores.rendererStore.getState().updateRenderViewCameraProps(row, col, {
              position: toVector3(posProps.position),
              up: toVector3(posProps.up),
            });
            lastManualCamera = { row, col, posProps };
          }
        }

        return { success: true, jaw, cameraPosition, caseType };
      }

      default:
        throw new Error(`Unknown command: "${method}"`);
    }
  }

  // ------------------------------------------------------------------
  // WebSocket lifecycle
  // ------------------------------------------------------------------

  function connect() {
    ws = new WebSocket(`ws://localhost:${WS_PORT}`);

    ws.addEventListener('open', () => {
      console.log('[engine-bridge] Connected to MCP WebSocket relay');
    });

    ws.addEventListener('message', async (event) => {
      let command;
      try { command = JSON.parse(event.data); } catch {
        console.error('[engine-bridge] Malformed command:', event.data);
        return;
      }

      const { id, method, params } = command;
      let response;
      try {
        const result = await dispatch(method, params ?? {});
        response = { id, result: safeSerialize(result) };
      } catch (err) {
        response = { id, error: err instanceof Error ? err.message : String(err) };
      }
      ws.send(JSON.stringify(response));
    });

    ws.addEventListener('close', () => {
      console.warn(`[engine-bridge] Disconnected. Reconnecting in ${RECONNECT_DELAY_MS}ms…`);
      setTimeout(connect, RECONNECT_DELAY_MS);
    });

    ws.addEventListener('error', (err) => {
      console.error('[engine-bridge] WebSocket error:', err);
    });
  }

  // ------------------------------------------------------------------
  // Engine event forwarding
  // ------------------------------------------------------------------

  function forwardEngineEvents(container) {
    const engineEvents = [
      'app-loaded', 'itr-loaded', 'niri-loaded',
      'camera-move', 'camera-stopped',
      'bi-log-event', 'context-update', 'model-rendered',
      'rotation-preference-changed',
      'itr-loading-progress', 'niri-loading-progress',
    ];
    engineEvents.forEach((eventName) => {
      container.addEventListener(eventName, (e) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'engine-event', eventName, detail: safeSerialize(e.detail) }));
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  window.mcpBridge = {
    setEngineElement(elementOrSelector) {
      const el = typeof elementOrSelector === 'string'
        ? document.querySelector(elementOrSelector)
        : elementOrSelector;
      if (!el) { console.error('[engine-bridge] Element not found'); return; }
      if (el.web3dEngineApi) {
        bindApi(el.web3dEngineApi);
      } else {
        el.addEventListener('web3d-engine-ready', (e) => { if (e.detail) bindApi(e.detail); }, { once: true });
      }
      forwardEngineEvents(el);
    },

    /**
     * Register the Angular component's generateEngineContext(overrides) function.
     * Call this from Angular's ngOnInit so the bridge can drive jaw / preset changes
     * through Angular's [engineContext] binding rather than bypassing it.
     *
     * @param {function} fn - (overrides: Record<string, Record<string, unknown> | null> | null) => void
     */
    setRefreshContext(fn) {
      refreshContextFn = fn;
      console.log('[engine-bridge] refreshContext registered');
    },

    /** @deprecated Use setEngineElement instead */
    setService(_service, eventContainer) {
      console.warn('[engine-bridge] setService is deprecated. Use setEngineElement(element) instead.');
      if (eventContainer) forwardEngineEvents(eventContainer);
    },
  };

  connect();
})();
