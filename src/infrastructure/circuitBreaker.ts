// src/infrastructure/circuitBreaker.ts
import { ILogger } from "./loggerInterface";

export enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN",
}

/**
 * Circuit breaker for error handling
 */
export class CircuitBreaker {
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

    getState(): CircuitState {
        return this.state;
    }

    private onSuccess(): void {
        this.errorCount = 0n;
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;

            // Reset if approaching safe limits for serialization
            if (this.successCount > 9007199254740991n) {
                this.successCount = 0n;
            }

            if (this.successCount >= 3n) {
                this.state = CircuitState.CLOSED;
            }
        }
    }

    private onFailure(): void {
        this.errorCount++;
        this.lastErrorTime = Date.now();

        // Reset if approaching safe limits for serialization
        if (this.errorCount > 9007199254740991n) {
            this.errorCount = 0n;
        }

        if (this.errorCount >= BigInt(this.threshold)) {
            this.state = CircuitState.OPEN;
        }
    }

    async execute<T>(
        operation: () => Promise<T>,
        correlationId?: string
    ): Promise<T> {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastErrorTime > this.timeoutMs) {
                this.state = CircuitState.HALF_OPEN;
                this.successCount = 0n;
            } else {
                throw new Error(
                    `Circuit breaker is OPEN. Correlation ID: ${correlationId}`
                );
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
}
