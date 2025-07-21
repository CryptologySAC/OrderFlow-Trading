// src/multithreading/shared/messageSchemas.ts - Add validation schemas
import { z } from "zod";

export const ProxyLogMessageSchema = z.object({
    type: z.literal("log_message"),
    data: z.object({
        level: z.enum(["info", "error", "warn", "debug"]),
        message: z.string(),
        context: z.record(z.unknown()).optional(),
        correlationId: z.string().optional(),
    }),
});

export const ProxyCorrelationMessageSchema = z.object({
    type: z.literal("log_correlation"),
    action: z.enum(["set", "remove"]),
    id: z.string(),
    context: z.string().optional(),
});

export const MetricsUpdateMessageSchema = z.object({
    type: z.literal("metrics_update"),
    metricName: z.string(),
    value: z.number(),
    worker: z.string(),
});

export const MetricsIncrementMessageSchema = z.object({
    type: z.literal("metrics_increment"),
    metricName: z.string(),
    worker: z.string(),
});

export const CircuitBreakerFailureMessageSchema = z.object({
    type: z.literal("circuit_breaker_failure"),
    failures: z.number(),
    failuresString: z.string().optional(), // Safe BigInt serialization
    failuresIsTruncated: z.boolean().optional(), // Indicates if failures exceeded Number.MAX_SAFE_INTEGER
    worker: z.string(),
    state: z.string().optional(),
    timestamp: z.number().optional(),
    correlationId: z.string().optional(),
});

export const DepthSnapshotRequestMessageSchema = z.object({
    type: z.literal("depth_snapshot_request"),
    symbol: z.string(),
    limit: z.number(),
    correlationId: z.string(),
});

// Schema for validating raw Binance API depth snapshot response
export const BinanceDepthSnapshotSchema = z.object({
    lastUpdateId: z.number(),
    bids: z.array(z.array(z.string())).transform((bids) =>
        bids.map((bid) => {
            if (bid.length < 2)
                throw new Error(
                    `Invalid bid format: expected [price, quantity], got ${JSON.stringify(bid)}`
                );
            return [bid[0], bid[1]] as [string, string];
        })
    ),
    asks: z.array(z.array(z.string())).transform((asks) =>
        asks.map((ask) => {
            if (ask.length < 2)
                throw new Error(
                    `Invalid ask format: expected [price, quantity], got ${JSON.stringify(ask)}`
                );
            return [ask[0], ask[1]] as [string, string];
        })
    ),
});

export const DepthSnapshotResponseMessageSchema = z.object({
    type: z.literal("depth_snapshot_response"),
    correlationId: z.string(),
    success: z.boolean(),
    data: z
        .object({
            lastUpdateId: z.number(),
            bids: z.array(z.tuple([z.string(), z.string()])),
            asks: z.array(z.tuple([z.string(), z.string()])),
        })
        .optional(),
    error: z.string().optional(),
});

export const MetricsBatchMessageSchema = z.object({
    type: z.literal("metrics_batch"),
    updates: z.array(
        z.object({
            name: z.string(),
            value: z.number(),
            timestamp: z.number(),
            type: z.enum([
                "update",
                "increment",
                "gauge",
                "counter",
                "histogram",
            ]),
            labels: z.record(z.string()).optional(),
        })
    ),
    worker: z.string(),
    timestamp: z.number(),
    correlationId: z.string(),
});

export const WorkerMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("start") }),
    z.object({ type: z.literal("stop") }),
    z.object({ type: z.literal("shutdown") }),
    MetricsUpdateMessageSchema,
    MetricsIncrementMessageSchema,
    CircuitBreakerFailureMessageSchema,
    MetricsBatchMessageSchema,
]);

export type ProxyLogMessage = z.infer<typeof ProxyLogMessageSchema>;
export type ProxyCorrelationMessage = z.infer<
    typeof ProxyCorrelationMessageSchema
>;
export type MetricsUpdateMessage = z.infer<typeof MetricsUpdateMessageSchema>;
export type MetricsIncrementMessage = z.infer<
    typeof MetricsIncrementMessageSchema
>;
export type CircuitBreakerFailureMessage = z.infer<
    typeof CircuitBreakerFailureMessageSchema
>;
export type MetricsBatchMessage = z.infer<typeof MetricsBatchMessageSchema>;
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;

// WebSocket message validation schemas
export const WebSocketPingSchema = z.object({
    type: z.literal("ping"),
    data: z.unknown().optional(), // Can include any additional data
    correlationId: z.string().optional(),
});

export const WebSocketBacklogSchema = z.object({
    type: z.literal("backlog"),
    data: z
        .object({
            amount: z.union([z.string(), z.number()]).optional(),
        })
        .optional(),
    correlationId: z.string().optional(),
});

// Generic WebSocket request for validation
export const WebSocketRequestSchema = z.object({
    type: z
        .string()
        .min(1)
        .max(50)
        .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), // Valid identifier
    data: z.unknown().optional(),
    correlationId: z.string().optional(),
});

// Discriminated union for all known WebSocket requests
export const ValidWebSocketRequestSchema = z.discriminatedUnion("type", [
    WebSocketPingSchema,
    WebSocketBacklogSchema,
]);

export type WebSocketPing = z.infer<typeof WebSocketPingSchema>;
export type WebSocketBacklog = z.infer<typeof WebSocketBacklogSchema>;
export type WebSocketRequest = z.infer<typeof WebSocketRequestSchema>;
export type ValidWebSocketRequest = z.infer<typeof ValidWebSocketRequestSchema>;

// Updated WorkerProxyLogger with validation
