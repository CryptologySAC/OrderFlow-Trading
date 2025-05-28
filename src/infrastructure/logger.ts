
export interface Logger {
    warn(
        message: string,
        meta?: Record<string, unknown>,
        correlationId?: string
    ): void;
    info(
        message: string,
        meta?: Record<string, unknown>,
        correlationId?: string
    ): void;
    error(
        message: string,
        meta?: Record<string, unknown>,
        correlationId?: string
    ): void;
    debug(
        message: string,
        meta?: Record<string, unknown>,
        correlationId?: string
    ): void;
}
