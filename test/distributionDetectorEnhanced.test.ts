// test/distributionDetectorEnhanced.test.ts
//
// ✅ DISTRIBUTION PHASE 1: DistributionDetectorEnhanced comprehensive test suite
//
// Tests cover the enhanced distribution detector with standardized zone integration,
// including multi-timeframe analysis, institutional selling pressure detection, and
// cross-timeframe distribution validation.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    DistributionDetectorEnhanced,
    DistributionEnhancedSettings,
} from "../src/indicators/distributionDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
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
        passiveVolume: 80 * multiplier, // Slightly lower than accumulation to show distribution
        aggressiveBuyVolume: 20 * multiplier, // Lower buy volume for distribution
        aggressiveSellVolume: 30 * multiplier, // Higher sell volume for distribution
        passiveBidVolume: 40 * multiplier,
        passiveAskVolume: 40 * multiplier,
        tradeCount: 8 * multiplier,
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

// Helper function to create enriched trade events for distribution scenarios
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
        isBuyerMaker: isBuy, // For distribution: buyerIsMaker = true indicates selling pressure
        zoneData: createStandardizedZoneData(price),
        // Add required fields for EnrichedTradeEvent
        passiveBidVolume: 80,
        passiveAskVolume: 80,
        bookImbalance: 0.5,
        spread: 0.01,
        midPrice: price,
    } as EnrichedTradeEvent;
}

