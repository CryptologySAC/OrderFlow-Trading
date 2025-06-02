// src/websocket/websocketManager.ts

import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import { randomUUID } from "crypto";
import { Logger } from "../infrastructure/logger.js";
import { RateLimiter } from "../infrastructure/rateLimiter.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { WebSocketError } from "../core/errors.js";
import type { WebSocketMessage } from "../utils/interfaces.js";

export interface ExtendedWebSocket extends WebSocket {
    clientId?: string;
    correlationId?: string;
}

export type WSHandler<T = unknown> = (
    ws: ExtendedWebSocket,
    data: T,
    correlationId?: string
) => void | Promise<void>;

/**
 * Manages WebSocket server and client connections
 */
export class WebSocketManager {
    private readonly wsServer: WebSocketServer;
    private readonly activeConnections = new Set<ExtendedWebSocket>();
    private isShuttingDown = false;

    constructor(
        port: number,
        private readonly logger: Logger,
        private readonly rateLimiter: RateLimiter,
        private readonly metricsCollector: MetricsCollector,
        private readonly wsHandlers: Record<string, WSHandler>
    ) {
        this.wsServer = new WebSocketServer({ port });
        this.setupWebSocketServer();
    }

    /**
     * Setup WebSocket server event handlers
     */
    private setupWebSocketServer(): void {
        this.wsServer.on("connection", (ws: ExtendedWebSocket) => {
            const clientId = randomUUID();
            const correlationId = randomUUID();

            ws.clientId = clientId;
            ws.correlationId = correlationId;
            this.activeConnections.add(ws);

            this.metricsCollector.updateMetric(
                "connectionsActive",
                this.activeConnections.size
            );
            this.logger.info("Client connected", { clientId }, correlationId);

            ws.on("close", () => {
                this.activeConnections.delete(ws);
                this.metricsCollector.updateMetric(
                    "connectionsActive",
                    this.activeConnections.size
                );
                this.logger.info(
                    "Client disconnected",
                    { clientId },
                    correlationId
                );
            });

            ws.on("message", (message) => this.handleWSMessage(ws, message));
            ws.on("error", (error) => {
                this.logger.error(
                    "WebSocket error",
                    { error, clientId },
                    correlationId
                );
            });
        });
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleWSMessage(ws: ExtendedWebSocket, message: RawData): void {
        const correlationId = randomUUID();

        if (!this.rateLimiter.isAllowed(ws.clientId || "unknown")) {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Rate limit exceeded",
                    correlationId,
                })
            );
            return;
        }

        try {
            const raw = this.parseMessage(
                message,
                ws.clientId || "unknown",
                correlationId
            );
            const parsed: unknown = JSON.parse(raw);

            if (!this.isValidWSRequest(parsed)) {
                throw new WebSocketError(
                    "Invalid message shape",
                    ws.clientId || "unknown",
                    correlationId
                );
            }

            const { type, data } = parsed;
            const handler = this.wsHandlers[type];

            if (!handler) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Unknown request type",
                        correlationId,
                    })
                );
                return;
            }

            Promise.resolve(handler(ws, data, correlationId)).catch(
                (err: Error) => {
                    this.logger.error(
                        `Handler error for ${type}`,
                        { error: err },
                        correlationId
                    );
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: err.message,
                            correlationId,
                        })
                    );
                }
            );
        } catch (err) {
            this.logger.error(
                "Message parse error",
                { error: err },
                correlationId
            );
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: (err as Error).message,
                    correlationId,
                })
            );
        }
    }

    /**
     * Parse raw WebSocket message
     */
    private parseMessage(
        message: RawData,
        clientId: string,
        correlationId: string
    ): string {
        if (typeof message === "string") return message;
        if (message instanceof Buffer) return message.toString();
        throw new WebSocketError(
            "Unexpected message format",
            clientId,
            correlationId
        );
    }

    /**
     * Validate WebSocket request structure
     */
    private isValidWSRequest(
        obj: unknown
    ): obj is { type: string; data?: unknown } {
        return (
            typeof obj === "object" &&
            obj !== null &&
            "type" in obj &&
            typeof (obj as { type: unknown }).type === "string"
        );
    }

    /**
     * Broadcast message to all connected clients
     */
    public broadcast(message: WebSocketMessage): void {
        if (this.isShuttingDown) return;

        this.wsServer.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(JSON.stringify(message));
                } catch (error) {
                    this.logger.error("Broadcast error", { error });
                }
            }
        });
    }

    /**
     * Gracefully shutdown WebSocket server
     */
    public shutdown(): void {
        this.isShuttingDown = true;

        this.wsServer.close(() => {
            this.logger.info("WebSocket server closed");
        });

        this.activeConnections.forEach((ws) => {
            ws.close(1001, "Server shutting down");
        });
    }

    /**
     * Get active connection count
     */
    public getConnectionCount(): number {
        return this.activeConnections.size;
    }
}
