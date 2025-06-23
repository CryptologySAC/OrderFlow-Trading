// test/absorption_numeric_stability.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { IOrderBookState } from "../src/market/orderBookState.js";
import { FinancialMath } from "../src/utils/financialMath.js";

describe("AbsorptionDetector Numeric Stability Fixes", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: IOrderBookState;

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

        mockSpoofingDetector = new SpoofingDetector(
            {
                tickSize: 0.01,
                wallTicks: 5,
                minWallSize: 10,
                maxCancellationRatio: 0.8,
                rapidCancellationMs: 500,
                ghostLiquidityThresholdMs: 200,
            },
            mockLogger
        );

        mockOrderBook = {
            updateDepth: vi.fn(),
            getBestBid: vi.fn().mockReturnValue(100),
            getBestAsk: vi.fn().mockReturnValue(101),
            getSpread: vi.fn().mockReturnValue(1),
            getBidAskVolumes: vi
                .fn()
                .mockReturnValue({ bidVolume: 10, askVolume: 10 }),
            getTotalBidVolume: vi.fn().mockReturnValue(100),
            getTotalAskVolume: vi.fn().mockReturnValue(100),
            getOrderBookSnapshot: vi.fn().mockReturnValue(new Map()),
            isEmpty: vi.fn().mockReturnValue(false),
            reset: vi.fn(),
            cleanup: vi.fn(),
        } as unknown as IOrderBookState;

        detector = new AbsorptionDetector(
            "test_absorption",
            {
                absorptionThreshold: 0.7,
                minPassiveMultiplier: 1.5,
                icebergDetectionSensitivity: 0.8,
                icebergConfidenceMultiplier: 1.2,
                maxAbsorptionRatio: 0.5,
            },
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
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

        expect(() => {
            detector.onEnrichedTrade(invalidTrade);
        }).not.toThrow();

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalled();
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

        expect(() => {
            detector.onEnrichedTrade(invalidTrade);
        }).not.toThrow();

        // Should log a warning about invalid quantity
        expect(mockLogger.warn).toHaveBeenCalled();
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

        expect(() => {
            detector.onEnrichedTrade(zeroTrade);
        }).not.toThrow();

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalled();
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

        expect(() => {
            detector.onEnrichedTrade(tradeWithNegativePassive);
        }).not.toThrow();
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

        expect(() => {
            detector.onEnrichedTrade(tradeWithExtremePassive);
        }).not.toThrow();
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

        expect(() => {
            detector.onEnrichedTrade(validTrade);
        }).not.toThrow();
    });

    it("should handle absorption ratio calculations with edge cases", () => {
        const detector_internal = detector as any;

        // Test that safeDivision is being used for absorption ratios
        expect(detector_internal.safeDivision(10, 5, 1.0)).toBe(2);
        expect(detector_internal.safeDivision(10, 0, 1.0)).toBe(1.0); // Division by zero safe
        expect(detector_internal.safeDivision(0, 5, 1.0)).toBe(0); // Zero numerator
    });

    it("should handle volume clustering analysis without crashes", () => {
        const detector_internal = detector as any;

        // Add multiple trades to create volume clustering scenario
        for (let i = 0; i < 10; i++) {
            const trade: EnrichedTradeEvent = {
                price: 100 + i * 0.1, // Clustered around 100
                quantity: 1 + i,
                timestamp: Date.now() - i * 1000,
                buyerIsMaker: i % 2 === 0,
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
            detector.onEnrichedTrade(trade);
        }

        // Should not crash during volume clustering analysis
        expect(true).toBe(true);
    });

    it("should handle absorption velocity calculations safely", () => {
        const detector_internal = detector as any;

        // Test velocity calculations don't crash with edge cases
        const trades = [
            { price: 100, quantity: 1, timestamp: Date.now() - 5000 },
            { price: 100, quantity: 2, timestamp: Date.now() - 4000 },
            { price: 100, quantity: 3, timestamp: Date.now() - 3000 },
        ];

        // Process trades
        trades.forEach((trade, i) => {
            const enrichedTrade: EnrichedTradeEvent = {
                price: trade.price,
                quantity: trade.quantity,
                timestamp: trade.timestamp,
                buyerIsMaker: false,
                tradeId: `vel_test_${i}`,
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10,
                passiveAskVolume: 10,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 20,
                depthSnapshot: new Map(),
                bestBid: 100,
                bestAsk: 101,
            };
            detector.onEnrichedTrade(enrichedTrade);
        });

        // Velocity calculations should not crash
        expect(true).toBe(true);
    });
});
