import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("AccumulationZoneDetector - Zone Merge Validation", () => {
    let detector: AccumulationZoneDetector;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as ILogger;
        
        mockMetrics = new MetricsCollector();
        
        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 120000, // 2 minutes (match production config)
            minZoneVolume: 200,           // Match production requirement
            minTradeCount: 6,             // Match production requirement
            maxPriceDeviation: 0.02,      // 2% (match production)
            minZoneStrength: 0.45,        // Reasonable for testing
            strengthChangeThreshold: 0.15, // Match production
        };

        detector = new AccumulationZoneDetector(
            "test-accumulation",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );
    });

    describe("Zone Conflict Resolution and Merge Logic", () => {
        it("should merge overlapping candidates with existing zones and validate final zone state", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Step 1: Create first zone by building up a candidate
            const zone1Trades = createTradeSequence(basePrice, baseTime, 15, true); // Heavy sell pressure
            
            // Process trades to build first candidate
            zone1Trades.forEach(trade => detector.analyze(trade));
            
            // Advance time to meet minimum duration (2 minutes)
            const zone1FormingTrade = createTrade(basePrice + 0.1, baseTime + 125000, true, 80);
            const result1 = detector.analyze(zone1FormingTrade);
            
            // Verify first zone was created
            expect(result1.updates).toHaveLength(1);
            expect(result1.updates[0].updateType).toBe("zone_created");
            const firstZone = result1.updates[0].zone;
            
            // Validate first zone state
            expect(firstZone).toBeDefined();
            expect(firstZone.type).toBe("accumulation");
            expect(firstZone.priceRange.center).toBeCloseTo(basePrice, 0);
            expect(firstZone.totalVolume).toBeGreaterThan(100);
            
            // Step 2: Create overlapping candidate that should merge
            const overlappingPrice = basePrice + 250; // Within 1% proximity tolerance
            const zone2Trades = createTradeSequence(overlappingPrice, baseTime + 130000, 12, true);
            
            // Process overlapping trades
            zone2Trades.forEach(trade => detector.analyze(trade));
            
            // Get pre-merge zone state
            const activeZonesBeforeMerge = detector.getActiveZones();
            expect(activeZonesBeforeMerge).toHaveLength(1);
            const premergeVolume = activeZonesBeforeMerge[0].totalVolume;
            
            // Trigger merge with zone formation attempt (after 2+ minutes)
            const mergeTriggerTrade = createTrade(overlappingPrice + 0.1, baseTime + 255000, true, 100);
            const mergeResult = detector.analyze(mergeTriggerTrade);
            
            // Step 3: Validate merge occurred correctly
            const activeZonesAfterMerge = detector.getActiveZones();
            
            // Should still have exactly one zone (merged, not two separate zones)
            expect(activeZonesAfterMerge).toHaveLength(1);
            
            const mergedZone = activeZonesAfterMerge[0];
            
            // Validate merged zone properties
            expect(mergedZone.id).toBe(firstZone.id); // Same zone ID (merged into existing)
            expect(mergedZone.totalVolume).toBeGreaterThan(premergeVolume); // Volume increased from merge
            expect(mergedZone.totalVolume).toBeGreaterThan(premergeVolume + 75); // Includes trigger trade
            
            // Validate merge operation was logged
            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Merged candidate with existing zone",
                expect.objectContaining({
                    component: "AccumulationZoneDetector",
                    existingZoneId: firstZone.id,
                    candidateVolume: expect.any(Number),
                    mergedTrades: expect.any(Number),
                })
            );
            
            // Validate zone still maintains accumulation characteristics
            expect(mergedZone.type).toBe("accumulation");
            expect(mergedZone.strength).toBeGreaterThan(0.4);
            expect(mergedZone.confidence).toBeGreaterThan(0.3);
        });

        it("should properly track volume consistency after merge operations", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Create first zone
            const zone1Trades = createTradeSequence(basePrice, baseTime, 15, true);
            zone1Trades.forEach(trade => detector.analyze(trade));
            
            const zone1FormingTrade = createTrade(basePrice + 0.5, baseTime + 15000, true, 100);
            detector.analyze(zone1FormingTrade);
            
            const initialZone = detector.getActiveZones()[0];
            const initialVolume = initialZone.totalVolume;
            
            // Create overlapping candidate with known volume
            const overlappingTrades = [
                createTrade(basePrice + 200, baseTime + 20000, true, 50),
                createTrade(basePrice + 200, baseTime + 21000, true, 75),
                createTrade(basePrice + 200, baseTime + 22000, false, 25), // Buy aggression (low)
                createTrade(basePrice + 200, baseTime + 23000, true, 60),
                createTrade(basePrice + 200, baseTime + 24000, true, 40),
            ];
            
            overlappingTrades.forEach(trade => detector.analyze(trade));
            
            // Calculate expected volume increase
            const candidateVolume = overlappingTrades.reduce((sum, t) => sum + t.quantity, 0);
            const triggerTradeVolume = 80;
            
            // Trigger merge
            const mergeTrigger = createTrade(basePrice + 200, baseTime + 35000, true, triggerTradeVolume);
            detector.analyze(mergeTrigger);
            
            // Validate volume tracking
            const finalZone = detector.getActiveZones()[0];
            const expectedMinimumVolume = initialVolume + candidateVolume + triggerTradeVolume;
            
            expect(finalZone.totalVolume).toBeGreaterThanOrEqual(expectedMinimumVolume);
            expect(finalZone.totalVolume).toBeLessThan(expectedMinimumVolume * 1.1); // Within 10% tolerance
        });

        it("should maintain proper accumulation ratio after merge", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Create zones with strong accumulation characteristics
            const highSellRatioTrades = [
                createTrade(basePrice, baseTime, true, 100), // Sell pressure
                createTrade(basePrice, baseTime + 1000, true, 90),
                createTrade(basePrice, baseTime + 2000, true, 110),
                createTrade(basePrice, baseTime + 3000, false, 20), // Minimal buy aggression
                createTrade(basePrice, baseTime + 4000, true, 95),
                createTrade(basePrice, baseTime + 5000, true, 85),
            ];
            
            highSellRatioTrades.forEach(trade => detector.analyze(trade));
            detector.analyze(createTrade(basePrice, baseTime + 15000, true, 50));
            
            // Create overlapping candidate with similar characteristics
            const overlappingHighSellTrades = [
                createTrade(basePrice + 100, baseTime + 20000, true, 80),
                createTrade(basePrice + 100, baseTime + 21000, true, 70),
                createTrade(basePrice + 100, baseTime + 22000, true, 90),
                createTrade(basePrice + 100, baseTime + 23000, false, 15), // Low buy aggression
                createTrade(basePrice + 100, baseTime + 24000, true, 85),
            ];
            
            overlappingHighSellTrades.forEach(trade => detector.analyze(trade));
            
            // Trigger merge
            detector.analyze(createTrade(basePrice + 100, baseTime + 35000, true, 60));
            
            const mergedZone = detector.getActiveZones()[0];
            
            // Validate accumulation characteristics are preserved
            expect(mergedZone.type).toBe("accumulation");
            expect(mergedZone.strength).toBeGreaterThan(0.5); // Strong accumulation signal
            
            // Use detector's internal state to validate ratios
            const detectorAny = detector as any;
            const candidates = detectorAny.getCandidates();
            
            // Should have no remaining candidates after merge
            expect(candidates).toHaveLength(0);
        });

        it("should handle merge failure gracefully", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Create initial zone
            const initialTrades = createTradeSequence(basePrice, baseTime, 10, true);
            initialTrades.forEach(trade => detector.analyze(trade));
            detector.analyze(createTrade(basePrice, baseTime + 15000, true, 50));
            
            const initialZoneCount = detector.getActiveZones().length;
            expect(initialZoneCount).toBe(1);
            
            // Mock zone manager to simulate merge failure
            const detectorAny = detector as any;
            const originalUpdateZone = detectorAny.zoneManager.updateZone;
            detectorAny.zoneManager.updateZone = vi.fn(() => {
                throw new Error("Simulated zone update failure");
            });
            
            // Create overlapping candidate
            const overlappingTrades = createTradeSequence(basePrice + 200, baseTime + 20000, 8, true);
            overlappingTrades.forEach(trade => detector.analyze(trade));
            
            // Trigger merge (should fail gracefully)
            const mergeTrigger = createTrade(basePrice + 200, baseTime + 35000, true, 60);
            const result = detector.analyze(mergeTrigger);
            
            // Should handle error gracefully without crashing
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

        it("should prefer strongest zone when multiple zones are nearby", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            // Create first zone (weaker)
            const weakZoneTrades = createTradeSequence(basePrice, baseTime, 8, true, 0.6); // Lower sell ratio
            weakZoneTrades.forEach(trade => detector.analyze(trade));
            detector.analyze(createTrade(basePrice, baseTime + 15000, true, 40));
            
            // Create second zone nearby (stronger)
            const strongZoneTrades = createTradeSequence(basePrice + 300, baseTime + 20000, 12, true, 0.85); // Higher sell ratio
            strongZoneTrades.forEach(trade => detector.analyze(trade));
            detector.analyze(createTrade(basePrice + 300, baseTime + 35000, true, 80));
            
            const zonesBeforeMerge = detector.getActiveZones();
            expect(zonesBeforeMerge).toHaveLength(2);
            
            // Find the stronger zone
            const strongerZone = zonesBeforeMerge.reduce((strongest, zone) =>
                zone.strength > strongest.strength ? zone : strongest
            );
            
            // Create candidate that overlaps both zones (equidistant)
            const middlePrice = basePrice + 150; // Between the two zones
            const overlappingTrades = createTradeSequence(middlePrice, baseTime + 40000, 10, true);
            overlappingTrades.forEach(trade => detector.analyze(trade));
            
            // Trigger merge
            detector.analyze(createTrade(middlePrice, baseTime + 55000, true, 70));
            
            const zonesAfterMerge = detector.getActiveZones();
            
            // Should merge with the stronger zone
            expect(zonesAfterMerge).toHaveLength(2); // One zone merged, one remains
            
            const updatedStrongZone = zonesAfterMerge.find(z => z.id === strongerZone.id);
            expect(updatedStrongZone).toBeDefined();
            expect(updatedStrongZone!.totalVolume).toBeGreaterThan(strongerZone.totalVolume);
        });
    });
});

