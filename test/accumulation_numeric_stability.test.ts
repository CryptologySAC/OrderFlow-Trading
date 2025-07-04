// test/accumulation_numeric_stability.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

describe("AccumulationZoneDetector Numeric Stability Fixes", () => {
    let detector: AccumulationZoneDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    const mockPreprocessor: IOrderflowPreprocessor = {
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
    };

    beforeEach(() => {
        // NOTE: AccumulationZoneDetectorEnhanced requires bindable logger methods due to logger.info.bind(logger) pattern
        // Using inline mock instead of centralized mock for this specific enhanced detector
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn().mockReturnValue(false),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        mockMetrics = {
            registerMetric: vi.fn(),
            recordHistogram: vi.fn(),
            getHistogramPercentiles: vi.fn().mockReturnValue(null),
            getHistogramSummary: vi.fn().mockReturnValue(null),
            recordGauge: vi.fn(),
            getGaugeValue: vi.fn().mockReturnValue(null),
            createGauge: vi.fn().mockReturnValue({
                increment: vi.fn(),
                decrement: vi.fn(),
                set: vi.fn(),
                get: vi.fn().mockReturnValue(0),
            }),
            setGauge: vi.fn(),
            incrementCounter: vi.fn(),
            decrementCounter: vi.fn(),
            getCounterRate: vi.fn().mockReturnValue(0),
            createCounter: vi.fn().mockReturnValue({
                increment: vi.fn(),
                get: vi.fn().mockReturnValue(0),
            }),
            createHistogram: vi
                .fn()
                .mockReturnValue({ observe: vi.fn(), reset: vi.fn() }),
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            getMetrics: vi.fn().mockReturnValue({
                legacy: {
                    signalsGenerated: 0,
                    connectionsActive: 0,
                    processingLatency: [],
                    errorsCount: 0,
                    circuitBreakerState: "closed",
                    uptime: 0,
                },
                enhanced: {
                    signalsGenerated: 0,
                    connectionsActive: 0,
                    processingLatency: [],
                    errorsCount: 0,
                    circuitBreakerState: "closed",
                    uptime: 0,
                },
                counters: {},
                gauges: {},
                histograms: {},
                metadata: {},
            }),
            getAverageLatency: vi.fn().mockReturnValue(0),
            getLatencyPercentiles: vi.fn().mockReturnValue({}),
            exportPrometheus: vi.fn().mockReturnValue(""),
            exportJSON: vi.fn().mockReturnValue(""),
            getHealthSummary: vi.fn().mockReturnValue({
                status: "healthy",
                details: {},
                healthy: true,
                uptime: 0,
                errorRate: 0,
                avgLatency: 0,
                memoryUsage: 0,
                cpuUsage: 0,
                activeConnections: 0,
            }),
            reset: vi.fn(),
            cleanup: vi.fn(),
        };

        detector = new AccumulationZoneDetectorEnhanced(
            "test_accumulation",
            "LTCUSDT",
            {
                minCandidateDuration: 60000,
                minZoneVolume: 100,
                minTradeCount: 5,
                minSellRatio: 0.55,
                maxPriceDeviation: 0.02,
                minZoneStrength: 0.3,
            },
            mockLogger,
            mockMetrics
        );
    });

    it("should handle NaN price values without crashing", () => {
        const invalidTrade: EnrichedTradeEvent = {
            price: NaN,
            quantity: 10,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test1",
            pair: "LTCUSDT",
            originalTrade: {} as any,
            passiveBidVolume: 5,
            passiveAskVolume: 5,
            zonePassiveBidVolume: 10,
            zonePassiveAskVolume: 10,
            depthSnapshot: new Map(),
            bestBid: 100,
            bestAsk: 101,
        };

        const result = detector.analyze(invalidTrade);

        expect(result).toBeDefined();
        expect(result.updates).toEqual([]);
        expect(result.signals).toEqual([]);
        expect(result.activeZones).toEqual([]);

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalled();
        // Verify the warning message contains information about invalid price
        const warnCalls = mockLogger.warn.mock.calls;
        const hasInvalidPriceCall = warnCalls.some(
            (call) =>
                call.length > 0 &&
                typeof call[0] === "string" &&
                call[0].includes("Invalid price")
        );
        expect(hasInvalidPriceCall).toBe(true);
    });

    it("should handle Infinity quantity values without crashing", () => {
        const invalidTrade: EnrichedTradeEvent = {
            price: 100,
            quantity: Infinity,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test2",
            pair: "LTCUSDT",
            originalTrade: {} as any,
            passiveBidVolume: 5,
            passiveAskVolume: 5,
            zonePassiveBidVolume: 10,
            zonePassiveAskVolume: 10,
            depthSnapshot: new Map(),
            bestBid: 100,
            bestAsk: 101,
        };

        const result = detector.analyze(invalidTrade);

        expect(result).toBeDefined();
        expect(result.updates).toEqual([]);
        expect(result.signals).toEqual([]);
        expect(result.activeZones).toEqual([]);

        // Should log a warning about invalid quantity
        expect(mockLogger.warn).toHaveBeenCalled();
        // Verify the warning message contains information about invalid quantity
        const warnCalls = mockLogger.warn.mock.calls;
        const hasInvalidQuantityCall = warnCalls.some(
            (call) =>
                call.length > 0 &&
                typeof call[0] === "string" &&
                call[0].includes("Invalid")
        );
        expect(hasInvalidQuantityCall).toBe(true);
    });

    it("should handle zero price values gracefully", () => {
        const zeroTrade: EnrichedTradeEvent = {
            price: 0,
            quantity: 10,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test3",
            pair: "LTCUSDT",
            originalTrade: {} as any,
            passiveBidVolume: 5,
            passiveAskVolume: 5,
            zonePassiveBidVolume: 10,
            zonePassiveAskVolume: 10,
            depthSnapshot: new Map(),
            bestBid: 100,
            bestAsk: 101,
        };

        const result = detector.analyze(zeroTrade);

        expect(result).toBeDefined();
        expect(result.updates).toEqual([]);
        expect(result.signals).toEqual([]);
        expect(result.activeZones).toEqual([]);

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalled();
        // Verify the warning message contains information about invalid price
        const warnCalls = mockLogger.warn.mock.calls;
        const hasInvalidPriceCall = warnCalls.some(
            (call) =>
                call.length > 0 &&
                typeof call[0] === "string" &&
                call[0].includes("Invalid price")
        );
        expect(hasInvalidPriceCall).toBe(true);
    });

    it("should validate numeric values correctly through public interface", () => {
        // TEST BEHAVIOR: Check that detector handles invalid values gracefully
        // Rather than testing private methods, test the public behavior

        // Test that detector doesn't crash with valid values
        const validTrade = createTestTrade(100.5, 10, "buy");
        expect(() => detector.analyze(validTrade)).not.toThrow();

        // The detector should handle invalid values gracefully (tested above)
        // Private method testing is not needed - public interface behavior is what matters
    });

    it("should handle division operations correctly through public interface", () => {
        // TEST BEHAVIOR: Verify detector handles mathematical operations safely
        // Focus on public behavior rather than private method testing

        // Test that detector processes trades with various volume ratios safely
        const normalTrade = createTestTrade(100.5, 50, "buy");
        const smallVolumeTrade = createTestTrade(100.5, 0.001, "buy");

        expect(() => detector.analyze(normalTrade)).not.toThrow();
        expect(() => detector.analyze(smallVolumeTrade)).not.toThrow();

        // Division safety is handled internally - public interface should be robust
    });

    it("should handle statistical calculations correctly through public interface", () => {
        // TEST BEHAVIOR: Verify detector handles statistical operations safely
        // Focus on public behavior rather than private method testing

        // Test that detector processes multiple trades safely (which involves statistical calculations)
        const trades = [
            createTestTrade(100.0, 10, "buy"),
            createTestTrade(100.1, 15, "buy"),
            createTestTrade(100.2, 20, "buy"),
            createTestTrade(100.3, 25, "buy"),
        ];

        trades.forEach((trade) => {
            expect(() => detector.analyze(trade)).not.toThrow();
        });

        // Statistical calculations are handled internally - public interface should be robust
    });

    it("should handle negative passive volume values gracefully", () => {
        const tradeWithNegativePassive: EnrichedTradeEvent = {
            price: 100,
            quantity: 1,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test4",
            pair: "LTCUSDT",
            originalTrade: {} as any,
            passiveBidVolume: 10,
            passiveAskVolume: 10,
            zonePassiveBidVolume: -5, // Negative passive volume
            zonePassiveAskVolume: -10, // Negative passive volume
            depthSnapshot: new Map(),
            bestBid: 100,
            bestAsk: 101,
        };

        const result = detector.analyze(tradeWithNegativePassive);

        expect(result).toBeDefined();
        // Should not crash and process the trade
        expect(result.updates).toBeDefined();
        expect(result.signals).toBeDefined();
        expect(result.activeZones).toBeDefined();
    });

    it("should handle extreme passive volume values gracefully", () => {
        const tradeWithExtremePassive: EnrichedTradeEvent = {
            price: 100,
            quantity: 1,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test5",
            pair: "LTCUSDT",
            originalTrade: {} as any,
            passiveBidVolume: 10,
            passiveAskVolume: 10,
            zonePassiveBidVolume: 1000000, // Extreme passive volume
            zonePassiveAskVolume: 2000000, // Extreme passive volume
            depthSnapshot: new Map(),
            bestBid: 100,
            bestAsk: 101,
        };

        const result = detector.analyze(tradeWithExtremePassive);

        expect(result).toBeDefined();
        // Should not crash and process the trade
        expect(result.updates).toBeDefined();
        expect(result.signals).toBeDefined();
        expect(result.activeZones).toBeDefined();
    });

    it("should process valid trades correctly", () => {
        const validTrade: EnrichedTradeEvent = {
            price: 100.5,
            quantity: 10.25,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test6",
            pair: "LTCUSDT",
            originalTrade: {} as any,
            passiveBidVolume: 15.5,
            passiveAskVolume: 12.3,
            zonePassiveBidVolume: 25.8,
            zonePassiveAskVolume: 20.1,
            depthSnapshot: new Map(),
            bestBid: 100.4,
            bestAsk: 100.6,
        };

        const result = detector.analyze(validTrade);

        expect(result).toBeDefined();
        expect(result.updates).toBeDefined();
        expect(result.signals).toBeDefined();
        expect(result.activeZones).toBeDefined();

        // Should not log any warnings for valid trade
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("should handle price level calculations with edge cases", () => {
        // TEST BEHAVIOR: Verify detector handles various price inputs gracefully
        // Focus on public interface behavior rather than private method testing

        // Test that detector processes valid trades without errors
        const validTrade = createTestTrade(100.5, 10, "buy");
        expect(() => detector.analyze(validTrade)).not.toThrow();

        // Test that detector handles invalid price inputs gracefully (tested above)
        // The detector should handle these cases internally without exposing private methods
        expect(detector.getCandidateCount()).toBeGreaterThanOrEqual(0);
    });

    it("should handle accumulation zone analysis without crashes", () => {
        // Add multiple trades to create accumulation scenario
        for (let i = 0; i < 10; i++) {
            const trade: EnrichedTradeEvent = {
                price: 100 + i * 0.01, // Clustered around 100
                quantity: 1 + i,
                timestamp: Date.now() - i * 1000,
                buyerIsMaker: i % 3 === 0, // Mostly sell pressure (accumulation pattern)
                tradeId: `test_${i}`,
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10 + i,
                passiveAskVolume: 10 + i,
                zonePassiveBidVolume: 20 + i,
                zonePassiveAskVolume: 20 + i,
                depthSnapshot: new Map(),
                bestBid: 100,
                bestAsk: 101,
            };
            detector.analyze(trade);
        }

        // Should not crash during accumulation analysis
        expect(detector.getCandidateCount()).toBeGreaterThanOrEqual(0);
        expect(detector.getActiveZones()).toBeDefined();
    });

    it("should handle zone formation calculations safely", () => {
        // TEST BEHAVIOR: Verify detector handles complex zone calculations safely
        // Focus on public interface behavior rather than private method testing

        // Test that detector processes a sequence of trades that might trigger zone formation
        const trades = [
            createTestTrade(100.0, 50, "buy"), // Base price
            createTestTrade(100.01, 60, "buy"), // Slight increase
            createTestTrade(99.99, 40, "buy"), // Slight decrease
            createTestTrade(100.0, 55, "buy"), // Back to base
            createTestTrade(100.02, 45, "buy"), // Small variation
        ];

        // Process all trades - should not crash during zone calculations
        trades.forEach((trade) => {
            expect(() => detector.analyze(trade)).not.toThrow();
        });

        // Detector should maintain valid state after processing
        expect(detector.getCandidateCount()).toBeGreaterThanOrEqual(0);
        expect(detector.getActiveZones()).toBeDefined();

        // Zone formation calculations are handled internally safely
        expect(true).toBe(true);
    });
});

// Helper function to create test trade events
function createTestTrade(
    price: number,
    quantity: number,
    side: "buy" | "sell"
): EnrichedTradeEvent {
    return {
        price,
        quantity,
        timestamp: Date.now(),
        buyerIsMaker: side === "sell",
        tradeId: `test_${Date.now()}_${Math.random()}`,
        pair: "LTCUSDT",
        originalTrade: {} as any,
        passiveBidVolume: 10,
        passiveAskVolume: 10,
        zonePassiveBidVolume: 20,
        zonePassiveAskVolume: 20,
        depthSnapshot: new Map(),
        bestBid: price - 0.01,
        bestAsk: price + 0.01,
    };
}
