import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
const COMMAND_TIMEOUT_MS = 30_000;
export class WebSocketRelay {
    port;
    wss;
    client = null;
    pending = new Map();
    eventListeners = [];
    constructor(port = 3333) {
        this.port = port;
        this.wss = new WebSocketServer({ port });
        this.wss.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                process.stderr.write(`[web-3d-engine-mcp] WARNING: port ${port} already in use. ` +
                    `Browser bridge unavailable — tools will return "No browser bridge connected".\n` +
                    `Kill the other process or set WS_PORT=<other port> and restart.\n`);
            }
            else {
                process.stderr.write(`[web-3d-engine-mcp] WebSocket server error: ${err.message}\n`);
            }
        });
        this.wss.on('connection', (ws) => {
            this.client = ws;
            process.stderr.write(`[web-3d-engine-mcp] Browser bridge connected\n`);
            ws.on('message', (raw) => {
                let msg;
                try {
                    msg = JSON.parse(raw.toString());
                }
                catch {
                    process.stderr.write(`[web-3d-engine-mcp] Malformed message: ${raw}\n`);
                    return;
                }
                if ('type' in msg && msg.type === 'engine-event') {
                    this.eventListeners.forEach((l) => l(msg.eventName, msg.detail));
                    return;
                }
                const response = msg;
                const resolve = this.pending.get(response.id);
                if (resolve) {
                    this.pending.delete(response.id);
                    resolve(response);
                }
            });
            ws.on('close', () => {
                process.stderr.write(`[web-3d-engine-mcp] Browser bridge disconnected\n`);
                if (this.client === ws) {
                    this.client = null;
                }
                // Reject any pending commands
                for (const [id, resolve] of this.pending) {
                    resolve({ id, error: 'Browser bridge disconnected' });
                }
                this.pending.clear();
            });
        });
        this.wss.on('listening', () => {
            process.stderr.write(`[web-3d-engine-mcp] WebSocket relay listening on ws://localhost:${port}\n`);
        });
    }
    /**
     * Send a command to the browser and wait for the correlated response.
     * Rejects after COMMAND_TIMEOUT_MS if no response is received.
     */
    execute(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.client || this.client.readyState !== WebSocket.OPEN) {
                reject(new Error('No browser bridge connected. Load the consumer app with engine-bridge.js included.'));
                return;
            }
            const id = randomUUID();
            const command = { id, method, params };
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Command "${method}" timed out after ${COMMAND_TIMEOUT_MS / 1000}s`));
            }, COMMAND_TIMEOUT_MS);
            this.pending.set(id, (response) => {
                clearTimeout(timer);
                resolve(response);
            });
            this.client.send(JSON.stringify(command));
        });
    }
    onEngineEvent(listener) {
        this.eventListeners.push(listener);
        return () => {
            const index = this.eventListeners.indexOf(listener);
            if (index >= 0)
                this.eventListeners.splice(index, 1);
        };
    }
    isConnected() {
        return this.client !== null && this.client.readyState === WebSocket.OPEN;
    }
    close() {
        this.wss.close();
    }
}
//# sourceMappingURL=websocket-relay.js.map