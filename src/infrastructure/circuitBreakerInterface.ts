// src/infrastructure/circuitBreakerInterface.ts
export interface ICircuitBreaker {
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
    getState(): string;
}