// Helper functions
function createTrade(
    price: number,
    timestamp: number,
    buyerIsMaker: boolean,
    quantity: number = 60 // Institutional size default
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

function createTradeSequence(
    basePrice: number,
    startTime: number,
    count: number,
    favorsAccumulation: boolean,
    sellRatio: number = 0.75 // 75% sell pressure for strong accumulation signal
): EnrichedTradeEvent[] {
    const trades: EnrichedTradeEvent[] = [];
    
    // Create trades concentrated at the same price level to meet minTradeCount requirement
    for (let i = 0; i < count; i++) {
        const timestamp = startTime + i * 2000; // 2 second intervals for stability
        // Keep most trades at the exact same price level to accumulate at one candidate
        const price = i < count * 0.8 
            ? basePrice  // 80% of trades at exact same price
            : basePrice + (Math.random() - 0.5) * 0.1; // 20% with minimal variation
        const quantity = 50 + Math.random() * 100; // 50-150 quantity for institutional size
        
        // Create sell pressure for accumulation
        const buyerIsMaker = favorsAccumulation 
            ? Math.random() < sellRatio // More sells for accumulation
            : Math.random() < 0.5; // Random for non-accumulation
            
        trades.push(createTrade(price, timestamp, buyerIsMaker, quantity));
    }
    
    return trades;
}