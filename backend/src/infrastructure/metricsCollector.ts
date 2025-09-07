// src/infrastructure/metricsCollector.ts

import type { IMetricsCollector } from "./metricsCollectorInterface.js";

/**
 * Enhanced metrics data structure with better organization
 */
export interface Metrics {
    // Core system metrics
    signalsGenerated: number;
    connectionsActive: number;
    processingLatency: number[];
    errorsCount: number;
    circuitBreakerState: string;
    uptime: number;

    // Server Metrics
    connections_active?: number;

    // Trade processing metrics
    tradeMessages?: number;
    depthMessages?: number;
    cvdConfirmations?: number;
    tradesProcessed?: number;
    tradesProcessingTime?: number;
    tradesErrors?: number;
    tradesSaveDropped?: number;
    invalidTrades?: number;
    hybridTradesProcessed?: number;
    individualTradesEnhancementErrors?: number;

    // Duplicate detection metrics
    duplicateTradesDetected?: number;
    processedTradeIdsCount?: number;
    tradeIdCleanupOperations?: number;

    // Individual trades metrics
    "individualTrades.cacheHits"?: number;
    "individualTrades.fetchSuccess"?: number;
    "individualTrades.lastFetchSize"?: number;
    "individualTrades.fetchErrors"?: number;

    // Microstructure analysis metrics
    "microstructure.analysisTimeMs"?: number;
    "microstructure.analysisCount"?: number;
    "microstructure.analysisErrors"?: number;

    // Orderbook metrics
    orderbookCircuitRejected?: number;
    orderbookPruneDuration?: number;
    orderbookPruneRemoved?: number;
    orderbookProcessingErrors?: number;
    orderbookUpdatesProcessed?: number;
    orderbookProcessingTime?: number;
    orderBookStateErrors?: number;

    // Detector metrics - Absorption
    absorptionSignals?: number;
    absorptionDetected?: number;
    absorptionDetectionAttempts?: number;
    absorptionZonesActive?: number;
    absorptionDetectionErrors?: number;
    absorptionSignalsGenerated?: number;
    absorptionSpoofingRejected?: number; // Fixed typo from "absorptionPpoofingRejected"
    absorptionSpoofingDetected?: number; // Enhanced absorption spoofing detection
    layeringAttackDetected?: number; // Layering attack detection
    detector_absorptionSignals?: number;
    detector_absorptionAggressive_volume?: number;
    detector_absorptionPassive_volume?: number;

    // Detector metrics - Exhaustion
    exhaustionDetectionAttempts?: number;
    exhaustionDetectionErrors?: number;
    exhaustionSpoofingRejected?: number;
    exhaustionRefillRejected?: number;
    exhaustionSignalsGenerated?: number;
    detector_exhaustionSignals?: number;
    detector_exhaustionAggressive_volume?: number;
    detector_exhaustionPassive_volume?: number;

    // Detector metrics - accumulation
    accumulationDetectionAttempts?: number;
    accumulationZonesActive?: number;
    accumulationDetectionErrors?: number;
    accumulationSignalsGenerated?: number;
    accumulationMarketVolatility?: number;
    accumulationMarketTrendStrength?: number;
    detector_accumulationSignals?: number;
    detector_accumulationAggressive_volume?: number;
    detector_accumulationPassive_volume?: number;

    // Detector metrics - distribution
    distributionDetectionAttempts?: number;
    distributionZonesActive?: number;
    distributionDetectionErrors?: number;
    distributionSignalsGenerated?: number;
    distributionMarketVolatility?: number;
    distributionMarketTrendStrength?: number;

    // Signal processing metrics
    signalCandidatesGenerated?: number;
    signalCandidatesProcessed?: number;
    signalsConfirmed?: number;
    signalsRejected?: number;

    // Signal rejection reasons
    signalsRejectedLowConfidence?: number;
    signalsRejectedUnhealthyMarket?: number;
    signalsRejectedProcessingError?: number;
    signalsRejectedTimeout?: number;
    signalsRejectedDuplicate?: number;

