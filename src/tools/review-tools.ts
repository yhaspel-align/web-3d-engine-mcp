import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketRelay } from '../websocket-relay.js';

function toText(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

export function registerReviewTools(server: McpServer, relay: WebSocketRelay): void {
  server.registerTool(
    'move_loupe',
    {
      description:
        'Move the review loupe to a specific 3D point in the scene. ' +
        'The loupe is a magnification/inspection tool used in dental review workflows.',
      inputSchema: z.object({
        position: z
          .object({ x: z.number(), y: z.number(), z: z.number() })
          .describe('3D world-space position to move the loupe to'),
        width: z.number().optional().describe('Width of the loupe in pixels'),
        height: z.number().optional().describe('Height of the loupe in pixels'),
        tolerance: z.number().optional().describe('Positioning tolerance'),
      }),
    },
    async ({ position, width, height, tolerance }) => {
      const response = await relay.execute('moveLoupeToPoint', { position, width, height, tolerance });
      if (response.error) return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      return { content: [{ type: 'text', text: toText(response.result) }] };
    },
  );

  server.registerTool(
    'highlight_loupe',
    {
      description: 'Highlight or un-highlight the review loupe to draw attention to it.',
      inputSchema: z.object({
        isHighlight: z.boolean().describe('true to highlight the loupe, false to remove highlight'),
      }),
    },
    async ({ isHighlight }) => {
      const response = await relay.execute('highLightLoupe', { isHighlight });
      if (response.error) return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      return { content: [{ type: 'text', text: toText(response.result) }] };
    },
  );

  server.registerTool(
    'select_image',
    {
      description: 'Select a specific NIRI (Near Infrared) image by its numeric ID in the review tool.',
      inputSchema: z.object({
        imageId: z.number().int().describe('Numeric ID of the image to select'),
      }),
    },
    async ({ imageId }) => {
      const response = await relay.execute('selectImageById', { imageId });
      if (response.error) return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
      return { content: [{ type: 'text', text: toText(response.result) }] };
    },
  );
}
