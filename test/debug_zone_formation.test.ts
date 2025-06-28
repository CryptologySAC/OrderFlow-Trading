import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("Debug Zone Formation", () => {
    let detector: AccumulationZoneDetector;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let debugOutput: string[] = [];

    beforeEach(() => {
        debugOutput = [];

        mockLogger = {
            info: vi.fn((msg, data) => {
                debugOutput.push(`[INFO] ${msg}: ${JSON.stringify(data)}`);
            }),
            warn: vi.fn((msg, data) => {
                debugOutput.push(`[WARN] ${msg}: ${JSON.stringify(data)}`);
            }),
            error: vi.fn((msg, data) => {
                debugOutput.push(`[ERROR] ${msg}: ${JSON.stringify(data)}`);
            }),
            debug: vi.fn((msg, data) => {
                debugOutput.push(`[DEBUG] ${msg}: ${JSON.stringify(data)}`);
                console.log(`[DEBUG] ${msg}`, JSON.stringify(data, null, 2));
            }),
            trace: vi.fn((msg, data) => {
                debugOutput.push(`[TRACE] ${msg}: ${JSON.stringify(data)}`);
            }),
        } as unknown as ILogger;

        mockMetrics = new MetricsCollector();
    });

    it("should debug why zones are not forming with ultra permissive config", () => {
        // Ultra permissive config
        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 5000, // 5 seconds only
            minZoneVolume: 10, // Very low
            minTradeCount: 2, // Very low
            maxPriceDeviation: 0.5, // 50% - extremely permissive
            minZoneStrength: 0.01, // Almost nothing
            strengthChangeThreshold: 0.15,
            minSellRatio: 0.1, // 10% - very low
        };

        console.log("=== CREATING DETECTOR WITH ULTRA PERMISSIVE CONFIG ===");
        console.log(JSON.stringify(config, null, 2));

        detector = new AccumulationZoneDetector(
            "debug-test",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );

        const baseTime = Date.now();
        const basePrice = 50000;

        // Create simple deterministic trades
        const trades: EnrichedTradeEvent[] = [
            {
                price: basePrice,
                quantity: 100,
                timestamp: baseTime,
                buyerIsMaker: true, // Sell
                pair: "BTCUSDT",
                tradeId: "debug-1",
                originalTrade: {} as any,
                passiveBidVolume: 100,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            },
            {
                price: basePrice,
                quantity: 100,
                timestamp: baseTime + 1000,
                buyerIsMaker: true, // Sell
                pair: "BTCUSDT",
                tradeId: "debug-2",
                originalTrade: {} as any,
                passiveBidVolume: 100,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            },
            {
                price: basePrice,
                quantity: 50,
                timestamp: baseTime + 2000,
                buyerIsMaker: false, // Buy (minimal)
                pair: "BTCUSDT",
                tradeId: "debug-3",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 50,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            },
        ];

        console.log("\n=== PROCESSING TRADES ===");
        trades.forEach((trade, i) => {
            console.log(
                `\nTrade ${i + 1}: price=${trade.price}, qty=${trade.quantity}, sell=${trade.buyerIsMaker}`
            );
            const result = detector.analyze(trade);
            console.log(
                `  Candidates: ${(detector as any).getCandidateCount()}`
            );
            console.log(`  Active zones: ${detector.getActiveZones().length}`);
            console.log(`  Updates: ${result.updates.length}`);
        });

        // Wait and trigger zone formation
        console.log("\n=== TRIGGERING ZONE FORMATION (after 10 seconds) ===");
        const triggerTrade: EnrichedTradeEvent = {
            price: basePrice,
            quantity: 100,
            timestamp: baseTime + 10000, // 10 seconds later (> 5 second requirement)
            buyerIsMaker: true,
            pair: "BTCUSDT",
            tradeId: "trigger",
            originalTrade: {} as any,
            passiveBidVolume: 100,
            passiveAskVolume: 0,
            zonePassiveBidVolume: 0,
            zonePassiveAskVolume: 0,
        };

        const finalResult = detector.analyze(triggerTrade);

        console.log("\n=== FINAL RESULT ===");
        console.log(`Updates: ${finalResult.updates.length}`);
        console.log(`Signals: ${finalResult.signals.length}`);
        console.log(`Active zones: ${finalResult.activeZones.length}`);
        console.log(
            `Final candidates: ${(detector as any).getCandidateCount()}`
        );

        // Check if any candidates exist
        const candidates = (detector as any).getCandidates();
        if (candidates && candidates.length > 0) {
            console.log("\n=== CANDIDATE ANALYSIS ===");
            candidates.forEach((candidate, index) => {
                console.log(
                    `Candidate ${index} at price level ${candidate.priceLevel}:`
                );
                console.log(
                    `  Total volume: ${candidate.totalVolume} (need >= ${config.minZoneVolume})`
                );
                console.log(`  Sell volume: ${candidate.sellVolume}`);
                console.log(`  Buy volume: ${candidate.buyVolume}`);
                console.log(
                    `  Trade count: ${candidate.trades?.length || candidate.trades?.getSize?.() || "unknown"} (need >= ${config.minTradeCount})`
                );
                console.log(
                    `  Duration: ${triggerTrade.timestamp - candidate.startTime}ms (need >= ${config.minCandidateDuration}ms)`
                );
                console.log(
                    `  Price stability: ${candidate.priceStability} (need >= ${1 - config.maxPriceDeviation})`
                );

                const sellRatio = candidate.sellVolume / candidate.totalVolume;
                console.log(
                    `  Sell ratio: ${sellRatio.toFixed(3)} (need >= ${config.minSellRatio})`
                );

                const buyRatio = candidate.buyVolume / candidate.totalVolume;
                const maxBuyRatio = 1 - (config.minSellRatio || 0.55);
                console.log(
                    `  Buy ratio: ${buyRatio.toFixed(3)} (need <= ${maxBuyRatio})`
                );

                // Check institutional scoring (this is likely the blocker)
                const minInstitutionalScore = Math.min(
                    0.15, // MAX_INSTITUTIONAL_SCORE_FLOOR
                    config.minZoneStrength * 0.3 // MIN_INSTITUTIONAL_SCORE_RATIO
                );
                console.log(
                    `  Required institutional score: ${minInstitutionalScore.toFixed(4)}`
                );

                // Check which requirements are failing
                console.log("\n  REQUIREMENT CHECK:");
                console.log(
                    `  ✓ Duration: ${triggerTrade.timestamp - candidate.startTime >= config.minCandidateDuration}`
                );
                console.log(
                    `  ✓ Volume: ${candidate.totalVolume >= config.minZoneVolume}`
                );
                console.log(
                    `  ✓ Trade count: ${(candidate.trades?.length || candidate.trades?.getSize?.() || 0) >= config.minTradeCount}`
                );
                console.log(
                    `  ✓ Sell ratio: ${sellRatio >= config.minSellRatio}`
                );
                console.log(
                    `  ✓ Price stability: ${candidate.priceStability >= 1 - config.maxPriceDeviation}`
                );
                console.log(`  ✓ Buy ratio: ${buyRatio <= maxBuyRatio}`);
                console.log(
                    `  ? Institutional score: UNKNOWN (likely failing - this is the blocker!)`
                );
            });
        } else {
            console.log(
                "\n❌ NO CANDIDATES FOUND - Issue with candidate creation"
            );
        }

        console.log("\n=== DEBUG OUTPUT ===");
        debugOutput.forEach((line) => console.log(line));

        // Basic expectations - we should at least get candidates
        expect((detector as any).getCandidateCount()).toBeGreaterThan(0);

        if (finalResult.updates.length === 0) {
            console.log(
                "\n❌ NO ZONE FORMED - Even with ultra permissive config!"
            );
            console.log(
                "   This suggests a fundamental issue with zone formation logic"
            );
        } else {
            console.log("\n✅ Zone formed successfully!");
        }
    });
});
