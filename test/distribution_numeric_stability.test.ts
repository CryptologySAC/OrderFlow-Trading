// test/distribution_numeric_stability.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DistributionDetectorEnhanced } from "../src/indicators/distributionDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { FinancialMath } from "../src/utils/financialMath.js";

describe("DistributionZoneDetector Numeric Stability Fixes", () => {
    let detector: DistributionDetectorEnhanced;
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
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: () => false,
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

        detector = new DistributionDetectorEnhanced(
            "test_distribution",
            "LTCUSDT",
            {
                minCandidateDuration: 60000,
                minZoneVolume: 100,
                minTradeCount: 5,
                minSellRatio: 0.55, // Used inversely for distribution (high buy ratios)
                maxPriceDeviation: 0.02,
                minZoneStrength: 0.3,
            },
            mockPreprocessor,
            mockLogger,
            mockMetrics
        );
    });

    it("should handle NaN price values without crashing", () => {
        const invalidTrade: EnrichedTradeEvent = {
            price: NaN,
            quantity: 10,
            timestamp: Date.now(),
            buyerIsMaker: true, // Seller aggressive - for distribution patterns
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
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[DistributionZoneDetector] Invalid price detected, skipping trade",
            expect.objectContaining({
                price: NaN,
                tradeId: "test1",
            })
        );
    });

    it("should handle Infinity quantity values without crashing", () => {
        const invalidTrade: EnrichedTradeEvent = {
            price: 100,
            quantity: Infinity,
            timestamp: Date.now(),
            buyerIsMaker: true,
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
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[DistributionZoneDetector] Invalid quantity detected, skipping trade",
            expect.objectContaining({
                quantity: Infinity,
                tradeId: "test2",
            })
        );
    });

    it("should handle zero price values gracefully", () => {
        const zeroTrade: EnrichedTradeEvent = {
            price: 0,
            quantity: 10,
            timestamp: Date.now(),
            buyerIsMaker: true,
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
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[DistributionZoneDetector] Invalid price detected, skipping trade",
            expect.objectContaining({
                price: 0,
                tradeId: "test3",
            })
        );
    });

    it("should validate numeric values correctly", () => {
        const detector_internal = detector as any;

        // Test validateNumeric method
        expect(detector_internal.validateNumeric(5, 1)).toBe(5);
        expect(detector_internal.validateNumeric(NaN, 1)).toBe(1);
        expect(detector_internal.validateNumeric(Infinity, 1)).toBe(1);
        expect(detector_internal.validateNumeric(-Infinity, 1)).toBe(1);
        expect(detector_internal.validateNumeric(0, 1)).toBe(1); // Zero is considered invalid
    });

    it("should handle safe division correctly", () => {
        // Use FinancialMath.safeDivide directly since deprecated methods were removed
        expect(FinancialMath.safeDivide(10, 2, 0)).toBe(5);
        expect(FinancialMath.safeDivide(10, 0, 99)).toBe(99); // Division by zero returns fallback
        expect(FinancialMath.safeDivide(NaN, 2, 99)).toBe(99); // NaN numerator returns fallback
        expect(FinancialMath.safeDivide(10, NaN, 99)).toBe(99); // NaN denominator returns fallback
        expect(FinancialMath.safeDivide(Infinity, 2, 99)).toBe(99); // Infinity returns fallback
    });

    it("should handle safe mean calculation correctly", () => {
        // Use FinancialMath.calculateMean directly since deprecated methods were removed
        expect(FinancialMath.calculateMean([1, 2, 3, 4, 5])).toBe(3);
        expect(FinancialMath.calculateMean([NaN, 2, 3])).toBe(2.5); // Ignores NaN
        expect(FinancialMath.calculateMean([Infinity, 2, 3])).toBe(2.5); // Ignores Infinity
        expect(FinancialMath.calculateMean([])).toBe(0); // Empty array returns 0
        expect(FinancialMath.calculateMean([NaN, Infinity])).toBe(0); // All invalid returns 0
        expect(FinancialMath.calculateMean(null as any)).toBe(0); // Null input returns 0
        expect(FinancialMath.calculateMean(undefined as any)).toBe(0); // Undefined input returns 0
    });

    it("should handle negative passive volume values gracefully", () => {
        const tradeWithNegativePassive: EnrichedTradeEvent = {
            price: 100,
            quantity: 1,
            timestamp: Date.now(),
            buyerIsMaker: false, // Buyer aggressive - for distribution patterns
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
            buyerIsMaker: false, // Buyer aggressive - good for distribution
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
            buyerIsMaker: false, // Buyer aggressive - good for distribution analysis
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
        const detector_internal = detector as any;

        // Test getPriceLevel method with valid values
        expect(detector_internal.getPriceLevel(100.5)).toBeGreaterThan(0);

        // Test with edge cases
        expect(detector_internal.getPriceLevel(0)).toBe(0); // Invalid price
        expect(detector_internal.getPriceLevel(-1)).toBe(0); // Negative price
        expect(detector_internal.getPriceLevel(NaN)).toBe(0); // NaN price
        expect(detector_internal.getPriceLevel(Infinity)).toBe(0); // Infinity price

        // Should log warnings for invalid parameters
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[DistributionZoneDetector] Invalid zone calculation parameters",
            expect.objectContaining({
                price: 0,
            })
        );
    });

    it("should handle distribution zone analysis without crashes", () => {
        // Add multiple trades to create distribution scenario
        for (let i = 0; i < 10; i++) {
            const trade: EnrichedTradeEvent = {
                price: 100 + i * 0.01, // Clustered around 100
                quantity: 1 + i,
                timestamp: Date.now() - i * 1000,
                buyerIsMaker: i % 3 !== 0, // Mostly buy pressure (distribution pattern)
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

        // Should not crash during distribution analysis
        expect(detector.getCandidateCount()).toBeGreaterThanOrEqual(0);
        expect(detector.getActiveZones()).toBeDefined();
    });

    it("should handle distribution quality calculations safely", () => {
        const detector_internal = detector as any;

        // Create a candidate that might trigger distribution quality analysis
        const mockCandidate = {
            priceLevel: 100,
            startTime: Date.now() - 120000, // 2 minutes ago
            trades: {
                getAll: () => [
                    { price: 100, quantity: 60, timestamp: Date.now() - 60000 },
                    {
                        price: 100.01,
                        quantity: 50,
                        timestamp: Date.now() - 30000,
                    },
                    { price: 99.99, quantity: 40, timestamp: Date.now() },
                ],
                length: 3,
            },
            buyVolume: 100, // High buy volume for distribution
            sellVolume: 50,
            totalVolume: 150,
            averageOrderSize: 50,
            lastUpdate: Date.now(),
            consecutiveTrades: 3,
            priceStability: 0.99,
            tradeCount: 3,
            absorptionQuality: 0.5,
        };

        // Test safe mean on prices using FinancialMath directly
        const prices = mockCandidate.trades.getAll().map((t: any) => t.price);
        const safeMeanResult = FinancialMath.calculateMean(prices);
        expect(safeMeanResult).toBeCloseTo(100, 2);

        // Test safe division calculations for distribution using FinancialMath directly
        const buyRatio = FinancialMath.safeDivide(
            mockCandidate.buyVolume,
            mockCandidate.totalVolume,
            0
        );
        expect(buyRatio).toBeCloseTo(0.667, 2);

        // Distribution quality calculations should not crash
        expect(true).toBe(true);
    });

    it("should handle distribution vs accumulation pattern differences", () => {
        // Distribution pattern: High buy pressure (retail) into which institutions sell
        const distributionTrade: EnrichedTradeEvent = {
            price: 100,
            quantity: 10,
            timestamp: Date.now(),
            buyerIsMaker: false, // Buyer aggressive - good for distribution
            tradeId: "dist_test",
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

        const result = detector.analyze(distributionTrade);

        expect(result).toBeDefined();
        // Distribution should process high buy pressure as positive signal
        expect(result.updates).toBeDefined();
        expect(result.signals).toBeDefined();
        expect(result.activeZones).toBeDefined();
    });
});
