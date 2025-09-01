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

    // Constants for object validation and size estimation
    private readonly MAX_OBJECT_SIZE_BYTES = 1000000;
    private readonly BASE_OBJECT_OVERHEAD = 16;
    private readonly ARRAY_ELEMENT_OVERHEAD = 8;
    private readonly REMAINING_ELEMENT_ESTIMATE = 16;
    private readonly PROPERTY_OVERHEAD = 32;
    private readonly UTF16_BYTES_PER_CHAR = 2;
    private readonly PRIMITIVE_SIZE_ESTIMATE = 8;

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
            // PERFORMANCE OPTIMIZATION: Fast size and security checks before JSON parsing
            let parsed: unknown;
            try {
                // Basic protection against JSON bombs - check raw string size first
                if (raw.length > 100 * 1024) {
                    // 100KB JSON limit
                    throw new Error("JSON too large");
                }

                // PERFORMANCE: Parse JSON first, then validate
                parsed = JSON.parse(raw);

                // PERFORMANCE OPTIMIZATION: Combined size and security validation
                const validation = this.fastValidateObject(parsed);
                if (!validation.isValid) {
                    throw new Error(validation.error || "Validation failed");
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
     * PERFORMANCE OPTIMIZATION: Fast object validation without expensive JSON operations
     */
    private fastValidateObject(obj: unknown): {
        isValid: boolean;
        error?: string;
    } {
        // Quick type checks first
        if (!obj || typeof obj !== "object") {
            return { isValid: true }; // Primitives are safe
        }

        if (obj === null) {
            return { isValid: true };
        }

        // Fast size estimation without JSON.stringify
        const estimatedSize = this.estimateObjectSize(obj);
        if (estimatedSize > this.MAX_OBJECT_SIZE_BYTES) {
            // 1MB limit
            return {
                isValid: false,
                error: `Object too large (${estimatedSize} bytes)`,
            };
        }

        // Fast depth check with early exit
        const maxDepth = 10;
        const visited = new WeakSet<object>();

        function checkDepth(obj: unknown, depth = 0): boolean {
            if (depth > maxDepth) return false;

            if (!obj || typeof obj !== "object") return true;

            // Prevent circular references
            if (visited.has(obj)) return true;
            visited.add(obj);

            if (Array.isArray(obj)) {
                // Limit array processing for performance
                const maxArrayCheck = Math.min(obj.length, 100);
                for (let i = 0; i < maxArrayCheck; i++) {
                    if (!checkDepth(obj[i], depth + 1)) return false;
                }
            } else {
                // Check object properties
                const keys = Object.keys(obj);
                const maxPropsCheck = Math.min(keys.length, 50);
                for (let i = 0; i < maxPropsCheck; i++) {
                    const key = keys[i];
                    if (key === undefined) continue; // Safety check
                    if (
                        !checkDepth(
                            (obj as Record<string, unknown>)[key],
                            depth + 1
                        )
                    ) {
                        return false;
                    }
                }
            }

            return true;
        }

        if (!checkDepth(obj)) {
            return { isValid: false, error: "Object too deeply nested" };
        }

        // Fast dangerous property check
        const dangerousProps = ["__proto__", "constructor", "prototype"];
        for (const prop of dangerousProps) {
            if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                return {
                    isValid: false,
                    error: `Dangerous property detected: ${prop}`,
                };
            }
        }

        return { isValid: true };
    }

    /**
     * PERFORMANCE OPTIMIZATION: Estimate object size without JSON.stringify
     */
    private estimateObjectSize(
        obj: unknown,
        visited = new WeakSet<object>()
    ): number {
        if (!obj || typeof obj !== "object") {
            if (typeof obj === "string")
                return obj.length * this.UTF16_BYTES_PER_CHAR; // UTF-16 estimate
            return this.PRIMITIVE_SIZE_ESTIMATE; // Primitive size estimate
        }

        if (visited.has(obj)) return 0;
        visited.add(obj);

        let size = this.BASE_OBJECT_OVERHEAD; // Base object overhead

        if (Array.isArray(obj)) {
            size += obj.length * this.ARRAY_ELEMENT_OVERHEAD; // Array element overhead
            // Sample first 10 elements for size estimation
            for (let i = 0; i < Math.min(obj.length, 10); i++) {
                size += this.estimateObjectSize(obj[i], visited);
            }
            if (obj.length > 10) {
                size += (obj.length - 10) * this.REMAINING_ELEMENT_ESTIMATE; // Estimate for remaining elements
            }
        } else {
            const keys = Object.keys(obj);
            size += keys.length * this.PROPERTY_OVERHEAD; // Property overhead
            // Sample first 20 properties
            for (let i = 0; i < Math.min(keys.length, 20); i++) {
                const key = keys[i];
                if (key === undefined) continue; // Safety check
                size += key.length * this.UTF16_BYTES_PER_CHAR; // Key string size
                size += this.estimateObjectSize(
                    (obj as Record<string, unknown>)[key],
                    visited
                );
            }
        }

        return size;
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
    private sanitizeForWebSocket(obj: unknown): unknown {
        const visited = new WeakSet<object>();

        function sanitize(obj: unknown, depth = 0): unknown {
            if (depth > 5) return {}; // Prevent deep recursion

            if (!obj || typeof obj !== "object") {
                return obj;
            }

            // Type guard for objects that can be stored in WeakSet
            if (obj === null || typeof obj !== "object") {
                return obj;
            }

            if (visited.has(obj)) {
                return {}; // Break circular reference
            }

            visited.add(obj);

            if (Array.isArray(obj)) {
                return obj.map((item) => sanitize(item, depth + 1));
            }

            // Handle plain objects
            if (obj.constructor === Object) {
                const result: Record<string, unknown> = {};
                for (const key in obj) {
                    if (
                        Object.prototype.hasOwnProperty.call(obj, key) &&
                        typeof (obj as Record<string, unknown>)[key] !==
                            "function"
                    ) {
                        result[key] = sanitize(
                            (obj as Record<string, unknown>)[key],
                            depth + 1
                        );
                    }
                }
                return result;
            }

            // For other object types, return empty object to avoid issues
            return {};
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
