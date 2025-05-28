// src/infrastructure/logger.ts

/**
 * Structured logger for the trading system
 */
export class Logger {
    private correlationContext = new Map<string, string>();

    /**
     * Log info level message
     */
    public info(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("INFO", message, context, correlationId);
    }

    /**
     * Log error level message
     */
    public error(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("ERROR", message, context, correlationId);
    }

    /**
     * Log warning level message
     */
    public warn(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("WARN", message, context, correlationId);
    }

    /**
     * Log debug level message
     */
    public debug(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        this.log("DEBUG", message, context, correlationId);
    }

    /**
     * Core logging method
     */
    private log(
        level: string,
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            correlationId,
            ...context,
        };

        console.log(JSON.stringify(logEntry));
    }

    /**
     * Set correlation context
     */
    public setCorrelationId(id: string, context: string): void {
        this.correlationContext.set(id, context);
    }

    /**
     * Remove correlation context
     */
    public removeCorrelationId(id: string): void {
        this.correlationContext.delete(id);
    }
}
