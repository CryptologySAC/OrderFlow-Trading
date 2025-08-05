// src/multithreading/shared/workerWebSocketAdapter.ts
// Worker WebSocket Adapter for CLAUDE.md compliance
// Bridges worker proxy classes with WebSocketManager requirements

import type {
    IWorkerRateLimiter,
    IWorkerMetricsCollector,
} from "./workerInterfaces.ts";
import type { IMetricsCollector } from "../../infrastructure/metricsCollectorInterface.ts";
import type { RateLimiter } from "../../infrastructure/rateLimiter.ts";

/**
 * Adapter that makes worker proxy classes compatible with WebSocketManager
 * Eliminates need for type casting while maintaining worker thread isolation
 */
export class WorkerWebSocketAdapter {
    constructor(
        private readonly rateLimiter: IWorkerRateLimiter,
        private readonly metrics: IWorkerMetricsCollector
    ) {}

    /**
     * Create a RateLimiter-compatible adapter
     * Maps client-specific rate limiting to worker proxy
     */
    createRateLimiterAdapter(): Pick<RateLimiter, "isAllowed"> {
        return {
            isAllowed: (clientId: string): boolean => {
                return this.rateLimiter.isAllowed(clientId);
            },
        };
    }

    /**
     * Create an IMetricsCollector-compatible adapter
     * Maps metrics operations to worker proxy
     */
    createMetricsAdapter(): Pick<
        IMetricsCollector,
        "updateMetric" | "incrementMetric" | "getMetrics"
    > {
        return {
            updateMetric: (metric: string, value: number | string): void => {
                if (typeof value === "number") {
                    this.metrics.updateMetric(metric, value);
                } else {
                    // Convert string metrics to numeric where possible
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue)) {
                        this.metrics.updateMetric(metric, numValue);
                    }
                }
            },

            incrementMetric: (metric: string, increment: number = 1): void => {
                // Simulate increment by calling updateMetric with increment
                for (let i = 0; i < increment; i++) {
                    this.metrics.incrementMetric(metric);
                }
            },

            getMetrics: () => {
                return this.metrics.getMetrics();
            },
        };
    }

    /**
     * Register a new client for rate limiting tracking
     */
    addClient(clientId: string): void {
        this.rateLimiter.addClient(clientId);
    }

    /**
     * Remove a client from rate limiting tracking
     */
    removeClient(clientId: string): void {
        this.rateLimiter.removeClient(clientId);
    }

    /**
     * Perform cleanup operations
     */
    cleanup(): void {
        this.rateLimiter.cleanup();
        if (this.metrics.cleanup) {
            this.metrics.cleanup();
        }
    }
}
