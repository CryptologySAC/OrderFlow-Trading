// src/multithreading/shared/workerInterfaces.ts
// Interface contracts for worker proxy implementations

import type {
    EnhancedMetrics,
    HealthSummary,
    HistogramSummary,
} from "../../infrastructure/metricsCollector.js";

/**
 * Minimal interface for metrics collection that workers need
 * Matches the subset of MetricsCollector methods actually used by DataStreamManager
 */
export interface IWorkerMetricsCollector {
    // Core metric operations
    updateMetric(name: string, value: number): void;
    incrementMetric(name: string): void;
    incrementCounter(
        name: string,
        increment?: number,
        labels?: Record<string, string>
    ): void;
    decrementCounter(name: string, decrement?: number): void;
    recordGauge(
        name: string,
        value: number,
        labels?: Record<string, string>
    ): void;
    recordHistogram(
        name: string,
        value: number,
        labels?: Record<string, string>
    ): void;

    // Metric registration and creation
    registerMetric(name: string, type: string, description?: string): void;
    createCounter(name: string, description?: string, labels?: string[]): void;
    createHistogram(
        name: string,
        description?: string,
        labels?: string[],
        buckets?: number[]
    ): void;
    createGauge(name: string, description?: string, labels?: string[]): void;
    setGauge(
        name: string,
        value: number,
        labels?: Record<string, string>
    ): void;

    // Data retrieval
    getMetrics(): EnhancedMetrics;
    getHealthSummary(): HealthSummary;
    getHistogramPercentiles(
        name: string,
        percentiles: number[]
    ): Record<string, number>;
    getCounterRate(name: string, windowMs?: number): number;
    getGaugeValue(name: string): number | null;
    getHistogramSummary(name: string): HistogramSummary | null;
    getAverageLatency(): number;
    getLatencyPercentiles(): Record<string, number>;

    // Export and utility
    exportPrometheus(): string;
    exportJSON(): string;
    reset(): void;
    cleanup(): void;
    destroy?(): void | Promise<void>;
}

/**
 * Minimal interface for circuit breaker that workers need
 * Matches the subset of CircuitBreaker methods actually used by DataStreamManager
 */
export interface IWorkerCircuitBreaker {
    canExecute(): boolean;
    recordError(): void;
    recordSuccess(): void;
    execute<T>(operation: () => Promise<T>): Promise<T>;
    isTripped(): boolean;
    getStats(): {
        errorCount: number;
        isOpen: boolean;
        lastTripTime: number;
    };
}

/**
 * Enhanced interface for rate limiter that workers need
 * Supports both global and client-specific rate limiting
 */
export interface IWorkerRateLimiter {
    // Client-specific rate limiting (compatible with RateLimiter interface)
    isAllowed(clientId: string): boolean;

    // Worker-global rate limiting (backward compatibility)
    isAllowed(): boolean;

    // Client management for WebSocket connections
    addClient(clientId: string): void;
    removeClient(clientId: string): void;

    // Remaining requests tracking
    getRemainingRequests(clientId?: string): number;

    // Cleanup for memory management
    cleanup(): void;
}

/**
 * Correlation context for error tracing
 */
export interface CorrelationContext {
    id: string;
    timestamp: number;
    worker: string;
}

/**
 * Batched metric update for performance
 */
export interface MetricUpdate {
    name: string;
    value: number;
    timestamp: number;
    type: "update" | "increment" | "gauge" | "counter" | "histogram";
    labels?: Record<string, string>;
}
