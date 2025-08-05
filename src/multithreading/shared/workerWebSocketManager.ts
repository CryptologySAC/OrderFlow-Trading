// src/multithreading/shared/workerWebSocketManager.ts
// Worker-specific WebSocket Manager for CLAUDE.md compliance
// Eliminates type casting violations by using worker proxy classes directly

import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import { randomUUID } from "crypto";
import { z } from "zod";
import { WebSocketError } from "../../core/errors.ts";
import type { WebSocketMessage } from "../../utils/interfaces.ts";
import type { ILogger } from "../../infrastructure/loggerInterface.ts";
import type {
    IWorkerRateLimiter,
    IWorkerMetricsCollector,
} from "./workerInterfaces.ts";

export interface ExtendedWebSocket extends WebSocket {
    clientId: string;
    correlationId: string;
    clientState?: {
        id: string;
        connectTime: number;
        lastActivity: number;
        pendingRequests: Set<string>;
    };
}

export type WSHandler<T = unknown> = (
    ws: ExtendedWebSocket,
    data: T,
    correlationId?: string
) => void | Promise<void>;

// Zod schema for incoming WebSocket message validation
const IncomingMessageSchema = z.object({
    type: z.string(),
    data: z.unknown().optional(), // Optional for ping messages
    correlationId: z.string().optional(),
});

/**
 * Worker-thread specific WebSocket manager that uses proxy classes directly
 * Maintains CLAUDE.md compliance by avoiding infrastructure imports in workers
 */
export class WorkerWebSocketManager {
    private readonly wsServer: WebSocketServer;
    private readonly activeConnections = new Set<ExtendedWebSocket>();
    private isShuttingDown = false;

    constructor(
        port: number,
        private readonly logger: ILogger,
        private readonly rateLimiter: IWorkerRateLimiter,
        private readonly metricsCollector: IWorkerMetricsCollector,
        private readonly wsHandlers: Record<string, WSHandler>,
        private readonly onConnect?: (
            ws: ExtendedWebSocket
        ) => void | Promise<void>
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
            ws.clientState = {
                id: clientId,
                connectTime: Date.now(),
                lastActivity: Date.now(),
                pendingRequests: new Set<string>(),
            };
            this.activeConnections.add(ws);

            // Register client with rate limiter
            this.rateLimiter.addClient(clientId);

            this.metricsCollector.updateMetric(
                "connectionsActive",
                this.activeConnections.size
            );
            this.logger.info("Client connected", { clientId }, correlationId);

            if (this.onConnect) {
                Promise.resolve(this.onConnect(ws)).catch((err) => {
                    this.logger.error("onConnect error", { error: err });
                });
            }

            ws.on("close", () => {
                this.activeConnections.delete(ws);

                // Remove client from rate limiter
                this.rateLimiter.removeClient(clientId);

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

        if (!this.rateLimiter.isAllowed(ws.clientId)) {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Rate limit exceeded",
                    correlationId,
                })
            );
            return;
        }

        // Convert Buffer to string if needed, discard other types as potential attack
        let messageStr: string;
        if (typeof message === "string") {
            messageStr = message;
        } else if (Buffer.isBuffer(message)) {
            messageStr = message.toString("utf8");
        } else {
            return; // Discard non-string, non-Buffer messages
        }

        try {
            const parsed: unknown = JSON.parse(messageStr);

            // Validate message structure with Zod
            const validationResult = IncomingMessageSchema.safeParse(parsed);
            if (!validationResult.success) {
                return; // Silently discard invalid messages
            }

            const { type, data } = validationResult.data;
            const handler = this.wsHandlers[type];

            if (!handler) {
                this.logger.warn(
                    "Unknown message type",
                    {
                        type,
                        availableHandlers: Object.keys(this.wsHandlers),
                        clientId: ws.clientId,
                    },
                    correlationId
                );
                return;
            }

            Promise.resolve(handler(ws, data, correlationId)).catch((error) => {
                this.logger.error(
                    "Handler error",
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        type,
                        clientId: ws.clientId,
                    },
                    correlationId
                );
            });
        } catch (error) {
            this.logger.error(
                "Message parsing error",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    clientId: ws.clientId,
                },
                correlationId
            );

            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Invalid message format",
                    correlationId,
                })
            );
        }
    }

    /**
     * Broadcast message to all connected clients
     */
    broadcast(message: WebSocketMessage): void {
        if (this.isShuttingDown) {
            return;
        }

        const serialized = JSON.stringify(message);
        const toRemove: ExtendedWebSocket[] = [];

        for (const ws of this.activeConnections) {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(serialized);
                } else {
                    toRemove.push(ws);
                }
            } catch (error) {
                this.logger.error("Broadcast error", {
                    error,
                    clientId: ws.clientId,
                });
                toRemove.push(ws);
            }
        }

        // Cleanup dead connections
        for (const ws of toRemove) {
            this.activeConnections.delete(ws);
            this.rateLimiter.removeClient(ws.clientId);
        }

        this.metricsCollector.updateMetric(
            "connectionsActive",
            this.activeConnections.size
        );
    }

    /**
     * Send message to specific client
     */
    sendToClient(clientId: string, message: WebSocketMessage): boolean {
        for (const ws of this.activeConnections) {
            if (ws.clientId === clientId && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(message));
                    return true;
                } catch (error) {
                    this.logger.error("Send to client error", {
                        error,
                        clientId,
                    });
                    this.activeConnections.delete(ws);
                    this.rateLimiter.removeClient(clientId);
                    return false;
                }
            }
        }
        return false;
    }

    /**
     * Get connection count
     */
    getConnectionCount(): number {
        return this.activeConnections.size;
    }

    /**
     * Get connection information
     */
    getConnections(): Array<{ clientId: string; correlationId: string }> {
        return Array.from(this.activeConnections).map((ws) => ({
            clientId: ws.clientId,
            correlationId: ws.correlationId,
        }));
    }

    /**
     * Graceful shutdown
     */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;

        this.logger.info("WebSocket server shutting down");

        // Close all connections
        for (const ws of this.activeConnections) {
            try {
                ws.close(1001, "Server shutting down");
                this.rateLimiter.removeClient(ws.clientId);
            } catch (error) {
                this.logger.error("Error closing connection during shutdown", {
                    error,
                    clientId: ws.clientId,
                });
            }
        }

        this.activeConnections.clear();

        // Close the server
        return new Promise<void>((resolve, reject) => {
            this.wsServer.close((error) => {
                if (error) {
                    this.logger.error("Error closing WebSocket server", {
                        error,
                    });
                    reject(
                        new WebSocketError(
                            "Failed to close WebSocket server",
                            "server"
                        )
                    );
                } else {
                    this.logger.info("WebSocket server closed successfully");

                    // Cleanup rate limiter
                    this.rateLimiter.cleanup();

                    resolve();
                }
            });
        });
    }
}
