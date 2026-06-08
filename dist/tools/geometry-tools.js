import { z } from 'zod';
function toText(result) {
    return JSON.stringify(result, null, 2);
}
const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const createObjectParamsSchema = z.object({
    type: z
        .enum(['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus', 'line', 'points'])
        .describe('Geometry primitive type'),
    position: vec3Schema.optional().describe('World-space position'),
    rotation: vec3Schema.optional().describe('Euler rotation in radians'),
    scale: vec3Schema.optional().describe('Scale factors'),
    color: z
        .object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() })
        .optional()
        .describe('RGBA color (0–1 range)'),
    width: z.number().optional(),
    height: z.number().optional(),
    depth: z.number().optional(),
    radius: z.number().optional(),
    segments: z.number().optional(),
});
export function registerGeometryTools(server, relay) {
    server.registerTool('remove_object', {
        description: 'Remove an object from the scene by name or UUID.',
        inputSchema: z.object({
            name: z.string().optional().describe('Name of the object to remove'),
            uuid: z.string().optional().describe('UUID of the object to remove'),
        }),
    }, async ({ name, uuid }) => {
        const response = await relay.execute('removeObjectBy', { name, uuid });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
    server.registerTool('create_geometry_in_scene', {
        description: 'Create a new primitive geometry object and add it directly to the root scene. ' +
            'Optionally assign a UUID and name.',
        inputSchema: z.object({
            params: createObjectParamsSchema,
            uuid: z.string().optional().describe('Optional UUID to assign to the new object'),
            name: z.string().optional().describe('Optional name for the new object'),
        }),
    }, async ({ params, uuid, name }) => {
        const response = await relay.execute('createAndAddGeometryToScene', { params, uuid, name });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
    server.registerTool('create_geometry_in_group', {
        description: 'Create a new primitive geometry object and add it to a named group in the scene. ' +
            'Identify the target group by name or UUID.',
        inputSchema: z.object({
            params: createObjectParamsSchema,
            groupName: z.string().optional().describe('Name of the group to add the geometry to'),
            groupUuid: z.string().optional().describe('UUID of the group to add the geometry to'),
            uuid: z.string().optional().describe('Optional UUID to assign to the new object'),
            name: z.string().optional().describe('Optional name for the new object'),
        }),
    }, async ({ params, groupName, groupUuid, uuid, name }) => {
        const response = await relay.execute('createAndAddGeometryToGroup', {
            params,
            name: groupName,
            uuid: groupUuid,
            objectUuid: uuid,
            objectName: name,
        });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
}
//# sourceMappingURL=geometry-tools.js.map