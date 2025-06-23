// test/deltaCVD_numeric_stability.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeltaCVDConfirmation } from "../src/indicators/deltaCVDConfirmation.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

describe("DeltaCVD Numeric Stability Fixes", () => {
    let detector: DeltaCVDConfirmation;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;

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
            createCounter: vi
                .fn()
                .mockReturnValue({
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

        detector = new DeltaCVDConfirmation(
            "test_cvd",
            {
                minZ: 3,
                minTradesPerSec: 0.5,
                minVolPerSec: 1,
                usePassiveVolume: true,
                enableDepthAnalysis: false, // Simplified mode
                detectionMode: "momentum",
                baseConfidenceRequired: 0.3,
                finalConfidenceRequired: 0.5,
            },
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
            (detector as any).onEnrichedTradeSpecific(invalidTrade);
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
            (detector as any).onEnrichedTradeSpecific(invalidTrade);
        }).not.toThrow();
    });

    it("should handle zero division in passive volume calculation", () => {
        const tradWithZeroQuantity: EnrichedTradeEvent = {
            price: 100,
            quantity: 0,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test3",
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

        expect(() => {
            (detector as any).onEnrichedTradeSpecific(tradWithZeroQuantity);
        }).not.toThrow();
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
        const detector_internal = detector as any;

        // Test safeDivision method
        expect(detector_internal.safeDivision(10, 2, 0)).toBe(5);
        expect(detector_internal.safeDivision(10, 0, 99)).toBe(99); // Division by zero returns fallback
        expect(detector_internal.safeDivision(NaN, 2, 99)).toBe(99); // NaN numerator returns fallback
        expect(detector_internal.safeDivision(10, NaN, 99)).toBe(99); // NaN denominator returns fallback
        expect(detector_internal.safeDivision(Infinity, 2, 99)).toBe(99); // Infinity returns fallback
    });

    it("should handle extreme passive volume ratios gracefully", () => {
        const tradeWithExtremePassive: EnrichedTradeEvent = {
            price: 100,
            quantity: 1,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test4",
            pair: "LTCUSDT",
            originalTrade: {} as any,
            passiveBidVolume: 1000000, // Extreme passive volume
            passiveAskVolume: 0,
            zonePassiveBidVolume: 2000000,
            zonePassiveAskVolume: 0,
            depthSnapshot: new Map(),
            bestBid: 100,
            bestAsk: 101,
        };

        expect(() => {
            (detector as any).onEnrichedTradeSpecific(tradeWithExtremePassive);
        }).not.toThrow();
    });

    it("should handle configuration with simplified mode correctly", () => {
        const status = detector.getStatus();
        expect(status).toContain("Enhanced CVD Detector");

        // Verify that simplified mode is active (enableDepthAnalysis: false)
        const detailedState = detector.getDetailedState();
        expect(detailedState.configuration).toBeDefined();
    });

    it("should process valid trades correctly", () => {
        const validTrade: EnrichedTradeEvent = {
            price: 100.5,
            quantity: 10.25,
            timestamp: Date.now(),
            buyerIsMaker: false,
            tradeId: "test5",
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
            (detector as any).onEnrichedTradeSpecific(validTrade);
        }).not.toThrow();
    });
});