    // Signals by type - candidates
    candidatesAbsorption?: number;
    candidatesExhaustion?: number;
    candidatesAccumulation?: number;
    candidatesDistribution?: number;
    candidatesCvdConfirmation?: number;

    // Signals by type - confirmed
    confirmedAbsorption?: number;
    confirmedExhaustion?: number;
    confirmedAccumulation?: number;
    confirmedDistribution?: number;
    confirmedCvdConfirmation?: number;

    // Signals by type - rejected
    rejectedAbsorption?: number;
    rejectedExhaustion?: number;
    rejectedAccumulation?: number;
    rejectedDistribution?: number;
    rejectedCvdConfirmation?: number;

    // Signal quality metrics
    averageSignalConfidence?: number;
    signalConfidenceTotal?: number;
    signalConfidenceCount?: number;

    // Signal timing metrics
    signalProcessingTime?: number;
    signalQueueDepth?: number;
    signalCorrelationHits?: number;

    // Legacy/cleanup metrics
    accumulationDetected?: number;
    accumulationErrors?: number;
    preprocessorErrors?: number;

    // Flow detector rejection metrics
    accumulationRejectedFlowSpecificValidation?: number;
    accumulationRejectedInsufficientStatisticalSignificance?: number;
    accumulationRejectedInsufficientVolume?: number;
    accumulationRejectedSpoofingDetected?: number;
    distributionRejectedFlowSpecificValidation?: number;
    distributionRejectedInsufficientStatisticalSignificance?: number;
    distributionRejectedInsufficientVolume?: number;
    distributionRejectedSpoofingDetected?: number;

    signals_filtered_traditional_indicators?: number;
}

/**
 * Histogram bucket for time-series data
 */
export interface HistogramBucket {
    count: bigint;
    sum: number;
    buckets: Map<number, bigint>; // bucket_le -> count
    timestamps: number[];
    values: number[];
    bounds?: number[];
}

/**
 * Gauge metric for point-in-time values
 */
export interface GaugeMetric {
    value: number;
    timestamp: number;
    labels?: Record<string, string>;
}

/**
 * Counter metric for incrementing values
 */
export interface CounterMetric {
    value: bigint;
    rate?: number; // per second
    lastIncrement: number;
}

/**
 * Metric metadata for better organization
 */
export interface MetricMetadata {
    name: string;
    type: "counter" | "gauge" | "histogram";
    description: string;
    unit?: string;
    labels?: string[];
}

/**
 * Histogram summary for aggregated statistics
 */
export interface HistogramSummary {
    count: number;
    sum: number;
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    percentiles: Record<string, number>;
}

/**
 * Enhanced metrics structure for export
 */
export interface EnhancedMetrics {
    legacy: Metrics & { uptime: number };
    counters: Record<
        string,
        { value: string; rate?: number; lastIncrement: number }
    >;
    gauges: Record<string, number>;
    histograms: Record<string, HistogramSummary | null>;
    metadata: Record<string, MetricMetadata>;
}

/**
 * Health summary interface
 */
export interface HealthSummary {
    healthy: boolean;
    uptime: number;
    errorRate: number;
    avgLatency: number;
    activeConnections: number;
    timestamp: number;
}

/**
 * Enhanced metrics collector with production-ready features
 */
export class MetricsCollector implements IMetricsCollector {
    private metrics: Metrics;
    private readonly histograms = new Map<string, HistogramBucket>();
    private readonly gauges = new Map<string, GaugeMetric>();
    private readonly counters = new Map<string, CounterMetric>();
    private readonly metadata = new Map<string, MetricMetadata>();
    private startTime = Date.now();
    private lastRateCalculation = Date.now();

    // Configuration
    private readonly maxHistogramSamples = 10000;
    private readonly maxLatencyEntries = 1000;
    private readonly rateCalculationIntervalMs = 5000;

    constructor() {
        this.metrics = this.getDefaultMetrics();
        this.setupCoreMetrics();
        this.startRateCalculationTimer();
    }

