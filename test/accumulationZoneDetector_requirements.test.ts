import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("AccumulationZoneDetector - Production Requirements Validation", () => {
    let detector: AccumulationZoneDetector;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;

    beforeEach(() => {
        mockLogger = {
            info: vi
                .fn()
                .mockImplementation((...args) => console.log("INFO:", ...args)),
            warn: vi
                .fn()
                .mockImplementation((...args) => console.log("WARN:", ...args)),
            error: vi
                .fn()
                .mockImplementation((...args) =>
                    console.log("ERROR:", ...args)
                ),
            debug: vi
                .fn()
                .mockImplementation((...args) =>
                    console.log("DEBUG:", ...args)
                ),
        } as ILogger;

        mockMetrics = new MetricsCollector();

        // Use production-matching config to test real requirements
        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 120000, // 2 minutes - STRICT enforcement
            minZoneVolume: 200, // Production requirement
            minTradeCount: 6, // Production requirement
            maxPriceDeviation: 0.02, // 2%
            minZoneStrength: 0.45,
            strengthChangeThreshold: 0.15,
        };

        detector = new AccumulationZoneDetector(
            "test-requirements",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );
    });

    describe("Zone Formation Requirements Analysis", () => {
        it("should create zone when ALL requirements are properly met", () => {
            const baseTime = Date.now();
            const basePrice = 50000;

            console.log("🔧 TESTING: Creating zone with all requirements met");

            // Create exactly what production requires:
            // 1. minTradeCount: 6 trades minimum
            // 2. minZoneVolume: 200+ volume
            // 3. minCandidateDuration: 2+ minutes
            // 4. Proper sell ratio for accumulation
            // 5. Institutional activity signals
            // 6. Price stability

            const accumTrades: EnrichedTradeEvent[] = [];
            let totalVolume = 0;

            // Create 8 trades (exceeds minTradeCount: 6) at the EXACT same price level
            for (let i = 0; i < 8; i++) {
                const quantity = 45 + Math.random() * 15; // 45-60 each = institutional size (threshold: 40)
                const trade: EnrichedTradeEvent = {
                    price: basePrice, // EXACT same price for concentration
                    quantity,
                    timestamp: baseTime + i * 3000, // 3-second intervals
                    buyerIsMaker: Math.random() < 0.8, // 80% sell pressure for accumulation
                    pair: "BTCUSDT",
                    tradeId: `accum_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                accumTrades.push(trade);
                totalVolume += quantity;
            }

            console.log(
                `🔧 Created ${accumTrades.length} trades with total volume: ${totalVolume}`
            );
            console.log(
                `🔧 Sell pressure: ${accumTrades.filter((t) => t.buyerIsMaker).length / accumTrades.length}`
            );

            // Process all trades
            accumTrades.forEach((trade, i) => {
                const result = detector.analyze(trade);
                console.log(
                    `🔧 Trade ${i}: candidates=${detector.getCandidateCount()}, zones=${detector.getActiveZones().length}`
                );
            });

            // Wait for minimum duration requirement (2 minutes)
            const formationTrade: EnrichedTradeEvent = {
                price: basePrice, // Same price to add to existing candidate
                quantity: 50, // Institutional size
                timestamp: baseTime + 125000, // 2+ minutes later
                buyerIsMaker: true, // Sell pressure
                pair: "BTCUSDT",
                tradeId: "formation_trigger",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            console.log("🔧 Triggering zone formation after 2+ minutes...");
            const formationResult = detector.analyze(formationTrade);

            console.log(
                `🔧 Formation result: updates=${formationResult.updates.length}`
            );
            console.log(`🔧 Final zones: ${detector.getActiveZones().length}`);

            // Analyze candidate state for debugging
            const candidates = detector.getCandidates();
            if (candidates.length > 0) {
                const mainCandidate =
                    candidates.find((c) => c.priceLevel === basePrice) ||
                    candidates[0];
                console.log("🔧 Main candidate analysis:", {
                    priceLevel: mainCandidate.priceLevel,
                    totalVolume: mainCandidate.totalVolume,
                    tradeCount: mainCandidate.tradeCount,
                    sellVolume: mainCandidate.sellVolume,
                    buyVolume: mainCandidate.buyVolume,
                    sellRatio:
                        mainCandidate.sellVolume / mainCandidate.totalVolume,
                    duration:
                        formationTrade.timestamp - mainCandidate.startTime,
                    priceStability: mainCandidate.priceStability,
                });

                // This is what production requires - let's validate systematically
                expect(mainCandidate.tradeCount).toBeGreaterThanOrEqual(6); // ✅ minTradeCount
                expect(mainCandidate.totalVolume).toBeGreaterThanOrEqual(200); // ✅ minZoneVolume
                expect(
                    formationTrade.timestamp - mainCandidate.startTime
                ).toBeGreaterThanOrEqual(120000); // ✅ minCandidateDuration
                expect(
                    mainCandidate.sellVolume / mainCandidate.totalVolume
                ).toBeGreaterThan(0.5); // ✅ Accumulation pattern
            }

            // If all requirements are met, a zone SHOULD be created OR merged
            // The zone formation can result in either creation or merge with existing zones
            expect(formationResult.updates.length).toBeGreaterThanOrEqual(1);
            // Accept either zone_created or zone_updated (for merge scenarios)
            const hasZoneUpdate = formationResult.updates.some(
                (update) =>
                    update.updateType === "zone_created" ||
                    update.updateType === "zone_updated"
            );
            expect(hasZoneUpdate).toBe(true);
            expect(detector.getActiveZones()).toHaveLength(1);

            const createdZone = detector.getActiveZones()[0];
            console.log("🔧 Final zone details:", {
                id: createdZone.id,
                type: createdZone.type,
                totalVolume: createdZone.totalVolume,
                priceRange: createdZone.priceRange,
                strength: createdZone.strength,
                completion: createdZone.completion,
            });
            expect(createdZone.type).toBe("accumulation");
            // Zone should have meaningful volume (may be from initial creation or accumulated)
            expect(createdZone.totalVolume).toBeGreaterThan(0);
        });
    });
});

// Helper to create valid accumulation sequence that meets all production requirements
function createValidAccumulationSequence(
    basePrice: number,
    startTime: number
): EnrichedTradeEvent[] {
    const trades: EnrichedTradeEvent[] = [];

    // Create 7 trades at exact same price (meets minTradeCount: 6)
    for (let i = 0; i < 7; i++) {
        const quantity = 45 + Math.random() * 15; // 45-60 each = institutional size (threshold: 40)
        const trade = createTrade(
            basePrice, // Exact same price for concentration
            startTime + i * 3000, // 3-second intervals
            Math.random() < 0.8, // 80% sell pressure
            quantity
        );
        trades.push(trade);
    }

    return trades;
}

function createTrade(
    price: number,
    timestamp: number,
    buyerIsMaker: boolean,
    quantity: number
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
