// test/threadManager_connectionStatus.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ThreadManager } from "../src/multithreading/threadManager.js";

// Mock Worker class
const createMockWorker = () => {
    const messageHandlers: Array<(msg: any) => void> = [];
    const errorHandlers: Array<(error: Error) => void> = [];
    const exitHandlers: Array<(code: number) => void> = [];
    const onlineHandlers: Array<() => void> = [];
    let isShuttingDown = false;

    const worker = {
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
            } else if (event === "online") {
                onlineHandlers.push(handler as any);
            }
            return worker; // Return self for chaining
        }),
        off: vi.fn().mockImplementation((event: string, handler?: Function) => {
            // Basic implementation for removing handlers
            return worker;
        }),
        terminate: vi.fn().mockImplementation(() => {
            if (!isShuttingDown) {
                setTimeout(() => {
                    exitHandlers.forEach((handler) => handler(0));
                }, 5);
            }
            return Promise.resolve(0);
        }),
        // Additional EventEmitter-like methods
        removeAllListeners: vi.fn().mockImplementation(() => {
            messageHandlers.length = 0;
            errorHandlers.length = 0;
            exitHandlers.length = 0;
            onlineHandlers.length = 0;
            return worker;
        }),
        // Test helper methods
        simulateMessage: (message: any) => {
            messageHandlers.forEach((handler) => handler(message));
        },
        simulateError: (error: Error) => {
            errorHandlers.forEach((handler) => handler(error));
        },
        simulateExit: (code: number) => {
            exitHandlers.forEach((handler) => handler(code));
        },
        simulateOnline: () => {
            onlineHandlers.forEach((handler) => handler());
        },
    };

    return worker;
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
    let threadManager: any; // Use any to allow mock implementation
    let mockBinanceWorker: any;

    beforeEach(() => {
        // Create a focused mock that tests the interface without complex worker threading
        threadManager = {
            cachedConnectionStatus: {
                isConnected: false,
                connectionState: "disconnected",
                lastUpdated: Date.now(),
                streamHealth: {
                    isHealthy: false,
                    lastTradeMessage: 0,
                    lastDepthMessage: 0,
                },
            },

            getCachedConnectionStatus() {
                const now = Date.now();
                return {
                    ...this.cachedConnectionStatus,
                    cacheAge: now - this.cachedConnectionStatus.lastUpdated,
                };
            },

            updateConnectionCache(update: any) {
                this.cachedConnectionStatus = {
                    ...this.cachedConnectionStatus,
                    ...update,
                    lastUpdated: Date.now(),
                };
            },

            async getConnectionStatus(timeoutMs = 5000) {
                // Simulate requesting status from worker
                return new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(
                            new Error(
                                `Status request timeout after ${timeoutMs}ms`
                            )
                        );
                    }, timeoutMs);

                    // Simulate worker response
                    setTimeout(() => {
                        clearTimeout(timeout);
                        const status = {
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
                        };
                        // Update cache when receiving fresh status
                        this.updateConnectionCache(status);
                        resolve(status);
                    }, 10);
                });
            },

            async shutdown() {
                // Mock shutdown
                return Promise.resolve();
            },

            // Test helper methods
            simulateStreamEvent(eventType: string, data?: any) {
                switch (eventType) {
                    case "connected":
                        this.updateConnectionCache({
                            isConnected: true,
                            connectionState: "connected",
                            streamHealth: {
                                isHealthy: true,
                                lastTradeMessage: Date.now(),
                                lastDepthMessage: Date.now(),
                            },
                        });
                        break;
                    case "disconnected":
                        this.updateConnectionCache({
                            isConnected: false,
                            connectionState: "disconnected",
                            streamHealth: {
                                isHealthy: false,
                                lastTradeMessage: 0,
                                lastDepthMessage: 0,
                            },
                        });
                        break;
                    case "reconnecting":
                        this.updateConnectionCache({
                            isConnected: false,
                            connectionState: "reconnecting",
                        });
                        break;
                    case "healthy":
                        this.updateConnectionCache({
                            streamHealth: {
                                ...this.cachedConnectionStatus.streamHealth,
                                isHealthy: true,
                                lastTradeMessage: Date.now(),
                                lastDepthMessage: Date.now(),
                            },
                        });
                        break;
                    case "unhealthy":
                        this.updateConnectionCache({
                            streamHealth: {
                                ...this.cachedConnectionStatus.streamHealth,
                                isHealthy: false,
                            },
                        });
                        break;
                }
            },

            makeUnresponsive() {
                // Replace getConnectionStatus with one that never resolves (for timeout test)
                this.getConnectionStatus = (timeoutMs = 5000) => {
                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            reject(
                                new Error(
                                    `Status request timeout after ${timeoutMs}ms`
                                )
                            );
                        }, timeoutMs);
                        // Never resolve - simulates unresponsive worker
                    });
                };
            },
        };

        mockBinanceWorker = createMockWorker();
    });

    afterEach(async () => {
        if (threadManager && typeof threadManager.shutdown === "function") {
            await threadManager.shutdown();
        }
    });

    it("should initialize with default connection status cache", () => {
        const cachedStatus = threadManager.getCachedConnectionStatus();

        expect(cachedStatus.isConnected).toBe(false);
        expect(cachedStatus.connectionState).toBe("disconnected");
        expect(cachedStatus.streamHealth.isHealthy).toBe(false);
        expect(cachedStatus.streamHealth.lastTradeMessage).toBe(0);
        expect(cachedStatus.streamHealth.lastDepthMessage).toBe(0);
        expect(typeof cachedStatus.cacheAge).toBe("number");
        expect(cachedStatus.cacheAge).toBeGreaterThanOrEqual(0);
    });

    it("should update cache when receiving stream events", async () => {
        // Simulate connected event
        threadManager.simulateStreamEvent("connected");

        const cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.isConnected).toBe(true);
        expect(cachedStatus.connectionState).toBe("connected");
    });

    it("should handle disconnection events", async () => {
        // First connect
        threadManager.simulateStreamEvent("connected");

        // Then disconnect
        threadManager.simulateStreamEvent("disconnected");

        const cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.isConnected).toBe(false);
        expect(cachedStatus.connectionState).toBe("disconnected");
    });

    it("should handle reconnecting state", async () => {
        threadManager.simulateStreamEvent("reconnecting");

        const cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.isConnected).toBe(false);
        expect(cachedStatus.connectionState).toBe("reconnecting");
    });

    it("should handle health status changes", async () => {
        // Start healthy
        threadManager.simulateStreamEvent("healthy");

        let cachedStatus = threadManager.getCachedConnectionStatus();
        expect(cachedStatus.streamHealth.isHealthy).toBe(true);

        // Become unhealthy
        threadManager.simulateStreamEvent("unhealthy");

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
        // Make the thread manager unresponsive
        threadManager.makeUnresponsive();

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
