import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketRelay } from '../websocket-relay.js';

function toText(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

export function registerSceneTools(server: McpServer, relay: WebSocketRelay): void {
  server.registerTool(
    'get_scene_objects',
    {
      description:
        'Get all rendered 3D objects in the current scene, organized as a tree. ' +
        'Returns roots, a nodeMap keyed by name, and a typeMap keyed by object type.',
      inputSchema: z.object({}),
    },
    async () => {
      const response = await relay.execute('getAllRenderedModelObjects', {});
      if (response.error) return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      return { content: [{ type: 'text', text: toText(response.result) }] };
    },
  );

  server.registerTool(
    'get_cameras',
    {
      description:
        'Get all cameras in the scene. Returns an array with name, uuid, cameraPosition, and groupRelated for each camera.',
      inputSchema: z.object({}),
    },
    async () => {
      const response = await relay.execute('getCameras', {});
      if (response.error) return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      return { content: [{ type: 'text', text: toText(response.result) }] };
    },
  );

  server.registerTool(
    'get_groups',
    {
      description: 'Get all named groups in the scene. Returns an array of { name, uuid } objects.',
      inputSchema: z.object({}),
    },
    async () => {
      const response = await relay.execute('getGroups', {});
      if (response.error) return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      return { content: [{ type: 'text', text: toText(response.result) }] };
    },
  );

  server.registerTool(
    'get_materials',
    {
      description:
        'Get material properties for all rendered objects. Returns shader uniforms, vertex/fragment shaders, and material types per object UUID.',
      inputSchema: z.object({}),
    },
    async () => {
      const response = await relay.execute('getModelsMaterialsProps', {});
      if (response.error) return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      return { content: [{ type: 'text', text: toText(response.result) }] };
    },
  );

  server.registerTool(
    'get_object_transformation',
    {
      description:
        'Get the current transformation matrix (Matrix4) for an object by UUID. ' +
        'Returns a 16-element array representing the 4×4 matrix, or null if not found.',
      inputSchema: z.object({
        uuid: z.string().describe('UUID of the object to query'),
        index: z.number().optional().describe('Optional index when multiple instances share the UUID'),
      }),
    },
    async ({ uuid, index }) => {
      const response = await relay.execute('getObjectTransformation', { uuid, index });
      if (response.error) return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      return { content: [{ type: 'text', text: toText(response.result) }] };
    },
  );
}
