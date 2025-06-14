// src/infrastructure/metricsCollectorInterface.ts

import type {
    Metrics,
    EnhancedMetrics,
    HistogramSummary,
    HealthSummary,
} from "./metricsCollector.js";

/**
 * Interface for metrics collection and management
 * Provides abstraction for dependency injection and testing
 */
export interface IMetricsCollector {
    // Metric registration
    registerMetric(
        name: string,
        type: "counter" | "gauge" | "histogram",
        description: string,
        unit?: string,
        labels?: string[]
    ): void;

    // Histogram methods
    recordHistogram(
        name: string,
        value: number,
        labels?: Record<string, string>
    ): void;
    getHistogramPercentiles(
        name: string,
        percentiles: number[]
    ): Record<string, number> | null;
    getHistogramSummary(name: string): HistogramSummary | null;

    // Gauge methods
    recordGauge(
        name: string,
        value: number,
        labels?: Record<string, string>
    ): void;
    getGaugeValue(name: string): number | null;
    createGauge(name: string, description: string, labels?: string[]): void;
    setGauge(
        name: string,
        value: number,
        labels?: Record<string, string>
    ): void;

    // Counter methods
    incrementCounter(
        name: string,
        increment?: number,
        labels?: Record<string, string>
    ): void;
    decrementCounter(name: string, decrement?: number): void;
    getCounterRate(name: string, windowMs?: number): number;
    createCounter(name: string, description: string, labels?: string[]): void;

    // Histogram creation
    createHistogram(
        name: string,
        description?: string,
        labels?: string[],
        buckets?: number[]
    ): void;

    // Legacy metrics methods
    updateMetric(metric: keyof Metrics, value: number | string): void;
    incrementMetric(metric: keyof Metrics, increment?: number): void;
    getMetrics(): EnhancedMetrics;

    // Latency methods
    getAverageLatency(): number;
    getLatencyPercentiles(): Record<string, number>;

    // Export methods
    exportPrometheus(): string;
    exportJSON(): string;

    // Status methods
    getHealthSummary(): HealthSummary;

    // Management methods
    reset(): void;
    cleanup(): void;
}
