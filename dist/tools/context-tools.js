import { z } from 'zod';
function errResponse(msg) {
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}
export function registerContextTools(server, relay) {
    server.registerTool('set_feature_flag', {
        description: 'Set a single feature flag in engineContext.featuresAvailability. ' +
            'Reads current context, merges the flag, and dispatches UPDATE_ENGINE_CONTEXT.',
        inputSchema: z.object({
            flag: z.string().describe('Feature flag key (e.g. isRotationEnabled)'),
            value: z.boolean().describe('Value to set'),
        }),
    }, async ({ flag, value }) => {
        const ctx = await relay.execute('get_engine_context', {});
        if (ctx.error)
            return errResponse(ctx.error);
        const current = ctx.result;
        const features = { ...(current.featuresAvailability ?? {}), [flag]: value };
        const r = await relay.execute('update_engine_context', { data: { featuresAvailability: features } });
        if (r.error)
            return errResponse(r.error);
        return { content: [{ type: 'text', text: `Feature flag "${flag}" set to ${value}` }] };
    });
    server.registerTool('update_engine_context_partial', {
        description: 'Partial update of engine context for approved paths only (UI, bizCtx, featuresAvailability). ' +
            'Nested objects are replaced, not deep-merged. Read current context first if you need to preserve nested fields.',
        inputSchema: z.object({
            data: z.record(z.string(), z.unknown()).describe('Partial engine context data to merge'),
        }),
    }, async ({ data }) => {
        const BLOCKED = ['logging', 'security'];
        for (const key of Object.keys(data)) {
            if (BLOCKED.includes(key))
                return errResponse(`Key "${key}" is not allowed for MCP updates`);
        }
        const r = await relay.execute('update_engine_context', { data });
        if (r.error)
            return errResponse(r.error);
        return { content: [{ type: 'text', text: `Engine context updated with keys: ${Object.keys(data).join(', ')}` }] };
    });
}
//# sourceMappingURL=context-tools.js.map