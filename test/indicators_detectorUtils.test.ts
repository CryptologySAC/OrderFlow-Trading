import { describe, it, expect } from "vitest";
import { DetectorUtils } from "../src/indicators/base/detectorUtils";
import type { AggressiveTrade } from "../src/types/marketEvents";

describe("indicators/detectorUtils", () => {
    it("calculates basic statistics", () => {
        expect(DetectorUtils.calculateMedian([3, 1, 2])).toBe(2);
        expect(DetectorUtils.calculateMedian([])).toBe(0);
        expect(DetectorUtils.calculatePercentile([1, 2, 3, 4, 5], 50)).toBe(3);
        expect(DetectorUtils.calculateMean([1, 2, 3])).toBeCloseTo(2);
        expect(DetectorUtils.calculateStdDev([1, 2, 3])).toBeCloseTo(1.0, 3);
    });

    it("validates and normalizes trades", () => {
        const raw = {
            p: "100",
            q: "2",
            T: 1,
            m: false,
            s: "TEST",
            a: 1,
        } as any;
        const trade = DetectorUtils.normalizeTradeData(raw);
        expect(trade.price).toBe(100);
        expect(trade.quantity).toBe(2);
        expect(DetectorUtils.isValidTrade(trade as AggressiveTrade)).toBe(true);
        expect(
            DetectorUtils.isValidTrade({
                price: 0,
                quantity: 0,
            } as AggressiveTrade)
        ).toBe(false);
    });

    it("calculates standardized zones correctly", () => {
        // Test with LTCUSDT precision (2 decimals) and 1 tick zones
        // FinancialMath.calculateZone() consistently rounds down to zone boundaries (more predictable)
        expect(DetectorUtils.calculateZone(89.45, 1, 2)).toBe(89.45);
        expect(DetectorUtils.calculateZone(89.456, 1, 2)).toBe(89.45); // Rounds down to zone boundary (correct financial behavior)
        expect(DetectorUtils.calculateZone(89.454, 1, 2)).toBe(89.45);

        // Test with 2-tick zones (zoneSize = 2 * 0.01 = 0.02)
        // FinancialMath always rounds down to zone boundaries for consistency
        expect(DetectorUtils.calculateZone(89.45, 2, 2)).toBe(89.44); // 89.45 rounds down to 89.44 zone
        expect(DetectorUtils.calculateZone(89.43, 2, 2)).toBe(89.42); // 89.43 rounds down to 89.42 zone
        expect(DetectorUtils.calculateZone(89.47, 2, 2)).toBe(89.46); // 89.47 rounds down to 89.46 zone

        // Test floating point precision consistency
        const price = 89.456789;
        const zone1 = DetectorUtils.calculateZone(price, 1, 2);
        const zone2 = DetectorUtils.calculateZone(price, 1, 2);
        expect(zone1).toBe(zone2); // Should be exactly equal
        expect(typeof zone1).toBe("number");
        expect(zone1.toString()).not.toContain("e"); // No scientific notation

        // Test zone boundary consistency - ensure same zones regardless of calculation method
        const testPrices = [89.44, 89.45, 89.46, 89.47, 89.48];
        testPrices.forEach((price) => {
            const zone = DetectorUtils.calculateZone(price, 2, 2);
            expect(typeof zone).toBe("number");
            // Zone should be aligned to 0.02 boundaries
            expect((zone * 100) % 2).toBe(0);
        });
    });
});
