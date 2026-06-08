import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WebSocketRelay } from '../websocket-relay.js';

function toText(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

function errResponse(msg: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

export function registerPluginTools(server: McpServer, relay: WebSocketRelay): void {
  server.registerTool(
    'set_jaw_navigation',
    {
      description:
        'Toggle jaws on or off in the JawsNavigation plugin, exactly mimicking a user click on the jaw selector. ' +
        'Dispatches UPDATE_PLUGIN_PRESET for JawsNavigation — safe to call without reading or replacing the full preset array.',
      inputSchema: z.object({
        upper_jaw: z.boolean().optional().describe('Whether the upper jaw should be selected (visible)'),
        lower_jaw: z.boolean().optional().describe('Whether the lower jaw should be selected (visible)'),
        cameraPosition: z.string().optional().describe('Camera position name to use (default: "Frontal")'),
      }),
    },
    async ({ upper_jaw, lower_jaw, cameraPosition = 'Frontal' }) => {
      const overrides: Record<string, Record<string, unknown>> = {};
      if (upper_jaw !== undefined) overrides['JawsNavigation'] = { ...(overrides['JawsNavigation'] ?? {}), upper_jaw: { cameraPosition, selected: upper_jaw } };
      if (lower_jaw !== undefined) overrides['JawsNavigation'] = { ...(overrides['JawsNavigation'] ?? {}), lower_jaw: { cameraPosition, selected: lower_jaw } };
      if (Object.keys(overrides).length === 0) return errResponse('Provide at least one of upper_jaw or lower_jaw');
      const r = await relay.execute('refresh_engine_context', { overrides });
      if (r.error) return errResponse(r.error);
      const parts = [];
      if (upper_jaw !== undefined) parts.push(`upper_jaw: ${upper_jaw}`);
      if (lower_jaw !== undefined) parts.push(`lower_jaw: ${lower_jaw}`);
      return { content: [{ type: 'text', text: `JawsNavigation updated — ${parts.join(', ')}` }] };
    },
  );

  server.registerTool(
    'set_plugin_props',
    {
      description:
        'Merge props into any plugin preset via the Angular generateEngineContext(overrides) path. ' +
        'Safe — only the specified props are deep-merged into the target plugin; the rest of the preset is unchanged. ' +
        'Known plugin IDs: ReviewTool, JawsNavigation, StageSplitter, OcclusalClearance, stone-model. ' +
        'ReviewTool props: isDefaultActive, isNiriDefaultActive, isIocDefaultActive, isForcedDisabled, isNiriDisabled, isIocDisabled, isNiriHidden, isIocHidden.',
      inputSchema: z.object({
        pluginId: z.string().describe('Plugin component.id (e.g. ReviewTool, StageSplitter)'),
        props: z.record(z.string(), z.unknown()).describe('Props to deep-merge into the plugin preset'),
      }),
    },
    async ({ pluginId, props }) => {
      const r = await relay.execute('refresh_engine_context', { overrides: { [pluginId]: props } });
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: `Plugin "${pluginId}" props updated: ${JSON.stringify(props)}` }] };
    },
  );

  server.registerTool(
    'set_plugin_active',
    {
      description: 'Activate or deactivate a plugin via UPDATE_PLUGIN_PRESET with isDefaultActive.',
      inputSchema: z.object({
        pluginId: z.string().describe('Plugin identifier (e.g. ReviewTool, StageSplitter)'),
        active: z.boolean().describe('Whether the plugin should be active'),
      }),
    },
    async ({ pluginId, active }) => {
      const r = await relay.execute('refresh_engine_context', { overrides: { [pluginId]: { isDefaultActive: active } } });
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: `Plugin "${pluginId}" active set to ${active}` }] };
    },
  );

  server.registerTool(
    'set_plugin_disabled',
    {
      description:
        'Force-disable a plugin via UPDATE_PLUGIN_PRESET with isForcedDisabled. ' +
        'Note: behavior is plugin-dependent; not all plugins react uniformly.',
      inputSchema: z.object({
        pluginId: z.string().describe('Plugin identifier'),
        disabled: z.boolean().describe('Whether the plugin should be force-disabled'),
      }),
    },
    async ({ pluginId, disabled }) => {
      const r = await relay.execute('refresh_engine_context', { overrides: { [pluginId]: { isForcedDisabled: disabled } } });
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: `Plugin "${pluginId}" forcedDisabled set to ${disabled}` }] };
    },
  );

  server.registerTool(
    'set_plugin_zone',
    {
      description: 'Replace a plugin zone preset by component.id in engineContext.preset array.',
      inputSchema: z.object({
        componentId: z.string().describe('The component.id of the preset zone to replace'),
        zoneData: z.record(z.string(), z.unknown()).describe('New zone data to merge into the preset entry'),
      }),
    },
    async ({ componentId, zoneData }) => {
      const ctx = await relay.execute('get_engine_context', {});
      if (ctx.error) return errResponse(ctx.error);
      const current = ctx.result as Record<string, unknown>;
      const presets = [...((current.preset as unknown[]) ?? [])];
      const idx = presets.findIndex((p: unknown) => ((p as Record<string, Record<string, unknown>>)?.component)?.id === componentId);
      if (idx === -1) return errResponse(`Preset with component.id "${componentId}" not found`);
      presets[idx] = { ...(presets[idx] as object), ...zoneData };
      const r = await relay.execute('update_engine_context', { data: { preset: presets } });
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: `Plugin zone "${componentId}" updated` }] };
    },
  );

  server.registerTool(
    'add_or_update_plugin_preset',
    {
      description: 'Upsert a plugin preset entry by component.id in engineContext.preset array.',
      inputSchema: z.object({
        componentId: z.string().describe('The component.id to match or create'),
        presetData: z.record(z.string(), z.unknown()).describe('Full preset object (must include component.id)'),
      }),
    },
    async ({ componentId, presetData }) => {
      const ctx = await relay.execute('get_engine_context', {});
      if (ctx.error) return errResponse(ctx.error);
      const current = ctx.result as Record<string, unknown>;
      const presets = [...((current.preset as unknown[]) ?? [])];
      const idx = presets.findIndex((p: unknown) => ((p as Record<string, Record<string, unknown>>)?.component)?.id === componentId);
      if (idx >= 0) { presets[idx] = presetData; } else { presets.push(presetData); }
      const r = await relay.execute('update_engine_context', { data: { preset: presets } });
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: `Plugin preset "${componentId}" ${idx >= 0 ? 'updated' : 'added'}` }] };
    },
  );

  server.registerTool(
    'remove_plugin_preset',
    {
      description: 'Remove a plugin preset entry by component.id from engineContext.preset array.',
      inputSchema: z.object({
        componentId: z.string().describe('The component.id to remove'),
      }),
    },
    async ({ componentId }) => {
      const ctx = await relay.execute('get_engine_context', {});
      if (ctx.error) return errResponse(ctx.error);
      const current = ctx.result as Record<string, unknown>;
      const presets = ((current.preset as unknown[]) ?? []).filter(
        (p: unknown) => ((p as Record<string, Record<string, unknown>>)?.component)?.id !== componentId,
      );
      const r = await relay.execute('update_engine_context', { data: { preset: presets } });
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: `Plugin preset "${componentId}" removed` }] };
    },
  );

  server.registerTool(
    'set_stage_splitter_view',
    {
      description:
        'Update the StageSplitter plugin preset with activeView and optional cameraPositions/ignoreModels.',
      inputSchema: z.object({
        activeView: z.string().describe('Active view name'),
        cameraPositions: z.record(z.string(), z.unknown()).optional().describe('Camera positions map'),
        ignoreModels: z.array(z.string()).optional().describe('Model names to ignore'),
      }),
    },
    async ({ activeView, cameraPositions, ignoreModels }) => {
      const props: Record<string, unknown> = { activeView };
      if (cameraPositions !== undefined) props.cameraPositions = cameraPositions;
      if (ignoreModels !== undefined) props.ignoreModels = ignoreModels;
      const r = await relay.execute('refresh_engine_context', { overrides: { StageSplitter: props } });
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: `StageSplitter view set to "${activeView}"` }] };
    },
  );

  server.registerTool(
    'set_active_jaw',
    {
      description:
        'Set the active jaw in the jaw selector. ' +
        'Pass jaw="upper_jaw" or jaw="lower_jaw" to select that jaw, ' +
        'or jaw=null / omit to unselect all jaws (allJawsUnselected).',
      inputSchema: z.object({
        jaw: z
          .enum(['upper_jaw', 'lower_jaw'])
          .nullable()
          .optional()
          .describe('Jaw to activate: "upper_jaw", "lower_jaw", or null to unselect all'),
      }),
    },
    async ({ jaw }) => {
      let r;
      if (jaw == null) {
        r = await relay.execute('call_store_action', {
          store: 'pluginsSyncStore',
          action: 'jawsSelection',
          args: [true],
        });
      } else {
        r = await relay.execute('call_store_action', {
          store: 'pluginsSyncStore',
          action: 'selectedActiveJaw',
          args: [jaw],
        });
      }
      if (r.error) return errResponse(r.error);
      return { content: [{ type: 'text', text: jaw == null ? 'All jaws unselected' : `Active jaw set to "${jaw}"` }] };
    },
  );
}
