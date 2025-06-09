import { Logger } from "../infrastructure/logger.js";
import { ThreadManager } from "./threadManager.js";

export class WorkerLogger extends Logger {
    constructor(
        private readonly manager: ThreadManager,
        pretty = false
    ) {
        super(pretty);
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
