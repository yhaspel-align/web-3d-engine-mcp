import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketRelay } from '../websocket-relay.js';

function toText(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

function errResponse(msg: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

export function registerStateTools(server: McpServer, relay: WebSocketRelay): void {
  server.registerTool(
    'get_engine_snapshot',
    {
      description:
        'Get a full engine state snapshot including context summary, feature flags, plugin presets, render views, model loaded state, and plugin sync state.',
      inputSchema: z.object({}),
    },
    async () => {
      const r = await relay.execute('get_engine_snapshot', {});
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: toText(r.result) }] };
    },
  );

  server.registerTool(
    'get_engine_context',
    {
      description: 'Get the current engineContext object from the engine store.',
      inputSchema: z.object({}),
    },
    async () => {
      const r = await relay.execute('get_engine_context', {});
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: toText(r.result) }] };
    },
  );

  server.registerTool(
    'get_plugin_presets',
    {
      description: 'Get the plugin presets array from engineContext.preset.',
      inputSchema: z.object({}),
    },
    async () => {
      const r = await relay.execute('get_plugin_presets', {});
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: toText(r.result) }] };
    },
  );

  server.registerTool(
    'get_render_views',
    {
      description: 'Get the current render view properties from the renderer store (camera positions, padding, etc.).',
      inputSchema: z.object({}),
    },
    async () => {
      const r = await relay.execute('get_render_views', {});
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: toText(r.result) }] };
    },
  );

  server.registerTool(
    'get_plugin_sync_state',
    {
      description: 'Get the current plugin sync store state (multibite, jaws, review tool, image selection).',
      inputSchema: z.object({}),
    },
    async () => {
      const r = await relay.execute('get_plugin_sync_state', {});
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: toText(r.result) }] };
    },
  );

  server.registerTool(
    'get_jaw_navigation_state',
    {
      description:
        'Get the current jaw visibility state from the JawsNavigation plugin preset. ' +
        'Returns upper_jaw and lower_jaw booleans (true = visible) and activeJaw (which jaw has camera focus). ' +
        'This is the authoritative source for jaw visibility — more reliable than get_render_views.jawsVisibility.',
      inputSchema: z.object({}),
    },
    async () => {
      const r = await relay.execute('get_jaw_navigation_state', {});
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: toText(r.result) }] };
    },
  );
}
