import { describe, it, expect } from "vitest";
import { MomentumDivergence } from "../src/indicators/momentumDivergence";

describe("indicators/MomentumDivergence", () => {
    it("detects bullish divergence", () => {
        const md = new MomentumDivergence({ lookbackPeriods: 10, minDataPoints: 10, sampleIntervalMs: 1, slopeThreshold: 0.00001 });
        const base = Date.now();
        for (let i = 0; i < 10; i++) {
            md.addDataPoint(100 - i * 5, 100 + i * 10, base + i);
        }
        const res = md.detectDivergence();
        expect(res.type).toBe("bullish");
        expect(res.strength).toBeGreaterThan(0);
    });

    it("returns stats", () => {
        const md = new MomentumDivergence({ lookbackPeriods: 2, minDataPoints: 2, sampleIntervalMs: 0 });
        md.addDataPoint(1, 1, 1);
        md.addDataPoint(2, 2, 2);
        const stats = md.getStats();
        expect(stats.dataPoints).toBe(2);
        expect(stats.oldestTimestamp).toBe(1);
        expect(stats.newestTimestamp).toBe(2);
    });
});