    /**
     * Initialize default metrics structure
     */
    private getDefaultMetrics(): Metrics {
        return {
            signalsGenerated: 0,
            connectionsActive: 0,
            processingLatency: [],
            errorsCount: 0,
            circuitBreakerState: "CLOSED",
            uptime: this.startTime,
            tradeMessages: 0,
            depthMessages: 0,
        };
    }

    /**
     * Setup core metrics with metadata
     */
    private setupCoreMetrics(): void {
        // Register core metrics metadata
        this.registerMetric(
            "signals_generated",
            "counter",
            "Total signals generated across all detectors"
        );
        this.registerMetric(
            "processing_latency",
            "histogram",
            "Processing latency in milliseconds",
            "ms"
        );
        this.registerMetric(
            "errors_total",
            "counter",
            "Total number of errors"
        );
        this.registerMetric(
            "connections_active",
            "gauge",
            "Number of active connections"
        );
        this.registerMetric(
            "memory_usage",
            "gauge",
            "Memory usage in MB",
            "MB"
        );
        this.registerMetric("cpu_usage", "gauge", "CPU usage percentage", "%");

        // Detector-specific metrics
        this.registerMetric(
            "detector_signals",
            "counter",
            "Detector signals by type",
            "",
            ["detector_type", "side"]
        );
        this.registerMetric(
            "detector_processing_time",
            "histogram",
            "Detector processing time",
            "ms",
            ["detector_type"]
        );
        this.registerMetric(
            "detector_zones_active",
            "gauge",
            "Active zones being tracked",
            "",
            ["detector_type"]
        );
    }

    /**
     * Register metric metadata
     */
    public registerMetric(
        name: string,
        type: "counter" | "gauge" | "histogram",
        description: string,
        unit: string = "",
        labels: string[] = []
    ): void {
        this.metadata.set(name, { name, type, description, unit, labels });
    }

    // =====================================================
    // STANDARD OBSERVABILITY METHODS (ADDED)
    // =====================================================

    /**
     * Record a histogram value (for latencies, sizes, etc.)
     */
    public recordHistogram(
        name: string,
        value: number,
        labels?: Record<string, string>
    ): void {
        void labels; // Labels not implemented yet, but reserved for future use

        if (!this.histograms.has(name)) {
            this.histograms.set(name, {
                count: 0n,
                sum: 0,
                buckets: new Map(),
                timestamps: [],
                values: [],
            });
        }

        const histogram = this.histograms.get(name)!;
        histogram.count++;
        // Reset if approaching safe limits for serialization
        if (histogram.count > 9007199254740991n) {
            histogram.count = 0n;
        }
        histogram.sum += value;
        histogram.timestamps.push(Date.now());
        histogram.values.push(value);

        // Maintain size limits
        if (histogram.values.length > this.maxHistogramSamples) {
            histogram.values = histogram.values.slice(
                -this.maxHistogramSamples
            );
            histogram.timestamps = histogram.timestamps.slice(
                -this.maxHistogramSamples
            );
        }

        // Update buckets for percentile calculations
        this.updateHistogramBuckets(histogram, value);

        // Also handle legacy processingLatency
        if (name === "processing_latency" || name === "processingLatency") {
            this.updateMetric("processingLatency", value);
        }
    }

    /**
     * Record a gauge value (for current state metrics)
     */
    public recordGauge(
        name: string,
        value: number,
        labels: Record<string, string> = {}
    ): void {
        this.gauges.set(name, {
            value,
            timestamp: Date.now(),
            labels,
        });

        // Handle legacy metric updates
        if (name === "connections_active") {
            this.updateMetric("connectionsActive", value);
        }
    }

    /**
     * Increment a counter
     */
    public incrementCounter(
        name: string,
        increment: number = 1,
        labels?: Record<string, string>
    ): void {
        void labels; // Labels not implemented yet, but reserved for future use

        if (!this.counters.has(name)) {
            this.counters.set(name, {
                value: 0n,
                rate: 0,
                lastIncrement: Date.now(),
            });
        }

        const counter = this.counters.get(name)!;
        counter.value += BigInt(increment);
        counter.lastIncrement = Date.now();

        // Reset if approaching safe limits for serialization
        if (counter.value > 9007199254740991n) {
            counter.value = 0n;
        }

        // Handle legacy increments
        this.handleLegacyCounterUpdate(name, increment);
    }

