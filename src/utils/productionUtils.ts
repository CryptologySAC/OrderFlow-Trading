// src/utils/productionUtils.ts - NEW UTILITY CLASS
import type { BaseDetectorSettings } from "../indicators/interfaces/detectorInterfaces.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { CircuitBreaker } from "../infrastructure/circuitBreaker.js";

export class ProductionUtils {
    /**
     * Circuit breaker for detector error handling
     */
    public static createCircuitBreaker(
        errorThreshold: number,
        timeoutMs: number,
        logger: Logger
    ): CircuitBreaker {
        return new CircuitBreaker(errorThreshold, timeoutMs, logger);
    }

    /**
     * Memory usage monitoring
     */
    public static getMemoryUsage(): number {
        if (typeof process !== "undefined" && process.memoryUsage) {
            return process.memoryUsage().heapUsed / 1024 / 1024; // MB
        }
        return 0;
    }

    /**
     * Performance monitoring wrapper
     */
    public static measurePerformance<T>(
        operation: () => T,
        metricsCollector: MetricsCollector,
        operationName: string
    ): T {
        const startTime = Date.now();
        try {
            const result = operation();
            const duration = Date.now() - startTime;
            metricsCollector.recordHistogram(
                `${operationName}.duration`,
                duration
            );
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            metricsCollector.recordHistogram(
                `${operationName}.error_duration`,
                duration
            );
            metricsCollector.incrementCounter(
                `${operationName}.error_duration`
            );
            void operationName;
            throw error;
        }
    }

    /**
     * Validate detector configuration
     */
    public static validateProductionConfig(
        settings: BaseDetectorSettings
    ): void {
        const errors: string[] = [];

        if (settings.windowMs && settings.windowMs < 5000) {
            errors.push("windowMs should be at least 5000ms in production");
        }

        if (settings.minAggVolume && settings.minAggVolume < 100) {
            errors.push("minAggVolume should be at least 100 in production");
        }

        if (settings.eventCooldownMs && settings.eventCooldownMs < 5000) {
            errors.push(
                "eventCooldownMs should be at least 5000ms in production"
            );
        }

        if (!settings.symbol) {
            errors.push("symbol is required in production");
        }

        if (errors.length > 0) {
            throw new Error(
                `Production config validation failed: ${errors.join(", ")}`
            );
        }
    }
}
