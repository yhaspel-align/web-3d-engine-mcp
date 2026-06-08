import { z } from 'zod';
function toText(result) {
    return JSON.stringify(result, null, 2);
}
export function registerVisibilityTools(server, relay) {
    server.registerTool('toggle_object_visibility', {
        description: 'Show or hide a 3D object in the scene. ' +
            'Identify by name or UUID. Omit isVisible to toggle the current state.',
        inputSchema: z.object({
            name: z.string().optional().describe('Name of the object'),
            uuid: z.string().optional().describe('UUID of the object'),
            isVisible: z
                .boolean()
                .optional()
                .describe('true to show, false to hide. Omit to toggle current visibility.'),
        }),
    }, async ({ name, uuid, isVisible }) => {
        const response = await relay.execute('toggleObjectVisibility', { name, uuid, isVisible });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
}
//# sourceMappingURL=visibility-tools.js.map