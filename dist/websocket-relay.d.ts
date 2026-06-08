import type { BridgeResponse } from './types/bridge.types.js';
export type EngineEventListener = (eventName: string, detail: unknown) => void;
export declare class WebSocketRelay {
    private readonly port;
    private wss;
    private client;
    private pending;
    private eventListeners;
    constructor(port?: number);
    /**
     * Send a command to the browser and wait for the correlated response.
     * Rejects after COMMAND_TIMEOUT_MS if no response is received.
     */
    execute(method: string, params?: unknown): Promise<BridgeResponse>;
    onEngineEvent(listener: EngineEventListener): () => void;
    isConnected(): boolean;
    close(): void;
}
//# sourceMappingURL=websocket-relay.d.ts.map