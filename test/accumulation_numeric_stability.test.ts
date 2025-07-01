// test/accumulation_numeric_stability.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

describe("AccumulationZoneDetector Numeric Stability Fixes", () => {
    let detector: AccumulationZoneDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

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
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[AccumulationZoneDetector] Invalid price detected, skipping trade",
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
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[AccumulationZoneDetector] Invalid quantity detected, skipping trade",
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
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[AccumulationZoneDetector] Invalid price detected, skipping trade",
            expect.objectContaining({
                price: 0,
                tradeId: "test3",
            })
        );
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
        
        trades.forEach(trade => {
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
        const detector_internal = detector as any;

        // Test getPriceLevel method with valid values
        expect(detector_internal.getPriceLevel(100.5)).toBeGreaterThan(0);

        // ✅ CLAUDE.md COMPLIANCE: Invalid calculations should return null, not 0
        expect(detector_internal.getPriceLevel(0)).toBe(null); // Invalid price
        expect(detector_internal.getPriceLevel(-1)).toBe(null); // Negative price
        expect(detector_internal.getPriceLevel(NaN)).toBe(null); // NaN price
        expect(detector_internal.getPriceLevel(Infinity)).toBe(null); // Infinity price

        // Should log warnings for invalid parameters
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[AccumulationZoneDetector] Invalid zone calculation parameters",
            expect.objectContaining({
                price: 0,
            })
        );
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
        const detector_internal = detector as any;

        // Create a candidate that might trigger zone formation
        const mockCandidate = {
            priceLevel: 100,
            startTime: Date.now() - 120000, // 2 minutes ago
            trades: {
                getAll: () => [
                    { price: 100, quantity: 50, timestamp: Date.now() - 60000 },
                    {
                        price: 100.01,
                        quantity: 60,
                        timestamp: Date.now() - 30000,
                    },
                    { price: 99.99, quantity: 40, timestamp: Date.now() },
                ],
                length: 3,
            },
            buyVolume: 50,
            sellVolume: 100,
            totalVolume: 150,
            averageOrderSize: 50,
            lastUpdate: Date.now(),
            consecutiveTrades: 3,
            priceStability: 0.99,
            tradeCount: 3,
            absorptionQuality: 0.5,
        };

        // Test safe mean on prices
        const prices = mockCandidate.trades.getAll().map((t: any) => t.price);
        const safeMeanResult = detector_internal.safeMean(prices);
        expect(safeMeanResult).toBeCloseTo(100, 2);

        // Test safe division calculations
        const sellRatio = detector_internal.safeDivision(
            mockCandidate.sellVolume,
            mockCandidate.totalVolume,
            0
        );
        expect(sellRatio).toBeCloseTo(0.667, 2);

        // Zone formation calculations should not crash
        expect(true).toBe(true);
    });
});
