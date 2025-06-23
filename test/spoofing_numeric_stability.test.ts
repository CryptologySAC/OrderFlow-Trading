// test/spoofing_numeric_stability.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { SpoofingDetectorConfig } from "../src/services/spoofingDetector.js";

describe("SpoofingDetector Numeric Stability Fixes", () => {
    let detector: SpoofingDetector;
    let mockLogger: ILogger;
    let config: SpoofingDetectorConfig;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: () => false,
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        config = {
            tickSize: 0.01,
            wallTicks: 10,
            minWallSize: 20,
            dynamicWallWidth: false,
            testLogMinSpoof: 50,
            maxCancellationRatio: 0.8,
            rapidCancellationMs: 500,
            algorithmicPatternThreshold: 0.9,
            layeringDetectionLevels: 3,
            ghostLiquidityThresholdMs: 200,
        };

        detector = new SpoofingDetector(config, mockLogger);
    });

    it("should handle NaN price values without crashing in trackOrderPlacement", () => {
        detector.trackOrderPlacement(NaN, "bid", 10, "test_placement_1");

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[SpoofingDetector] Invalid price in trackOrderPlacement, skipping",
            expect.objectContaining({
                price: NaN,
                side: "bid",
                quantity: 10,
                placementId: "test_placement_1",
            })
        );
    });

    it("should handle Infinity quantity values without crashing in trackOrderPlacement", () => {
        detector.trackOrderPlacement(100, "ask", Infinity, "test_placement_2");

        // Should log a warning about invalid quantity
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[SpoofingDetector] Invalid quantity in trackOrderPlacement, skipping",
            expect.objectContaining({
                price: 100,
                side: "ask",
                quantity: Infinity,
                placementId: "test_placement_2",
            })
        );
    });

    it("should handle zero price values gracefully in trackOrderPlacement", () => {
        detector.trackOrderPlacement(0, "bid", 10, "test_placement_3");

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[SpoofingDetector] Invalid price in trackOrderPlacement, skipping",
            expect.objectContaining({
                price: 0,
                side: "bid",
                quantity: 10,
                placementId: "test_placement_3",
            })
        );
    });

    it("should handle NaN price values without crashing in trackOrderCancellation", () => {
        detector.trackOrderCancellation(NaN, "bid", 10, "test_cancel_1", Date.now());

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[SpoofingDetector] Invalid price in trackOrderCancellation, skipping",
            expect.objectContaining({
                price: NaN,
                side: "bid",
                quantity: 10,
                placementId: "test_cancel_1",
            })
        );
    });

    it("should handle zero quantity values gracefully in trackOrderCancellation", () => {
        detector.trackOrderCancellation(100, "ask", 0, "test_cancel_2", Date.now());

        // Should log a warning about invalid quantity (zero)
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[SpoofingDetector] Invalid quantity in trackOrderCancellation, skipping",
            expect.objectContaining({
                price: 100,
                side: "ask",
                quantity: 0,
                placementId: "test_cancel_2",
            })
        );
    });

    it("should handle NaN price values without crashing in trackPassiveChange", () => {
        detector.trackPassiveChange(NaN, 10, 20);

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[SpoofingDetector] Invalid price in trackPassiveChange, skipping",
            expect.objectContaining({
                price: NaN,
                bid: 10,
                ask: 20,
            })
        );
    });

    it("should handle Infinity bid/ask values gracefully in trackPassiveChange", () => {
        // This should not crash and should process with valid values
        detector.trackPassiveChange(100, Infinity, -Infinity);

        // Should not log warnings since we handle Infinity bid/ask internally
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining("Invalid price"),
            expect.anything()
        );
    });

    it("should validate numeric helper methods correctly", () => {
        const detector_internal = detector as any;

        // Test validateNumeric method
        expect(detector_internal.validateNumeric(5, 1)).toBe(5);
        expect(detector_internal.validateNumeric(NaN, 1)).toBe(1);
        expect(detector_internal.validateNumeric(Infinity, 1)).toBe(1);
        expect(detector_internal.validateNumeric(-Infinity, 1)).toBe(1);
        expect(detector_internal.validateNumeric(0, 1)).toBe(1); // Zero is considered invalid
    });

    it("should handle safe division correctly", () => {
        const detector_internal = detector as any;

        // Test safeDivision method
        expect(detector_internal.safeDivision(10, 2, 0)).toBe(5);
        expect(detector_internal.safeDivision(10, 0, 99)).toBe(99); // Division by zero returns fallback
        expect(detector_internal.safeDivision(NaN, 2, 99)).toBe(99); // NaN numerator returns fallback
        expect(detector_internal.safeDivision(10, NaN, 99)).toBe(99); // NaN denominator returns fallback
        expect(detector_internal.safeDivision(Infinity, 2, 99)).toBe(99); // Infinity returns fallback
    });

    it("should handle safe ratio calculations correctly", () => {
        const detector_internal = detector as any;

        // Test safeRatio method
        expect(detector_internal.safeRatio(50, 100, 0)).toBe(0.5);
        expect(detector_internal.safeRatio(80, 100, 0)).toBe(0.8);
        expect(detector_internal.safeRatio(120, 100, 0)).toBe(1.0); // Capped at 1.0
        expect(detector_internal.safeRatio(10, 0, 99)).toBe(99); // Division by zero returns fallback
        expect(detector_internal.safeRatio(-10, 100, 99)).toBe(99); // Negative numerator returns fallback
        expect(detector_internal.safeRatio(NaN, 100, 99)).toBe(99); // NaN numerator returns fallback
        expect(detector_internal.safeRatio(50, NaN, 99)).toBe(99); // NaN denominator returns fallback
    });

    it("should handle safe mean calculation correctly", () => {
        const detector_internal = detector as any;

        // Test safeMean method
        expect(detector_internal.safeMean([1, 2, 3, 4, 5])).toBe(3);
        expect(detector_internal.safeMean([NaN, 2, 3])).toBe(2.5); // Ignores NaN
        expect(detector_internal.safeMean([Infinity, 2, 3])).toBe(2.5); // Ignores Infinity
        expect(detector_internal.safeMean([])).toBe(0); // Empty array returns 0
        expect(detector_internal.safeMean([NaN, Infinity])).toBe(0); // All invalid returns 0
        expect(detector_internal.safeMean(null as any)).toBe(0); // Null input returns 0
        expect(detector_internal.safeMean(undefined as any)).toBe(0); // Undefined input returns 0
    });

    it("should handle spoofing detection with edge case price values", () => {
        // Track some normal passive changes first
        detector.trackPassiveChange(100, 25, 30);
        detector.trackPassiveChange(100, 0, 30); // Wall disappears

        const mockGetAggressiveVolume = vi.fn().mockReturnValue(2); // Small execution

        const result = detector.wasSpoofed(
            100,
            "buy",
            Date.now(),
            mockGetAggressiveVolume
        );

        // Should not crash and should handle the calculation safely
        expect(typeof result).toBe("boolean");
    });

    it("should handle fake wall spoofing detection without crashes", () => {
        const now = Date.now();

        // Create a scenario that could trigger division by zero
        detector.trackPassiveChange(100, 50, 20); // Large bid wall
        setTimeout(() => {
            detector.trackPassiveChange(100, 0, 20); // Wall disappears
        }, 10);

        const spoofingEvents = detector.detectSpoofingPatterns(100, "buy", now + 100);

        // Should not crash and return valid array
        expect(Array.isArray(spoofingEvents)).toBe(true);
    });

    it("should handle layering detection with edge cases", () => {
        const now = Date.now();

        // Create layering scenario with potential division by zero
        for (let i = 1; i <= 3; i++) {
            const price = 100 - i * 0.01;
            detector.trackPassiveChange(price, 30, 15); // Create walls
            setTimeout(() => {
                detector.trackPassiveChange(price, 0, 15); // Remove walls rapidly
            }, 10);
        }

        const spoofingEvents = detector.detectSpoofingPatterns(100, "buy", now + 200);

        // Should not crash and handle division by zero in avgCancelTime calculation
        expect(Array.isArray(spoofingEvents)).toBe(true);
    });

    it("should handle ghost liquidity detection without crashes", () => {
        const now = Date.now();

        // Create ghost liquidity pattern: low -> high -> low
        detector.trackPassiveChange(100, 5, 10);   // Low liquidity
        detector.trackPassiveChange(100, 50, 10);  // Sudden high liquidity
        detector.trackPassiveChange(100, 3, 10);   // Disappears quickly

        const spoofingEvents = detector.detectSpoofingPatterns(100, "buy", now + 150);

        // Should not crash and handle disappearanceRatio calculation safely
        expect(Array.isArray(spoofingEvents)).toBe(true);
    });

    it("should process numeric calculations without throwing errors", () => {
        const now = Date.now();

        // Create a scenario with valid numeric values
        detector.trackPassiveChange(100.5, 45.5, 20.3); // Large wall
        detector.trackPassiveChange(100.5, 5.2, 20.3); // Wall mostly disappears

        const mockGetAggressiveVolume = vi.fn().mockReturnValue(2.1); // Small execution

        // The key test: ensure no division by zero or numeric errors occur
        expect(() => {
            const result = detector.wasSpoofed(
                100.5,
                "buy",
                now + 1000,
                mockGetAggressiveVolume
            );
            expect(typeof result).toBe("boolean");
        }).not.toThrow();

        // Should not have logged any warnings for valid numeric data
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining("Invalid"),
            expect.anything()
        );
    });

    it("should handle extreme trading volumes gracefully", () => {
        // Test with very large volumes that could cause overflow
        detector.trackOrderPlacement(100, "bid", 1000000, "large_order_1");
        detector.trackPassiveChange(100, 2000000, 1500000);

        const now = Date.now();
        const mockGetAggressiveVolume = vi.fn().mockReturnValue(100000);

        const result = detector.wasSpoofed(
            100,
            "buy",
            now,
            mockGetAggressiveVolume
        );

        // Should handle large numbers without overflow or precision issues
        expect(typeof result).toBe("boolean");
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining("Invalid"),
            expect.anything()
        );
    });

    it("should handle zero denominator edge cases in all algorithms", () => {
        const now = Date.now();

        // Test scenarios that could lead to zero denominators
        detector.trackPassiveChange(100, 0, 0); // All zero quantities
        detector.trackPassiveChange(100, 0, 0); // Still zero

        const spoofingEvents = detector.detectSpoofingPatterns(100, "buy", now);

        // Should handle all zero scenarios gracefully
        expect(Array.isArray(spoofingEvents)).toBe(true);
        expect(spoofingEvents.length).toBe(0); // No spoofing with zero quantities
    });

    it("should handle mixed valid and invalid data gracefully", () => {
        // Mix valid and invalid inputs
        detector.trackOrderPlacement(100.1, "bid", 15.5, "valid_1");
        detector.trackOrderPlacement(NaN, "bid", 20, "invalid_1"); // Invalid price
        detector.trackOrderPlacement(100.2, "ask", Infinity, "invalid_2"); // Invalid quantity
        detector.trackOrderPlacement(100.3, "bid", 25.7, "valid_2");

        // Should have warned about invalid entries but continued processing valid ones
        expect(mockLogger.warn).toHaveBeenCalledTimes(2);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining("Invalid price"),
            expect.anything()
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining("Invalid quantity"),
            expect.anything()
        );
    });
});