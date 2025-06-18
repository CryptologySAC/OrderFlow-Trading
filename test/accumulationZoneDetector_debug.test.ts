import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("AccumulationZoneDetector - Debug Zone Creation", () => {
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
        
        // Use minimal config to help zone creation
        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 10000, // Start with 10 seconds
            minZoneVolume: 50,           // Lower threshold
            minTradeCount: 3,            // Lower threshold
            maxPriceDeviation: 0.1,      // Higher tolerance
            minZoneStrength: 0.1,        // Lower threshold
            strengthChangeThreshold: 0.05, // Lower threshold
        };

        detector = new AccumulationZoneDetector(
            "debug-accumulation",
            "BTCUSDT", 
            config,
            mockLogger,
            mockMetrics
        );
    });

    it("should debug why zones aren't being created", () => {
        const baseTime = Date.now();
        const basePrice = 50000;
        
        console.log("🔍 DEBUG: Starting zone creation test");
        
        // Create high-volume, high-sell-pressure trades with institutional size
        const trades: EnrichedTradeEvent[] = [];
        for (let i = 0; i < 20; i++) {
            const trade: EnrichedTradeEvent = {
                price: basePrice + (Math.random() - 0.5) * 1, // Tight price range
                quantity: 100 + Math.random() * 50, // 100-150 institutional size
                timestamp: baseTime + i * 1000,
                buyerIsMaker: Math.random() < 0.9, // 90% sell pressure
                pair: "BTCUSDT",
                tradeId: `debug_${i}`,
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };
            trades.push(trade);
        }
        
        console.log(`🔍 DEBUG: Created ${trades.length} trades`);
        console.log(`🔍 DEBUG: Total volume: ${trades.reduce((sum, t) => sum + t.quantity, 0)}`);
        console.log(`🔍 DEBUG: Sell ratio: ${trades.filter(t => t.buyerIsMaker).length / trades.length}`);
        
        // Process trades
        trades.forEach((trade, i) => {
            const result = detector.analyze(trade);
            if (i === 0 || i === 10 || i === 19) {
                console.log(`🔍 DEBUG: Trade ${i}: updates=${result.updates.length}, signals=${result.signals.length}`);
            }
        });
        
        console.log(`🔍 DEBUG: Candidates after trades: ${detector.getCandidateCount()}`);
        console.log(`🔍 DEBUG: Active zones after trades: ${detector.getActiveZones().length}`);
        
        // Try to trigger zone formation after minimum duration
        const formationTrade: EnrichedTradeEvent = {
            price: basePrice + 0.1,
            quantity: 200, // Large institutional trade
            timestamp: baseTime + 15000, // 15 seconds later
            buyerIsMaker: true, // Sell pressure
            pair: "BTCUSDT",
            tradeId: "formation_trigger",
            originalTrade: {} as any,
            passiveBidVolume: 0,
            passiveAskVolume: 0,
            zonePassiveBidVolume: 0,
            zonePassiveAskVolume: 0,
        };
        
        console.log("🔍 DEBUG: Triggering zone formation...");
        const formationResult = detector.analyze(formationTrade);
        
        console.log(`🔍 DEBUG: Formation result: updates=${formationResult.updates.length}, signals=${formationResult.signals.length}`);
        console.log(`🔍 DEBUG: Final candidates: ${detector.getCandidateCount()}`);
        console.log(`🔍 DEBUG: Final zones: ${detector.getActiveZones().length}`);
        
        // Log candidate details
        const candidates = detector.getCandidates();
        candidates.forEach((candidate, i) => {
            console.log(`🔍 DEBUG: Candidate ${i}:`, {
                priceLevel: candidate.priceLevel,
                totalVolume: candidate.totalVolume,
                sellVolume: candidate.sellVolume,
                buyVolume: candidate.buyVolume,
                tradeCount: candidate.tradeCount,
                duration: formationTrade.timestamp - candidate.startTime,
                priceStability: candidate.priceStability,
            });
        });
        
        // At least we should have candidates
        expect(detector.getCandidateCount()).toBeGreaterThan(0);
    });
});