    /**
     * Decrement a counter
     */
    public decrementCounter(name: string, decrement: number = 1): void {
        this.incrementCounter(name, -decrement);
    }

    // =====================================================
    // ENHANCED QUERY METHODS (ADDED)
    // =====================================================

    /**
     * Get histogram percentiles
     */
    public getHistogramPercentiles(
        name: string,
        percentiles: number[] = [50, 90, 95, 99]
    ): Record<string, number> {
        const histogram = this.histograms.get(name);
        if (!histogram || histogram.values.length === 0) {
            return {};
        }

        const sorted = [...histogram.values].sort((a, b) => a - b);
        const result: Record<string, number> = {};

        for (const p of percentiles) {
            const index = Math.ceil((p / 100) * sorted.length) - 1;
            result[`p${p}`] = sorted[Math.max(0, index)]!;
        }

        return result;
    }

    /**
     * Get counter rate (per second)
     */
    public getCounterRate(name: string, windowMs: number = 60000): number {
        void windowMs; // Not implemented yet, but reserved for windowed rate calculation

        const counter = this.counters.get(name);
        if (!counter) return 0;

        // Simple rate calculation - could be enhanced with proper time windows
        return counter.rate || 0;
    }

    /**
     * Get gauge value
     */
    public getGaugeValue(name: string): number | null {
        const gauge = this.gauges.get(name);
        return gauge ? gauge.value : null;
    }

    /**
     * Get histogram summary
     */
    public getHistogramSummary(name: string): HistogramSummary | null {
        const histogram = this.histograms.get(name);
        if (!histogram || histogram.values.length === 0) {
            return null;
        }

        const percentiles = this.getHistogramPercentiles(name);
        const mean = histogram.sum / Number(histogram.count);
        const values = histogram.values;
        const variance =
            values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
            values.length;
        const stdDev = Math.sqrt(variance);

        return {
            count: Number(histogram.count), // Convert BigInt to number for JSON serialization
            sum: histogram.sum,
            mean,
            min: Math.min(...values),
            max: Math.max(...values),
            stdDev,
            percentiles,
        };
    }

    // =====================================================
    // EXISTING METHODS (IMPROVED)
    // =====================================================

