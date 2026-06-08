import { z } from 'zod';
function toText(result) {
    return JSON.stringify(result, null, 2);
}
export function registerCameraTools(server, relay) {
    server.registerTool('focus_camera_to_object', {
        description: 'Focus the camera on a specific object in the scene. ' +
            'Identify the target by name or UUID. Optionally control zoom level.',
        inputSchema: z.object({
            name: z.string().optional().describe('Name of the object to focus on'),
            uuid: z.string().optional().describe('UUID of the object to focus on'),
            zoomParam: z.number().optional().describe('Absolute zoom value'),
            zoomPercentage: z.number().optional().describe('Zoom as a percentage (0–100)'),
            focusPoint: z
                .object({ x: z.number(), y: z.number(), z: z.number() })
                .optional()
                .describe('Specific 3D point to focus on'),
            shouldFacePoint: z.boolean().optional().describe('Whether the camera should orient to face the point'),
        }),
    }, async (params) => {
        const response = await relay.execute('focusCameraToObject', params);
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
    server.registerTool('rotate_camera', {
        description: 'Rotate the camera by a specified number of degrees around an axis (x, y, or z). ' +
            'Requires the camera UUID from get_cameras.',
        inputSchema: z.object({
            axis: z
                .enum(['x', 'y', 'z'])
                .describe('Axis of rotation: "x" (pitch), "y" (yaw), "z" (roll)'),
            cameraUUID: z.string().describe('UUID of the camera to rotate'),
            degree: z.number().optional().describe('Degrees to rotate (default may vary by implementation)'),
        }),
    }, async ({ axis, cameraUUID, degree }) => {
        const response = await relay.execute('rotateCameraByDegreeAxis', { axis, cameraUUID, degree });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
    server.registerTool('move_camera', {
        description: 'Move the camera to an explicit position in 3D space. ' +
            'Provide the target position and up-vector. Requires the camera UUID from get_cameras.',
        inputSchema: z.object({
            cameraUUID: z.string().describe('UUID of the camera to move'),
            position: z
                .object({ x: z.number(), y: z.number(), z: z.number() })
                .describe('Target position in world space'),
            up: z
                .object({ x: z.number(), y: z.number(), z: z.number() })
                .optional()
                .describe('Up vector (default: {x:0, y:1, z:0})'),
            target: z
                .object({ x: z.number(), y: z.number(), z: z.number() })
                .optional()
                .describe('Point the camera looks at'),
            zoom: z.number().optional().describe('Camera zoom level'),
        }),
    }, async ({ cameraUUID, position, up, target, zoom }) => {
        const cameraPosition = { position, up: up ?? { x: 0, y: 1, z: 0 }, target, zoom };
        const response = await relay.execute('cameraManipulation', { cameraPosition, cameraUUID });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
    server.registerTool('toggle_camera_static', {
        description: 'Enable or disable static mode on a camera. In static mode the camera cannot be moved by user interaction.',
        inputSchema: z.object({
            isStaticMode: z.boolean().describe('true to lock the camera, false to unlock it'),
            cameraUUID: z.string().describe('UUID of the camera (from get_cameras)'),
        }),
    }, async ({ isStaticMode, cameraUUID }) => {
        const response = await relay.execute('toggleCameraStaticMode', { isStaticMode, cameraUUID });
        if (response.error)
            return { content: [{ type: 'text', text: `Error: ${response.error}` }], isError: true };
        return { content: [{ type: 'text', text: toText(response.result) }] };
    });
}
//# sourceMappingURL=camera-tools.js.map