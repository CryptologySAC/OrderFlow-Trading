// src/websocket/websocketManager.ts

import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import { randomUUID } from "crypto";
import { RateLimiter } from "../infrastructure/rateLimiter.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { WebSocketError } from "../core/errors.js";
import type { WebSocketMessage } from "../utils/interfaces.js";
import { ILogger } from "../infrastructure/loggerInterface.js";
import {
    ValidWebSocketRequestSchema,
    WebSocketRequestSchema,
    type ValidWebSocketRequest,
} from "../multithreading/shared/messageSchemas.js";

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
        private readonly logger: ILogger,
        private readonly rateLimiter: RateLimiter,
        private readonly metricsCollector: IMetricsCollector,
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
            this.activeConnections.add(ws);

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
                // Defensive cleanup to prevent memory leaks
                if (this.activeConnections.has(ws)) {
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
                }
            });

            ws.on("message", (message) => this.handleWSMessage(ws, message));
            ws.on("error", (error) => {
                this.logger.error(
                    "WebSocket error",
                    { error, clientId },
                    correlationId
                );
                // Ensure connection is cleaned up on error
                if (this.activeConnections.has(ws)) {
                    this.activeConnections.delete(ws);
                    this.metricsCollector.updateMetric(
                        "connectionsActive",
                        this.activeConnections.size
                    );
                }
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
            // Security: Safe JSON parsing with size and depth limits
            let parsed: unknown;
            try {
                // Basic protection against JSON bombs
                if (raw.length > 100 * 1024) {
                    // 100KB JSON limit
                    throw new Error("JSON too large");
                }

                parsed = JSON.parse(raw);

                // Security: Check object depth to prevent stack overflow
                const checkDepth = (obj: unknown, depth = 0): void => {
                    if (depth > 10) {
                        // Max 10 levels deep
                        throw new Error("JSON too deeply nested");
                    }
                    if (obj && typeof obj === "object" && obj !== null) {
                        if (Array.isArray(obj)) {
                            obj.forEach((value) =>
                                checkDepth(value, depth + 1)
                            );
                        } else {
                            Object.values(obj).forEach((value) =>
                                checkDepth(value, depth + 1)
                            );
                        }
                    }
                };

                checkDepth(parsed);

                // Security: Check for dangerous object properties (own properties only)
                if (parsed && typeof parsed === "object" && parsed !== null) {
                    const dangerousProps = [
                        "__proto__",
                        "constructor",
                        "prototype",
                    ];
                    for (const prop of dangerousProps) {
                        if (
                            Object.prototype.hasOwnProperty.call(parsed, prop)
                        ) {
                            throw new Error(
                                "Dangerous object property detected"
                            );
                        }
                    }
                }
            } catch (jsonError) {
                this.metricsCollector.incrementCounter(
                    "websocket_json_parse_failures_total",
                    1,
                    { client_id: ws.clientId || "unknown" }
                );

                throw new WebSocketError(
                    `Invalid JSON: ${jsonError instanceof Error ? jsonError.message : "Parse error"}`,
                    ws.clientId || "unknown",
                    correlationId
                );
            }

            // Comprehensive Zod validation with security checks
            const validation = this.validateWSRequest(parsed);
            if (!validation.isValid) {
                this.metricsCollector.incrementCounter(
                    "websocket_validation_failures_total",
                    1,
                    {
                        client_id: ws.clientId || "unknown",
                        error_type: "validation_failed",
                    }
                );

                throw new WebSocketError(
                    validation.error || "Invalid message structure",
                    ws.clientId || "unknown",
                    correlationId
                );
            }

            const { type, data } = validation.data!;
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
     * Parse raw WebSocket message with security checks
     */
    private parseMessage(
        message: RawData,
        clientId: string,
        correlationId: string
    ): string {
        let messageStr: string;

        if (typeof message === "string") {
            messageStr = message;
        } else if (Buffer.isBuffer(message)) {
            // Security: Validate buffer size to prevent memory exhaustion
            if (message.length > 1024 * 1024) {
                // 1MB limit
                throw new WebSocketError(
                    "Message too large",
                    clientId,
                    correlationId
                );
            }
            messageStr = message.toString("utf8");
        } else {
            throw new WebSocketError(
                "Unexpected message format",
                clientId,
                correlationId
            );
        }

        // Security: Validate string length and content
        if (messageStr.length > 1024 * 1024) {
            // 1MB limit
            throw new WebSocketError(
                "Message too large",
                clientId,
                correlationId
            );
        }

        // Security: Basic check for potentially malicious patterns
        if (messageStr.includes("\0") || messageStr.includes("\ufeff")) {
            throw new WebSocketError(
                "Message contains invalid characters",
                clientId,
                correlationId
            );
        }

        return messageStr;
    }

    /**
     * Validate WebSocket request structure using Zod schemas
     */
    private validateWSRequest(obj: unknown): {
        isValid: boolean;
        data?: ValidWebSocketRequest;
        error?: string;
    } {
        // First try strict validation against known message types
        const strictResult = ValidWebSocketRequestSchema.safeParse(obj);
        if (strictResult.success) {
            return { isValid: true, data: strictResult.data };
        }

        // Fallback to basic structure validation for extensibility
        const basicResult = WebSocketRequestSchema.safeParse(obj);
        if (basicResult.success) {
            // Additional security checks for unknown message types
            const msgType = basicResult.data.type;

            // Block potentially dangerous message types
            const dangerousTypes = [
                "eval",
                "exec",
                "script",
                "function",
                "__proto__",
                "constructor",
            ];
            if (dangerousTypes.includes(msgType.toLowerCase())) {
                return {
                    isValid: false,
                    error: `Blocked dangerous message type: ${msgType}`,
                };
            }

            // Warn about unknown message types for monitoring
            this.logger.warn("Unknown WebSocket message type received", {
                type: msgType,
                component: "WebSocketManager",
                security: "unknown_message_type",
            });

            return {
                isValid: true,
                data: basicResult.data as ValidWebSocketRequest,
            };
        }

        // Return detailed validation error
        const errorDetails = strictResult.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ");

        return {
            isValid: false,
            error: `Invalid message structure: ${errorDetails}`,
        };
    }

    /**
     * Send message to a specific client
     */
    public sendToClient(
        ws: ExtendedWebSocket,
        message: WebSocketMessage
    ): void {
        if (this.isShuttingDown || ws.readyState !== WebSocket.OPEN) return;

        // Sanitize message to prevent circular references and deep nesting
        const sanitizedMessage = this.sanitizeForWebSocket(message);

        try {
            ws.send(JSON.stringify(sanitizedMessage));
        } catch (error) {
            this.logger.error("Send to client error", { error });
        }
    }

    /**
     * Broadcast message to all connected clients
     */
    public broadcast(message: WebSocketMessage): void {
        if (this.isShuttingDown) return;

        // Sanitize message to prevent circular references and deep nesting
        const sanitizedMessage = this.sanitizeForWebSocket(message);

        this.wsServer.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(JSON.stringify(sanitizedMessage));
                } catch (error) {
                    this.logger.error("Broadcast error", { error });
                }
            }
        });
    }

    /**
     * Sanitize objects for WebSocket transmission to prevent circular references
     */
    private sanitizeForWebSocket(obj: any): any {
        const visited = new WeakSet();

        function sanitize(obj: any, depth = 0): any {
            if (depth > 5) return {}; // Prevent deep recursion

            if (!obj || typeof obj !== "object") {
                return obj;
            }

            if (visited.has(obj)) {
                return {}; // Break circular reference
            }

            visited.add(obj);

            if (Array.isArray(obj)) {
                return obj.map((item) => sanitize(item, depth + 1));
            }

            const result: any = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key) && typeof obj[key] !== "function") {
                    result[key] = sanitize(obj[key], depth + 1);
                }
            }
            return result;
        }

        return sanitize(obj);
    }

    /**
     * Gracefully shutdown WebSocket server with proper resource cleanup
     */
    public shutdown(): void {
        this.isShuttingDown = true;

        // Close all active connections with proper cleanup
        this.activeConnections.forEach((ws) => {
            const _WS_CLOSE_AWAY = 1001; // Going away
            try {
                ws.close(_WS_CLOSE_AWAY, "Server shutting down");
            } catch (error) {
                this.logger.error("Error closing WebSocket connection", {
                    error,
                });
            }
        });

        // Clear the connections set to prevent memory leaks
        this.activeConnections.clear();

        // Update metrics to reflect zero connections
        this.metricsCollector.updateMetric("connectionsActive", 0);

        this.wsServer.close(() => {
            this.logger.info("WebSocket server closed");
        });
    }

    /**
     * Get active connection count
     */
    public getConnectionCount(): number {
        return this.activeConnections.size;
    }
}
