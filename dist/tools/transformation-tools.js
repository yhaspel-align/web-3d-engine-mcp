import { z } from 'zod';
function toText(result) {
    return JSON.stringify(result, null, 2);
}
export function registerTransformationTools(server, relay) {
    server.registerTool('change_object_transformation', {
        description: 'Apply a transformation matrix to an object. ' +
            'The matrix is a flat 16-element array representing a column-major 4×4 Matrix4. ' +
            'Use get_object_transformation first to retrieve the current matrix as a reference.',
        inputSchema: z.object({
            uuid: z.string().describe('UUID of the object to transform'),
            transformationMatrix: z
                .array(z.number())
                .length(16)
                .describe('Column-major 4×4 transformation matrix as a 16-element array'),
        }),
    }, async ({ uuid, transformationMatrix }) => {
        const response = await relay.execute('changeModelObjectTransformation', { uuid, transformationMatrix });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
    server.registerTool('reset_object_transformation', {
        description: 'Reset an object\'s transformation matrix to its original/default state.',
        inputSchema: z.object({
            uuid: z.string().describe('UUID of the object to reset'),
        }),
    }, async ({ uuid }) => {
        const response = await relay.execute('resetModelObjectTransformation', { uuid });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
}
//# sourceMappingURL=transformation-tools.js.map