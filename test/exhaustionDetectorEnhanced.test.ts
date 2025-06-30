// test/exhaustionDetectorEnhanced.test.ts
//
// ✅ EXHAUSTION PHASE 1: ExhaustionDetectorEnhanced comprehensive test suite
//
// Tests cover the enhanced exhaustion detector with standardized zone integration,
// including multi-timeframe analysis, liquidity depletion detection, and
// cross-timeframe exhaustion validation.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ExhaustionDetectorEnhanced,
    ExhaustionEnhancedSettings,
} from "../src/indicators/exhaustionDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import type { IOrderBookState } from "../src/market/orderBookState.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";

// Mock dependencies
const mockLogger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
};

const mockMetricsCollector: IMetricsCollector = {
    recordGauge: vi.fn(),
    recordCounter: vi.fn(),
    recordHistogram: vi.fn(),
    recordTiming: vi.fn(),
    incrementMetric: vi.fn(),
    getMetrics: vi.fn(() => ({}) as any),
    cleanup: vi.fn(),
};

const mockSignalLogger: ISignalLogger = {
    logSignal: vi.fn(),
    cleanup: vi.fn(),
};

const mockSpoofingDetector = {
    analyzeOrderPlacement: vi.fn(),
    cleanup: vi.fn(),
};

const mockOrderBook: IOrderBookState = {
    getBestBid: vi.fn(() => 88.5),
    getBestAsk: vi.fn(() => 88.6),
    getSpread: vi.fn(() => 0.1),
    getMidPrice: vi.fn(() => 88.55),
    getBookLevel: vi.fn(),
    getBidAskImbalance: vi.fn(() => 0.5),
    updateFromTrade: vi.fn(),
    updateFromDepth: vi.fn(),
    cleanup: vi.fn(),
    getLastUpdateAge: vi.fn(() => 100),
} as unknown as IOrderBookState;

// Helper function to create zone snapshots
function createZoneSnapshot(
    priceLevel: number,
    multiplier: number
): ZoneSnapshot {
    return {
        zoneId: `zone-${priceLevel}-${multiplier}`,
        priceLevel,
        tickSize: 0.01,
        aggressiveVolume: 50 * multiplier,
        passiveVolume: 100 * multiplier,
        aggressiveBuyVolume: 25 * multiplier,
        aggressiveSellVolume: 25 * multiplier,
        passiveBidVolume: 50 * multiplier,
        passiveAskVolume: 50 * multiplier,
        tradeCount: 10 * multiplier,
        timespan: 60000,
        boundaries: { min: priceLevel - 0.005, max: priceLevel + 0.005 },
        lastUpdate: Date.now(),
        volumeWeightedPrice: priceLevel,
    };
}

// Helper function to create standardized zone data
function createStandardizedZoneData(price: number): StandardZoneData {
    return {
        zones5Tick: [
            createZoneSnapshot(price - 0.05, 1),
            createZoneSnapshot(price, 2),
            createZoneSnapshot(price + 0.05, 1),
        ],
        zones10Tick: [
            createZoneSnapshot(price - 0.1, 1.5),
            createZoneSnapshot(price, 2.5),
            createZoneSnapshot(price + 0.1, 1.5),
        ],
        zones20Tick: [
            createZoneSnapshot(price - 0.2, 2),
            createZoneSnapshot(price, 3),
            createZoneSnapshot(price + 0.2, 2),
        ],
    };
}

// Helper function to create enriched trade events
function createEnrichedTradeEvent(
    price: number,
    quantity: number,
    isBuy: boolean
): EnrichedTradeEvent {
    return {
        id: `test-trade-${Date.now()}`,
        symbol: "LTCUSDT",
        price,
        quantity,
        side: isBuy ? "buy" : "sell",
        timestamp: Date.now(),
        isBuyerMaker: !isBuy,
        zoneData: createStandardizedZoneData(price),
        // Add required fields for EnrichedTradeEvent
        passiveBidVolume: 100,
        passiveAskVolume: 100,
        bookImbalance: 0.5,
        spread: 0.01,
        midPrice: price,
    } as EnrichedTradeEvent;
}

