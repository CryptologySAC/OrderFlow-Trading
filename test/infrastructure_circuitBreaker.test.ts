import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    CircuitBreaker,
    CircuitState,
} from "../src/infrastructure/circuitBreaker";
import type { ILogger } from "../src/infrastructure/loggerInterface";

describe("infrastructure/circuitBreaker", () => {
    let mockLogger: ILogger;

    beforeEach(() => {
        vi.useFakeTimers();
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn(() => false),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const create = () => new CircuitBreaker(2, 1000, mockLogger);

    it("trips after threshold errors", () => {
        const cb = create();
        cb.recordError();
        expect(cb.isTripped()).toBe(false);
        cb.recordError();
        expect(cb.isTripped()).toBe(true);
    });

    it("resets after timeout", () => {
        const cb = create();
        cb.recordError();
        cb.recordError();
        expect(cb.isTripped()).toBe(true);
        vi.advanceTimersByTime(1001);
        expect(cb.canExecute()).toBe(true);
    });

    it("execute rejects when open", async () => {
        const cb = new CircuitBreaker(1, 1000, mockLogger);
        await expect(
            cb.execute(async () => {
                throw new Error("fail");
            })
        ).rejects.toThrow("fail");

        // After one error with threshold=1, circuit should be open
        expect(cb.getState()).toBe(CircuitState.OPEN);

        await expect(cb.execute(async () => 1)).rejects.toThrow(
            /Circuit breaker is open/
        );
    });

    it("state transitions to CLOSED after successes", async () => {
        const cb = new CircuitBreaker(1, 1000, mockLogger);
        cb.recordError();
        vi.advanceTimersByTime(1001);
        await cb.execute(async () => 1);
        await cb.execute(async () => 1);
        await cb.execute(async () => 1);
        expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
});
