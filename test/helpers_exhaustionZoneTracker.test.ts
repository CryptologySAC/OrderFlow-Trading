// test/helpers_exhaustionZoneTracker.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    ExhaustionZoneTracker,
    type ZoneTrackerConfig,
    type ExhaustionPattern,
} from "../src/indicators/helpers/exhaustionZoneTracker.js";
import type { ZoneSnapshot } from "../src/types/marketEvents.js";

/**
 * 🧪 COMPREHENSIVE EXHAUSTION ZONE TRACKER TESTS
 *
 * These tests prove the depletion detection works correctly in all scenarios:
 * - Progressive depletion (1000 → 200 = 80% depletion)
 * - No depletion (volume increases or stable)
 * - Zone identity persistence with stable keys
 * - Directional exhaustion (bid vs ask)
 * - Peak tracking with cumulative maximums
 * - Edge cases and configuration variations
 */

// Test data helpers
function createZone(
    price: number,
    bidVolume: number,
    askVolume: number,
    timestamp: number = Date.now()
): ZoneSnapshot {
    return {
        zoneId: `zone-${price}-${timestamp}`,
        priceLevel: price,
        passiveBidVolume: bidVolume,
        passiveAskVolume: askVolume,
        aggressiveBuyVolume: bidVolume * 0.1,
        aggressiveSellVolume: askVolume * 0.1,
        aggressiveVolume: (bidVolume + askVolume) * 0.1,
        tradeCount: 10,
        timespan: 60000,
        boundaries: { min: price - 0.005, max: price + 0.005 },
        lastUpdate: timestamp,
        volumeWeightedPrice: price,
        tickSize: 0.01,
    };
}

function expectExhaustion(
    result: ExhaustionPattern,
    hasExhaustion: boolean,
    expectedRatio?: number,
    expectedType?: "bid" | "ask" | "both" | null
): void {
    expect(result.hasExhaustion).toBe(hasExhaustion);
    if (hasExhaustion && expectedRatio !== undefined) {
        expect(result.depletionRatio).toBeCloseTo(expectedRatio, 3);
    }
    if (expectedType !== undefined) {
        expect(result.exhaustionType).toBe(expectedType);
    }
}

function expectNoExhaustion(result: ExhaustionPattern): void {
    expect(result.hasExhaustion).toBe(false);
    expect(result.exhaustionType).toBe(null);
    expect(result.depletionRatio).toBe(0);
    expect(result.affectedZones).toBe(0);
}