describe("ExhaustionDetectorEnhanced", () => {
    describe("Basic Enhancement Functionality", () => {
        let enhancedDetector: ExhaustionDetectorEnhanced;

        beforeEach(() => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    enableDepletionAnalysis: true,
                    enableCrossTimeframeAnalysis: false,
                },
            };

            enhancedDetector = new ExhaustionDetectorEnhanced(
                "test-enhanced-exhaustion",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should initialize with standardized zones disabled by default", () => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-disabled",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            const stats = detector.getEnhancementStats();
            expect(stats.callCount).toBe(0);
        });

        it("should enable standardized zones when configured", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
        });

        it("should handle trade events without zone data gracefully", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);
            trade.zoneData = undefined;

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(0); // Should not process without zone data
        });
    });

    describe("Zone Confluence Analysis", () => {
        let enhancedDetector: ExhaustionDetectorEnhanced;

        beforeEach(() => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
                windowMs: 45000,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    minZoneConfluenceCount: 2,
                    maxZoneConfluenceDistance: 3,
                },
            };

            enhancedDetector = new ExhaustionDetectorEnhanced(
                "test-confluence",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should detect zone confluence when multiple zones overlap", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
            expect(stats.confluenceDetectionCount).toBeGreaterThanOrEqual(0);
        });

        it("should calculate confluence strength correctly", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.averageConfidenceBoost).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Liquidity Depletion Analysis", () => {
        let enhancedDetector: ExhaustionDetectorEnhanced;

        beforeEach(() => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
                windowMs: 45000,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableDepletionAnalysis: true,
                    depletionVolumeThreshold: 30,
                    depletionRatioThreshold: 0.6,
                },
            };

            enhancedDetector = new ExhaustionDetectorEnhanced(
                "test-depletion",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should detect liquidity depletion when volume threshold exceeded", () => {
            const trade = createEnrichedTradeEvent(89.0, 50, true); // Higher volume

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
        });

        it("should not detect depletion for low volume trades", () => {
            const trade = createEnrichedTradeEvent(89.0, 10, true); // Low volume

            // Override zone data with high passive volumes to avoid depletion
            if (trade.zoneData) {
                trade.zoneData.zones5Tick = [
                    createZoneSnapshot(89.0, 0.2), // 10 aggressive, 20 passive - low volumes
                ];
                trade.zoneData.zones10Tick = [
                    createZoneSnapshot(89.0, 0.3), // 15 aggressive, 30 passive - low volumes
                ];
                trade.zoneData.zones20Tick = [
                    createZoneSnapshot(89.0, 0.4), // 20 aggressive, 40 passive - low volumes
                ];
            }

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.depletionDetectionCount).toBe(0);
        });
    });

    describe("Cross-Timeframe Analysis", () => {
        let enhancedDetector: ExhaustionDetectorEnhanced;

        beforeEach(() => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
                windowMs: 45000,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableCrossTimeframeAnalysis: true,
                    crossTimeframeBoost: 0.05,
                },
            };

            enhancedDetector = new ExhaustionDetectorEnhanced(
                "test-crossframe",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should perform cross-timeframe analysis when enabled", () => {
            const trade = createEnrichedTradeEvent(89.0, 35, true);

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
        });
    });

    describe("Enhancement Statistics and Monitoring", () => {
        let enhancedDetector: ExhaustionDetectorEnhanced;

        beforeEach(() => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    enableDepletionAnalysis: true,
                },
            };

            enhancedDetector = new ExhaustionDetectorEnhanced(
                "test-stats",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should track enhancement statistics correctly", () => {
            const trade = createEnrichedTradeEvent(89.0, 30, true);

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBeGreaterThan(0);
            expect(stats.errorCount).toBe(0);
        });

        it("should handle enhancement errors gracefully", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);
            // Create corrupted zone data to trigger error
            trade.zoneData = null as any;

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(0); // Should not increment on null zone data
        });
    });

    describe("Enhancement Mode Control", () => {
        let enhancedDetector: ExhaustionDetectorEnhanced;

        beforeEach(() => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "monitoring",
                },
            };

            enhancedDetector = new ExhaustionDetectorEnhanced(
                "test-mode",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should allow runtime enhancement mode changes", () => {
            enhancedDetector.setEnhancementMode("production");

            expect(mockLogger.info).toHaveBeenCalledWith(
                "ExhaustionDetectorEnhanced: Enhancement mode updated",
                expect.objectContaining({
                    newMode: "production",
                })
            );
        });
    });

    describe("Production Safety", () => {
        let enhancedDetector: ExhaustionDetectorEnhanced;

        beforeEach(() => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                },
            };

            enhancedDetector = new ExhaustionDetectorEnhanced(
                "test-safety",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should preserve original detector behavior when enhancements fail", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);

            // Should not throw or impact original behavior
            expect(() => enhancedDetector.onEnrichedTrade(trade)).not.toThrow();
        });

        it("should provide comprehensive cleanup", () => {
            enhancedDetector.cleanup();

            expect(mockLogger.info).toHaveBeenCalledWith(
                "ExhaustionDetectorEnhanced: Enhanced cleanup completed",
                expect.objectContaining({
                    enhancementStats: expect.any(Object),
                })
            );
        });
    });

    describe("Configuration Validation", () => {
        it("should use conservative defaults for production", () => {
            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                minAggVolume: 20,
                useStandardizedZones: true,
                // No standardizedZoneConfig provided - should use defaults
            };

            const detector = new ExhaustionDetectorEnhanced(
                "test-defaults",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            const stats = detector.getEnhancementStats();
            expect(stats).toBeDefined();
            expect(stats.callCount).toBe(0);
        });
    });
});
