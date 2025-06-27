// test/exhaustion_numeric_stability.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExhaustionDetector } from "../src/indicators/exhaustionDetector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { FinancialMath } from "../src/utils/financialMath.js";

describe("ExhaustionDetector Numeric Stability Fixes", () => {
    let detector: ExhaustionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;

    beforeEach(async () => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: () => false,
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        // Use proper mock from __mocks__/ directory per CLAUDE.md
        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

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

        detector = new ExhaustionDetector(
            "test_exhaustion",
            {
                exhaustionThreshold: 0.7,
                maxPassiveRatio: 0.3,
                minDepletionFactor: 0.5,
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

        // Test validateNumeric method - returns null for invalid values per CLAUDE.md
        expect(detector_internal.validateNumeric(5)).toBe(5);
        expect(detector_internal.validateNumeric(NaN)).toBe(null); // CORRECT: return null for invalid NaN
        expect(detector_internal.validateNumeric(Infinity)).toBe(null); // CORRECT: return null for invalid Infinity
        expect(detector_internal.validateNumeric(-Infinity)).toBe(null); // CORRECT: return null for invalid -Infinity
        expect(detector_internal.validateNumeric(0)).toBe(null); // CORRECT: return null for invalid zero
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

    it("should handle adaptive memory cleanup correctly", () => {
        const detector_internal = detector as any;

        // Test that cleanup doesn't crash with empty zones
        expect(() => {
            detector_internal.cleanupZoneMemory();
        }).not.toThrow();

        // Add some trades to create zones
        for (let i = 0; i < 10; i++) {
            const trade: EnrichedTradeEvent = {
                price: 100 + i,
                quantity: 1,
                timestamp: Date.now() - i * 1000,
                buyerIsMaker: false,
                tradeId: `test_${i}`,
                pair: "LTCUSDT",
                originalTrade: {} as any,
                passiveBidVolume: 10,
                passiveAskVolume: 10,
                zonePassiveBidVolume: 10,
                zonePassiveAskVolume: 10,
                depthSnapshot: new Map(),
                bestBid: 100,
                bestAsk: 101,
            };
            detector.onEnrichedTrade(trade);
        }

        // Test cleanup doesn't crash with populated zones
        expect(() => {
            detector_internal.cleanupZoneMemory();
        }).not.toThrow();
    });
});
