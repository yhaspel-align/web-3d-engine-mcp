import { z } from 'zod';
function toText(result) {
    return JSON.stringify(result, null, 2);
}
const objectIdentifier = {
    objectName: z.string().optional().describe('Name of the target object'),
    objectUuid: z.string().optional().describe('UUID of the target object'),
};
export function registerMaterialTools(server, relay) {
    server.registerTool('change_object_color', {
        description: 'Change the uniform (solid) color of an object. ' +
            'Color components are in the 0–1 range (not 0–255). ' +
            'Identify the object by name or UUID.',
        inputSchema: z.object({
            color: z.object({
                r: z.number().min(0).max(1).describe('Red channel (0–1)'),
                g: z.number().min(0).max(1).describe('Green channel (0–1)'),
                b: z.number().min(0).max(1).describe('Blue channel (0–1)'),
                a: z.number().min(0).max(1).optional().describe('Alpha channel (0–1, default 1)'),
            }),
            ...objectIdentifier,
        }),
    }, async ({ color, objectName, objectUuid }) => {
        const vec4 = { x: color.r, y: color.g, z: color.b, w: color.a ?? 1 };
        const response = await relay.execute('changeUniformColor', { color: vec4, objectName, objectUuid });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
    server.registerTool('change_material_props', {
        description: 'Change material properties on an object such as opacity, wireframe mode, or other shader uniforms. ' +
            'Identify the object by name or UUID.',
        inputSchema: z.object({
            properties: z
                .record(z.unknown())
                .describe('Key-value map of material properties to update. ' +
                'Examples: { "opacity": 0.5 }, { "wireframe": true }, { "color": "#ff0000" }'),
            ...objectIdentifier,
        }),
    }, async ({ properties, objectName, objectUuid }) => {
        const response = await relay.execute('changeObjectMaterialProps', { properties, objectName, objectUuid });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
}
//# sourceMappingURL=material-tools.js.map