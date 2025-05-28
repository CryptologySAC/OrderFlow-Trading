// src/infrastructure/circuitBreaker.ts

export enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN",
}

/**
 * Circuit breaker pattern for fault tolerance
 */
export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount = 0;
    private lastFailureTime = 0;
    private successCount = 0;

    constructor(
        private readonly threshold: number = 5,
        private readonly timeout: number = 60000,
        private readonly monitoringPeriod: number = 10000
    ) {}

    async execute<T>(
        operation: () => Promise<T>,
        correlationId?: string
    ): Promise<T> {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = CircuitState.HALF_OPEN;
                this.successCount = 0;
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

    private onSuccess(): void {
        this.failureCount = 0;
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= 3) {
                this.state = CircuitState.CLOSED;
            }
        }
    }

    private onFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.threshold) {
            this.state = CircuitState.OPEN;
        }
    }

    getState(): CircuitState {
        return this.state;
    }
}
