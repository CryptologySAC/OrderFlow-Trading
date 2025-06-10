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

export const WorkerMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("start") }),
    z.object({ type: z.literal("stop") }),
    z.object({ type: z.literal("shutdown") }),
]);

export type ProxyLogMessage = z.infer<typeof ProxyLogMessageSchema>;
export type ProxyCorrelationMessage = z.infer<
    typeof ProxyCorrelationMessageSchema
>;
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;

// Updated WorkerProxyLogger with validation
