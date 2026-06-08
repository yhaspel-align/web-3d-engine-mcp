import { z } from 'zod';
function toText(result) {
    return JSON.stringify(result, null, 2);
}
function errResponse(msg) {
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}
const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export function registerCameraViewTools(server, relay) {
    server.registerTool('set_stage_camera_positions', {
        description: 'Set StageSplitter camera positions preset. Uses predefined positions like Frontal, Left-Buccal, Right-Buccal, Upper-Occlusal, Lower-Occlusal.',
        inputSchema: z.object({
            cameraPositions: z.record(z.string(), z.unknown()).describe('Camera positions map (view name -> camera props)'),
            activeView: z.string().optional().describe('Optionally set the active view'),
        }),
    }, async ({ cameraPositions, activeView }) => {
        const data = { cameraPositions };
        if (activeView !== undefined)
            data.activeView = activeView;
        const r = await relay.execute('update_plugin_preset', { pluginId: 'StageSplitter', data });
        if (r.error)
            return errResponse(r.error);
        return { content: [{ type: 'text', text: 'Stage camera positions updated' }] };
    });
    server.registerTool('set_render_view_camera_props', {
        description: 'Update camera props for a specific render view cell. The bridge reconstructs Vector3 instances for position/up.',
        inputSchema: z.object({
            row: z.number().int().describe('Row index of the render view'),
            col: z.number().int().describe('Column index of the render view'),
            cameraProps: z.object({
                position: vec3Schema.optional().describe('Camera position {x, y, z}'),
                up: vec3Schema.optional().describe('Camera up vector {x, y, z}'),
                zoom: z.number().optional().describe('Camera zoom level'),
            }).describe('Camera properties to update'),
        }),
    }, async ({ row, col, cameraProps }) => {
        const r = await relay.execute('call_store_action', {
            store: 'rendererStore',
            action: 'updateRenderViewCameraProps',
            args: [row, col, cameraProps],
        });
        if (r.error)
            return errResponse(r.error);
        return { content: [{ type: 'text', text: `Render view [${row},${col}] camera updated` }] };
    });
    server.registerTool('reset_render_views', {
        description: 'Reset render views to default for a given case type.',
        inputSchema: z.object({
            caseType: z.string().describe('Case type to reset to (e.g. "default")'),
        }),
    }, async ({ caseType }) => {
        const r = await relay.execute('call_store_action', {
            store: 'rendererStore',
            action: 'resetRenderViewToDefault',
            args: [caseType],
        });
        if (r.error)
            return errResponse(r.error);
        return { content: [{ type: 'text', text: `Render views reset to "${caseType}" default` }] };
    });
    server.registerTool('set_render_view_fit_padding', {
        description: 'Update the modelPaddingFactor on current render views. This is the stateful zoom/fit control. ' +
            'The bridge clones current renderViewProps (preserving Vector3 instances) and updates padding.',
        inputSchema: z.object({
            modelPaddingFactor: z.number().describe('Padding factor for model fit (e.g. 1.0 = no padding, 1.2 = 20% padding)'),
        }),
    }, async ({ modelPaddingFactor }) => {
        // Read current render views, update padding, and set via bridge
        const views = await relay.execute('get_render_views', {});
        if (views.error)
            return errResponse(views.error);
        const rvp = views.result;
        if (!rvp)
            return errResponse('No render view props available');
        rvp.modelPaddingFactor = modelPaddingFactor;
        const r = await relay.execute('call_store_action', {
            store: 'rendererStore',
            action: 'setRenderViews',
            args: [rvp],
        });
        if (r.error)
            return errResponse(r.error);
        return { content: [{ type: 'text', text: `Model padding factor set to ${modelPaddingFactor}` }] };
    });
    server.registerTool('set_rotation_enabled', {
        description: 'Enable or disable rotation in the review tool via featuresAvailability.isRotationEnabled flag.',
        inputSchema: z.object({
            enabled: z.boolean().describe('Whether rotation is enabled'),
        }),
    }, async ({ enabled }) => {
        const ctx = await relay.execute('get_engine_context', {});
        if (ctx.error)
            return errResponse(ctx.error);
        const current = ctx.result;
        const features = { ...(current.featuresAvailability ?? {}), isRotationEnabled: enabled };
        const r = await relay.execute('update_engine_context', { data: { featuresAvailability: features } });
        if (r.error)
            return errResponse(r.error);
        return { content: [{ type: 'text', text: `Rotation enabled: ${enabled}` }] };
    });
    server.registerTool('rotate_camera_to_jaw_view', {
        description: 'Directly rotate the Three.js camera to a named view position for a specific jaw. ' +
            'This bypasses the Angular preset system and moves the camera immediately by setting camera.position/up ' +
            'then calling callZoomCameraTo() to orient toward the model. ' +
            'Use this to show an occlusal view without resetting jaw visibility. ' +
            'cameraPosition values: "Frontal", "Lower-Occlusal", "Upper-Occlusal", "Left-Buccal", "Right-Buccal".',
        inputSchema: z.object({
            jaw: z.enum(['upper_jaw', 'lower_jaw']).describe('Which jaw camera slot to rotate'),
            cameraPosition: z
                .enum(['Frontal', 'Lower-Occlusal', 'Upper-Occlusal', 'Left-Buccal', 'Right-Buccal'])
                .describe('Target camera position name'),
        }),
    }, async ({ jaw, cameraPosition }) => {
        const r = await relay.execute('rotate_camera_to_jaw_view', { jaw, cameraPosition });
        if (r.error)
            return errResponse(r.error);
        const res = r.result;
        return {
            content: [{
                    type: 'text',
                    text: `Camera rotated: jaw=${res.jaw}, position=${res.cameraPosition}, caseType=${res.caseType}`,
                }],
        };
    });
    server.registerTool('set_jaw_visibility', {
        description: 'Show or hide a jaw mesh in the 3D view by setting jawsVisibility on all render views. ' +
            'jaw can be: upper, lower, upperPretreatment, lowerPretreatment, ' +
            'upperDentureCopyScan, lowerDentureCopyScan, upperEmergenceProfile, lowerEmergenceProfile.',
        inputSchema: z.object({
            jaw: z
                .enum([
                'upper', 'lower',
                'upperPretreatment', 'lowerPretreatment',
                'upperDentureCopyScan', 'lowerDentureCopyScan',
                'upperEmergenceProfile', 'lowerEmergenceProfile',
            ])
                .describe('Which jaw mesh to show/hide'),
            visible: z.boolean().describe('true = show, false = hide'),
        }),
    }, async ({ jaw, visible }) => {
        const views = await relay.execute('get_render_views', {});
        if (views.error)
            return errResponse(views.error);
        // renderViewProps is the 2D array itself: RenderViewProps[][]
        const rvp = views.result;
        if (!rvp || !Array.isArray(rvp))
            return errResponse('No render view props available');
        const jawKey = `${jaw}Jaw`;
        for (const row of rvp) {
            for (const cell of row) {
                const jv = cell.jawsVisibility;
                if (jv)
                    jv[jawKey] = visible;
            }
        }
        const r = await relay.execute('call_store_action', {
            store: 'rendererStore',
            action: 'setRenderViews',
            args: [rvp],
        });
        if (r.error)
            return errResponse(r.error);
        return { content: [{ type: 'text', text: `${jaw} jaw visibility set to ${visible}` }] };
    });
}
//# sourceMappingURL=camera-view-tools.js.map