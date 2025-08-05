// src/multithreading/shared/workerMetricsProxy.ts
import { parentPort } from "worker_threads";
import type {
    EnhancedMetrics,
    HealthSummary,
    HistogramSummary,
} from "../../infrastructure/metricsCollector.js";
import type {
    IWorkerMetricsCollector,
    MetricUpdate,
} from "./workerInterfaces.js";

/**
 * Worker-side proxy for MetricsCollector with batching and complete compatibility
 * Replaces direct infrastructure imports in worker threads
 */
export class WorkerMetricsProxy implements IWorkerMetricsCollector {
    private localMetrics = new Map<string, number>();
    private counterMetrics = new Map<
        string,
        { value: number; lastIncrement: number }
    >();
    private gaugeMetrics = new Map<string, number>();
    private readonly workerName: string;
    private readonly startTime = Date.now();
    private lastRateCalculation = Date.now();

    // Memory leak prevention
    private readonly MAX_METRICS = 10000;
    private readonly CLEANUP_INTERVAL = 300000; // 5 minutes
    private lastCleanup = Date.now();
    private cleanupTimer?: NodeJS.Timeout;

    // Batching for performance
    private batchBuffer: MetricUpdate[] = [];
    private batchTimer?: NodeJS.Timeout;
    private readonly batchIntervalMs = 100; // 100ms batching to reduce IPC overhead

    constructor(workerName: string) {
        this.workerName = workerName;

        // Initialize cleanup timer
        this.cleanupTimer = setInterval(() => {
            this.cleanupOldMetrics();
        }, this.CLEANUP_INTERVAL);
    }

    updateMetric(name: string, value: number): void {
        try {
            this.checkAndCleanupIfNeeded();

            this.localMetrics.set(name, value);
            this.gaugeMetrics.set(name, value);

            this.addToBatch({
                name,
                value,
                timestamp: Date.now(),
                type: "update",
            });
        } catch {
            // Silent failure - metrics updates should not disrupt operation
        }
    }

    incrementMetric(name: string): void {
        try {
            this.checkAndCleanupIfNeeded();

            const current = this.localMetrics.get(name) || 0;
            const newValue = current + 1;
            this.localMetrics.set(name, newValue);

            const now = Date.now();
            this.counterMetrics.set(name, {
                value: newValue,
                lastIncrement: now,
            });

            this.addToBatch({
                name,
                value: newValue,
                timestamp: now,
                type: "increment",
            });
        } catch {
            // Silent failure - metric increments should not disrupt operation
        }
    }

    incrementCounter(
        name: string,
        increment: number = 1,
        labels: Record<string, string> = {}
    ): void {
        try {
            const current = this.localMetrics.get(name) || 0;
            const newValue = current + increment;
            this.localMetrics.set(name, newValue);

            const now = Date.now();
            this.counterMetrics.set(name, {
                value: newValue,
                lastIncrement: now,
            });

            this.addToBatch({
                name,
                value: newValue,
                timestamp: now,
                type: "counter",
                labels,
            });
        } catch {
            // Silent failure - counter increments should not disrupt operation
        }
    }

    recordGauge(
        name: string,
        value: number,
        labels: Record<string, string> = {}
    ): void {
        try {
            this.localMetrics.set(name, value);
            this.gaugeMetrics.set(name, value);

            this.addToBatch({
                name,
                value,
                timestamp: Date.now(),
                type: "gauge",
                labels,
            });

            // Handle legacy metric updates for compatibility
            if (name === "connections_active") {
                this.updateMetric("connectionsActive", value);
            }
        } catch {
            // Silent failure - gauge records should not disrupt operation
        }
    }

    getMetrics(): EnhancedMetrics {
        const now = Date.now();
        const uptime = now - this.startTime;

        // Build counters with rates
        const counters: Record<
            string,
            { value: string; rate?: number; lastIncrement: number }
        > = {};
        this.counterMetrics.forEach((counter, name) => {
            const timeSinceLastCalc = now - this.lastRateCalculation;
            const rate =
                timeSinceLastCalc > 0
                    ? (counter.value / timeSinceLastCalc) * 1000
                    : 0;

            counters[name] = {
                value: counter.value.toString(),
                rate,
                lastIncrement: counter.lastIncrement,
            };
        });

        // Build gauges
        const gauges: Record<string, number> = {};
        this.gaugeMetrics.forEach((value, name) => {
            gauges[name] = value;
        });

        // Legacy metrics for compatibility - use required Metrics structure
        const legacy = {
            signalsGenerated: this.localMetrics.get("signalsGenerated") || 0,
            connectionsActive: this.localMetrics.get("connectionsActive") || 0,
            processingLatency: [
                this.localMetrics.get("processingLatency") || 0,
            ], // Array as required by interface
            errorsCount: this.localMetrics.get("errorsCount") || 0,
            circuitBreakerState: "CLOSED", // Required field
            uptime,
        };

        return {
            legacy,
            counters,
            gauges,
            histograms: {}, // Worker doesn't track histograms for performance
            metadata: this.getMetadata() as Record<
                string,
                import("../../infrastructure/metricsCollector.js").MetricMetadata
            >,
        };
    }

    getHealthSummary(): HealthSummary {
        const errorCount = this.localMetrics.get("errorsCount") || 0;
        const connectionCount = this.localMetrics.get("connectionsActive") || 0;
        const uptime = Date.now() - this.startTime;

        const healthy = errorCount <= 10 && connectionCount > 0;

        return {
            healthy,
            uptime,
            errorRate: errorCount / (uptime / 60000), // errors per minute
            avgLatency: this.localMetrics.get("processingLatency") || 0,
            activeConnections: connectionCount,
            circuitBreakerState:
                this.localMetrics.get("circuitBreakerState")?.toString() ||
                "CLOSED",
            timestamp: Date.now(),
        };
    }

