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

export const MetricsBatchMessageSchema = z.object({
    type: z.literal("metrics_batch"),
    updates: z.array(
        z.object({
            name: z.string(),
            value: z.number(),
            timestamp: z.number(),
            type: z.enum(["update", "increment"]),
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

// Updated WorkerProxyLogger with validation
