import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker, CircuitState } from "../src/infrastructure/circuitBreaker";
import { Logger } from "../src/infrastructure/logger";

vi.mock("../src/infrastructure/logger");

describe("infrastructure/circuitBreaker", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const create = () => new CircuitBreaker(2, 1000, new Logger());

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
        const cb = new CircuitBreaker(1, 1000, new Logger());
        await expect(cb.execute(async () => {
            throw new Error("fail");
        })).rejects.toThrow();
        await expect(cb.execute(async () => 1, "id")).rejects.toThrow(/Circuit breaker is OPEN/);
    });

    it("state transitions to CLOSED after successes", async () => {
        const cb = new CircuitBreaker(1, 1000, new Logger());
        cb.recordError();
        vi.advanceTimersByTime(1001);
        await cb.execute(async () => 1);
        await cb.execute(async () => 1);
        await cb.execute(async () => 1);
        expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
});
