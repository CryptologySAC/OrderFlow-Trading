// src/multithreading/shared/workerMetricsProxy.ts
import { parentPort } from "worker_threads";
import type { EnhancedMetrics } from "../../infrastructure/metricsCollector.js";
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

    // Batching for performance
    private batchBuffer: MetricUpdate[] = [];
    private batchTimer?: NodeJS.Timeout;
    private readonly batchIntervalMs = 100; // 100ms batching to reduce IPC overhead

    constructor(workerName: string) {
        this.workerName = workerName;
    }

    updateMetric(name: string, value: number): void {
        try {
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
        labels?: Record<string, string>
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
        labels?: Record<string, string>
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

    getHealthSummary(): string {
        const errorCount = this.localMetrics.get("errorsCount") || 0;
        const connectionCount = this.localMetrics.get("connectionsActive") || 0;

        if (errorCount > 10) return "Degraded";
        if (connectionCount === 0) return "Warning";
        return "Healthy";
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

        this.batchTimer = undefined;
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
        return `${this.workerName}-metrics-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Complete MetricsCollector API implementation
    decrementCounter(name: string, decrement: number = 1): void {
        this.incrementCounter(name, -decrement);
    }

    recordHistogram(
        name: string,
        value: number,
        labels?: Record<string, string>
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

    getHistogramSummary(): Record<string, number> | null {
        return null; // Simplified for worker
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
    }
}