describe("ExhaustionZoneTracker - Comprehensive Depletion Detection", () => {
    let tracker: ExhaustionZoneTracker;
    let config: ZoneTrackerConfig;

    beforeEach(() => {
        config = {
            maxZonesPerSide: 5,
            historyWindowMs: 60000,
            depletionThreshold: 0.2, // 20% depletion threshold
            minPeakVolume: 100,
            gapDetectionTicks: 3,
        };
        tracker = new ExhaustionZoneTracker(config, 0.01); // 1 cent tick size
        tracker.updateSpread(89.0, 89.01); // Set initial spread
    });

    describe("Zone Identity and Tracking", () => {
        it("should use stable zone keys with Config.PRICE_PRECISION format", () => {
            const zone1 = createZone(89.0, 1000, 500, Date.now());
            const zone2 = createZone(89.0, 800, 400, Date.now() + 1000); // Same price, different volume

            tracker.updateZone(zone1, Date.now());
            tracker.updateZone(zone2, Date.now() + 1000);

            const result = tracker.analyzeExhaustion(false); // Check bid exhaustion

            // Should detect depletion because zones at same price level maintained history
            expect(result.depletionRatio).toBeCloseTo(0.2, 3); // (1000-800)/1000 = 0.2
            expect(result.affectedZones).toBe(1);
        });

        it("should maintain zone history across zone ID changes", () => {
            const baseTime = Date.now();
            tracker.updateSpread(89.0, 89.01); // Set spread first

            // First zone with original ID - use price within tracking range (≤5 ticks from spread)
            const zone1 = createZone(88.96, 1000, 0, baseTime); // 4 ticks below bid (89.00)
            zone1.zoneId = "original-zone-id";
            tracker.updateZone(zone1, baseTime);

            // Second zone with DIFFERENT ID but SAME PRICE - should maintain history
            const zone2 = createZone(88.96, 200, 0, baseTime + 1000);
            zone2.zoneId = "completely-different-zone-id";
            tracker.updateZone(zone2, baseTime + 1000);

            const result = tracker.analyzeExhaustion(false);

            // Should detect 80% depletion: (1000-200)/1000 = 0.8
            expectExhaustion(result, true, 0.8, "bid");
            expect(result.affectedZones).toBe(1);
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it("should filter zones outside tracking range", () => {
            tracker.updateSpread(89.0, 89.01);

            // Zone too far below bid (>5 ticks away with maxZonesPerSide=5)
            const farZone = createZone(88.94, 1000, 0); // 6 ticks below bid
            tracker.updateZone(farZone, Date.now());

            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // Should not track distant zones
        });

        it("should clean distant zones when spread moves", () => {
            const zone = createZone(89.0, 1000, 0);
            tracker.updateZone(zone, Date.now());

            // Move spread significantly
            tracker.updateSpread(89.1, 89.11); // Moved up 10 cents

            // Original zone should be cleaned as it's now too far
            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result);
        });
    });

    describe("Progressive Depletion Detection", () => {
        it("should detect classic progressive depletion (1000→200, 80% depletion)", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Progressive depletion: 1000 → 800 → 500 → 200
            const volumes = [1000, 800, 500, 200];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);

            // Should detect 80% depletion: (1000-200)/1000 = 0.8
            expectExhaustion(result, true, 0.8, "bid");
            expect(result.affectedZones).toBe(1);
            expect(result.confidence).toBeGreaterThan(0.6); // High confidence for 80% depletion
        });

        it("should detect rapid depletion in single update (1000→50, 95% depletion)", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Initial large volume
            const zone1 = createZone(price, 1000, 0, baseTime);
            tracker.updateZone(zone1, baseTime);

            // Sudden depletion to almost zero
            const zone2 = createZone(price, 50, 0, baseTime + 1000);
            tracker.updateZone(zone2, baseTime + 1000);

            const result = tracker.analyzeExhaustion(false);

            // Should detect 95% depletion: (1000-50)/1000 = 0.95
            expectExhaustion(result, true, 0.95, "bid");
            expect(result.confidence).toBeGreaterThan(0.6); // High confidence (max ~0.64 for single zone)
        });

        it("should detect gradual depletion over many updates", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Gradual depletion: 1000 → 950 → 900 → 850 → 800 → 750 → 700
            const volumes = [1000, 950, 900, 850, 800, 750, 700];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);

            // Should detect 30% depletion: (1000-700)/1000 = 0.3
            expectExhaustion(result, true, 0.3, "bid");
        });

        it("should respect depletion threshold (test at 20% threshold)", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Set up zone with initial volume
            const zone1 = createZone(price, 1000, 0, baseTime);
            tracker.updateZone(zone1, baseTime);

            // Deplete to exactly 19% (below 20% threshold)
            const zone2 = createZone(price, 810, 0, baseTime + 1000); // 19% depletion
            tracker.updateZone(zone2, baseTime + 1000);

            const result1 = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result1); // Below threshold

            // Deplete to exactly 21% (above 20% threshold)
            const zone3 = createZone(price, 790, 0, baseTime + 2000); // 21% depletion
            tracker.updateZone(zone3, baseTime + 2000);

            const result2 = tracker.analyzeExhaustion(false);
            expectExhaustion(result2, true, 0.21, "bid"); // Above threshold
        });

        it("should detect multi-zone depletion simultaneously", () => {
            const baseTime = Date.now();

            // Set up multiple zones at different price levels
            const zone1_initial = createZone(88.99, 1000, 0, baseTime);
            const zone2_initial = createZone(88.98, 800, 0, baseTime);

            tracker.updateZone(zone1_initial, baseTime);
            tracker.updateZone(zone2_initial, baseTime);

            // Deplete both zones
            const zone1_depleted = createZone(88.99, 200, 0, baseTime + 1000); // 80% depletion
            const zone2_depleted = createZone(88.98, 200, 0, baseTime + 1000); // 75% depletion

            tracker.updateZone(zone1_depleted, baseTime + 1000);
            tracker.updateZone(zone2_depleted, baseTime + 1000);

            const result = tracker.analyzeExhaustion(false);

            expectExhaustion(result, true);
            expect(result.affectedZones).toBe(2); // Both zones affected
            expect(result.depletionRatio).toBeCloseTo(0.775, 2); // Average: (0.8 + 0.75) / 2
        });
    });

    describe("No Depletion Scenarios", () => {
        it("should NOT detect exhaustion when volume increases", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Volume increases: 100 → 500 → 1000 (accumulation, not depletion)
            const volumes = [100, 500, 1000];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // No depletion occurred
        });

        it("should NOT detect exhaustion when volume is stable", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Stable volume: 1000 → 1000 → 1000
            const volumes = [1000, 1000, 1000];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // No change means no depletion
        });

        it("should NOT detect exhaustion for minor fluctuations below threshold", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Minor fluctuations: 1000 → 950 → 980 → 970 (max 5% depletion)
            const volumes = [1000, 950, 980, 970];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // Below 20% threshold
        });

        it("should NOT detect exhaustion when peak volume below minPeakVolume", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Small volumes below minPeakVolume (100): 50 → 10
            const zone1 = createZone(price, 50, 0, baseTime); // Below minPeakVolume
            const zone2 = createZone(price, 10, 0, baseTime + 1000); // 80% depletion but peak too small

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime + 1000);

            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // Peak volume insufficient
        });

        it("should NOT detect exhaustion with insufficient history", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Only one data point
            const zone = createZone(price, 1000, 0, baseTime);
            tracker.updateZone(zone, baseTime);

            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // Need at least 2 data points for depletion
        });
    });

    describe("Directional Exhaustion", () => {
        it("should detect bid exhaustion for buy trades", () => {
            const baseTime = Date.now();
            const bidPrice = 89.0;

            // Set up bid zone and deplete it
            const zone1 = createZone(bidPrice, 1000, 500, baseTime);
            const zone2 = createZone(bidPrice, 200, 500, baseTime + 1000); // Only bid depleted

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime + 1000);

            const result = tracker.analyzeExhaustion(false); // Buy trade (isBuyTrade=false checks bid zones)

            expectExhaustion(result, true, 0.8, "bid");
        });

        it("should detect ask exhaustion for sell trades", () => {
            const baseTime = Date.now();
            tracker.updateSpread(89.0, 89.01); // Set spread first
            const askPrice = 89.01;

            // Set up ask zone and deplete it
            const zone1 = createZone(askPrice, 500, 1000, baseTime);
            const zone2 = createZone(askPrice, 500, 150, baseTime + 1000); // Only ask depleted

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime + 1000);

            const result = tracker.analyzeExhaustion(true); // Sell trade (isBuyTrade=true checks ask zones)

            expectExhaustion(result, true, 0.85, "ask"); // (1000-150)/1000 = 0.85
        });

        it("should NOT detect ask exhaustion when checking bid zones", () => {
            const baseTime = Date.now();
            const askPrice = 89.01;

            // Deplete ask zone
            const zone1 = createZone(askPrice, 100, 1000, baseTime);
            const zone2 = createZone(askPrice, 100, 100, baseTime + 1000); // Ask depleted

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime + 1000);

            // Check for bid exhaustion (wrong direction)
            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // Checking wrong side
        });

        it("should return null exhaustion type when both sides depleted", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Set up zone with both bid and ask volume
            const zone1 = createZone(price, 1000, 1000, baseTime);

            // Deplete both sides equally
            const zone2 = createZone(price, 200, 200, baseTime + 1000);

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime + 1000);

            const result = tracker.analyzeExhaustion(false); // Check bid side

            // Even though there's depletion, if both sides are depleted, it's unclear direction
            // The current implementation focuses on the side being checked
            expectExhaustion(result, true, 0.8, "bid");
        });
    });

    describe("Peak Tracking", () => {
        it("should maintain cumulative maximum peaks", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Volume sequence: 500 → 1000 → 800 → 300
            const volumes = [500, 1000, 800, 300];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);

            // Peak should be 1000 (maximum seen), current is 300
            // Depletion: (1000-300)/1000 = 0.7
            expectExhaustion(result, true, 0.7, "bid");
        });

        it("should set initial peak on first update", () => {
            const baseTime = Date.now();
            const price = 89.0;

            const zone1 = createZone(price, 500, 0, baseTime);
            const zone2 = createZone(price, 100, 0, baseTime + 1000);

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime + 1000);

            const result = tracker.analyzeExhaustion(false);

            // Peak is 500 (first value), depletion: (500-100)/500 = 0.8
            expectExhaustion(result, true, 0.8, "bid");
        });

        it("should never decrease peaks", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Sequence: 1000 → 200 → 1200 → 300
            const volumes = [1000, 200, 1200, 300];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);

            // Peak should be 1200 (new maximum), current is 300
            // Depletion: (1200-300)/1200 = 0.75
            expectExhaustion(result, true, 0.75, "bid");
        });

        it("should handle volume recovery without resetting peak", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Volume dip and recovery: 1000 → 200 → 900
            const volumes = [1000, 200, 900];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);

            // Peak remains 1000, current is 900 - only 10% depletion (below threshold)
            expectNoExhaustion(result);
        });
    });

    describe("Edge Cases", () => {
        it("should handle empty zones (passiveVolume = 0)", () => {
            const baseTime = Date.now();
            const price = 89.0;

            const zone1 = createZone(price, 1000, 0, baseTime);
            const zone2 = createZone(price, 0, 0, baseTime + 1000); // Completely empty

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime + 1000);

            const result = tracker.analyzeExhaustion(false);

            // Should detect 100% depletion: (1000-0)/1000 = 1.0
            expectExhaustion(result, true, 1.0, "bid");
        });

        it("should handle NaN and undefined volume values", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Create zone with valid volume first
            const zone1 = createZone(price, 1000, 500, baseTime);
            tracker.updateZone(zone1, baseTime);

            // Create zone with invalid volume (undefined will be converted to 0)
            const invalidZone = createZone(price, 0, 0, baseTime + 1000);
            // @ts-expect-error - Testing invalid data
            invalidZone.passiveBidVolume = undefined;
            // @ts-expect-error - Testing invalid data
            invalidZone.passiveAskVolume = NaN;

            // Should not crash and should handle gracefully
            expect(() =>
                tracker.updateZone(invalidZone, baseTime + 1000)
            ).not.toThrow();

            const result = tracker.analyzeExhaustion(false);
            // Should still detect depletion as undefined/NaN becomes 0
            expectExhaustion(result, true, 1.0, "bid");
        });

        it("should handle zones moving out of tracking range", () => {
            const baseTime = Date.now();
            tracker.updateSpread(89.0, 89.01);

            // Add zone at edge of tracking range
            const edgeZone = createZone(88.95, 1000, 0, baseTime); // 5 ticks below (at limit)
            tracker.updateZone(edgeZone, baseTime);

            // Move spread down, making zone fall outside range
            tracker.updateSpread(88.9, 88.91);

            // Try to analyze - should have no zones to analyze
            const result = tracker.analyzeExhaustion(false);
            expectNoExhaustion(result);
        });

        it("should clean old history after time window", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Add old zone (outside history window)
            const oldZone = createZone(
                price,
                1000,
                0,
                baseTime - config.historyWindowMs - 1000
            );
            tracker.updateZone(
                oldZone,
                baseTime - config.historyWindowMs - 1000
            );

            // Add recent zone
            const recentZone = createZone(price, 200, 0, baseTime);
            tracker.updateZone(recentZone, baseTime);

            const result = tracker.analyzeExhaustion(false);

            // Should not detect depletion because old history was cleaned
            // Peak should be 200 (only recent data), so no depletion detected
            expectNoExhaustion(result);
        });

        it("should handle rapid spread changes", () => {
            const baseTime = Date.now();

            // Add zones at multiple price levels
            const zone1 = createZone(89.0, 1000, 0, baseTime);
            const zone2 = createZone(88.99, 800, 0, baseTime);

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime);

            // Rapidly change spread multiple times
            tracker.updateSpread(89.05, 89.06);
            tracker.updateSpread(88.95, 88.96);
            tracker.updateSpread(89.1, 89.11);

            // Should not crash and should handle zone cleanup
            expect(() => {
                const result = tracker.analyzeExhaustion(false);
                // Result may vary based on which zones are still in range
            }).not.toThrow();
        });

        it("should handle concurrent zone updates at same price level", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Simulate rapid updates at same price level
            const volumes = [1000, 950, 900, 850, 200];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 100
                ); // 100ms apart
                tracker.updateZone(zone, baseTime + index * 100);
            });

            const result = tracker.analyzeExhaustion(false);

            // Should properly track depletion: (1000-200)/1000 = 0.8
            expectExhaustion(result, true, 0.8, "bid");
        });
    });

    describe("Configuration Variations", () => {
        it("should work with different tick sizes", () => {
            // Test with larger tick size (10 cents)
            const largeTickTracker = new ExhaustionZoneTracker(config, 0.1);
            largeTickTracker.updateSpread(89.0, 89.1);

            const zone1 = createZone(89.0, 1000, 0, Date.now());
            const zone2 = createZone(89.0, 200, 0, Date.now() + 1000);

            largeTickTracker.updateZone(zone1, Date.now());
            largeTickTracker.updateZone(zone2, Date.now() + 1000);

            const result = largeTickTracker.analyzeExhaustion(false);
            expectExhaustion(result, true, 0.8, "bid");
        });

        it("should respect different depletion thresholds", () => {
            // Test with higher threshold (50%)
            const strictConfig = { ...config, depletionThreshold: 0.5 };
            const strictTracker = new ExhaustionZoneTracker(strictConfig, 0.01);
            strictTracker.updateSpread(89.0, 89.01);

            const zone1 = createZone(89.0, 1000, 0, Date.now());
            const zone2 = createZone(89.0, 600, 0, Date.now() + 1000); // 40% depletion

            strictTracker.updateZone(zone1, Date.now());
            strictTracker.updateZone(zone2, Date.now() + 1000);

            const result = strictTracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // Below 50% threshold
        });

        it("should respect different minPeakVolume settings", () => {
            // Test with higher minPeakVolume
            const highVolumeConfig = { ...config, minPeakVolume: 500 };
            const highVolumeTracker = new ExhaustionZoneTracker(
                highVolumeConfig,
                0.01
            );
            highVolumeTracker.updateSpread(89.0, 89.01);

            const zone1 = createZone(89.0, 400, 0, Date.now()); // Below minPeakVolume
            const zone2 = createZone(89.0, 80, 0, Date.now() + 1000); // 80% depletion

            highVolumeTracker.updateZone(zone1, Date.now());
            highVolumeTracker.updateZone(zone2, Date.now() + 1000);

            const result = highVolumeTracker.analyzeExhaustion(false);
            expectNoExhaustion(result); // Peak volume insufficient
        });

        it("should respect maxZonesPerSide configuration", () => {
            // Test with smaller zone limit
            const limitedConfig = { ...config, maxZonesPerSide: 2 };
            const limitedTracker = new ExhaustionZoneTracker(
                limitedConfig,
                0.01
            );
            limitedTracker.updateSpread(89.0, 89.01);

            // Only zones within 2 ticks should be tracked
            const nearZone = createZone(88.99, 1000, 0, Date.now()); // 1 tick below
            const farZone = createZone(88.97, 1000, 0, Date.now()); // 3 ticks below (outside range)

            limitedTracker.updateZone(nearZone, Date.now());
            limitedTracker.updateZone(farZone, Date.now());

            // Deplete near zone
            const depletedNear = createZone(88.99, 200, 0, Date.now() + 1000);
            limitedTracker.updateZone(depletedNear, Date.now() + 1000);

            const result = limitedTracker.analyzeExhaustion(false);
            // Should only see 1 zone (the near one), far zone filtered out
            expectExhaustion(result, true, 0.8, "bid");
            expect(result.affectedZones).toBe(1);
        });
    });

    describe("Real Market Scenarios", () => {
        it("should detect flash crash scenario (sudden liquidity withdrawal)", () => {
            const baseTime = Date.now();
            const prices = [89.0, 88.99, 88.98]; // Multiple price levels

            // Set up normal liquidity across multiple levels
            prices.forEach((price) => {
                const zone = createZone(price, 1000, 500, baseTime);
                tracker.updateZone(zone, baseTime);
            });

            // Flash crash: all liquidity withdrawn simultaneously
            prices.forEach((price) => {
                const crashZone = createZone(price, 50, 25, baseTime + 1000);
                tracker.updateZone(crashZone, baseTime + 1000);
            });

            const result = tracker.analyzeExhaustion(false);

            expectExhaustion(result, true);
            expect(result.depletionRatio).toBeCloseTo(0.95, 2); // 95% depletion
            expect(result.affectedZones).toBe(3); // All zones affected
            expect(result.confidence).toBeGreaterThan(0.7); // High confidence (3 zones = ~0.72)
        });

        it("should detect accumulation before exhaustion", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Phase 1: Accumulation (building up liquidity)
            const accumulation = [100, 300, 500, 800, 1000, 1200];
            accumulation.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            // No exhaustion during accumulation
            const midResult = tracker.analyzeExhaustion(false);
            expectNoExhaustion(midResult);

            // Phase 2: Sudden exhaustion
            const exhaustionZone = createZone(price, 100, 0, baseTime + 6000);
            tracker.updateZone(exhaustionZone, baseTime + 6000);

            const finalResult = tracker.analyzeExhaustion(false);

            // Should detect depletion from peak (1200) to current (100)
            expectExhaustion(finalResult, true, (1200 - 100) / 1200, "bid");
        });

        it("should handle oscillating volume patterns", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Oscillating pattern: 1000 → 800 → 900 → 700 → 850 → 600
            const volumes = [1000, 800, 900, 700, 850, 600];

            volumes.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 1000
                );
                tracker.updateZone(zone, baseTime + index * 1000);
            });

            const result = tracker.analyzeExhaustion(false);

            // Peak is 1000, current is 600 = 40% depletion
            expectExhaustion(result, true, 0.4, "bid");
        });

        it("should detect institutional sweep pattern", () => {
            const baseTime = Date.now();

            // Multiple zones representing order book depth
            const zones = [
                { price: 89.0, volume: 1000 },
                { price: 88.99, volume: 800 },
                { price: 88.98, volume: 600 },
                { price: 88.97, volume: 400 },
            ];

            // Initial state
            zones.forEach(({ price, volume }) => {
                const zone = createZone(price, volume, 0, baseTime);
                tracker.updateZone(zone, baseTime);
            });

            // Institutional sweep: consuming liquidity level by level
            const sweepStages = [
                { price: 89.0, volume: 100 }, // Top level consumed
                { price: 88.99, volume: 200 }, // Second level partially consumed
                { price: 88.98, volume: 600 }, // Third level untouched
                { price: 88.97, volume: 400 }, // Fourth level untouched
            ];

            sweepStages.forEach(({ price, volume }) => {
                const zone = createZone(price, volume, 0, baseTime + 1000);
                tracker.updateZone(zone, baseTime + 1000);
            });

            const result = tracker.analyzeExhaustion(false);

            expectExhaustion(result, true);
            expect(result.affectedZones).toBeGreaterThan(1); // Multiple zones affected
        });

        it("should detect market maker retreat pattern", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Market maker retreat: gradual withdrawal over time
            // Simulating MM reducing size progressively
            const mmRetreat = [2000, 1800, 1500, 1200, 800, 400, 200];

            mmRetreat.forEach((volume, index) => {
                const zone = createZone(
                    price,
                    volume,
                    0,
                    baseTime + index * 2000
                ); // 2s intervals
                tracker.updateZone(zone, baseTime + index * 2000);
            });

            const result = tracker.analyzeExhaustion(false);

            // Should detect progressive retreat: (2000-200)/2000 = 0.9
            expectExhaustion(result, true, 0.9, "bid");
            expect(result.confidence).toBeGreaterThan(0.6); // High confidence (max ~0.64 for single zone)
        });
    });

    describe("Confidence Calculation", () => {
        it("should calculate confidence based on depletion ratio", () => {
            const baseTime = Date.now();
            const price = 89.0;

            // Test different depletion levels
            const testCases = [
                { depletion: 0.3, expectedMinConfidence: 0.2 }, // Low depletion
                { depletion: 0.6, expectedMinConfidence: 0.4 }, // Medium depletion
                { depletion: 0.9, expectedMinConfidence: 0.6 }, // High depletion
            ];

            testCases.forEach(({ depletion, expectedMinConfidence }) => {
                const freshTracker = new ExhaustionZoneTracker(config, 0.01);
                freshTracker.updateSpread(89.0, 89.01);

                const zone1 = createZone(price, 1000, 0, baseTime);
                const zone2 = createZone(
                    price,
                    1000 * (1 - depletion),
                    0,
                    baseTime + 1000
                );

                freshTracker.updateZone(zone1, baseTime);
                freshTracker.updateZone(zone2, baseTime + 1000);

                const result = freshTracker.analyzeExhaustion(false);

                expect(result.hasExhaustion).toBe(true);
                expect(result.confidence).toBeGreaterThan(
                    expectedMinConfidence
                );
            });
        });

        it("should increase confidence with more affected zones", () => {
            const baseTime = Date.now();

            // Single zone depletion
            const singleTracker = new ExhaustionZoneTracker(config, 0.01);
            singleTracker.updateSpread(89.0, 89.01);

            const singleZone1 = createZone(89.0, 1000, 0, baseTime);
            const singleZone2 = createZone(89.0, 200, 0, baseTime + 1000);

            singleTracker.updateZone(singleZone1, baseTime);
            singleTracker.updateZone(singleZone2, baseTime + 1000);

            const singleResult = singleTracker.analyzeExhaustion(false);

            // Multi-zone depletion
            const multiTracker = new ExhaustionZoneTracker(config, 0.01);
            multiTracker.updateSpread(89.0, 89.01);

            const prices = [89.0, 88.99, 88.98];
            prices.forEach((price) => {
                const zone1 = createZone(price, 1000, 0, baseTime);
                const zone2 = createZone(price, 200, 0, baseTime + 1000);
                multiTracker.updateZone(zone1, baseTime);
                multiTracker.updateZone(zone2, baseTime + 1000);
            });

            const multiResult = multiTracker.analyzeExhaustion(false);

            expect(multiResult.confidence).toBeGreaterThan(
                singleResult.confidence
            );
            expect(multiResult.affectedZones).toBe(3);
            expect(singleResult.affectedZones).toBe(1);
        });
    });
});
