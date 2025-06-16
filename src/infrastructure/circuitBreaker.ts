// src/infrastructure/circuitBreaker.ts
import { ILogger } from "./loggerInterface";
import { ICircuitBreaker } from "./circuitBreakerInterface";

export enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN",
}

/**
 * Circuit breaker for error handling
 */
export class CircuitBreaker implements ICircuitBreaker {
    private errorCount = 0n;
    private successCount = 0n;
    private lastErrorTime = 0;
    private isOpen = false;
    private lastTripTime = 0;
    private state: CircuitState = CircuitState.CLOSED;

    constructor(
        private readonly threshold: number,
        private readonly timeoutMs: number,
        private readonly logger: ILogger
    ) {}

    public canExecute(): boolean {
        const now = Date.now();

        // Reset error count if enough time has passed (1 minute window)
        if (now - this.lastErrorTime > 60000) {
            this.errorCount = 0n;
        }

        // Check if circuit breaker should transition from OPEN to HALF_OPEN
        if (this.isOpen && now - this.lastTripTime > this.timeoutMs) {
            this.isOpen = false;
            this.state = CircuitState.HALF_OPEN;
            this.errorCount = 0n; // Safe reset during state transition
            this.logger.info(
                "[CircuitBreaker] Circuit breaker reset to half-open"
            );
        }

        return !this.isOpen;
    }

    public recordError(): void {
        const now = Date.now();
        this.errorCount++;
        this.lastErrorTime = now;

        // Proper BigInt overflow management for high-frequency trading
        const MAX_BIGINT_SAFE = 9007199254740991n;
        if (this.errorCount > MAX_BIGINT_SAFE) {
            // Maintain circuit state integrity - don't reset to 0 if already tripped
            if (this.isOpen) {
                this.errorCount = BigInt(this.threshold) + 1n; // Keep above threshold
            } else {
                this.errorCount = BigInt(this.threshold); // Set to threshold to trigger
            }
            this.logger.warn(
                "[CircuitBreaker] Error count overflow detected, maintaining circuit state",
                {
                    originalCount: "MAX_SAFE_INTEGER+",
                    newCount: Number(this.errorCount),
                }
            );
        }

        if (this.errorCount >= BigInt(this.threshold) && !this.isOpen) {
            this.isOpen = true;
            this.state = CircuitState.OPEN;
            this.lastTripTime = now;
            this.logger.error(
                `[CircuitBreaker] Circuit breaker tripped after ${this.errorCount} errors`
            );
        }
    }

    public recordSuccess(): void {
        this.successCount++;

        // Prevent successCount overflow in high-frequency scenarios
        const MAX_BIGINT_SAFE = 9007199254740991n;
        if (this.successCount > MAX_BIGINT_SAFE) {
            this.successCount = 1n; // Reset to 1 to maintain success tracking
        }

        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.CLOSED;
            this.isOpen = false;
            this.errorCount = 0n;
            this.logger.info(
                "[CircuitBreaker] Circuit breaker closed after successful operation"
            );
        }
    }

    public async execute<T>(operation: () => Promise<T>): Promise<T> {
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

    public isTripped(): boolean {
        return this.isOpen;
    }

    public getStats(): {
        errorCount: number;
        isOpen: boolean;
        lastTripTime: number;
    } {
        // Safe BigInt to Number conversion with overflow protection
        const MAX_SAFE_INTEGER = 9007199254740991;
        const errorCountNumber =
            this.errorCount > MAX_SAFE_INTEGER
                ? MAX_SAFE_INTEGER
                : Number(this.errorCount);

        return {
            errorCount: errorCountNumber,
            isOpen: this.isOpen,
            lastTripTime: this.lastTripTime,
        };
    }

    getState(): string {
        return this.state;
    }
}
