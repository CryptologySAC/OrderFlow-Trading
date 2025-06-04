import { WebSocketManager } from "../src/websocket/websocketManager";
import { Logger } from "../src/infrastructure/logger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { RateLimiter } from "../src/infrastructure/rateLimiter";
import ws from "ws";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/infrastructure/rateLimiter");
vi.mock("ws");

const createManager = (handlers: Record<string, any> = {}) => {
    const logger = new Logger();
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
        const { server, limiter } = createManager({ test: handler });
        const socket = new (ws as any).WebSocket();
        server.clients.add(socket);
        server.emit("connection", socket);
        socket.emit(
            "message",
            JSON.stringify({ type: "test", data: { a: 1 } })
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
});
