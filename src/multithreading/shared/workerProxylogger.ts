// shared/workerProxyLogger.ts
import { parentPort } from "worker_threads";
import type { ILogger } from "../../infrastructure/loggerInterface.js";
import { ProxyLogMessage, ProxyLogMessageSchema } from "./messageSchemas.js";

/**
 * Proxy logger that forwards log messages to the logger worker via parent thread
 */

export class WorkerProxyLogger implements ILogger {
    private correlationContext = new Map<string, string>();

    constructor(private readonly workerName: string) {}

    public setCorrelationId(id: string, context: string): void {
        this.correlationContext.set(id, context);
        // Forward to logger worker
        parentPort?.postMessage({
            type: "log_correlation",
            action: "set",
            id,
            context,
        });
    }

    public removeCorrelationId(id: string): void {
        this.correlationContext.delete(id);
        // Forward to logger worker
        parentPort?.postMessage({
            type: "log_correlation",
            action: "remove",
            id,
        });
    }

    public info(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.sendLogMessage("info", message, context, correlationId);
    }

    public error(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.sendLogMessage("error", message, context, correlationId);
    }

    public warn(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.sendLogMessage("warn", message, context, correlationId);
    }

    public debug(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.sendLogMessage("debug", message, context, correlationId);
    }

    private sendLogMessage(
        level: "info" | "error" | "warn" | "debug",
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        try {
            const enhancedContext = {
                ...context,
                worker: this.workerName,
                timestamp: new Date().toISOString(),
            };

            const logMessage: ProxyLogMessage = {
                type: "log_message",
                data: {
                    level,
                    message,
                    context: enhancedContext,
                    correlationId,
                },
            };

            // Validate message before sending
            const validation = ProxyLogMessageSchema.safeParse(logMessage);
            if (!validation.success) {
                console.error(
                    `[${this.workerName}] Invalid log message:`,
                    validation.error
                );
                return;
            }

            parentPort?.postMessage(logMessage);
        } catch (error) {
            console.error(
                `[${this.workerName}] Failed to send log message:`,
                error
            );
            console[level](`[${this.workerName}] ${message}`, context);
        }
    }
}
