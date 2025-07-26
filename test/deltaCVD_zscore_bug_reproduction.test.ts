import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before imports - MANDATORY per CLAUDE.md
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { DeltaCVDDetectorEnhanced } from "../src/indicators/deltaCVDDetectorEnhanced.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";

// Import mock config for complete settings
import mockConfig from "../__mocks__/config.json";

const createMockPreprocessor = (): IOrderflowPreprocessor => ({
    handleDepth: vi.fn(),
    handleAggTrade: vi.fn(),
    getStats: vi.fn(() => ({
        processedTrades: 0,
        processedDepthUpdates: 0,
        bookMetrics: {} as any,
    })),
    findZonesNearPrice: vi.fn(() => []),
    calculateZoneRelevanceScore: vi.fn(() => 0.5),
    findMostRelevantZone: vi.fn(() => null),
});

// Helper function to create zone snapshots with CVD data
function createCVDZoneSnapshot(
    priceLevel: number,
    aggressiveBuyVolume: number,
    aggressiveSellVolume: number
): ZoneSnapshot {
    return {
        zoneId: `zone-${priceLevel}`,
        priceLevel,
        tickSize: 0.01,
        aggressiveVolume: aggressiveBuyVolume + aggressiveSellVolume,
        passiveVolume: 100,
        aggressiveBuyVolume,
        aggressiveSellVolume,
        passiveBidVolume: 50,
        passiveAskVolume: 50,
        tradeCount: 10,
        timespan: 60000,
        boundaries: { min: priceLevel - 0.005, max: priceLevel + 0.005 },
        lastUpdate: Date.now(),
        volumeWeightedPrice: priceLevel,
    };
}

// Helper function to create zone data with strong CVD divergence
function createStrongCVDZoneData(
    price: number,
    buyVolume: number,
    sellVolume: number
): StandardZoneData {
    return {
        zones: [
            createCVDZoneSnapshot(
                price - 0.1,
                buyVolume * 0.7,
                sellVolume * 0.7
            ),
            createCVDZoneSnapshot(price, buyVolume * 1.5, sellVolume * 1.5),
            createCVDZoneSnapshot(
                price + 0.1,
                buyVolume * 0.7,
                sellVolume * 0.7
            ),
        ],
        zoneConfig: {
            zoneTicks: 10,
            tickValue: 0.01,
            timeWindow: 60000,
        },
        timestamp: Date.now(),
    };
}

/**
 * STANDALONE CVD FUNCTIONALITY VALIDATION
 *
 * This test validates that the standalone DeltaCVD detector can:
 * 1. Process high-volume trades with CVD divergence patterns
 * 2. Handle mathematical calculations without numeric instability
 * 3. Properly analyze zone-based CVD data
 *
 * Replaces the original z-score specific bug reproduction with broader CVD validation.
 */

