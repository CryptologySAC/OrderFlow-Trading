import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "../src/infrastructure/rateLimiter";

describe("infrastructure/rateLimiter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("limits requests per rate", () => {
        const rl = new RateLimiter(2, 1);
        expect(rl.isAllowed("a")).toBe(true);
        expect(rl.isAllowed("a")).toBe(true);
        expect(rl.isAllowed("a")).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(rl.isAllowed("a")).toBe(true);
    });

    it("tracks counts and can be cleared", () => {
        const rl = new RateLimiter(2, 1);
        rl.isAllowed("b");
        rl.isAllowed("b");
        expect(rl.getRequestCount("b")).toBe(2);
        rl.clear();
        expect(rl.getRequestCount("b")).toBe(0);
    });

    it("destroy clears data", () => {
        const rl = new RateLimiter(2, 1);
        rl.isAllowed("c");
        rl.destroy();
        expect(rl.getRequestCount("c")).toBe(0);
    });
});
