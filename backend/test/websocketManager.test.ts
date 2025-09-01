import { describe, it, expect, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/infrastructure/rateLimiter");
vi.mock("ws");

import { WebSocketManager } from "../src/websocket/websocketManager";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { RateLimiter } from "../src/infrastructure/rateLimiter";
import ws from "ws";

const createManager = (handlers: Record<string, any> = {}) => {
    const logger = new WorkerLogger();
    const metrics = new MetricsCollector();
    const limiter = new RateLimiter();
    limiter.isAllowed.mockReturnValue(true);
    const manager = new WebSocketManager(
        1234,
        logger,
        limiter,
        metrics,
        handlers
    );
    const server: any = (ws as any).lastServerInstance();
    return { manager, logger, metrics, limiter, server };
};

describe("WebSocketManager", () => {
    beforeEach(() => {
        (ws as any).clean();
    });

    it("tracks connection count", () => {
        const { manager, server } = createManager();
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        expect(manager.getConnectionCount()).toBe(1);
    });

    it("rate limits messages", () => {
        const { server, limiter } = createManager();
        limiter.isAllowed.mockReturnValue(false);
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        socket.emit("message", "{}");
        expect(socket.send).toHaveBeenCalledWith(
            expect.stringContaining("Rate limit exceeded")
        );
    });

    it("handles invalid json", () => {
        const { server } = createManager();
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        socket.emit("message", "not json");
        expect(socket.send).toHaveBeenCalled();
        const payload = JSON.parse(socket.send.mock.calls[0][0]);
        expect(payload.type).toBe("error");
    });

    it("processes valid request", () => {
        const handler = vi.fn();
        const { server, limiter } = createManager({ ping: handler });
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        socket.emit(
            "message",
            JSON.stringify({ type: "ping", data: { a: 1 } })
        );
        expect(socket.send).not.toHaveBeenCalled();
    });

    it("broadcasts to clients", () => {
        const { manager, server } = createManager();
        const a = new (ws as any).WebSocket();
        const b = new (ws as any).WebSocket();
        server.clients.add(a);
        server.clients.add(b);
        server.emit("connection", a);
        server.emit("connection", b);
        manager.broadcast({ type: "test", data: 1, now: Date.now() });
        expect(a.send).toHaveBeenCalled();
        expect(b.send).toHaveBeenCalled();
    });

    it("handles close events and updates metrics", () => {
        const { server, metrics, logger, manager } = createManager();
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        socket.emit("close");
        expect(metrics.updateMetric).toHaveBeenLastCalledWith(
            "connectionsActive",
            manager.getConnectionCount()
        );
        expect(logger.info).toHaveBeenCalledWith(
            "Client disconnected",
            expect.any(Object),
            expect.any(String)
        );
    });

    it("logs socket errors", () => {
        const { server, logger } = createManager();
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        const err = new Error("boom");
        socket.emit("error", err);
        expect(logger.error).toHaveBeenCalledWith(
            "WebSocket error",
            { error: err, clientId: expect.any(String) },
            expect.any(String)
        );
    });

    it("rejects invalid message shape", () => {
        const { server } = createManager();
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        socket.emit("message", JSON.stringify({ bad: true }));
        const payload = JSON.parse(socket.send.mock.calls[0][0]);
        expect(payload.message).toContain("Invalid message structure");
    });

    it("handles unknown request types", () => {
        const { server } = createManager();
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        socket.emit("message", JSON.stringify({ type: "nope" }));
        const payload = JSON.parse(socket.send.mock.calls[0][0]);
        expect(payload.message).toBe("Unknown request type");
    });

    it("reports handler errors", async () => {
        const handler = vi.fn().mockRejectedValue(new Error("fail"));
        const { server, logger } = createManager({ ping: handler });
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        socket.emit("message", JSON.stringify({ type: "ping" }));
        await Promise.resolve();
        expect(logger.error).toHaveBeenCalledWith(
            "Handler error for ping",
            { error: expect.any(Error) },
            expect.any(String)
        );
        const payload = JSON.parse(socket.send.mock.calls[0][0]);
        expect(payload.message).toBe("fail");
    });

    it("parses messages and throws on unexpected type", () => {
        const { manager } = createManager();
        const parse = (manager as any).parseMessage.bind(manager);
        expect(parse(Buffer.from("hi"), "id", "cid")).toBe("hi");
        expect(() => parse(123 as any, "id", "cid")).toThrow(
            "Unexpected message format"
        );
    });

    it("logs broadcast errors", () => {
        const { manager, server, logger } = createManager();
        const good = new (ws as any).WebSocket();
        const bad = new (ws as any).WebSocket();
        bad.send.mockImplementation(() => {
            throw new Error("broken");
        });
        server.clients.add(good);
        server.clients.add(bad);
        server.emit("connection", good);
        server.emit("connection", bad);
        manager.broadcast({ type: "x", data: 1 });
        expect(logger.error).toHaveBeenCalledWith("Broadcast error", {
            error: expect.any(Error),
        });
    });

    it("blocks dangerous object properties", () => {
        const { server, logger } = createManager();
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        // Create a message with dangerous property manually (bypassing JSON.stringify)
        const dangerousMessage =
            '{"type":"ping","constructor":{"dangerous":true}}';
        socket.emit("message", dangerousMessage);
        expect(logger.error).toHaveBeenCalledWith(
            "Message parse error",
            expect.objectContaining({
                error: expect.objectContaining({
                    message: expect.stringContaining(
                        "Dangerous property detected"
                    ),
                }),
            }),
            expect.any(String)
        );
    });

    it("shuts down and closes connections", () => {
        const { manager, server } = createManager();
        const a = new (ws as any).WebSocket();
        const b = new (ws as any).WebSocket();
        server.clients.add(a);
        server.clients.add(b);
        server.emit("connection", a);
        server.emit("connection", b);
        manager.shutdown();
        expect(server.close).toHaveBeenCalled();
        expect(a.close).toHaveBeenCalledWith(1001, "Server shutting down");
        expect(b.close).toHaveBeenCalledWith(1001, "Server shutting down");
    });
});