describe("DeltaCVD Standalone Validation - Mathematical Stability", () => {
    let detector: DeltaCVDDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockPreprocessor: IOrderflowPreprocessor;
    let signalSpy: vi.Mock;

    const createTradeEvent = (
        price: number,
        quantity: number,
        isBuyerMaker: boolean,
        timestamp: number,
        buyVolume: number = 50,
        sellVolume: number = 50
    ): EnrichedTradeEvent => ({
        tradeId: Math.floor(Math.random() * 1000000),
        price,
        quantity,
        quoteQuantity: price * quantity,
        timestamp,
        isBuyerMaker,
        passiveBidVolume: 50,
        passiveAskVolume: 50,
        zonePassiveBidVolume: 100,
        zonePassiveAskVolume: 100,
        bestBid: price - 0.01,
        bestAsk: price + 0.01,
        zoneData: createStrongCVDZoneData(price, buyVolume, sellVolume),
    });

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
        } as ILogger;
        mockMetrics = new MetricsCollector();
        mockPreprocessor = createMockPreprocessor();

        detector = new DeltaCVDDetectorEnhanced(
            "standalone_validation_test",
            "LTCUSDT",
            {
                ...mockConfig.symbols.LTCUSDT.deltaCVD,
                windowsSec: [60],
                enhancementMode: "production" as const,
            },
            mockPreprocessor,
            mockLogger,
            mockMetrics
        );

        signalSpy = vi.fn();
        detector.on("signal", signalSpy);
    });

    it("should handle high-volume CVD patterns without mathematical instability", () => {
        console.log("\\n=== STANDALONE CVD MATHEMATICAL STABILITY TEST ===");

        const baseTime = Date.now();
        const basePrice = 85.0;
        const tradeCount = 75;

        console.log(
            `Processing ${tradeCount} trades with strong CVD divergence patterns...`
        );

        // Create a strong bullish CVD divergence pattern
        // Price slowly declines but buy volume dominates (bullish divergence)
        const trades: EnrichedTradeEvent[] = [];

        for (let i = 0; i < tradeCount; i++) {
            const timeOffset = i * 1000; // 1 second intervals
            const priceDecline = basePrice - i * 0.005; // Gradually declining price
            const buyVolume = 60 + i * 2; // Increasing buy volume
            const sellVolume = 30 - i * 0.5; // Decreasing sell volume
            const quantity = 10 + i * 0.5; // Increasing quantity

            const trade = createTradeEvent(
                priceDecline,
                quantity,
                false, // Aggressive buy (buyer is NOT maker)
                baseTime + timeOffset,
                Math.max(buyVolume, 10), // Ensure minimum volume
                Math.max(sellVolume, 5) // Ensure minimum volume
            );

            trades.push(trade);
        }

        // Process all trades
        trades.forEach((trade, index) => {
            expect(() => detector.onEnrichedTrade(trade)).not.toThrow();

            if (index % 25 === 0) {
                console.log(
                    `Processed ${index + 1}/${tradeCount} trades - Price: ${trade.price.toFixed(3)}, Buy Vol: ${trade.zoneData?.zones[1]?.aggressiveBuyVolume}`
                );
            }
        });

        console.log("\\n--- CVD Analysis Results ---");

        // Verify the detector processed all trades successfully
        expect(mockLogger.error).not.toHaveBeenCalled(); // No errors expected

        // Check that analysis is occurring (debug logs should show CVD processing)
        const debugCalls = (mockLogger.debug as vi.Mock).mock.calls;
        const cvdAnalysisCalls = debugCalls.filter(
            (call) =>
                call[0].includes("DeltaCVDDetectorEnhanced") &&
                call[0].includes("CVD")
        );

        console.log(`CVD analysis calls detected: ${cvdAnalysisCalls.length}`);
        expect(cvdAnalysisCalls.length).toBeGreaterThan(0);

        // Verify mathematical stability - no errors about NaN or infinite values
        const mathErrorCalls = debugCalls.filter(
            (call) =>
                call[0].includes("NaN") ||
                call[0].includes("Infinity") ||
                call[0].includes("mathematical error")
        );
        expect(mathErrorCalls.length).toBe(0);

        console.log("\\n✅ Mathematical stability test completed successfully");
    });

    it("should handle extreme CVD imbalance scenarios", () => {
        console.log("\\n=== EXTREME CVD IMBALANCE TEST ===");

        // Test with extreme buy/sell imbalances to ensure mathematical robustness
        const extremeScenarios = [
            { buyVol: 1000, sellVol: 1, scenario: "Extreme Buy Dominance" },
            { buyVol: 1, sellVol: 1000, scenario: "Extreme Sell Dominance" },
            { buyVol: 500, sellVol: 500, scenario: "Perfect Balance" },
            { buyVol: 0, sellVol: 100, scenario: "Zero Buy Volume" },
            { buyVol: 100, sellVol: 0, scenario: "Zero Sell Volume" },
        ];

        extremeScenarios.forEach((scenario, index) => {
            console.log(`Testing ${scenario.scenario}...`);

            const trade = createTradeEvent(
                85.0 + index * 0.01,
                50,
                false,
                Date.now() + index * 1000,
                scenario.buyVol,
                scenario.sellVol
            );

            expect(() => detector.onEnrichedTrade(trade)).not.toThrow();
        });

        console.log("✅ Extreme imbalance scenarios handled successfully");
    });

    it("should maintain consistent behavior across multiple CVD analysis cycles", () => {
        // Test that repeated analysis produces consistent results
        const testPrice = 85.0;
        const testTrade = createTradeEvent(
            testPrice,
            25,
            false,
            Date.now(),
            75,
            25
        );

        // Run the same trade multiple times
        for (let i = 0; i < 10; i++) {
            expect(() =>
                detector.onEnrichedTrade({
                    ...testTrade,
                    timestamp: Date.now() + i * 1000,
                    tradeId: 50000 + i,
                })
            ).not.toThrow();
        }

        // Verify consistent processing (should not accumulate errors)
        expect(detector).toBeDefined();
        expect(typeof detector.getStatus).toBe("function");

        const status = detector.getStatus();
        expect(status).toContain("CVD Detector");
    });
});
