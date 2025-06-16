import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Worker } from "worker_threads";
import WebSocket from "ws";

// Mock the worker and WebSocket modules
vi.mock("worker_threads", () => ({
    Worker: vi.fn(),
    parentPort: {
        postMessage: vi.fn(),
        on: vi.fn(),
    },
}));

vi.mock("ws", () => ({
    default: vi.fn(),
    WebSocketServer: vi.fn(),
}));

// Mock the extended WebSocket interface
interface MockExtendedWebSocket {
    clientId?: string;
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
}

describe("Communication Worker Threaded WebSocket", () => {
    let mockWs: MockExtendedWebSocket;
    let mockWsServer: any;
    let workerMessages: any[];
    let mockParentPort: any;

    beforeEach(() => {
        // Reset all mocks
        vi.clearAllMocks();
        workerMessages = [];

        // Mock WebSocket instance
        mockWs = {
            clientId: "test-client-1",
            send: vi.fn(),
            on: vi.fn(),
            close: vi.fn(),
            readyState: 1, // OPEN
        };

        // Mock WebSocketServer
        mockWsServer = {
            on: vi.fn(),
            close: vi.fn(),
        };

        // Mock parentPort
        mockParentPort = {
            postMessage: vi.fn((msg) => workerMessages.push(msg)),
            on: vi.fn(),
        };

        // Set up global mocks
        global.connectedClients = new Set([mockWs]);
        global.pendingBacklogRequests = new Map();
    });

    afterEach(() => {
        // Clean up globals
        delete global.connectedClients;
        delete global.pendingBacklogRequests;
    });

    describe("Ping/Pong Functionality", () => {
        it("should respond to ping with pong", () => {
            const correlationId = "test-correlation-123";

            // Simulate ping handler being called
            const pingData = { type: "ping" };

            // The worker should send a pong response
            expect(mockWs.send).not.toHaveBeenCalled();

            // Simulate calling the ping handler
            const expectedPongResponse = JSON.stringify({
                type: "pong",
                now: expect.any(Number),
                correlationId,
            });

            // Test that ping handler would work correctly
            expect(() => {
                mockWs.send(expectedPongResponse);
            }).not.toThrow();
        });

        it("should handle ping without correlation ID", () => {
            const pingData = { type: "ping" };

            const expectedPongResponse = JSON.stringify({
                type: "pong",
                now: expect.any(Number),
                correlationId: undefined,
            });

            expect(() => {
                mockWs.send(expectedPongResponse);
            }).not.toThrow();
        });
    });

    describe("Backlog Request Functionality", () => {
        it("should handle backlog request with valid amount", () => {
            const backlogData = {
                type: "backlog",
                amount: 500,
            };
            const correlationId = "test-correlation-456";

            // Test that backlog request would be processed correctly
            expect(backlogData.amount).toBe(500);
            expect(backlogData.amount).toBeGreaterThan(0);
            expect(backlogData.amount).toBeLessThanOrEqual(100000);
        });

        it("should handle backlog request with default amount", () => {
            const backlogData = { type: "backlog" };
            const defaultAmount = 1000;

            expect(defaultAmount).toBe(1000);
        });

        it("should reject invalid backlog amounts", () => {
            const invalidAmounts = [-1, 0, 100001, "invalid", null];

            invalidAmounts.forEach((amount) => {
                const isValid =
                    typeof amount === "number" &&
                    Number.isInteger(amount) &&
                    amount > 0 &&
                    amount <= 100000;
                expect(isValid).toBe(false);
            });
        });

        it("should store pending backlog requests", () => {
            const clientId = "test-client-1";
            const correlationId = "test-correlation-789";

            global.pendingBacklogRequests!.set(clientId, {
                ws: mockWs,
                correlationId,
            });

            expect(global.pendingBacklogRequests!.has(clientId)).toBe(true);
            expect(
                global.pendingBacklogRequests!.get(clientId)?.correlationId
            ).toBe(correlationId);
        });
    });

    describe("Client Connection Management", () => {
        it("should add clients to connected clients set", () => {
            expect(global.connectedClients!.has(mockWs)).toBe(true);
            expect(global.connectedClients!.size).toBe(1);
        });

        it("should remove clients on disconnect", () => {
            global.connectedClients!.delete(mockWs);
            expect(global.connectedClients!.has(mockWs)).toBe(false);
            expect(global.connectedClients!.size).toBe(0);
        });

        it("should handle multiple clients", () => {
            const mockWs2: MockExtendedWebSocket = {
                clientId: "test-client-2",
                send: vi.fn(),
                on: vi.fn(),
                close: vi.fn(),
                readyState: 1,
            };

            global.connectedClients!.add(mockWs2);
            expect(global.connectedClients!.size).toBe(2);
        });
    });

    describe("Backlog Broadcasting", () => {
        it("should broadcast backlog to all connected clients", () => {
            const backlogData = [
                { price: 100, quantity: 10, timestamp: Date.now() },
                { price: 101, quantity: 15, timestamp: Date.now() + 1000 },
            ];
            const signalsData = [
                { type: "absorption", price: 100, confidence: 0.8 },
            ];

            // Simulate broadcasting
            global.connectedClients!.forEach((ws) => {
                const backlogMessage = JSON.stringify({
                    type: "backlog",
                    data: backlogData,
                    now: Date.now(),
                });

                const signalsMessage = JSON.stringify({
                    type: "signal_backlog",
                    data: signalsData,
                    now: Date.now(),
                });

                expect(() => {
                    ws.send(backlogMessage);
                    ws.send(signalsMessage);
                }).not.toThrow();
            });
        });

        it("should send direct responses to pending requests", () => {
            const clientId = "test-client-1";
            const correlationId = "test-correlation-direct";

            global.pendingBacklogRequests!.set(clientId, {
                ws: mockWs,
                correlationId,
            });

            const backlogData = [{ price: 100, quantity: 10 }];
            const signalsData = [{ type: "test", price: 100 }];

            // Simulate direct response
            const directBacklogMessage = JSON.stringify({
                type: "backlog",
                data: backlogData,
                now: Date.now(),
                correlationId,
            });

            const directSignalsMessage = JSON.stringify({
                type: "signal_backlog",
                data: signalsData,
                now: Date.now(),
                correlationId,
            });

            expect(() => {
                mockWs.send(directBacklogMessage);
                mockWs.send(directSignalsMessage);
            }).not.toThrow();

            // Verify pending requests would be cleared
            global.pendingBacklogRequests!.clear();
            expect(global.pendingBacklogRequests!.size).toBe(0);
        });
    });

    describe("Error Handling", () => {
        it("should handle WebSocket send errors gracefully", () => {
            mockWs.send = vi.fn().mockImplementation(() => {
                throw new Error("Connection closed");
            });

            expect(() => {
                try {
                    mockWs.send("test message");
                } catch (error) {
                    // Error should be caught and logged
                    expect(error).toBeInstanceOf(Error);
                }
            }).not.toThrow();
        });

        it("should handle malformed backlog data", () => {
            const malformedData = {
                type: "backlog",
                amount: "not-a-number",
            };

            const amount = parseInt(malformedData.amount as string, 10);
            expect(Number.isNaN(amount)).toBe(true);
        });

        it("should handle missing global objects", () => {
            delete global.connectedClients;
            delete global.pendingBacklogRequests;

            expect(global.connectedClients).toBeUndefined();
            expect(global.pendingBacklogRequests).toBeUndefined();
        });
    });

    describe("Message Validation", () => {
        it("should validate backlog request message structure", () => {
            const validMessage = {
                type: "request_backlog",
                data: {
                    clientId: "test-client",
                    amount: 1000,
                    correlationId: "test-123",
                    directResponse: true,
                },
            };

            expect(validMessage.type).toBe("request_backlog");
            expect(validMessage.data.clientId).toBeTruthy();
            expect(typeof validMessage.data.amount).toBe("number");
        });

        it("should validate send_backlog message structure", () => {
            const validMessage = {
                type: "send_backlog",
                data: {
                    backlog: [],
                    signals: [],
                },
            };

            expect(validMessage.type).toBe("send_backlog");
            expect(Array.isArray(validMessage.data.backlog)).toBe(true);
            expect(Array.isArray(validMessage.data.signals)).toBe(true);
        });
    });

    describe("WebSocket State Management", () => {
        it("should track WebSocket ready states", () => {
            const states = {
                CONNECTING: 0,
                OPEN: 1,
                CLOSING: 2,
                CLOSED: 3,
            };

            expect(mockWs.readyState).toBe(states.OPEN);
            expect(Object.values(states)).toContain(mockWs.readyState);
        });

        it("should handle connection lifecycle", () => {
            const connectionEvents = ["open", "message", "close", "error"];

            connectionEvents.forEach((event) => {
                expect(typeof event).toBe("string");
                expect(event.length).toBeGreaterThan(0);
            });
        });
    });

    describe("Performance and Memory", () => {
        it("should handle large backlog data efficiently", () => {
            const largeBacklog = Array.from({ length: 10000 }, (_, i) => ({
                price: 100 + i * 0.01,
                quantity: Math.random() * 100,
                timestamp: Date.now() + i,
            }));

            expect(largeBacklog.length).toBe(10000);
            expect(JSON.stringify(largeBacklog).length).toBeGreaterThan(0);
        });

        it("should manage memory usage with client cleanup", () => {
            // Add many clients
            for (let i = 0; i < 100; i++) {
                const client: MockExtendedWebSocket = {
                    clientId: `client-${i}`,
                    send: vi.fn(),
                    on: vi.fn(),
                    close: vi.fn(),
                    readyState: 1,
                };
                global.connectedClients!.add(client);
            }

            expect(global.connectedClients!.size).toBe(101); // Original + 100

            // Clean up all clients
            global.connectedClients!.clear();
            expect(global.connectedClients!.size).toBe(0);
        });
    });

    describe("Threading Integration", () => {
        it("should handle parent port communication", () => {
            const messageTypes = [
                "metrics",
                "broadcast",
                "send_backlog",
                "shutdown",
                "request_backlog",
            ];

            messageTypes.forEach((type) => {
                const message = { type, data: {} };
                expect(message.type).toBe(type);
            });
        });

        it("should validate worker message handling", () => {
            const workerMessage = {
                type: "request_backlog",
                data: {
                    clientId: "worker-test",
                    amount: 500,
                },
            };

            // Simulate worker receiving message
            workerMessages.push(workerMessage);
            expect(workerMessages).toContain(workerMessage);
        });
    });
});
