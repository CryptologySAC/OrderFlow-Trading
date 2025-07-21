// test/threadManager_connectionStatus.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ThreadManager } from "../src/multithreading/threadManager.js";

// Mock Worker class
const createMockWorker = () => {
    const messageHandlers: Array<(msg: any) => void> = [];
    const errorHandlers: Array<(error: Error) => void> = [];
    const exitHandlers: Array<(code: number) => void> = [];
    let isShuttingDown = false;

    return {
        postMessage: vi.fn().mockImplementation((message: any) => {
            // Simulate worker receiving message
            setTimeout(() => {
                if (message.type === "status_request") {
                    // Simulate status response
                    messageHandlers.forEach((handler) =>
                        handler({
                            type: "status_response",
                            requestId: message.requestId,
                            status: {
                                isConnected: true,
                                connectionState: "connected",
                                reconnectAttempts: 0,
                                uptime: 30000,
                                lastReconnectAttempt: 0,
                                streamHealth: {
                                    isHealthy: true,
                                    lastTradeMessage: Date.now() - 1000,
                                    lastDepthMessage: Date.now() - 500,
                                },
                            },
                        })
                    );
                } else if (message.type === "shutdown") {
                    // Simulate graceful shutdown
                    isShuttingDown = true;
                    setTimeout(() => {
                        exitHandlers.forEach((handler) => handler(0));
                    }, 5);
                }
            }, 10);
        }),
        on: vi.fn().mockImplementation((event: string, handler: Function) => {
            if (event === "message") {
                messageHandlers.push(handler as any);
            } else if (event === "error") {
                errorHandlers.push(handler as any);
            } else if (event === "exit") {
                exitHandlers.push(handler as any);
            }
        }),
        terminate: vi.fn().mockImplementation(() => {
            if (!isShuttingDown) {
                setTimeout(() => {
                    exitHandlers.forEach((handler) => handler(0));
                }, 5);
            }
            return Promise.resolve(0);
        }),
        simulateMessage: (message: any) => {
            messageHandlers.forEach((handler) => handler(message));
        },
        simulateError: (error: Error) => {
            errorHandlers.forEach((handler) => handler(error));
        },
        simulateExit: (code: number) => {
            exitHandlers.forEach((handler) => handler(code));
        },
    };
};

// Mock the Worker constructor
vi.mock("worker_threads", () => ({
    Worker: vi.fn().mockImplementation(() => createMockWorker()),
    parentPort: {
        postMessage: vi.fn(),
        on: vi.fn(),
    },
}));

describe("ThreadManager Connection Status", () => {
    let threadManager: ThreadManager;
    let mockBinanceWorker: any;

    beforeEach(() => {
        threadManager = new ThreadManager();
        // Get reference to the mocked binance worker
        mockBinanceWorker = (threadManager as any).binanceWorker;
    });

    afterEach(async () => {
        await threadManager.shutdown();
    });

    it("should initialize with default connection status cache", () => {
        const cachedStatus = threadManager.getCachedConnectionStatus();

        expect(cachedStatus.isConnected).toBe(false);
        expect(cachedStatus.connectionState).toBe("disconnected");
        expect(cachedStatus.streamHealth.isHealthy).toBe(false);
        expect(cachedStatus.cacheAge).toBeGreaterThanOrEqual(0);
    });

    it("should update cache when receiving stream events", async () => {
        // Simulate connected event
        mockBinanceWorker.simulateMessage({
            type: "stream_event",
            eventType: "connected",
            data: { timestamp: Date.now() },
        });

        // Wait for async message processing
        await new Promise((resolve) => setTimeout(resolve, 20));

        const cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.isConnected).toBe(true);
        expect(cachedStatus.connectionState).toBe("connected");
    });

    it("should handle disconnection events", async () => {
        // First connect
        mockBinanceWorker.simulateMessage({
            type: "stream_event",
            eventType: "connected",
            data: { timestamp: Date.now() },
        });

        // Wait for first message processing
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Then disconnect
        mockBinanceWorker.simulateMessage({
            type: "stream_event",
            eventType: "disconnected",
            data: { reason: "network_error", timestamp: Date.now() },
        });

        // Wait for second message processing
        await new Promise((resolve) => setTimeout(resolve, 20));

        const cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.isConnected).toBe(false);
        expect(cachedStatus.connectionState).toBe("disconnected");
    });

    it("should handle reconnecting state", async () => {
        mockBinanceWorker.simulateMessage({
            type: "stream_event",
            eventType: "reconnecting",
            data: { attempt: 1, delay: 5000, maxAttempts: 10 },
        });

        // Wait for async message processing
        await new Promise((resolve) => setTimeout(resolve, 20));

        const cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.isConnected).toBe(false);
        expect(cachedStatus.connectionState).toBe("reconnecting");
    });

    it("should handle health status changes", async () => {
        // Start healthy
        mockBinanceWorker.simulateMessage({
            type: "stream_event",
            eventType: "healthy",
            data: { timestamp: Date.now() },
        });

        // Wait for async message processing
        await new Promise((resolve) => setTimeout(resolve, 20));

        let cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.streamHealth.isHealthy).toBe(true);

        // Become unhealthy
        mockBinanceWorker.simulateMessage({
            type: "stream_event",
            eventType: "unhealthy",
            data: { timestamp: Date.now() },
        });

        // Wait for async message processing
        await new Promise((resolve) => setTimeout(resolve, 20));

        cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.streamHealth.isHealthy).toBe(false);
    });

    it("should request and receive fresh connection status", async () => {
        const statusPromise = threadManager.getConnectionStatus(1000);

        const status = await statusPromise;

        expect(status.isConnected).toBe(true);
        expect(status.connectionState).toBe("connected");
        expect(status.reconnectAttempts).toBe(0);
        expect(status.uptime).toBe(30000);
        expect(status.streamHealth.isHealthy).toBe(true);
        expect(status.streamHealth.lastTradeMessage).toBeGreaterThan(0);
        expect(status.streamHealth.lastDepthMessage).toBeGreaterThan(0);
    });

    it("should timeout when status request takes too long", async () => {
        // Create a worker that doesn't respond
        const mockWorkerWithoutResponse = createMockWorker();
        mockWorkerWithoutResponse.postMessage = vi.fn(); // Don't respond
        (threadManager as any).binanceWorker = mockWorkerWithoutResponse;

        await expect(threadManager.getConnectionStatus(100)).rejects.toThrow(
            "Status request timeout after 100ms"
        );
    });

    it("should update cache when receiving fresh status", async () => {
        const status = await threadManager.getConnectionStatus(1000);

        const cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.isConnected).toBe(status.isConnected);
        expect(cachedStatus.connectionState).toBe(status.connectionState);
        expect(cachedStatus.streamHealth.isHealthy).toBe(
            status.streamHealth.isHealthy
        );
    });

    it("should handle multiple concurrent status requests", async () => {
        const promises = [
            threadManager.getConnectionStatus(1000),
            threadManager.getConnectionStatus(1000),
            threadManager.getConnectionStatus(1000),
        ];

        const results = await Promise.all(promises);

        results.forEach((status) => {
            expect(status.isConnected).toBe(true);
            expect(status.connectionState).toBe("connected");
        });
    });
});
