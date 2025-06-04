import { describe, it, expect } from "vitest";
import { DetectorUtils } from "../src/indicators/base/detectorUtils";
import type { AggressiveTrade } from "../src/types/marketEvents";

describe("indicators/detectorUtils", () => {
    it("calculates basic statistics", () => {
        expect(DetectorUtils.calculateMedian([3, 1, 2])).toBe(2);
        expect(DetectorUtils.calculateMedian([])).toBe(0);
        expect(DetectorUtils.calculatePercentile([1, 2, 3, 4, 5], 50)).toBe(3);
        expect(DetectorUtils.calculateMean([1, 2, 3])).toBeCloseTo(2);
        expect(DetectorUtils.calculateStdDev([1, 2, 3])).toBeCloseTo(0.816, 3);
    });

    it("validates and normalizes trades", () => {
        const raw = { p: "100", q: "2", T: 1, m: false, s: "TEST", a: 1 } as any;
        const trade = DetectorUtils.normalizeTradeData(raw);
        expect(trade.price).toBe(100);
        expect(trade.quantity).toBe(2);
        expect(DetectorUtils.isValidTrade(trade as AggressiveTrade)).toBe(true);
        expect(
            DetectorUtils.isValidTrade({ price: 0, quantity: 0 } as AggressiveTrade)
        ).toBe(false);
    });
});
