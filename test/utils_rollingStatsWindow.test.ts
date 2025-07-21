import { describe, it, expect, vi } from "vitest";
import { RollingStatsWindow } from "../src/utils/rollingStatsWindow";

describe("utils/RollingStatsWindow", () => {
    it("tracks stats within time window", () => {
        vi.useFakeTimers();
        const w = new RollingStatsWindow(1000);
        w.push(1, Date.now());
        vi.advanceTimersByTime(500);
        w.push(3, Date.now());
        expect(w.count()).toBe(2);
        expect(w.mean()).toBe(2);
        expect(w.stdDev()).toBeGreaterThan(0);
        vi.advanceTimersByTime(600);
        w.push(5, Date.now());
        // first entry should have been trimmed
        expect(w.count()).toBe(2);
        expect(w.mean()).toBe(4);
        vi.useRealTimers();
    });
});
