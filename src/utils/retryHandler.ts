// src/utils/retryHandler.ts
import { ProductionUtils } from "./productionUtils.js";
import { WorkerLogger } from "../multithreading/workerLogger";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";

export interface RetryConfig {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitter: boolean;
    retryIf?: (error: Error) => boolean;
}

export interface RetryContext {
    operation: string;
    component: string;
    correlationId?: string;
    logger?: WorkerLogger;
    metricsCollector?: MetricsCollector;
}

export class RetryError extends Error {
    constructor(
        message: string,
        public readonly attempts: number,
        public readonly lastError: Error,
        public readonly context: RetryContext
    ) {
        super(message);
        this.name = "RetryError";
    }
}

export class RetryHandler {
    /**
     * Default retry configuration for different scenarios
     */
    public static readonly PRESETS = {
        FAST: {
            maxAttempts: 3,
            baseDelayMs: 100,
            maxDelayMs: 1000,
            backoffMultiplier: 2,
            jitter: true,
        },
        STANDARD: {
            maxAttempts: 5,
            baseDelayMs: 1000,
            maxDelayMs: 30000,
            backoffMultiplier: 2,
            jitter: true,
        },
        PERSISTENT: {
            maxAttempts: 10,
            baseDelayMs: 2000,
            maxDelayMs: 60000,
            backoffMultiplier: 1.5,
            jitter: true,
        },
        NETWORK: {
            maxAttempts: 5,
            baseDelayMs: 1000,
            maxDelayMs: 32000,
            backoffMultiplier: 2,
            jitter: true,
            retryIf: (error: Error) => {
                // Retry on network errors, timeouts, rate limits
                return (
                    error.message.includes("ECONNRESET") ||
                    error.message.includes("ETIMEDOUT") ||
                    error.message.includes("rate limit") ||
                    error.message.includes("ENOTFOUND")
                );
            },
        },
    };

    /**
     * Execute operation with exponential backoff retry
     */
    public static async executeWithRetry<T>(
        operation: () => Promise<T>,
        config: RetryConfig,
        context: RetryContext
    ): Promise<T> {
        let lastError: Error;
        let attempt = 0;

        for (attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                const result = await operation();

                // Log successful retry if not first attempt
                if (attempt > 1 && context.logger) {
                    context.logger.info(
                        `[${context.component}] ${context.operation} succeeded after ${attempt} attempts`,
                        { operation: context.operation, attempts: attempt },
                        context.correlationId
                    );

                    if (context.metricsCollector) {
                        context.metricsCollector.recordHistogram(
                            `${context.component}.${context.operation}.retry_attempts`,
                            attempt
                        );
                    }
                }

                return result;
            } catch (error) {
                lastError = error as Error;

                // Check if we should retry this error
                if (config.retryIf && !config.retryIf(lastError)) {
                    if (context.logger) {
                        context.logger.warn(
                            `[${context.component}] ${context.operation} failed with non-retryable error`,
                            {
                                operation: context.operation,
                                attempt,
                                error: lastError.message,
                            },
                            context.correlationId
                        );
                    }
                    break;
                }

                // If this is the last attempt, don't delay
                if (attempt === config.maxAttempts) {
                    break;
                }

                const delayMs = this.calculateBackoffDelay(
                    attempt,
                    config.baseDelayMs,
                    config.maxDelayMs,
                    config.backoffMultiplier,
                    config.jitter
                );

                if (context.logger) {
                    context.logger.warn(
                        `[${context.component}] ${context.operation} failed, retrying in ${delayMs}ms`,
                        {
                            operation: context.operation,
                            attempt,
                            maxAttempts: config.maxAttempts,
                            delayMs,
                            error: lastError.message,
                        },
                        context.correlationId
                    );
                }

                if (context.metricsCollector) {
                    context.metricsCollector.incrementCounter(
                        `${context.component}.${context.operation}.retry_attempts`
                    );
                }

                await ProductionUtils.sleep(delayMs);
            }
        }

