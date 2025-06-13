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

        // Reset error count if enough time has passed
        if (now - this.lastErrorTime > 60000) {
            // 1 minute window
            this.errorCount = 0n;
        }

        // Check if circuit breaker should be reset
        if (this.isOpen && now - this.lastTripTime > this.timeoutMs) {
            this.isOpen = false;
            this.errorCount = 0n;
            this.logger.info("[CircuitBreaker] Circuit breaker reset");
        }

        return !this.isOpen;
    }

    public recordError(): void {
        const now = Date.now();
        this.errorCount++;
        this.lastErrorTime = now;

        // Reset if approaching safe limits for serialization
        if (this.errorCount > 9007199254740991n) {
            this.errorCount = 0n;
        }

        if (this.errorCount >= BigInt(this.threshold) && !this.isOpen) {
            this.isOpen = true;
            this.lastTripTime = now;
            this.logger.error(
                `[CircuitBreaker] Circuit breaker tripped after ${this.errorCount} errors`
            );
        }
    }

    public recordSuccess(): void {
        this.successCount++;
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
        return {
            errorCount: Number(this.errorCount),
            isOpen: this.isOpen,
            lastTripTime: this.lastTripTime,
        };
    }

    getState(): string {
        return this.state;
    }
}
