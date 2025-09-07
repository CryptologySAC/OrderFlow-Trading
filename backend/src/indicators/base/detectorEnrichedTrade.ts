// /src/indicators/base/detectorEnrichedTrade.ts
import { EventEmitter } from "events";
import type { ILogger } from "../../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../../infrastructure/signalLoggerInterface.js";
import type { EnrichedTradeEvent } from "../../types/marketEvents.js";
import type { SignalCandidate } from "../../types/signalTypes.js";
import type {
    TraditionalIndicators,
    TraditionalIndicatorValues,
} from "../helpers/traditionalIndicators.js";

/**
 * Abstract base for all detectors (handles logging/metrics/signalLogger).
 */
export abstract class Detector extends EventEmitter {
    public readonly logger: ILogger;
    protected readonly metricsCollector: IMetricsCollector;
    protected readonly signalLogger?: ISignalLogger;
    protected readonly id: string;
    protected readonly traditionalIndicators?: TraditionalIndicators;

    // Performance monitoring
    protected readonly performanceMetrics = {
        lastProcessingTime: 0,
        averageProcessingTime: 0,
        totalProcessed: 0,
        maxProcessingTime: 0,
        slowOperationsCount: 0,
    };

    constructor(
        id: string,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger: ISignalLogger,
        traditionalIndicators?: TraditionalIndicators
    ) {
        super();
        this.id = id;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.signalLogger = signalLogger;
        if (traditionalIndicators) {
            this.traditionalIndicators = traditionalIndicators;
        }
    }

    /**
     * Handle a new trade and evaluate for confirmation.
     * Must be implemented by subclasses.
     */
    public abstract onEnrichedTrade(event: EnrichedTradeEvent): void;

    /**
     * Get detector status.
     * Must be implemented by subclasses.
     */
    public abstract getStatus(): string;

    /**
     * Mark a signal as confirmed to start cooldown.
     * Must be implemented by subclasses.
     */
    public abstract markSignalConfirmed(
        zone: number,
        side: "buy" | "sell"
    ): void;

    /**
     * Performance monitoring helper for detector operations
     */
    protected measurePerformance<T>(
        operation: () => T,
        operationName?: string
    ): T {
        const start = process.hrtime.bigint();
        try {
            return operation();
        } finally {
            const end = process.hrtime.bigint();
            const duration = Number(end - start) / 1_000_000; // Convert to milliseconds (1e6)

            this.performanceMetrics.lastProcessingTime = duration;
            this.performanceMetrics.totalProcessed++;
            this.performanceMetrics.averageProcessingTime =
                (this.performanceMetrics.averageProcessingTime *
                    (this.performanceMetrics.totalProcessed - 1) +
                    duration) /
                this.performanceMetrics.totalProcessed;
            this.performanceMetrics.maxProcessingTime = Math.max(
                this.performanceMetrics.maxProcessingTime,
                duration
            );

            // Alert on performance degradation
            if (duration > 100) {
                // 100ms threshold
                this.performanceMetrics.slowOperationsCount++;
                this.logger?.warn?.("Slow detector operation detected", {
                    component: this.constructor.name,
                    operation: operationName || "unknown",
                    duration,
                    averageTime: this.performanceMetrics.averageProcessingTime,
                    maxTime: this.performanceMetrics.maxProcessingTime,
                    slowOperationsCount:
                        this.performanceMetrics.slowOperationsCount,
                });
            }
        }
    }

    /**
     * Get performance metrics for monitoring
     */
    public getPerformanceMetrics(): {
        lastProcessingTime: number;
        averageProcessingTime: number;
        totalProcessed: number;
        maxProcessingTime: number;
        slowOperationsCount: number;
    } {
        return { ...this.performanceMetrics };
    }

    protected handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.metricsCollector.incrementMetric("errorsCount");
        this.logger.error(
            `[${context}] ${error.message}`,
            {
                context,
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                correlationId,
            },
            correlationId
        );
    }

    /**
     * Get detector ID
     */
    public getId(): string {
        return this.id || `${this.constructor.name}_${Date.now()}`;
    }

    /**
     * Update traditional indicators with trade data (call this for each trade)
     */
    protected updateTraditionalIndicators(trade: EnrichedTradeEvent): void {
        if (this.traditionalIndicators) {
            try {
                this.traditionalIndicators.updateIndicators(trade);
            } catch (error) {
                this.logger.warn("Failed to update traditional indicators", {
                    detectorId: this.id,
                    trade: trade.tradeId,
                    error,
                });
            }
        }
    }

    /**
     * Validate signal against traditional indicators before emission
     */
    protected validateWithTraditionalIndicators(
        price: number,
        side: "buy" | "sell",
        timestamp: number
    ): TraditionalIndicatorValues | null {
        if (!this.traditionalIndicators) {
            return null; // No filtering if traditional indicators not enabled
        }

        try {
            return this.traditionalIndicators.validateSignal(price, side);
        } catch (error) {
            this.logger.error("Traditional indicators validation failed", {
                detectorId: this.id,
                price,
                side,
                timestamp,
                error,
            });
            return null; // Allow signal through if validation fails (defensive)
        }
    }

    /**
     * Emit signal candidate with traditional indicator filtering
     */
    protected emitSignalCandidate(candidate: SignalCandidate): void {
        this.emit("signalCandidate", candidate);
    }

    /**
     * Emit error
     */
    protected emitError(error: Error): void {
        this.emit("error", error);
    }

    /**
     * Emit status change
     */
    protected emitStatusChange(status: string): void {
        this.emit("statusChange", status);
    }
}