    /**
     * Update a metric value (legacy method, improved)
     */
    public updateMetric(metric: keyof Metrics, value: number | string): void {
        if (metric === "processingLatency" && typeof value === "number") {
            this.metrics.processingLatency.push(value);
            // Keep only last entries
            if (
                this.metrics.processingLatency.length > this.maxLatencyEntries
            ) {
                this.metrics.processingLatency =
                    this.metrics.processingLatency.slice(
                        -this.maxLatencyEntries
                    );
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
     * Increment a numeric metric (legacy method, improved)
     */
    public incrementMetric(metric: keyof Metrics, increment: number = 1): void {
        const value = this.metrics[metric];
        if (typeof value === "number") {
            (this.metrics[metric] as number) = value + increment;
        }

        // Also update new counter system
        this.incrementCounter(metric as string, increment);
    }

    /**
     * Get all metrics (enhanced)
     */
    public getMetrics(): EnhancedMetrics {
        return {
            // Legacy metrics
            legacy: {
                ...this.metrics,
                uptime: Date.now() - this.startTime,
            },

            // Enhanced metrics
            counters: Object.fromEntries(
                Array.from(this.counters.entries()).map(([name, counter]) => [
                    name,
                    {
                        ...counter,
                        value: counter.value.toString(), // Convert BigInt to string for JSON serialization
                    },
                ])
            ),
            gauges: Object.fromEntries(
                Array.from(this.gauges.entries()).map(([name, gauge]) => [
                    name,
                    gauge.value,
                ])
            ),
            histograms: Object.fromEntries(
                Array.from(this.histograms.entries()).map(([name, hist]) => {
                    void hist; // Histogram object not directly used, just getting the name
                    return [name, this.getHistogramSummary(name)];
                })
            ),

            // Metadata
            metadata: Object.fromEntries(this.metadata),
        };
    }

    /**
     * Get average latency (improved)
     */
    public getAverageLatency(): number {
        const latencies = this.metrics.processingLatency;
        if (latencies.length === 0) return 0;

        return latencies.reduce((a, b) => a + b, 0) / latencies.length;
    }

    /**
     * Get latency percentiles
     */
    public getLatencyPercentiles(): Record<string, number> {
        return this.getHistogramPercentiles("processing_latency");
    }

    // =====================================================
    // EXPORT AND MONITORING METHODS (ADDED)
    // =====================================================

    /**
     * Export metrics in Prometheus format
     */
    public exportPrometheus(): string {
        const lines: string[] = [];

        // Export counters
        for (const [name, counter] of this.counters) {
            const metadata = this.metadata.get(name);
            if (metadata) {
                lines.push(`# HELP ${name} ${metadata.description}`);
                lines.push(`# TYPE ${name} counter`);
            }
            lines.push(`${name} ${counter.value.toString()}`);
        }

        // Export gauges
        for (const [name, gauge] of this.gauges) {
            const metadata = this.metadata.get(name);
            if (metadata) {
                lines.push(`# HELP ${name} ${metadata.description}`);
                lines.push(`# TYPE ${name} gauge`);
            }
            lines.push(`${name} ${gauge.value}`);
        }

        // Export histograms
        for (const [name, histogram] of this.histograms) {
            const metadata = this.metadata.get(name);
            if (metadata) {
                lines.push(`# HELP ${name} ${metadata.description}`);
                lines.push(`# TYPE ${name} histogram`);
            }

            // Histogram buckets and summary
            const percentiles = this.getHistogramPercentiles(name);
            lines.push(`${name}_count ${histogram.count.toString()}`);
            lines.push(`${name}_sum ${histogram.sum}`);

            for (const [percentile, value] of Object.entries(percentiles)) {
                lines.push(`${name}_${percentile} ${value}`);
            }
        }

        return lines.join("\n");
    }

    /**
     * Export metrics as JSON
     */
    public exportJSON(): string {
        return JSON.stringify(this.getMetrics(), null, 2);
    }

    /**
     * Get system health summary
     */
    public getHealthSummary(): HealthSummary {
        const now = Date.now();
        const uptimeMs = now - this.startTime;
        const errorRate = this.getCounterRate("errors_total", 60000);
        const avgLatency = this.getAverageLatency();
        const activeConnections = this.getGaugeValue("connections_active") || 0;

        return {
            healthy:
                errorRate < 10 && avgLatency < 1000 && activeConnections > 0,
            uptime: uptimeMs,
            errorRate,
            avgLatency,
            activeConnections,
            circuitBreakerState: this.metrics.circuitBreakerState,
            timestamp: now,
        };
    }

    /**
     * Reset metrics (enhanced)
     */
    public reset(): void {
        this.metrics = this.getDefaultMetrics();
        this.histograms.clear();
        this.gauges.clear();
        this.counters.clear();
        // Keep metadata
        this.startTime = Date.now();
    }

    /**
     * Cleanup old data
     */
    public cleanup(): void {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

        // Cleanup histogram data
        for (const [name, histogram] of this.histograms) {
            void name; // Name not used in cleanup logic, just iterating

            const validIndices = histogram.timestamps
                .map((ts, index) => (ts > cutoff ? index : -1))
                .filter((index) => index >= 0);

            if (validIndices.length < histogram.timestamps.length) {
                histogram.timestamps = validIndices.map(
                    (i) => histogram.timestamps[i]!
                );
                histogram.values = validIndices.map(
                    (i) => histogram.values[i]!
                );
                histogram.count = BigInt(histogram.values.length);
                histogram.sum = histogram.values.reduce((a, b) => a + b, 0);
            }
        }
    }

    // =====================================================
    // PRIVATE HELPER METHODS
    // =====================================================

    private updateHistogramBuckets(
        histogram: HistogramBucket,
        value: number
    ): void {
        // Use custom bucket bounds if provided
        const buckets = histogram.bounds ?? [
            0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
            10000,
        ];

        for (const bucket of buckets) {
            if (value <= bucket) {
                histogram.buckets.set(
                    bucket,
                    (histogram.buckets.get(bucket) || 0n) + 1n
                );
            }
        }
    }

    private handleLegacyCounterUpdate(name: string, increment: number): void {
        // Map new counter names to legacy metric names
        const legacyMapping: Record<string, keyof Metrics> = {
            signals_generated: "signalsGenerated",
            errors_total: "errorsCount",
            trade_messages: "tradeMessages",
            depth_messages: "depthMessages",
            absorption_signals: "absorptionSignals",
            exhaustion_signals: "detector_exhaustionSignals",
        };

        const legacyKey = legacyMapping[name];
        if (legacyKey) {
            const currentValue = this.metrics[legacyKey];
            if (typeof currentValue === "number") {
                (this.metrics[legacyKey] as number) = currentValue + increment;
            }
        }
    }

    private startRateCalculationTimer(): void {
        setInterval(() => {
            this.calculateRates();
        }, this.rateCalculationIntervalMs);
    }

    private calculateRates(): void {
        const now = Date.now();
        const windowMs = now - this.lastRateCalculation;

        for (const [name, counter] of this.counters) {
            void name; // Name not used in rate calculation, just iterating

            // Simple rate calculation - could be more sophisticated
            if (windowMs > 0) {
                counter.rate = (Number(counter.value) * 1000) / windowMs; // per second
            }
        }

        this.lastRateCalculation = now;
    }

    /**
     * Create a counter metric (alias for existing functionality)
     */
    public createCounter(
        name: string,
        description?: string,
        labels?: string[]
    ): void {
        this.registerMetric(
            name,
            "counter",
            description || "",
            undefined,
            labels || []
        );
    }

    /**
     * Create a histogram metric (alias for existing functionality)
     */
    public createHistogram(
        name: string,
        description?: string,
        labels: string[] = [],
        buckets: number[] = []
    ): void {
        this.registerMetric(
            name,
            "histogram",
            description || "",
            "ms",
            labels || []
        );
        // Initialize histogram if not exists
        if (!this.histograms.has(name)) {
            this.histograms.set(name, {
                count: 0n,
                sum: 0,
                buckets: new Map(),
                timestamps: [],
                values: [],
                bounds:
                    buckets && buckets.length > 0
                        ? [...buckets].sort((a, b) => a - b)
                        : [],
            });
        }
    }

    /**
     * Create a gauge metric (alias for existing functionality)
     */
    public createGauge(
        name: string,
        description?: string,
        labels?: string[]
    ): void {
        this.registerMetric(
            name,
            "gauge",
            description || "",
            undefined,
            labels || []
        );
    }

    /**
     * Set gauge value (alias for existing recordGauge)
     */
    public setGauge(
        name: string,
        value: number,
        labels: Record<string, string> = {}
    ): void {
        this.recordGauge(name, value, labels);
    }
}

// =====================================================
// ENHANCED TYPE DEFINITIONS
// =====================================================

export interface HistogramSummary {
    count: number;
    sum: number;
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    percentiles: Record<string, number>;
}

export interface EnhancedMetrics {
    legacy: Metrics & { uptime: number };
    counters: Record<
        string,
        { value: string; rate?: number; lastIncrement: number }
    >;
    gauges: Record<string, number>;
    histograms: Record<string, HistogramSummary | null>;
    metadata: Record<string, MetricMetadata>;
}

export interface HealthSummary {
    healthy: boolean;
    uptime: number;
    errorRate: number;
    avgLatency: number;
    activeConnections: number;
    circuitBreakerState: string;
    timestamp: number;
}

// Export the enhanced class as default
export default MetricsCollector;
