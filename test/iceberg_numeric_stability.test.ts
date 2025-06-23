// test/iceberg_numeric_stability.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { IcebergDetector } from "../src/services/icebergDetector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import type {
    IcebergDetectorConfig,
    IcebergEvent,
} from "../src/services/icebergDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

describe("IcebergDetector Numeric Stability Fixes", () => {
    let detector: IcebergDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSignalLogger: ISignalLogger;
    let config: Partial<IcebergDetectorConfig>;

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

        mockSignalLogger = {
            logSignal: vi.fn(),
            logSignalConfirmation: vi.fn(),
            logSignalRejection: vi.fn(),
            getSignalHistory: vi.fn().mockReturnValue([]),
            cleanup: vi.fn(),
        };

        config = {
            minRefillCount: 3,
            maxSizeVariation: 0.2,
            minTotalSize: 50,
            maxRefillTimeMs: 30000,
            priceStabilityTolerance: 0.005,
            institutionalSizeThreshold: 10,
            trackingWindowMs: 300000,
            maxActiveIcebergs: 20,
        };

        detector = new IcebergDetector(
            "test_iceberg",
            config,
            mockLogger,
            mockMetrics,
            mockSignalLogger
        );
    });

    it("should handle NaN price values without crashing in onEnrichedTrade", () => {
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

        detector.onEnrichedTrade(invalidTrade);

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[IcebergDetector] Invalid price detected, skipping trade",
            expect.objectContaining({
                price: NaN,
                tradeId: "test1",
            })
        );
    });

    it("should handle Infinity quantity values without crashing in onEnrichedTrade", () => {
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

        detector.onEnrichedTrade(invalidTrade);

        // Should log a warning about invalid quantity
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[IcebergDetector] Invalid quantity detected, skipping trade",
            expect.objectContaining({
                quantity: Infinity,
                tradeId: "test2",
            })
        );
    });

    it("should handle zero price values gracefully in onEnrichedTrade", () => {
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

        detector.onEnrichedTrade(zeroTrade);

        // Should log a warning about invalid price
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "[IcebergDetector] Invalid price detected, skipping trade",
            expect.objectContaining({
                price: 0,
                tradeId: "test3",
            })
        );
    });

    it("should validate numeric helper methods correctly", () => {
        const detector_internal = detector as any;

        // Test validateNumeric method
        expect(detector_internal.validateNumeric(5, 1)).toBe(5);
        expect(detector_internal.validateNumeric(NaN, 1)).toBe(1);
        expect(detector_internal.validateNumeric(Infinity, 1)).toBe(1);
        expect(detector_internal.validateNumeric(-Infinity, 1)).toBe(1);
        expect(detector_internal.validateNumeric(0, 1)).toBe(1); // Zero is considered invalid
    });

    it("should handle safe division correctly", () => {
        const detector_internal = detector as any;

        // Test safeDivision method
        expect(detector_internal.safeDivision(10, 2, 0)).toBe(5);
        expect(detector_internal.safeDivision(10, 0, 99)).toBe(99); // Division by zero returns fallback
        expect(detector_internal.safeDivision(NaN, 2, 99)).toBe(99); // NaN numerator returns fallback
        expect(detector_internal.safeDivision(10, NaN, 99)).toBe(99); // NaN denominator returns fallback
        expect(detector_internal.safeDivision(Infinity, 2, 99)).toBe(99); // Infinity returns fallback
    });

    it("should handle safe ratio calculations correctly", () => {
        const detector_internal = detector as any;

        // Test safeRatio method
        expect(detector_internal.safeRatio(50, 100, 0)).toBe(0.5);
        expect(detector_internal.safeRatio(80, 100, 0)).toBe(0.8);
        expect(detector_internal.safeRatio(10, 0, 99)).toBe(99); // Division by zero returns fallback
        expect(detector_internal.safeRatio(-10, 100, 99)).toBe(99); // Negative numerator returns fallback
        expect(detector_internal.safeRatio(NaN, 100, 99)).toBe(99); // NaN numerator returns fallback
        expect(detector_internal.safeRatio(50, NaN, 99)).toBe(99); // NaN denominator returns fallback
    });

    it("should handle safe mean calculation correctly", () => {
        const detector_internal = detector as any;

        // Test safeMean method
        expect(detector_internal.safeMean([1, 2, 3, 4, 5])).toBe(3);
        expect(detector_internal.safeMean([NaN, 2, 3])).toBe(2.5); // Ignores NaN
        expect(detector_internal.safeMean([Infinity, 2, 3])).toBe(2.5); // Ignores Infinity
        expect(detector_internal.safeMean([])).toBe(0); // Empty array returns 0
        expect(detector_internal.safeMean([NaN, Infinity])).toBe(0); // All invalid returns 0
        expect(detector_internal.safeMean(null as any)).toBe(0); // Null input returns 0
        expect(detector_internal.safeMean(undefined as any)).toBe(0); // Undefined input returns 0
    });

    it("should handle price level activity with zero trade count gracefully", () => {
        const detector_internal = detector as any;

        // Create a scenario where trade count could be zero
        detector_internal.priceLevelActivity.set(100, {
            lastTradeTime: Date.now(),
            executedVolume: 50,
            tradeCount: 0,
            averageSize: 0,
        });

        // Update price level activity - should not crash with division by zero
        detector_internal.updatePriceLevelActivity(100, 10, Date.now());

        const activity = detector_internal.priceLevelActivity.get(100);
        expect(activity).toBeDefined();
        expect(activity.tradeCount).toBe(1);
        expect(activity.averageSize).toBe(60); // (50 + 10) / 1
    });

    it("should handle iceberg pattern analysis with zero average size", () => {
        const detector_internal = detector as any;

        // Set up price level activity with zero average size
        detector_internal.priceLevelActivity.set(100, {
            lastTradeTime: Date.now() - 1000,
            executedVolume: 0,
            tradeCount: 0,
            averageSize: 0,
        });

        const validTrade: EnrichedTradeEvent = {
            price: 100,
            quantity: 15,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test_valid",
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

        // Should not crash when checking if could be iceberg start
        const result = detector_internal.couldBeIcebergStart(validTrade, 100);
        expect(typeof result).toBe("boolean");
    });

    it("should handle size variation calculation with edge cases", () => {
        const detector_internal = detector as any;

        // Test with empty array
        expect(detector_internal.calculateSizeVariation([], 0)).toBe(0);

        // Test with single element
        expect(detector_internal.calculateSizeVariation([10], 10)).toBe(0);

        // Test with zero average size
        expect(detector_internal.calculateSizeVariation([1, 2, 3], 0)).toBe(1);

        // Test with normal values
        const result = detector_internal.calculateSizeVariation(
            [10, 12, 8],
            10
        );
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThan(1);
    });

    it("should handle temporal score calculation with empty gaps", () => {
        const detector_internal = detector as any;

        // Test with empty gaps array
        expect(detector_internal.calculateTemporalScore([])).toBe(1);

        // Test with normal gaps
        const gaps = [1000, 2000, 1500];
        const result = detector_internal.calculateTemporalScore(gaps);
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThanOrEqual(1);
    });

    it("should handle statistics calculation with no completed icebergs", () => {
        const stats = detector.getStatistics();

        expect(stats).toBeDefined();
        expect(stats.activeCandidates).toBe(0);
        expect(stats.completedIcebergs).toBe(0);
        expect(stats.avgConfidence).toBe(0);
        expect(stats.avgInstitutionalScore).toBe(0);
        expect(stats.totalVolumeDetected).toBe(0);
    });

    it("should process valid iceberg pattern without numeric errors", () => {
        const now = Date.now();

        // Create a series of trades that could form an iceberg pattern
        for (let i = 0; i < 5; i++) {
            const trade: EnrichedTradeEvent = {
                price: 100,
                quantity: 15, // Consistent piece size
                timestamp: now + i * 5000, // 5 second intervals
                buyerIsMaker: false,
                tradeId: `iceberg_${i}`,
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

            detector.onEnrichedTrade(trade);
        }

        // Should not crash and should handle all calculations safely
        const stats = detector.getStatistics();
        expect(stats).toBeDefined();
        expect(stats.activeCandidates).toBeGreaterThanOrEqual(0);

        // Should not have logged any warnings for valid trades
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining("Invalid"),
            expect.anything()
        );
    });

    it("should handle extreme trading volumes gracefully", () => {
        const trade: EnrichedTradeEvent = {
            price: 100,
            quantity: 1000000, // Very large quantity
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "large_trade",
            pair: "LTCUSDT",
            originalTrade: {} as any,
            passiveBidVolume: 500000,
            passiveAskVolume: 500000,
            zonePassiveBidVolume: 1000000,
            zonePassiveAskVolume: 1000000,
            depthSnapshot: new Map(),
            bestBid: 100,
            bestAsk: 101,
        };

        // Should handle large numbers without overflow or precision issues
        expect(() => detector.onEnrichedTrade(trade)).not.toThrow();

        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining("Invalid"),
            expect.anything()
        );
    });

    it("should handle mixed valid and invalid trades gracefully", () => {
        // Mix of valid and invalid trades
        const trades = [
            {
                price: 100.1,
                quantity: 15.5,
                timestamp: Date.now(),
                buyerIsMaker: false,
                tradeId: "valid_1",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10,
                passiveAskVolume: 10,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 20,
                depthSnapshot: new Map(),
                bestBid: 100,
                bestAsk: 101,
            },
            {
                price: NaN, // Invalid
                quantity: 20,
                timestamp: Date.now() + 1000,
                buyerIsMaker: false,
                tradeId: "invalid_1",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10,
                passiveAskVolume: 10,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 20,
                depthSnapshot: new Map(),
                bestBid: 100,
                bestAsk: 101,
            },
            {
                price: 100.2,
                quantity: Infinity, // Invalid
                timestamp: Date.now() + 2000,
                buyerIsMaker: false,
                tradeId: "invalid_2",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10,
                passiveAskVolume: 10,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 20,
                depthSnapshot: new Map(),
                bestBid: 100,
                bestAsk: 101,
            },
            {
                price: 100.3,
                quantity: 25.7,
                timestamp: Date.now() + 3000,
                buyerIsMaker: false,
                tradeId: "valid_2",
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10,
                passiveAskVolume: 10,
                zonePassiveBidVolume: 20,
                zonePassiveAskVolume: 20,
                depthSnapshot: new Map(),
                bestBid: 100,
                bestAsk: 101,
            },
        ];

        trades.forEach((trade) => detector.onEnrichedTrade(trade));

        // Should have warned about invalid entries but continued processing valid ones
        expect(mockLogger.warn).toHaveBeenCalledTimes(2);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining("Invalid price"),
            expect.anything()
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining("Invalid quantity"),
            expect.anything()
        );
    });

    it("should handle time gap calculations with edge cases", () => {
        const detector_internal = detector as any;

        // Test with empty pieces array
        expect(detector_internal.calculateTimeGaps([])).toEqual([]);

        // Test with single piece
        expect(
            detector_internal.calculateTimeGaps([{ timestamp: 1000 }])
        ).toEqual([]);

        // Test with normal pieces
        const pieces = [
            { timestamp: 1000 },
            { timestamp: 2000 },
            { timestamp: 3000 },
        ];
        const gaps = detector_internal.calculateTimeGaps(pieces);
        expect(gaps).toEqual([1000, 1000]);
    });

    it("should handle status reporting without errors", () => {
        const status = detector.getStatus();
        expect(typeof status).toBe("string");
        expect(status).toContain("Active:");
        expect(status).toContain("candidates");
        expect(status).toContain("completed");
    });
});
