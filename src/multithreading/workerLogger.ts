import { ThreadManager } from "./threadManager.js";
import { ILogger } from "../infrastructure/loggerInterface.js";

/**
 * WorkerLogger that delegates logging to a worker thread
 */
export class WorkerLogger implements ILogger {
    private workerCorrelationContext = new Map<string, string>();

    constructor(
        private readonly manager: ThreadManager,
        private readonly pretty = false
    ) {}

    public setCorrelationId(id: string, context: string): void {
        this.workerCorrelationContext.set(id, context);
        // Forward correlation context to worker thread
        this.manager.setCorrelationContext(id, context);
    }

    public removeCorrelationId(id: string): void {
        this.workerCorrelationContext.delete(id);
        // Forward removal to worker thread
        this.manager.removeCorrelationContext(id);
    }

    public info(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.manager.log("info", message, context, correlationId);
    }

    public error(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.manager.log("error", message, context, correlationId);
    }

    public warn(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.manager.log("warn", message, context, correlationId);
    }

    public debug(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.manager.log("debug", message, context, correlationId);
    }

    public isDebugEnabled(): boolean {
        // For worker logger, assume debug is enabled if NODE_ENV is development
        // or if explicitly configured to enable debug logging
        return (
            process.env["NODE_ENV"] === "development" ||
            process.env["LOG_LEVEL"] === "debug" ||
            this.pretty
        ); // Use pretty flag as debug indicator
    }
}