        // All attempts failed
        const retryError = new RetryError(
            `${context.operation} failed after ${attempt} attempts: ${lastError!.message}`,
            attempt,
            lastError!,
            context
        );

        if (context.logger) {
            context.logger.error(
                `[${context.component}] ${context.operation} failed permanently`,
                {
                    operation: context.operation,
                    totalAttempts: attempt,
                    finalError: lastError!.message,
                },
                context.correlationId
            );
        }

        if (context.metricsCollector) {
            context.metricsCollector.incrementCounter(
                `${context.component}.${context.operation}.retry_exhausted`
            );
        }

        throw retryError;
    }

    /**
     * Calculate backoff delay with exponential backoff and optional jitter
     */
    private static calculateBackoffDelay(
        attempt: number,
        baseDelayMs: number,
        maxDelayMs: number,
        backoffMultiplier: number,
        jitter: boolean
    ): number {
        // Calculate exponential backoff
        const exponentialDelay =
            baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);

        // Apply maximum delay cap
        const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

        // Add jitter to avoid thundering herd
        if (jitter) {
            const jitterFactor = 0.1; // 10% jitter
            const jitterRange = cappedDelay * jitterFactor;
            const jitterOffset = (Math.random() - 0.5) * jitterRange;
            return Math.max(0, Math.round(cappedDelay + jitterOffset));
        }

        return Math.round(cappedDelay);
    }

    /**
     * Create a retry handler for a specific component
     */
    public static createComponentRetryHandler(
        component: string,
        logger: WorkerLogger,
        metricsCollector?: MetricsCollector
    ) {
        return {
            fast: async <T>(
                operation: string,
                fn: () => Promise<T>,
                correlationId?: string
            ): Promise<T> => {
                return this.executeWithRetry(fn, this.PRESETS.FAST, {
                    operation,
                    component,
                    correlationId,
                    logger,
                    metricsCollector,
                });
            },

            standard: async <T>(
                operation: string,
                fn: () => Promise<T>,
                correlationId?: string
            ): Promise<T> => {
                return this.executeWithRetry(fn, this.PRESETS.STANDARD, {
                    operation,
                    component,
                    correlationId,
                    logger,
                    metricsCollector,
                });
            },

            persistent: async <T>(
                operation: string,
                fn: () => Promise<T>,
                correlationId?: string
            ): Promise<T> => {
                return this.executeWithRetry(fn, this.PRESETS.PERSISTENT, {
                    operation,
                    component,
                    correlationId,
                    logger,
                    metricsCollector,
                });
            },

            network: async <T>(
                operation: string,
                fn: () => Promise<T>,
                correlationId?: string
            ): Promise<T> => {
                return this.executeWithRetry(fn, this.PRESETS.NETWORK, {
                    operation,
                    component,
                    correlationId,
                    logger,
                    metricsCollector,
                });
            },

            custom: async <T>(
                operation: string,
                fn: () => Promise<T>,
                config: RetryConfig,
                correlationId?: string
            ): Promise<T> => {
                return this.executeWithRetry(fn, config, {
                    operation,
                    component,
                    correlationId,
                    logger,
                    metricsCollector,
                });
            },
        };
    }

    /**
     * Synchronous retry for operations that don't return promises
     */
    public static executeWithRetrySynchronous<T>(
        operation: () => T,
        config: Omit<RetryConfig, "baseDelayMs" | "maxDelayMs"> & {
            maxAttempts: number;
        },
        context: Omit<RetryContext, "logger" | "metricsCollector">
    ): T {
        let lastError: Error;
        let attempt = 0;

        for (attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                return operation();
            } catch (error) {
                lastError = error as Error;

                // Check if we should retry this error
                if (config.retryIf && !config.retryIf(lastError)) {
                    break;
                }

                // If this is the last attempt, don't continue
                if (attempt === config.maxAttempts) {
                    break;
                }
            }
        }

        // All attempts failed
        throw new RetryError(
            `${context.operation} failed after ${attempt} attempts: ${lastError!.message}`,
            attempt,
            lastError!,
            context as RetryContext
        );
    }
}
