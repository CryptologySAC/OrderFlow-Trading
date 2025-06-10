import { Logger } from "../infrastructure/logger.js";
import { ThreadManager } from "./threadManager.js";

export class WorkerLogger extends Logger {
    private workerCorrelationContext = new Map<string, string>();

    constructor(
        private readonly manager: ThreadManager,
        pretty = false
    ) {
        super(pretty);
    }

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

    public override info(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.manager.log("info", message, context, correlationId);
    }

    public override error(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.manager.log("error", message, context, correlationId);
    }

    public override warn(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.manager.log("warn", message, context, correlationId);
    }

    public override debug(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.manager.log("debug", message, context, correlationId);
    }
}
