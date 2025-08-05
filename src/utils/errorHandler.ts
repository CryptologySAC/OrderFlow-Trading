// src/utils/errorHandler.ts
import type { ILogger } from "../infrastructure/loggerInterface.ts";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.ts";

export interface ErrorContext {
    operation: string;
    component: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
}

export interface ErrorHandlerConfig {
    logger: ILogger;
    metricsCollector?: IMetricsCollector;
    throwOnError?: boolean;
    logLevel?: "error" | "warn" | "info";
}

export class StandardError extends Error {
    constructor(
        message: string,
        public readonly context: ErrorContext,
        public readonly originalError?: Error
    ) {
        super(message);
        this.name = "StandardError";

        // Preserve stack trace from original error if available
        if (originalError?.stack) {
            this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
        }
    }
}

export class ErrorHandler {
    /**
     * Standardized error handling wrapper for sync operations
     */
    public static handleError<T>(
        operation: () => T,
        context: ErrorContext,
        config: ErrorHandlerConfig
    ): T | null {
        try {
            return operation();
        } catch (error) {
            return this.processError(error, context, config);
        }
    }

    /**
     * Standardized error handling wrapper for async operations
     */
    public static async handleErrorAsync<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        config: ErrorHandlerConfig
    ): Promise<T | null> {
        try {
            return await operation();
        } catch (error) {
            return this.processError(error, context, config);
        }
    }

    /**
     * Process error with standardized logging and metrics
     */
    private static processError(
        error: unknown,
        context: ErrorContext,
        config: ErrorHandlerConfig
    ): null {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        const standardError = new StandardError(
            `${context.operation} failed: ${errorMessage}`,
            context,
            error instanceof Error ? error : undefined
        );

        // Log error with context
        const logData = {
            operation: context.operation,
            component: context.component,
            error:
                error instanceof Error
                    ? {
                          name: error.name,
                          message: error.message,
                          stack: error.stack,
                      }
                    : error,
            ...context.metadata,
        };

        const logLevel = config.logLevel ?? "error";
        config.logger[logLevel](
            `[${context.component}] ${context.operation} failed`,
            logData,
            context.correlationId
        );

        // Record metrics if collector provided
        if (config.metricsCollector) {
            config.metricsCollector.incrementCounter(
                `${context.component}.${context.operation}.errors`
            );

            // Record error type metrics
            const errorType =
                error instanceof Error ? error.name : "UnknownError";
            config.metricsCollector.incrementCounter(
                `errors.by_type.${errorType}`
            );
        }

        // Throw or return null based on configuration
        if (config.throwOnError) {
            throw standardError;
        }

        return null;
    }

    /**
     * Create a standardized error handler for a specific component
     */
    public static createComponentHandler(
        component: string,
        logger: ILogger,
        metricsCollector?: IMetricsCollector
    ) {
        return {
            handleSync: <T>(
                operation: string,
                fn: () => T,
                metadata?: Record<string, unknown>,
                correlationId?: string
            ): T | null => {
                return this.handleError(
                    fn,
                    { operation, component, metadata, correlationId },
                    { logger, metricsCollector, throwOnError: false }
                );
            },

            handleAsync: async <T>(
                operation: string,
                fn: () => Promise<T>,
                metadata?: Record<string, unknown>,
                correlationId?: string
            ): Promise<T | null> => {
                return this.handleErrorAsync(
                    fn,
                    { operation, component, metadata, correlationId },
                    { logger, metricsCollector, throwOnError: false }
                );
            },

            handleSyncThrow: <T>(
                operation: string,
                fn: () => T,
                metadata?: Record<string, unknown>,
                correlationId?: string
            ): T => {
                const result = this.handleError(
                    fn,
                    { operation, component, metadata, correlationId },
                    { logger, metricsCollector, throwOnError: true }
                );
                return result!; // Safe because throwOnError is true
            },

            handleAsyncThrow: async <T>(
                operation: string,
                fn: () => Promise<T>,
                metadata?: Record<string, unknown>,
                correlationId?: string
            ): Promise<T> => {
                const result = await this.handleErrorAsync(
                    fn,
                    { operation, component, metadata, correlationId },
                    { logger, metricsCollector, throwOnError: true }
                );
                return result!; // Safe because throwOnError is true
            },
        };
    }

    /**
     * Simple wrapper for handling errors in class methods
     * Use this instead of the decorator for better type safety
     */
    public static wrapMethod<T>(
        operation: string,
        component: string,
        logger: ILogger,
        fn: () => T,
        metricsCollector?: IMetricsCollector,
        correlationId?: string
    ): T | null {
        return this.handleError(
            fn,
            { operation, component, correlationId },
            { logger, metricsCollector, throwOnError: false }
        );
    }

    /**
     * Simple async wrapper for handling errors in class methods
     */
    public static async wrapAsyncMethod<T>(
        operation: string,
        component: string,
        logger: ILogger,
        fn: () => Promise<T>,
        metricsCollector?: IMetricsCollector,
        correlationId?: string
    ): Promise<T | null> {
        return this.handleErrorAsync(
            fn,
            { operation, component, correlationId },
            { logger, metricsCollector, throwOnError: false }
        );
    }
}
