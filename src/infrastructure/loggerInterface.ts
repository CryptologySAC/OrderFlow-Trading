/**
 * Common interface for all logger implementations
 */
export interface ILogger {
    info(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void;

    error(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void;

    warn(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void;

    debug(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void;

    setCorrelationId(id: string, context: string): void;

    removeCorrelationId(id: string): void;
}
