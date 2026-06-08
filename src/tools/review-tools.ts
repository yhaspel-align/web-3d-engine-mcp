import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketRelay } from '../websocket-relay.js';

function errResponse(msg: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

export function registerReviewTools(server: McpServer, relay: WebSocketRelay): void {
  server.registerTool(
    'select_image',
    {
      description:
        'Select a NIRI image by ID via pluginsSyncStore.setImageSelection. ' +
        'Optionally specify rotation degrees or rotation by quarters.',
      inputSchema: z.object({
        imageId: z.number().int().describe('Numeric ID of the image to select'),
        rotationDegrees: z.number().optional().describe('Rotation in degrees'),
        rotationByQuarters: z.number().int().optional().describe('Rotation by quarter turns (0-3)'),
      }),
    },
    async ({ imageId, rotationDegrees, rotationByQuarters }) => {
      const args: unknown[] = [imageId];
      if (rotationDegrees !== undefined) args.push(rotationDegrees);
      if (rotationByQuarters !== undefined) args.push(rotationByQuarters);
      const r = await relay.execute('call_store_action', {
        store: 'pluginsSyncStore',
        action: 'setImageSelection',
        args,
      });
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: `Image ${imageId} selected` }] };
    },
  );

  server.registerTool(
    'move_loupe',
    {
      description: 'UNSUPPORTED in v1. Direct loupe movement requires a stateful engine intent not yet exposed.',
      inputSchema: z.object({
        position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      }),
    },
    async () => {
      return { content: [{ type: 'text', text: 'move_loupe is not supported in this version. Use select_image for review tool interaction.' }], isError: true };
    },
  );

  server.registerTool(
    'highlight_loupe',
    {
      description: 'UNSUPPORTED in v1. Direct loupe highlight requires a stateful engine intent not yet exposed.',
      inputSchema: z.object({
        isHighlight: z.boolean(),
      }),
    },
    async () => {
      return { content: [{ type: 'text', text: 'highlight_loupe is not supported in this version. Use select_image for review tool interaction.' }], isError: true };
    },
  );
}
