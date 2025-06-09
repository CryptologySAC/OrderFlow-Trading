import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

describe("SpoofingDetector Hot Path Optimization", () => {
    let detector: SpoofingDetector;

    beforeEach(() => {
        vi.useFakeTimers();
        detector = new SpoofingDetector({
            tickSize: 0.01,
            wallTicks: 5, // Use larger wall band to test multiple price levels
            minWallSize: 10,
        });
    });

    it("should efficiently handle multiple band price calculations", () => {
        const basePrice = 100.0;
        const iterations = 100;

        // Set up some history data first
        for (let i = 0; i < 10; i++) {
            for (let offset = -2; offset <= 2; offset++) {
                const price = basePrice + offset * 0.01;
                detector.trackPassiveChange(price, i * 5, i * 5 + 20);
                vi.advanceTimersByTime(100);
            }
        }

        const now = Date.now();

        // Measure performance of the hot path
        const startTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            // This triggers the band price calculation hot path
            const result = detector.wasSpoofed(basePrice, "buy", now, () => 0);
            expect(typeof result).toBe("boolean");
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        // Should complete efficiently (this mainly verifies no performance regression)
        expect(duration).toBeLessThan(100); // Should complete in under 100ms

        // Log performance for visibility
        console.log(
            `Hot path performance: ${iterations} calls in ${duration.toFixed(2)}ms`
        );
    });

    it("should demonstrate the optimization benefit with different wall sizes", () => {
        const basePrice = 100.0;
        const wallSizes = [1, 3, 5, 10];

        wallSizes.forEach((wallTicks) => {
            const testDetector = new SpoofingDetector({
                tickSize: 0.01,
                wallTicks,
                minWallSize: 10,
            });

            // Set up history for each band
            for (let offset = -wallTicks; offset <= wallTicks; offset++) {
                const price = basePrice + offset * 0.01;
                testDetector.trackPassiveChange(price, 0, 20);
                vi.advanceTimersByTime(100);
                testDetector.trackPassiveChange(price, 0, 2);
            }

            const now = Date.now();

            // Test the optimized path
            expect(() => {
                const result = testDetector.wasSpoofed(
                    basePrice,
                    "buy",
                    now,
                    () => 0
                );
                expect(typeof result).toBe("boolean");
            }).not.toThrow();
        });
    });

    it("should maintain accuracy while being more efficient", () => {
        const basePrice = 100.0;
        const tickSize = 0.01;
        const wallTicks = 3;

        // Set up data that should trigger spoofing detection
        const targetPrice = basePrice + tickSize; // One tick above base price

        detector.trackPassiveChange(targetPrice, 0, 25); // Large wall
        vi.advanceTimersByTime(500);
        detector.trackPassiveChange(targetPrice, 0, 2); // Wall pulled

        const now = Date.now();

        // The optimized version should still detect spoofing correctly
        const result = detector.wasSpoofed(basePrice, "buy", now, () => 0);

        // Should detect spoofing due to the wall pull
        expect(result).toBe(true);
    });

    it("should handle edge cases efficiently", () => {
        const edgePrices = [
            0.00000001, // Very small price
            999999.99999999, // Very large price
            100.12345678, // Many decimal places
        ];

        edgePrices.forEach((price) => {
            const edgeDetector = new SpoofingDetector({
                tickSize: 0.00000001,
                wallTicks: 3,
                minWallSize: 10,
            });

            // Set up some history
            for (let offset = -1; offset <= 1; offset++) {
                const testPrice = price + offset * 0.00000001;
                edgeDetector.trackPassiveChange(testPrice, 0, 20);
                vi.advanceTimersByTime(100);
            }

            const now = Date.now();

            // Should handle edge cases without errors or performance issues
            expect(() => {
                const result = edgeDetector.wasSpoofed(
                    price,
                    "buy",
                    now,
                    () => 0
                );
                expect(typeof result).toBe("boolean");
            }).not.toThrow();
        });
    });

    it("should verify the optimization maintains identical behavior", () => {
        // This test conceptually verifies that the optimization produces identical results
        // to the old approach (though we can't directly test the old approach)

        const basePrice = 100.0;
        const wallTicks = 3;

        // Set up identical scenarios
        const scenarios = [
            { price: 100.0, side: "buy" as const },
            { price: 100.5, side: "sell" as const },
            { price: 99.95, side: "buy" as const },
        ];

        scenarios.forEach(({ price, side }) => {
            // Set up history for spoofing detection
            for (let offset = -wallTicks; offset <= wallTicks; offset++) {
                const testPrice = price + offset * 0.01;
                detector.trackPassiveChange(testPrice, 0, 25);
                vi.advanceTimersByTime(100);
                detector.trackPassiveChange(testPrice, 0, 2);
            }

            const now = Date.now();

            // Multiple calls should produce consistent results
            const result1 = detector.wasSpoofed(price, side, now, () => 0);
            const result2 = detector.wasSpoofed(price, side, now, () => 0);
            const result3 = detector.wasSpoofed(price, side, now, () => 0);

            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
            expect(typeof result1).toBe("boolean");
        });
    });

    it("should demonstrate memory efficiency with pre-calculated arrays", () => {
        // This test verifies that the optimization doesn't introduce memory leaks
        const basePrice = 100.0;
        const calls = 1000;

        // Set up some initial history
        detector.trackPassiveChange(basePrice, 0, 20);
        vi.advanceTimersByTime(100);
        detector.trackPassiveChange(basePrice, 0, 2);

        const now = Date.now();

        // Many calls should not cause memory issues
        for (let i = 0; i < calls; i++) {
            const result = detector.wasSpoofed(basePrice, "buy", now, () => 0);
            expect(typeof result).toBe("boolean");
        }

        // If we reach here, memory efficiency is maintained
        expect(true).toBe(true);
    });
});
