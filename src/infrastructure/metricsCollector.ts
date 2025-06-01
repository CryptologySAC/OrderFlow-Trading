// src/infrastructure/metricsCollector.ts

/**
 * Metrics data structure
 */
export interface Metrics {
    signalsGenerated: number;
    connectionsActive: number;
    processingLatency: number[];
    errorsCount: number;
    circuitBreakerState: string;
    uptime: number;
    cvdConfirmations?: number;
    tradeMessages?: number;
    depthMessages?: number;
    absorptionSignals?: number;
    accumulationDetected?: number;
    accumulationErrors?: number;
    invalidTrades?: number;
    preprocessorErrors?: number;
    orderBookStateErrors?: number;
    orderbookCircuitRejected?: number;
    orderbookPruneDuration?: number;
    orderbookPruneRemoved?: number;
    orderbookProcessingErrors?: number;
    orderbookUpdatesProcessed?: number;
    orderbookProcessingTime?: number;
    tradesErrors?: number;
    tradesSaveDropped?: number;
    tradesProcessed?: number;
    tradesProcessingTime?: number;
    absorptionDetected?: number;
    detector_absorptionSignals?: number;
    detector_exhaustionSignals?: number;
    detector_absorptionAggressive_volume?: number;
    detector_exhaustionAggressive_volume?: number;
    detector_absorptionPassive_volume?: number;
    detector_exhaustionPassive_volume?: number;
    absorptionDetectionAttempts?: number;
    absorptionZonesActive?: number;
    absorptionDetectionErrors?: number;
    absorptionSignalsGenerated?: number;
    absorptionPpoofingRejected?: number;
    exhaustionDetectionAttempts?: number;
    exhaustionDetectionErrors?: number;
    exhaustionSpoofingRejected?: number;
    exhaustionRefillRejected?: number;
    exhaustionSignalsGenerated?: number;
}

/**
 * Collects and manages system metrics
 */
export class MetricsCollector {
    private metrics: Metrics = {
        signalsGenerated: 0,
        connectionsActive: 0,
        processingLatency: [],
        errorsCount: 0,
        circuitBreakerState: "CLOSED",
        uptime: Date.now(),
        tradeMessages: 0,
        depthMessages: 0,
    };

    /**
     * Update a metric value
     */
    public updateMetric(metric: keyof Metrics, value: number | string): void {
        if (metric === "processingLatency" && typeof value === "number") {
            this.metrics.processingLatency.push(value);
            // Keep only last 1000 entries
            if (this.metrics.processingLatency.length > 1000) {
                this.metrics.processingLatency =
                    this.metrics.processingLatency.slice(-1000);
            }
        } else if (
            typeof value === "number" &&
            metric !== "processingLatency"
        ) {
            (this.metrics[metric] as number) = value;
        } else if (
            typeof value === "string" &&
            metric === "circuitBreakerState"
        ) {
            this.metrics.circuitBreakerState = value;
        }
    }

    /**
     * Increment a numeric metric
     */
    public incrementMetric(metric: keyof Metrics): void {
        const value = this.metrics[metric];
        if (typeof value === "number") {
            (this.metrics[metric] as number) = value + 1;
        }
    }

    /**
     * Get all metrics
     */
    public getMetrics(): Metrics {
        return {
            ...this.metrics,
            uptime: Date.now() - this.metrics.uptime,
        };
    }

    /**
     * Get average latency
     */
    public getAverageLatency(): number {
        const latencies = this.metrics.processingLatency;
        return latencies.length > 0
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0;
    }

    /**
     * Reset metrics
     */
    public reset(): void {
        this.metrics = {
            signalsGenerated: 0,
            connectionsActive: 0,
            processingLatency: [],
            errorsCount: 0,
            circuitBreakerState: "CLOSED",
            uptime: Date.now(),
            tradeMessages: 0,
            depthMessages: 0,
        };
    }
}
