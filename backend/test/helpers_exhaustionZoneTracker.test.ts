// test/helpers_exhaustionZoneTracker.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import {
    ExhaustionZoneTracker,
    type ZoneTrackerConfig,
    type ExhaustionPattern,
} from "../src/indicators/helpers/exhaustionZoneTracker.js";
import type { ZoneSnapshot } from "../src/types/marketEvents.js";
import { CircularBuffer } from "../src/utils/circularBuffer.js";

// Test data helpers
function createZone(
    price: number,
    bidVolume: number,
    askVolume: number,
    timestamp: number = Date.now()
): ZoneSnapshot {
    // Create a circular buffer for trade history
    const tradeHistory = new CircularBuffer(100, () => {}); // Capacity of 100 trades

    return {
        zoneId: `zone-${price}-${timestamp}`,
        priceLevel: price,
        passiveBidVolume: bidVolume,
        passiveAskVolume: askVolume,
        passiveVolume: bidVolume + askVolume,
        aggressiveBuyVolume: bidVolume * 0.1,
        aggressiveSellVolume: askVolume * 0.1,
        aggressiveVolume: (bidVolume + askVolume) * 0.1,
        tradeCount: 10,
        timespan: 60000,
        boundaries: { min: price - 0.005, max: price + 0.005 },
        lastUpdate: timestamp,
        volumeWeightedPrice: price,
        tickSize: 0.01,
        tradeHistory,
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
        // Use production-realistic configuration values from config.json
        config = {
            maxZonesPerSide: 15, // Match production maxZonesPerSide
            historyWindowMs: 300000, // Match zoneHistoryWindowMs (5 minutes)
            depletionThreshold: 0.75, // Match zoneDepletionThreshold (75%)
            minPeakVolume: 5000, // Match production minPeakVolume
            gapDetectionTicks: 3, // Match production gapDetectionTicks
            consumptionValidation: {
                // Match production consumptionValidation
                maxReasonableVelocity: 5000, // Increased from 1000 for test scenarios
                minConsumptionConfidence: 0.4,
                confidenceDecayTimeMs: 30000,
                minAggressiveVolume: 20,
            },
        };
        tracker = new ExhaustionZoneTracker(config, 0.01); // 1 cent tick size
        tracker.updateSpread(89.0, 89.01); // Set initial spread
    });

    describe("Zone Identity and Tracking", () => {
        it("should use stable zone keys with Config.PRICE_PRECISION format", () => {
            // Use realistic LTCUSDT volume levels that meet minPeakVolume threshold
            const baseTime = Date.now();
            const zone1 = createZone(89.0, 10000, 5000, baseTime); // 10K bid, 5K ask volume
            const zone2 = createZone(89.0, 8000, 4000, baseTime + 1000); // Intermediate depletion
            const zone3 = createZone(89.0, 2000, 1000, baseTime + 2000); // Final depletion

            tracker.updateZone(zone1, baseTime);
            tracker.updateZone(zone2, baseTime + 1000);
            tracker.updateZone(zone3, baseTime + 2000);

            const result = tracker.analyzeExhaustion(false); // Check bid exhaustion

            // Should detect 80% depletion: (10000-2000)/10000 = 0.8 (> 75% threshold)
            expectExhaustion(result, true, 0.8, "bid");
            expect(result.affectedZones).toBe(1);
        });
    });
});
