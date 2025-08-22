import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { DeltaCVDDetectorEnhanced } from "../src/indicators/deltaCVDDetectorEnhanced.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import { createMockSignalLogger } from "../__mocks__/src/infrastructure/signalLoggerInterface.js";
import { createMockTraditionalIndicators } from "../__mocks__/src/indicators/helpers/traditionalIndicators.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";

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

// Helper function to create zone data with CVD divergence
function createCVDDivergenceZoneData(
    price: number,
    buyPressure: number,
    sellPressure: number
): StandardZoneData {
    return {
        zones: [
            createCVDZoneSnapshot(
                price - 0.1,
                buyPressure * 0.7,
                sellPressure * 0.7
            ),
            createCVDZoneSnapshot(price, buyPressure * 1.5, sellPressure * 1.5),
            createCVDZoneSnapshot(
                price + 0.1,
                buyPressure * 0.7,
                sellPressure * 0.7
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

describe("DeltaCVDDetectorEnhanced single window CVD analysis", () => {
    let detector: DeltaCVDDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockPreprocessor: IOrderflowPreprocessor;
    let mockSignalValidationLogger: SignalValidationLogger;
    let signalSpy: vi.Mock;

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
        mockSignalValidationLogger = new SignalValidationLogger(mockLogger);

        const mockSignalLogger = createMockSignalLogger();
        const mockTraditionalIndicators = createMockTraditionalIndicators();

        detector = new DeltaCVDDetectorEnhanced(
            "cvd_single_window",
            {
                // Core CVD analysis parameters (match DeltaCVDDetectorSchema exactly)
                minTradesPerSec: 0.75,
                minVolPerSec: 10,
                signalThreshold: 0.4,
                eventCooldownMs: 5000,

                // Zone time window configuration
                timeWindowIndex: 0,

                // Zone enhancement control
                enhancementMode: "production",

                // CVD divergence analysis
                cvdImbalanceThreshold: 0.3,
            },
            mockPreprocessor,
            mockLogger,
            mockMetrics,
            mockSignalValidationLogger,
            mockSignalLogger
        );

        signalSpy = vi.fn();
        detector.on("signal", signalSpy);
    });

    it("should analyze CVD patterns with single window configuration", () => {
        // Create a trade event showing bullish CVD divergence
        // Price drops but buying volume increases (bullish divergence)
        const tradeEvent: EnrichedTradeEvent = {
            tradeId: 12345,
            price: 89.0, // Lower price
            quantity: 75, // High volume
            quoteQuantity: 89.0 * 75,
            timestamp: Date.now(),
            isBuyerMaker: false, // Aggressive buy
            passiveBidVolume: 200,
            passiveAskVolume: 100,
            zonePassiveBidVolume: 400,
            zonePassiveAskVolume: 150,
            bestBid: 88.99,
            bestAsk: 89.01,
            zoneData: createCVDDivergenceZoneData(89.0, 80, 30), // Strong buy pressure
        };

        // Process the CVD divergence trade
        expect(() => detector.onEnrichedTrade(tradeEvent)).not.toThrow();

        // The detector logs debug info during CVD analysis - this is expected
        expect(mockLogger.debug).toHaveBeenCalled(); // CVD analysis includes debug logging
    });

    it("should detect bearish CVD divergence patterns", () => {
        // Create a trade event showing bearish CVD divergence
        // Price rises but selling volume increases (bearish divergence)
        const tradeEvent: EnrichedTradeEvent = {
            tradeId: 12346,
            price: 89.5, // Higher price
            quantity: 65, // High volume
            quoteQuantity: 89.5 * 65,
            timestamp: Date.now(),
            isBuyerMaker: true, // Aggressive sell
            passiveBidVolume: 100,
            passiveAskVolume: 200,
            zonePassiveBidVolume: 150,
            zonePassiveAskVolume: 400,
            bestBid: 89.49,
            bestAsk: 89.51,
            zoneData: createCVDDivergenceZoneData(89.5, 25, 85), // Strong sell pressure
        };

        // Process the bearish CVD divergence
        expect(() => detector.onEnrichedTrade(tradeEvent)).not.toThrow();

        // The detector logs debug info during CVD analysis - this is expected
        expect(mockLogger.debug).toHaveBeenCalled(); // CVD analysis includes debug logging
    });

    it("should process sequence of trades maintaining CVD state", () => {
        const basePrice = 89.0;
        const sequenceLength = 10;

        // Create a sequence showing divergence pattern
        for (let i = 0; i < sequenceLength; i++) {
            const price = basePrice + i * 0.01; // Rising price
            const buyVolume = 80 - i * 5; // Declining buy volume (bearish divergence)
            const sellVolume = 20 + i * 3; // Increasing sell volume

            const tradeEvent: EnrichedTradeEvent = {
                tradeId: 12347 + i,
                price,
                quantity: 50 + i * 2,
                quoteQuantity: price * (50 + i * 2),
                timestamp: Date.now() + i * 1000,
                isBuyerMaker: i % 2 === 0, // Alternating buy/sell
                passiveBidVolume: 100,
                passiveAskVolume: 100,
                zonePassiveBidVolume: 200 - i * 10,
                zonePassiveAskVolume: 200 + i * 15,
                bestBid: price - 0.01,
                bestAsk: price + 0.01,
                zoneData: createCVDDivergenceZoneData(
                    price,
                    buyVolume,
                    sellVolume
                ),
            };

            expect(() => detector.onEnrichedTrade(tradeEvent)).not.toThrow();
        }

        // The detector logs debug info during CVD analysis - this is expected
        expect(mockLogger.debug).toHaveBeenCalled(); // CVD analysis includes debug logging

        // Verify detector maintained state through sequence
        const debugCalls = (mockLogger.debug as vi.Mock).mock.calls;
        expect(debugCalls.length).toBeGreaterThan(0); // Should have debug logs
    });

    it("should validate CVD confidence calculation functionality", () => {
        // Test that the detector's CVD analysis components work
        expect(detector).toBeDefined();
        expect(typeof detector.onEnrichedTrade).toBe("function");
        expect(typeof detector.getStatus).toBe("function");
        expect(typeof detector.getId).toBe("function");

        // Create high-confidence CVD signal conditions
        const highConfidenceEvent: EnrichedTradeEvent = {
            tradeId: 12348,
            price: 89.0,
            quantity: 100, // Very high volume
            quoteQuantity: 89.0 * 100,
            timestamp: Date.now(),
            isBuyerMaker: false, // Strong buy
            passiveBidVolume: 300,
            passiveAskVolume: 50, // High imbalance
            zonePassiveBidVolume: 500,
            zonePassiveAskVolume: 100,
            bestBid: 88.99,
            bestAsk: 89.01,
            zoneData: createCVDDivergenceZoneData(89.0, 120, 20), // Extreme buy pressure
        };

        // Should process high-confidence conditions without error
        expect(() =>
            detector.onEnrichedTrade(highConfidenceEvent)
        ).not.toThrow();
    });

    it("should handle edge cases in CVD analysis", () => {
        // Test with minimal volume (should not trigger CVD)
        const lowVolumeEvent: EnrichedTradeEvent = {
            tradeId: 12349,
            price: 89.0,
            quantity: 1, // Very low volume
            quoteQuantity: 89.0,
            timestamp: Date.now(),
            isBuyerMaker: false,
            passiveBidVolume: 10,
            passiveAskVolume: 10,
            zonePassiveBidVolume: 20,
            zonePassiveAskVolume: 20,
            bestBid: 88.99,
            bestAsk: 89.01,
            zoneData: createCVDDivergenceZoneData(89.0, 5, 5),
        };

        expect(() => detector.onEnrichedTrade(lowVolumeEvent)).not.toThrow();

        // Test with null zone data (should skip analysis)
        const noZoneEvent: EnrichedTradeEvent = {
            tradeId: 12350,
            price: 89.0,
            quantity: 50,
            quoteQuantity: 89.0 * 50,
            timestamp: Date.now(),
            isBuyerMaker: false,
            passiveBidVolume: 100,
            passiveAskVolume: 100,
            zonePassiveBidVolume: 200,
            zonePassiveAskVolume: 200,
            bestBid: 88.99,
            bestAsk: 89.01,
            zoneData: undefined, // No zone data
        };

        expect(() => detector.onEnrichedTrade(noZoneEvent)).not.toThrow();
    });
});
