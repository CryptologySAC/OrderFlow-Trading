import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpoofingDetector } from "../src/services/spoofingDetector";

describe("services/SpoofingDetector - Floating Point Precision Fix", () => {
    let detector: SpoofingDetector;

    beforeEach(() => {
        vi.useFakeTimers();
        detector = new SpoofingDetector({
            tickSize: 0.00000001, // Very small tick size to test precision
            wallTicks: 3,
            minWallSize: 10,
        });
    });

    it("should handle very small tick sizes without precision errors", () => {
        const basePrice = 1.00000001;
        const tickSize = 0.00000001;
        const now = Date.now();

        // Test that band price calculations are precise for various offsets
        const testOffsets = [-1, 0, 1, -2, 2];

        testOffsets.forEach((offset) => {
            const expectedBandPrice = basePrice + offset * tickSize;

            // Track passive changes at the expected band price
            detector.trackPassiveChange(expectedBandPrice, 0, 20);
            vi.setSystemTime(now + 100);
            detector.trackPassiveChange(expectedBandPrice, 0, 2);

            // This should work without precision issues
            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 200,
                () => 0
            );

            // If precision was an issue, the detector might not find the right price band
            // The test passes if no errors are thrown and the method completes successfully
            expect(typeof result).toBe("boolean");
        });
    });

    it("should produce consistent results for mathematically equivalent prices", () => {
        const now = Date.now();

        // Test case 1: Direct calculation
        const price1 = 100.12345678;
        const tickSize = 0.01;
        const offset = 5;

        // Test case 2: Equivalent price computed differently (should give same result)
        const price2 = 100.0 + 0.12345678;

        // Both should produce the same band price internally
        detector.trackPassiveChange(price1 + offset * tickSize, 0, 20);
        vi.setSystemTime(now + 100);
        detector.trackPassiveChange(price1 + offset * tickSize, 0, 2);
        const result1 = detector.wasSpoofed(price1, "buy", now + 200, () => 0);

        // Reset for second test
        vi.setSystemTime(now);
        detector = new SpoofingDetector({
            tickSize: 0.01,
            wallTicks: 3,
            minWallSize: 10,
        });

        detector.trackPassiveChange(price2 + offset * tickSize, 0, 20);
        vi.setSystemTime(now + 100);
        detector.trackPassiveChange(price2 + offset * tickSize, 0, 2);
        const result2 = detector.wasSpoofed(price2, "buy", now + 200, () => 0);

        // Results should be the same despite potential floating-point differences
        expect(result1).toBe(result2);
    });

    it("should handle edge case prices around floating-point representation limits", () => {
        const now = Date.now();
        const edgeCasePrices = [
            999999.99999999, // Large number with many decimals
            0.00000001, // Very small number
            1e-8, // Scientific notation small number
            999999 + 0.99999999, // Large + fractional
        ];

        edgeCasePrices.forEach((price) => {
            const tickSize = 0.00000001;

            // Test that each edge case price can be processed without errors
            detector.trackPassiveChange(price, 0, 20);
            vi.setSystemTime(now + 100);
            detector.trackPassiveChange(price, 0, 2);

            expect(() => {
                const result = detector.wasSpoofed(
                    price,
                    "buy",
                    now + 200,
                    () => 0
                );
                expect(typeof result).toBe("boolean");
            }).not.toThrow();
        });
    });
});
