/**
 * engine-bridge.js
 *
 * Browser-side WebSocket client that bridges the web-3d-engine-mcp MCP server
 * to an IThreeObjectsService instance running inside this browser page.
 *
 * USAGE — add to your consumer app:
 *
 *   1. Include this script (or bundle it):
 *        <script type="module" src="/engine-bridge.js"></script>
 *
 *   2. Wire up the service in your getThreeService callback:
 *        getThreeObjectsServiceCallback = {
 *          updateThreeObjects(service) {
 *            window.mcpBridge?.setService(service);
 *          }
 *        }
 *
 *   3. Optionally configure the port before the script loads:
 *        window.MCP_BRIDGE_PORT = 3333; // default
 *
 * The bridge automatically reconnects if the WebSocket drops.
 */

(function () {
  const WS_PORT = window.MCP_BRIDGE_PORT ?? 3333;
  const RECONNECT_DELAY_MS = 3000;

  let service = null;
  let ws = null;

  // ------------------------------------------------------------------
  // Serialization helpers — some IThreeObjectsService return values
  // contain Three.js objects, Maps, and functions which can't go over JSON.
  // ------------------------------------------------------------------

  function serializeMatrix4(m) {
    if (!m) return null;
    // THREE.Matrix4 stores elements as a flat 16-element array (column-major)
    return Array.isArray(m.elements) ? Array.from(m.elements) : m;
  }

  function serializeRenderedObjectTree(result) {
    if (!result) return null;
    // Flatten the roots tree into a simplified list — Maps and functions are dropped.
    function flattenNode(node) {
      return {
        name: node.name,
        uuid: node.uuid,
        type: node.type,
        objectType: node.objectType,
        visible: node.visible,
        children: Array.isArray(node.children) ? node.children.map(flattenNode) : [],
      };
    }
    return {
      roots: Array.isArray(result.roots) ? result.roots.map(flattenNode) : [],
    };
  }

  function serializeCamera(cam) {
    return {
      name: cam.name,
      uuid: cam.uuid,
      groupRelated: cam.groupRelated,
      cameraPosition: cam.cameraPosition
        ? {
            position: cam.cameraPosition.position,
            up: cam.cameraPosition.up,
            zoom: cam.cameraPosition.zoom,
          }
        : null,
    };
  }

  function safeSerialize(value) {
    try {
      JSON.stringify(value);
      return value;
    } catch {
      return String(value);
    }
  }

  // ------------------------------------------------------------------
  // Command dispatch — maps method names to IThreeObjectsService calls
  // ------------------------------------------------------------------

  async function dispatch(method, params) {
    if (!service) throw new Error('IThreeObjectsService not yet available. Call window.mcpBridge.setService(service) first.');

    switch (method) {
      // ---- Scene queries ----
      case 'getAllRenderedModelObjects': {
        const result = service.getAllRenderedModelObjects();
        return serializeRenderedObjectTree(result);
      }
      case 'getCameras': {
        const cameras = service.getCameras();
        return cameras.map(serializeCamera);
      }
      case 'getGroups':
        return service.getGroups();
      case 'getModelsMaterialsProps':
        return service.getModelsMaterialsProps();
      case 'getObjectTransformation': {
        const matrix = service.getObjectTransformation(params.uuid, params.index);
        return serializeMatrix4(matrix);
      }

      // ---- Camera ----
      case 'focusCameraToObject':
        return service.focusCameraToObject(params);
      case 'rotateCameraByDegreeAxis':
        return service.rotateCameraByDegreeAxis(params.axis, params.cameraUUID, params.degree);
      case 'cameraManipulation':
        return service.cameraManipulation(params.cameraPosition, params.cameraUUID);
      case 'toggleCameraStaticMode':
        return service.toggleCameraStaticMode(params.isStaticMode, params.cameraUUID);

      // ---- Visibility ----
      case 'toggleObjectVisibility':
        return service.toggleObjectVisibility(params);

      // ---- Material / color ----
      case 'changeUniformColor':
        return service.changeUniformColor(params);
      case 'changeObjectMaterialProps':
        return service.changeObjectMaterialProps(params);

      // ---- Transformation ----
      case 'changeModelObjectTransformation':
        return service.changeModelObjectTransformation(params);
      case 'resetModelObjectTransformation':
        return service.resetModelObjectTransformation(params.uuid);

      // ---- Geometry ----
      case 'removeObjectBy':
        return service.removeObjectBy(params);
      case 'createAndAddGeometryToScene':
        return service.createAndAddGeometryToScene(params);
      case 'createAndAddGeometryToGroup':
        return service.createAndAddGeometryToGroup(params);

      // ---- Review / loupe ----
      case 'moveLoupeToPoint':
        return service.moveLoupeToPoint(
          params.position,
          params.isWaitForReady,
          params.tolerance,
          params.width,
          params.height,
        );
      case 'highLightLoupe':
        return service.highLightLoupe(params.isHighlight, params.isWaitForReady);
      case 'selectImageById':
        return service.selectImageById(params.imageId, params.isWaitForReady);

      default:
        throw new Error(`Unknown method: "${method}"`);
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
      try {
        command = JSON.parse(event.data);
      } catch {
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
  // Engine event forwarding (optional — forward EngineEventsEnum events)
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
          ws.send(JSON.stringify({
            type: 'engine-event',
            eventName,
            detail: safeSerialize(e.detail),
          }));
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // Public API exposed on window.mcpBridge
  // ------------------------------------------------------------------

  window.mcpBridge = {
    /**
     * Call this once you have the IThreeObjectsService instance.
     * Typically inside your ThreeObjectsAdapter.updateThreeObjects callback.
     *
     * @param {IThreeObjectsService} threeObjectsService
     * @param {HTMLElement} [eventContainer] - element that emits engine events (optional)
     */
    setService(threeObjectsService, eventContainer) {
      service = threeObjectsService;
      console.log('[engine-bridge] IThreeObjectsService registered');
      if (eventContainer) {
        forwardEngineEvents(eventContainer);
      }
    },
  };

  // Start connecting immediately
  connect();
})();