    private addToBatch(update: MetricUpdate): void {
        this.batchBuffer.push(update);

        if (!this.batchTimer) {
            this.batchTimer = setTimeout(
                () => this.flushBatch(),
                this.batchIntervalMs
            );
        }

        // Flush immediately if buffer is getting large
        if (this.batchBuffer.length >= 50) {
            this.flushBatch();
        }
    }

    private flushBatch(): void {
        if (this.batchBuffer.length > 0) {
            try {
                parentPort?.postMessage({
                    type: "metrics_batch",
                    updates: this.batchBuffer,
                    worker: this.workerName,
                    timestamp: Date.now(),
                    correlationId: this.generateCorrelationId(),
                });
            } catch {
                // Silent failure - metrics batch sending should not disrupt operation
            }

            this.batchBuffer = [];
        }

        delete this.batchTimer;
        this.lastRateCalculation = Date.now();
    }

    private getMetadata(): Record<string, unknown> {
        return {
            worker: this.workerName,
            startTime: this.startTime,
            lastUpdate: Date.now(),
            metricCount: this.localMetrics.size,
        };
    }

    private generateCorrelationId(): string {
        return `${this.workerName}-metrics-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }

    private checkAndCleanupIfNeeded(): void {
        const now = Date.now();
        if (now - this.lastCleanup > this.CLEANUP_INTERVAL) {
            this.cleanupOldMetrics();
        }
    }

    private cleanupOldMetrics(): void {
        const now = Date.now();
        this.lastCleanup = now;

        // Clean up localMetrics if exceeding limit
        if (this.localMetrics.size > this.MAX_METRICS) {
            const entries = Array.from(this.localMetrics.entries());
            // Keep 80% of the limit, removing oldest entries
            const toKeep = entries.slice(-Math.floor(this.MAX_METRICS * 0.8));
            this.localMetrics = new Map(toKeep);
        }

        // Clean up counterMetrics if exceeding limit
        if (this.counterMetrics.size > this.MAX_METRICS) {
            const entries = Array.from(this.counterMetrics.entries());
            // Sort by lastIncrement timestamp, keep most recent
            entries.sort((a, b) => b[1].lastIncrement - a[1].lastIncrement);
            const toKeep = entries.slice(0, Math.floor(this.MAX_METRICS * 0.8));
            this.counterMetrics = new Map(toKeep);
        }

        // Clean up gaugeMetrics if exceeding limit
        if (this.gaugeMetrics.size > this.MAX_METRICS) {
            const entries = Array.from(this.gaugeMetrics.entries());
            const toKeep = entries.slice(-Math.floor(this.MAX_METRICS * 0.8));
            this.gaugeMetrics = new Map(toKeep);
        }

        // Clean up old counter metrics (>1 hour old)
        const oneHourAgo = now - 3600000;
        for (const [name, counter] of this.counterMetrics.entries()) {
            if (counter.lastIncrement < oneHourAgo) {
                this.counterMetrics.delete(name);
            }
        }
    }

    // Complete MetricsCollector API implementation
    decrementCounter(name: string, decrement: number = 1): void {
        this.incrementCounter(name, -decrement);
    }

    recordHistogram(
        name: string,
        value: number,
        labels: Record<string, string> = {}
    ): void {
        try {
            this.localMetrics.set(`${name}_histogram`, value);
            this.addToBatch({
                name,
                value,
                timestamp: Date.now(),
                type: "histogram",
                labels,
            });
        } catch {
            // Silent failure
        }
    }

    registerMetric(): void {
        // No-op for worker proxy
    }

    getHistogramPercentiles(): Record<string, number> {
        return {}; // Simplified for worker
    }

    getCounterRate(name: string): number {
        const counter = this.counterMetrics.get(name);
        if (!counter) return 0;
        const timeDiff = Date.now() - counter.lastIncrement;
        return timeDiff > 0 ? (counter.value / timeDiff) * 1000 : 0;
    }

    getGaugeValue(name: string): number | null {
        return this.gaugeMetrics.get(name) ?? null;
    }

    getHistogramSummary(name: string): HistogramSummary | null {
        // Simplified for worker - return null as histograms are not tracked in detail
        void name;
        return null;
    }

    getAverageLatency(): number {
        return this.localMetrics.get("processingLatency") || 0;
    }

    getLatencyPercentiles(): Record<string, number> {
        return {}; // Simplified for worker
    }

    exportPrometheus(): string {
        return ""; // Not needed in worker
    }

    exportJSON(): string {
        return JSON.stringify(this.getMetrics());
    }

    reset(): void {
        this.localMetrics.clear();
        this.counterMetrics.clear();
        this.gaugeMetrics.clear();
    }

    cleanup(): void {
        this.reset();
        this.destroy();
    }

    createCounter(): void {
        // No-op for worker proxy
    }

    createHistogram(): void {
        // No-op for worker proxy
    }

    createGauge(): void {
        // No-op for worker proxy
    }

    setGauge(
        name: string,
        value: number,
        labels?: Record<string, string>
    ): void {
        this.recordGauge(name, value, labels);
    }

    // Cleanup method for graceful shutdown
    destroy(): void {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.flushBatch(); // Final flush
        }

        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
    }
}
