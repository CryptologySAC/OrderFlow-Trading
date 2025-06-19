import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("AccumulationZoneDetector - Core Merge Functionality", () => {
    let detector: AccumulationZoneDetector;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn().mockImplementation((message, data) => {
                // Log zone formation debug to understand why first zone fails
                if (
                    message.includes("checkForZoneFormation") ||
                    message.includes("Evaluating candidate") ||
                    message.includes("failed") ||
                    message.includes("Creating zone detection data") ||
                    message.includes("Created new candidate") ||
                    message.includes("About to call") ||
                    message.includes("returned") ||
                    message.includes("New zone created")
                ) {
                    console.log(
                        `[DEBUG] ${message}`,
                        JSON.stringify(data, null, 2)
                    );
                }
            }),
        } as ILogger;

        mockMetrics = new MetricsCollector();

        // Use realistic config based on working requirements test
        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 120000, // 2 minutes - realistic institutional timeframe
            minZoneVolume: 200, // Production volume requirement
            minTradeCount: 6, // Production trade count
            maxPriceDeviation: 0.02, // 2% - realistic price deviation
            minZoneStrength: 0.45, // Production strength requirement
            strengthChangeThreshold: 0.15,
            minSellRatio: 0.5, // 50% sell ratio for accumulation
        };

        detector = new AccumulationZoneDetector(
            "test-merge-core",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );
    });

    describe("Zone Merge Logic Validation", () => {
        it("should properly update existing zone when merge occurs", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Step 1: Create first zone with concentrated trades at same price
            const firstZoneTrades = createConcentratedTrades(
                basePrice,
                baseTime,
                12,
                0.8
            );
            firstZoneTrades.forEach((trade) => detector.analyze(trade));

            // Trigger first zone formation - wait 2+ minutes for realistic timing
            const zone1Trigger = createTrade(
                basePrice,
                baseTime + 125000, // 2+ minutes for production requirements
                true,
                100
            );
            const result1 = detector.analyze(zone1Trigger);

            // Verify first zone created
            expect(result1.updates).toHaveLength(1);
            const firstZone = result1.updates[0].zone;
            expect(firstZone).toBeDefined();
            expect(firstZone.type).toBe("accumulation");

            const initialVolume = firstZone.totalVolume;
            const initialZoneId = firstZone.id;

            // Step 2: Create overlapping candidate at nearby price (within 1% tolerance)
            const overlappingPrice = basePrice + 300; // Within 1% of 50000
            const overlappingTrades = createConcentratedTrades(
                overlappingPrice,
                baseTime + 130000,
                10,
                0.75
            );
            overlappingTrades.forEach((trade) => detector.analyze(trade));

            // Calculate expected additional volume
            const candidateVolume = overlappingTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const triggerVolume = 80;

            // Trigger merge by trying to form overlapping zone
            const mergeTrigger = createTrade(
                overlappingPrice,
                baseTime + 255000, // Another 2+ minutes later
                true,
                triggerVolume
            );
            const mergeResult = detector.analyze(mergeTrigger);

            // Step 3: Validate merge behavior
            const activeZones = detector.getActiveZones();

            // Should still have exactly one zone (merged, not two separate)
            expect(activeZones).toHaveLength(1);

            const finalZone = activeZones[0];

            // Validate zone properties after merge
            expect(finalZone.id).toBe(initialZoneId); // Same zone ID (existing zone updated)
            expect(finalZone.totalVolume).toBeGreaterThan(initialVolume); // Volume increased
            expect(finalZone.type).toBe("accumulation"); // Still accumulation type

            // Validate merge was logged
            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Merged candidate with existing zone",
                expect.objectContaining({
                    component: "AccumulationZoneDetector",
                    existingZoneId: initialZoneId,
                    candidateVolume: expect.any(Number),
                    mergedTrades: expect.any(Number),
                })
            );
        });

        it("should create new zone when no overlapping zones exist", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Create zone at one price level
            const trades1 = createConcentratedTrades(
                basePrice,
                baseTime,
                12,
                0.8
            );
            trades1.forEach((trade) => detector.analyze(trade));

            const zone1Trigger = createTrade(
                basePrice,
                baseTime + 125000,
                true,
                100
            );
            const result1 = detector.analyze(zone1Trigger);

            console.log("=== STEP 1: Creating first zone at", basePrice, "===");
            console.log(
                "Candidates before first zone:",
                (detector as any).getCandidateCount()
            );
            console.log("Result1 updates:", result1.updates.length);
            console.log(
                "Active zones after first:",
                detector.getActiveZones().length
            );
            console.log(
                "Candidates after first zone creation:",
                (detector as any).getCandidateCount()
            );

            // Create second zone at very distant price (outside any tolerance)
            const distantPrice = basePrice + 5000; // 10% away, well outside any merge tolerance
            console.log(
                "=== STEP 2: Creating second zone at",
                distantPrice,
                "==="
            );

            const trades2 = createConcentratedTrades(
                distantPrice,
                baseTime + 130000,
                12,
                0.8
            );
            trades2.forEach((trade) => detector.analyze(trade));
            console.log(
                "Candidates after second trades:",
                (detector as any).getCandidateCount()
            );

            const zone2Trigger = createTrade(
                distantPrice,
                baseTime + 255000,
                true,
                100
            );
            const result2 = detector.analyze(zone2Trigger);

            console.log("Result2 updates:", result2.updates.length);
            console.log(
                "Active zones after second:",
                detector.getActiveZones().length
            );
            console.log(
                "Candidates after second zone creation:",
                (detector as any).getCandidateCount()
            );

            const activeZones = detector.getActiveZones();
            activeZones.forEach((zone, i) => {
                console.log(
                    `Zone ${i}: ID=${zone.id}, center=${zone.priceRange.center}`
                );
            });

            // Should create second zone (no merge due to distance)
            expect(activeZones).toHaveLength(2);

            // Validate zones are distinct
            const prices = activeZones.map((z) => z.priceRange.center);
            expect(Math.abs(prices[0] - prices[1])).toBeGreaterThan(500); // Confirm they're far apart
        });

        it("should handle merge errors gracefully", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Create initial zone
            const trades1 = createConcentratedTrades(
                basePrice,
                baseTime,
                12,
                0.8
            );
            trades1.forEach((trade) => detector.analyze(trade));

            const zone1Trigger = createTrade(
                basePrice,
                baseTime + 125000,
                true,
                100
            );
            detector.analyze(zone1Trigger);

            // Mock zoneManager.updateZone to simulate failure
            const detectorAny = detector as any;
            const originalUpdateZone = detectorAny.zoneManager.updateZone;
            detectorAny.zoneManager.updateZone = vi.fn(() => {
                throw new Error("Simulated zone update failure");
            });

            // Create overlapping candidate
            const overlappingTrades = createConcentratedTrades(
                basePrice + 200,
                baseTime + 130000,
                10,
                0.8
            );
            overlappingTrades.forEach((trade) => detector.analyze(trade));

            // Trigger merge (should fail gracefully)
            const mergeTrigger = createTrade(
                basePrice + 200,
                baseTime + 255000,
                true,
                80
            );
            const result = detector.analyze(mergeTrigger);

            // Should handle error gracefully
            expect(result).toBeDefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                "Failed to merge candidate with existing zone",
                expect.objectContaining({
                    error: "Simulated zone update failure",
                })
            );

            // Restore original function
            detectorAny.zoneManager.updateZone = originalUpdateZone;
        });

        it("should validate zone state consistency after merge", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Create first zone with known volume characteristics
            const firstTrades = createConcentratedTrades(
                basePrice,
                baseTime,
                15,
                0.85
            ); // High sell ratio
            firstTrades.forEach((trade) => detector.analyze(trade));

            const trigger1 = createTrade(
                basePrice,
                baseTime + 125000,
                true,
                120
            );
            detector.analyze(trigger1);

            const initialZone = detector.getActiveZones()[0];
            const initialVolume = initialZone.totalVolume;
            const initialStrength = initialZone.strength;

            // Create overlapping candidate with additional volume
            const overlappingTrades = createConcentratedTrades(
                basePrice + 150,
                baseTime + 130000,
                8,
                0.75
            );
            const overlappingVolume = overlappingTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );

            overlappingTrades.forEach((trade) => detector.analyze(trade));

            // Trigger merge
            const triggerVolume = 90;
            const mergeTrigger = createTrade(
                basePrice + 150,
                baseTime + 255000,
                true,
                triggerVolume
            );
            detector.analyze(mergeTrigger);

            // Validate final zone state
            const finalZone = detector.getActiveZones()[0];

            // Volume should include all sources
            expect(finalZone.totalVolume).toBeGreaterThanOrEqual(
                initialVolume + overlappingVolume + triggerVolume * 0.8 // Allow some tolerance
            );

            // Zone should maintain or improve strength (more data = better signal)
            expect(finalZone.strength).toBeGreaterThanOrEqual(
                initialStrength * 0.9
            ); // Allow slight degradation

            // Type should remain accumulation
            expect(finalZone.type).toBe("accumulation");
            expect(finalZone.confidence).toBeGreaterThan(0);
        });
    });
});