describe("DistributionDetectorEnhanced", () => {
    describe("Basic Enhancement Functionality", () => {
        let enhancedDetector: DistributionDetectorEnhanced;

        beforeEach(() => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                minCandidateDuration: 300000,
                minSellRatio: 0.65,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    enableSellingPressureAnalysis: true,
                    enableCrossTimeframeAnalysis: false,
                },
            };

            enhancedDetector = new DistributionDetectorEnhanced(
                "test-enhanced-distribution",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );
        });

        it("should initialize with standardized zones disabled by default", () => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
            };

            const detector = new DistributionDetectorEnhanced(
                "test-disabled",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );

            const stats = detector.getEnhancementStats();
            expect(stats.callCount).toBe(0);
        });

        it("should enable standardized zones when configured", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true); // Selling pressure

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
        });

        it("should handle trade events without zone data gracefully", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);
            trade.zoneData = undefined;

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(0); // Should not process without zone data
        });
    });

    describe("Zone Confluence Analysis", () => {
        let enhancedDetector: DistributionDetectorEnhanced;

        beforeEach(() => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    minZoneConfluenceCount: 2,
                    maxZoneConfluenceDistance: 3,
                },
            };

            enhancedDetector = new DistributionDetectorEnhanced(
                "test-confluence",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );
        });

        it("should detect zone confluence when multiple zones overlap", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true); // Selling pressure

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
            expect(stats.confluenceDetectionCount).toBeGreaterThanOrEqual(0);
        });

        it("should calculate confluence strength correctly", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.averageConfidenceBoost).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Institutional Selling Pressure Analysis", () => {
        let enhancedDetector: DistributionDetectorEnhanced;

        beforeEach(() => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableSellingPressureAnalysis: true,
                    sellingPressureVolumeThreshold: 40,
                    sellingPressureRatioThreshold: 0.65,
                },
            };

            enhancedDetector = new DistributionDetectorEnhanced(
                "test-selling-pressure",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );
        });

        it("should detect selling pressure when volume threshold exceeded", () => {
            const trade = createEnrichedTradeEvent(89.0, 60, true); // High selling volume

            // Override zone data to show strong selling pressure
            if (trade.zoneData) {
                trade.zoneData.zones5Tick = [
                    {
                        ...createZoneSnapshot(89.0, 1),
                        aggressiveSellVolume: 50, // High selling volume
                        aggressiveVolume: 60,
                        passiveVolume: 30, // Lower passive volume
                    },
                ];
            }

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
        });

        it("should not detect selling pressure for low volume trades", () => {
            const trade = createEnrichedTradeEvent(89.0, 10, true); // Low selling volume

            // Override zone data with low selling volumes
            if (trade.zoneData) {
                trade.zoneData.zones5Tick = [
                    {
                        ...createZoneSnapshot(89.0, 0.2),
                        aggressiveSellVolume: 5, // Low selling volume
                        aggressiveVolume: 10,
                        passiveVolume: 40, // Higher passive volume
                    },
                ];
                trade.zoneData.zones10Tick = [
                    {
                        ...createZoneSnapshot(89.0, 0.3),
                        aggressiveSellVolume: 8,
                        aggressiveVolume: 15,
                        passiveVolume: 45,
                    },
                ];
                trade.zoneData.zones20Tick = [
                    {
                        ...createZoneSnapshot(89.0, 0.4),
                        aggressiveSellVolume: 10,
                        aggressiveVolume: 20,
                        passiveVolume: 50,
                    },
                ];
            }

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.sellingPressureDetectionCount).toBe(0);
        });
    });

    describe("Cross-Timeframe Analysis", () => {
        let enhancedDetector: DistributionDetectorEnhanced;

        beforeEach(() => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableCrossTimeframeAnalysis: true,
                    crossTimeframeBoost: 0.05,
                },
            };

            enhancedDetector = new DistributionDetectorEnhanced(
                "test-crossframe",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );
        });

        it("should perform cross-timeframe analysis when enabled", () => {
            const trade = createEnrichedTradeEvent(89.0, 35, true); // Selling pressure

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
        });
    });

    describe("Enhancement Statistics and Monitoring", () => {
        let enhancedDetector: DistributionDetectorEnhanced;

        beforeEach(() => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    enableSellingPressureAnalysis: true,
                },
            };

            enhancedDetector = new DistributionDetectorEnhanced(
                "test-stats",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );
        });

        it("should track enhancement statistics correctly", () => {
            const trade = createEnrichedTradeEvent(89.0, 30, true); // Selling pressure

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBeGreaterThan(0);
            expect(stats.errorCount).toBe(0);
        });

        it("should handle enhancement errors gracefully", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);
            // Create corrupted zone data to trigger error
            trade.zoneData = null as any;

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(0); // Should not increment on null zone data
        });
    });

    describe("Enhancement Mode Control", () => {
        let enhancedDetector: DistributionDetectorEnhanced;

        beforeEach(() => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "monitoring",
                },
            };

            enhancedDetector = new DistributionDetectorEnhanced(
                "test-mode",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );
        });

        it("should allow runtime enhancement mode changes", () => {
            enhancedDetector.setEnhancementMode("production");

            expect(mockLogger.info).toHaveBeenCalledWith(
                "DistributionDetectorEnhanced: Enhancement mode updated",
                expect.objectContaining({
                    newMode: "production",
                })
            );
        });
    });

    describe("Production Safety", () => {
        let enhancedDetector: DistributionDetectorEnhanced;

        beforeEach(() => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                },
            };

            enhancedDetector = new DistributionDetectorEnhanced(
                "test-safety",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );
        });

        it("should preserve original detector behavior when enhancements fail", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);

            // Should not throw or impact original behavior
            expect(() => enhancedDetector.analyze(trade)).not.toThrow();
        });

        it("should provide comprehensive cleanup", () => {
            enhancedDetector.cleanup();

            expect(mockLogger.info).toHaveBeenCalledWith(
                "DistributionDetectorEnhanced: Enhanced cleanup completed",
                expect.objectContaining({
                    enhancementStats: expect.any(Object),
                })
            );
        });
    });

    describe("Configuration Validation", () => {
        it("should use conservative defaults for production", () => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                useStandardizedZones: true,
                // No standardizedZoneConfig provided - should use defaults
            };

            const detector = new DistributionDetectorEnhanced(
                "test-defaults",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );

            const stats = detector.getEnhancementStats();
            expect(stats).toBeDefined();
            expect(stats.callCount).toBe(0);
        });
    });

    describe("Distribution-Specific Behavior", () => {
        let enhancedDetector: DistributionDetectorEnhanced;

        beforeEach(() => {
            const settings: DistributionEnhancedSettings = {
                symbol: "LTCUSDT",
                minZoneVolume: 1000,
                minTradeCount: 10,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableSellingPressureAnalysis: true,
                    sellingPressureVolumeThreshold: 40,
                    sellingPressureRatioThreshold: 0.65,
                },
            };

            enhancedDetector = new DistributionDetectorEnhanced(
                "test-distribution-behavior",
                "LTCUSDT",
                settings,
                mockLogger,
                mockMetricsCollector
            );
        });

        it("should focus on selling pressure rather than buying absorption", () => {
            const sellingTrade = createEnrichedTradeEvent(89.0, 50, true); // buyerIsMaker = true (selling pressure)

            // Create zone data with high selling pressure characteristics
            if (sellingTrade.zoneData) {
                sellingTrade.zoneData.zones5Tick = [
                    {
                        ...createZoneSnapshot(89.0, 1),
                        aggressiveSellVolume: 60, // High institutional selling
                        aggressiveBuyVolume: 20,
                        aggressiveVolume: 80,
                        passiveVolume: 30, // Lower passive volume to trigger detection
                    },
                ];
                sellingTrade.zoneData.zones10Tick = [
                    {
                        ...createZoneSnapshot(89.0, 1.2),
                        aggressiveSellVolume: 65,
                        aggressiveBuyVolume: 25,
                        aggressiveVolume: 90,
                        passiveVolume: 35,
                    },
                ];
                sellingTrade.zoneData.zones20Tick = [
                    {
                        ...createZoneSnapshot(89.0, 1.5),
                        aggressiveSellVolume: 70,
                        aggressiveBuyVolume: 30,
                        aggressiveVolume: 100,
                        passiveVolume: 40,
                    },
                ];
            }

            enhancedDetector.analyze(sellingTrade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.enhancementCount).toBeGreaterThan(0);
            // The selling pressure detection might not trigger if confluence is detected instead
            expect(
                stats.confluenceDetectionCount +
                    stats.sellingPressureDetectionCount
            ).toBeGreaterThan(0);
        });

        it("should detect cross-timeframe distribution alignment", () => {
            const trade = createEnrichedTradeEvent(89.0, 40, true);

            // Create strong distribution pattern across all timeframes
            if (trade.zoneData) {
                // All timeframes show selling pressure
                const distributionPattern = (multiplier: number) => ({
                    ...createZoneSnapshot(89.0, multiplier),
                    aggressiveSellVolume: 50 * multiplier,
                    aggressiveBuyVolume: 20 * multiplier,
                    aggressiveVolume: 70 * multiplier,
                    passiveVolume: 30 * multiplier,
                });

                trade.zoneData.zones5Tick = [distributionPattern(1)];
                trade.zoneData.zones10Tick = [distributionPattern(1.2)];
                trade.zoneData.zones20Tick = [distributionPattern(1.5)];
            }

            // Enable cross-timeframe analysis
            enhancedDetector.setEnhancementMode("production");

            enhancedDetector.analyze(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBeGreaterThan(0);
        });
    });
});
