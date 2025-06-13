// src/multithreading/shared/workerCircuitBreakerProxy.ts
import { parentPort } from "worker_threads";
import type { IWorkerCircuitBreaker } from "./workerInterfaces.js";
import type { ICircuitBreaker } from "../../infrastructure/circuitBreakerInterface.js";

enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN",
}

/**
 * Worker-side proxy for CircuitBreaker that communicates via message passing
 * Provides complete CircuitBreaker compatibility with error handling
 */
export class WorkerCircuitBreakerProxy
    implements IWorkerCircuitBreaker, ICircuitBreaker
{
    private successCount = 0n;
    private lastFailure = 0;
    private state: CircuitState = CircuitState.CLOSED;
    private lastTripTime = 0;
    private readonly maxFailures: number;
    private readonly timeoutMs: number;
    private readonly workerName: string;

    private errorCount = 0n;

    constructor(maxFailures: number, timeoutMs: number, workerName: string) {
        this.maxFailures = maxFailures;
        this.timeoutMs = timeoutMs;
        this.workerName = workerName;
    }

    canExecute(): boolean {
        const now = Date.now();

        // Reset error count if enough time has passed (1 minute window like original)
        if (now - this.lastFailure > 60000) {
            this.errorCount = 0n;
        }

        // Check if circuit breaker should be reset
        if (
            this.state === CircuitState.OPEN &&
            now - this.lastTripTime > this.timeoutMs
        ) {
            this.state = CircuitState.HALF_OPEN;
            this.errorCount = 0n;
        }

        return this.state !== CircuitState.OPEN;
    }

    recordError(): void {
        const now = Date.now();
        this.errorCount++;
        this.lastFailure = now;

        // Reset if approaching safe limits for serialization (like original)
        if (this.errorCount > 9007199254740991n) {
            this.errorCount = 0n;
        }

        if (
            Number(this.errorCount) >= this.maxFailures &&
            this.state !== CircuitState.OPEN
        ) {
            this.state = CircuitState.OPEN;
            this.lastTripTime = now;

            // Notify main thread with error handling and safe BigInt serialization
            try {
                parentPort?.postMessage({
                    type: "circuit_breaker_failure",
                    failures:
                        this.errorCount <= Number.MAX_SAFE_INTEGER
                            ? Number(this.errorCount)
                            : Number.MAX_SAFE_INTEGER,
                    failuresString: this.errorCount.toString(), // Safe serialization
                    failuresIsTruncated:
                        this.errorCount > Number.MAX_SAFE_INTEGER,
                    worker: this.workerName,
                    state: this.state,
                    timestamp: now,
                    correlationId: this.generateCorrelationId(),
                });
            } catch (error) {
                console.error(
                    `Failed to send circuit breaker notification: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    recordSuccess(): void {
        this.successCount++;
        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.CLOSED;
            this.errorCount = 0n;
        }
    }

    isTripped(): boolean {
        return this.state === CircuitState.OPEN;
    }

    getStats(): {
        errorCount: number;
        isOpen: boolean;
        lastTripTime: number;
        errorCountString?: string;
        errorCountIsTruncated?: boolean;
    } {
        const errorCountNumber =
            this.errorCount <= Number.MAX_SAFE_INTEGER
                ? Number(this.errorCount)
                : Number.MAX_SAFE_INTEGER;

        return {
            errorCount: errorCountNumber,
            isOpen: this.state === CircuitState.OPEN,
            lastTripTime: this.lastTripTime,
            errorCountString: this.errorCount.toString(),
            errorCountIsTruncated: this.errorCount > Number.MAX_SAFE_INTEGER,
        };
    }

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (!this.canExecute()) {
            throw new Error(`Circuit breaker is ${this.state.toLowerCase()}`);
        }

        try {
            const result = await operation();
            this.recordSuccess();
            return result;
        } catch (error) {
            this.recordError();
            throw error;
        }
    }

    getState(): string {
        return this.state;
    }

    private generateCorrelationId(): string {
        return `${this.workerName}-cb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}
