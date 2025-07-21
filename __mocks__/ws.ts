/// <reference types="vitest/globals" />

console.log("MOCK WS LOADED");
import { EventEmitter } from "events";

const GLOBAL = globalThis as any;

if (!GLOBAL.__MOCK_WS_SINGLETON__) {
    GLOBAL.__MOCK_WS_SINGLETON__ = {
        lastServerInstance: null,
    };
}

class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = MockWebSocket.OPEN;
    send = vi.fn<(msg: string) => void>();
    close = vi.fn<() => void>();
}

class MockWebSocketServer extends EventEmitter {
    static lastInstance: any = null; // <-- Make this a static property!
    clients = new Set<MockWebSocket>();

    constructor(_: { port: number }) {
        super();
        MockWebSocketServer.lastInstance = this; // <-- Assign to static property, not getter
    }
    close = vi.fn();
}

export const clean = () => {
    vi.clearAllMocks();
};

export {
    MockWebSocket as WebSocket,
    MockWebSocketServer as WebSocketServer,
    MockWebSocketServer as Server,
};

export default {
    WebSocket: MockWebSocket,
    WebSocketServer: MockWebSocketServer,
    Server: MockWebSocketServer,
    OPEN: MockWebSocket.OPEN,
    clean,
    lastServerInstance: () => MockWebSocketServer.lastInstance,
};

export const __esModule = true;