// Helper functions optimized for zone creation
function createTrade(
    price: number,
    timestamp: number,
    buyerIsMaker: boolean,
    quantity: number = 80
): EnrichedTradeEvent {
    return {
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        pair: "BTCUSDT",
        tradeId: `trade_${timestamp}_${Math.random()}`,
        originalTrade: {} as any,
        passiveBidVolume: buyerIsMaker ? quantity : 0,
        passiveAskVolume: buyerIsMaker ? 0 : quantity,
        zonePassiveBidVolume: 0,
        zonePassiveAskVolume: 0,
    };
}

function createConcentratedTrades(
    exactPrice: number,
    startTime: number,
    count: number,
    sellRatio: number
): EnrichedTradeEvent[] {
    const trades: EnrichedTradeEvent[] = [];

    // Calculate how many trades should be sells to meet ratio
    const sellCount = Math.ceil(count * sellRatio);
    const buyCount = count - sellCount;

    // Create realistic institutional-sized trades over time
    for (let i = 0; i < sellCount; i++) {
        const timestamp = startTime + i * 3000; // 3 second intervals for realism
        const quantity = 50 + Math.random() * 50; // 50-100 institutional sizes
        trades.push(createTrade(exactPrice, timestamp, true, quantity)); // buyerIsMaker=true = sell
    }

    for (let i = 0; i < buyCount; i++) {
        const timestamp = startTime + (sellCount + i) * 3000;
        const quantity = 50 + Math.random() * 50; // 50-100 institutional sizes
        trades.push(createTrade(exactPrice, timestamp, false, quantity)); // buyerIsMaker=false = buy
    }

    return trades;
}
