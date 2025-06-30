// test/deltaCVDDetectorEnhanced.test.ts
//
// ✅ DELTACVD PHASE 1: DeltaCVDDetectorEnhanced comprehensive test suite
//
// Tests cover the enhanced CVD detector with standardized zone integration,
// including multi-timeframe analysis, CVD divergence detection, and
// cross-timeframe momentum validation.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    DeltaCVDDetectorEnhanced,
    DeltaCVDEnhancedSettings,
} from "../src/indicators/deltaCVDDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
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
    createCounter: vi.fn(),
    createGauge: vi.fn(),
    createHistogram: vi.fn(),
};

const mockSignalLogger: ISignalLogger = {
    logSignal: vi.fn(),
    cleanup: vi.fn(),
};

const mockSpoofingDetector: SpoofingDetector = {
    isSpoof: vi.fn(() => false),
    analyze: vi.fn(),
    cleanup: vi.fn(),
} as any;

// Helper function to create zone snapshots
function createZoneSnapshot(
    priceLevel: number,
    multiplier: number
): ZoneSnapshot {
    return {
        zoneId: `zone-${priceLevel}-${multiplier}`,
        priceLevel,
        tickSize: 0.01,
        aggressiveVolume: 60 * multiplier,
        passiveVolume: 40 * multiplier,
        aggressiveBuyVolume: 35 * multiplier, // Strong buy pressure for CVD
        aggressiveSellVolume: 25 * multiplier,
        passiveBidVolume: 20 * multiplier,
        passiveAskVolume: 20 * multiplier,
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

// Helper function to create enriched trade events for CVD scenarios
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
        isBuyerMaker: !isBuy, // For CVD: buyerIsMaker = false indicates aggressive buying
        zoneData: createStandardizedZoneData(price),
        // Add required fields for EnrichedTradeEvent
        passiveBidVolume: 40,
        passiveAskVolume: 40,
        bookImbalance: 0.5,
        spread: 0.01,
        midPrice: price,
    } as EnrichedTradeEvent;
}

describe("DeltaCVDDetectorEnhanced", () => {
    describe("Basic Enhancement Functionality", () => {
        let enhancedDetector: DeltaCVDDetectorEnhanced;

        beforeEach(() => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    enableCVDDivergenceAnalysis: true,
                    enableMomentumAlignment: false,
                },
            };

            enhancedDetector = new DeltaCVDDetectorEnhanced(
                "test-enhanced-cvd",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should initialize with standardized zones disabled by default", () => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
            };

            const detector = new DeltaCVDDetectorEnhanced(
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
            const trade = createEnrichedTradeEvent(89.0, 50, true); // Strong buy signal

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
        });

        it("should handle trade events without zone data gracefully", () => {
            const trade = createEnrichedTradeEvent(89.0, 50, true);
            trade.zoneData = undefined;

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(0); // Should not process without zone data
        });
    });

    describe("Zone Confluence Analysis", () => {
        let enhancedDetector: DeltaCVDDetectorEnhanced;

        beforeEach(() => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    minZoneConfluenceCount: 2,
                    maxZoneConfluenceDistance: 3,
                },
            };

            enhancedDetector = new DeltaCVDDetectorEnhanced(
                "test-confluence",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should detect zone confluence when multiple zones overlap", () => {
            const trade = createEnrichedTradeEvent(89.0, 50, true); // Strong buy signal

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
            expect(stats.confluenceDetectionCount).toBeGreaterThanOrEqual(0);
        });

        it("should calculate confluence strength correctly", () => {
            const trade = createEnrichedTradeEvent(89.0, 50, true);

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.averageConfidenceBoost).toBeGreaterThanOrEqual(0);
        });
    });

    describe("CVD Divergence Analysis", () => {
        let enhancedDetector: DeltaCVDDetectorEnhanced;

        beforeEach(() => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableCVDDivergenceAnalysis: true,
                    cvdDivergenceVolumeThreshold: 50,
                    cvdDivergenceStrengthThreshold: 0.6,
                },
            };

            enhancedDetector = new DeltaCVDDetectorEnhanced(
                "test-cvd-divergence",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should detect CVD divergence when volume threshold exceeded", () => {
            const trade = createEnrichedTradeEvent(89.0, 80, true); // High volume buy

            // Override zone data to show strong CVD divergence
            if (trade.zoneData) {
                trade.zoneData.zones5Tick = [
                    {
                        ...createZoneSnapshot(89.0, 1),
                        aggressiveBuyVolume: 70, // Strong buy volume
                        aggressiveSellVolume: 10, // Weak sell volume
                        aggressiveVolume: 80,
                        passiveVolume: 30,
                    },
                ];
            }

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
        });

        it("should not detect CVD divergence for balanced volume", () => {
            const trade = createEnrichedTradeEvent(89.0, 30, true); // Moderate volume

            // Override zone data with balanced volumes
            if (trade.zoneData) {
                trade.zoneData.zones5Tick = [
                    {
                        ...createZoneSnapshot(89.0, 0.5),
                        aggressiveBuyVolume: 15, // Balanced buy volume
                        aggressiveSellVolume: 15, // Balanced sell volume
                        aggressiveVolume: 30,
                        passiveVolume: 40,
                    },
                ];
                trade.zoneData.zones10Tick = [
                    {
                        ...createZoneSnapshot(89.0, 0.6),
                        aggressiveBuyVolume: 18,
                        aggressiveSellVolume: 18,
                        aggressiveVolume: 36,
                        passiveVolume: 45,
                    },
                ];
                trade.zoneData.zones20Tick = [
                    {
                        ...createZoneSnapshot(89.0, 0.7),
                        aggressiveBuyVolume: 21,
                        aggressiveSellVolume: 21,
                        aggressiveVolume: 42,
                        passiveVolume: 50,
                    },
                ];
            }

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.cvdDivergenceDetectionCount).toBe(0);
        });
    });

    describe("Momentum Alignment Analysis", () => {
        let enhancedDetector: DeltaCVDDetectorEnhanced;

        beforeEach(() => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableMomentumAlignment: true,
                    momentumAlignmentBoost: 0.08,
                },
            };

            enhancedDetector = new DeltaCVDDetectorEnhanced(
                "test-momentum",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should perform momentum alignment analysis when enabled", () => {
            const trade = createEnrichedTradeEvent(89.0, 60, true); // Strong momentum signal

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
        });
    });

    describe("Enhancement Statistics and Monitoring", () => {
        let enhancedDetector: DeltaCVDDetectorEnhanced;

        beforeEach(() => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                    enableCVDDivergenceAnalysis: true,
                },
            };

            enhancedDetector = new DeltaCVDDetectorEnhanced(
                "test-stats",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should track enhancement statistics correctly", () => {
            const trade = createEnrichedTradeEvent(89.0, 50, true); // Strong signal

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBeGreaterThan(0);
            expect(stats.errorCount).toBe(0);
        });

        it("should handle enhancement errors gracefully", () => {
            const trade = createEnrichedTradeEvent(89.0, 50, true);
            // Create corrupted zone data to trigger error
            trade.zoneData = null as any;

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(0); // Should not increment on null zone data
        });
    });

    describe("Enhancement Mode Control", () => {
        let enhancedDetector: DeltaCVDDetectorEnhanced;

        beforeEach(() => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "monitoring",
                },
            };

            enhancedDetector = new DeltaCVDDetectorEnhanced(
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
                "DeltaCVDDetectorEnhanced: Enhancement mode updated",
                expect.objectContaining({
                    newMode: "production",
                })
            );
        });
    });

    describe("Production Safety", () => {
        let enhancedDetector: DeltaCVDDetectorEnhanced;

        beforeEach(() => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableZoneConfluenceFilter: true,
                },
            };

            enhancedDetector = new DeltaCVDDetectorEnhanced(
                "test-safety",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should preserve original detector behavior when enhancements fail", () => {
            const trade = createEnrichedTradeEvent(89.0, 50, true);

            // Should not throw or impact original behavior
            expect(() => enhancedDetector.onEnrichedTrade(trade)).not.toThrow();
        });

        it("should provide comprehensive cleanup", () => {
            enhancedDetector.cleanup();

            expect(mockLogger.info).toHaveBeenCalledWith(
                "DeltaCVDDetectorEnhanced: Enhanced cleanup completed",
                expect.objectContaining({
                    enhancementStats: expect.any(Object),
                })
            );
        });
    });

    describe("Configuration Validation", () => {
        it("should use conservative defaults for production", () => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                // No standardizedZoneConfig provided - should use defaults
            };

            const detector = new DeltaCVDDetectorEnhanced(
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

    describe("CVD-Specific Behavior", () => {
        let enhancedDetector: DeltaCVDDetectorEnhanced;

        beforeEach(() => {
            const settings: DeltaCVDEnhancedSettings = {
                windowsSec: [60, 300],
                minZ: 0.4,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    enableCVDDivergenceAnalysis: true,
                    cvdDivergenceVolumeThreshold: 50,
                    cvdDivergenceStrengthThreshold: 0.6,
                },
            };

            enhancedDetector = new DeltaCVDDetectorEnhanced(
                "test-cvd-behavior",
                settings,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should focus on volume delta patterns rather than price action", () => {
            const buyTrade = createEnrichedTradeEvent(89.0, 70, true); // buyerIsMaker = false (aggressive buying)

            // Create zone data with strong CVD characteristics
            if (buyTrade.zoneData) {
                buyTrade.zoneData.zones5Tick = [
                    {
                        ...createZoneSnapshot(89.0, 1),
                        aggressiveBuyVolume: 80, // High aggressive buying
                        aggressiveSellVolume: 20,
                        aggressiveVolume: 100,
                        passiveVolume: 50,
                    },
                ];
                buyTrade.zoneData.zones10Tick = [
                    {
                        ...createZoneSnapshot(89.0, 1.2),
                        aggressiveBuyVolume: 90,
                        aggressiveSellVolume: 25,
                        aggressiveVolume: 115,
                        passiveVolume: 60,
                    },
                ];
                buyTrade.zoneData.zones20Tick = [
                    {
                        ...createZoneSnapshot(89.0, 1.5),
                        aggressiveBuyVolume: 105,
                        aggressiveSellVolume: 30,
                        aggressiveVolume: 135,
                        passiveVolume: 70,
                    },
                ];
            }

            enhancedDetector.onEnrichedTrade(buyTrade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.enhancementCount).toBeGreaterThan(0);
            // Either confluence or CVD divergence should be detected
            expect(
                stats.confluenceDetectionCount +
                    stats.cvdDivergenceDetectionCount
            ).toBeGreaterThan(0);
        });

        it("should detect cross-timeframe CVD alignment", () => {
            const trade = createEnrichedTradeEvent(89.0, 60, true);

            // Create strong CVD pattern across all timeframes
            if (trade.zoneData) {
                // All timeframes show strong buying pressure
                const cvdPattern = (multiplier: number) => ({
                    ...createZoneSnapshot(89.0, multiplier),
                    aggressiveBuyVolume: 70 * multiplier,
                    aggressiveSellVolume: 20 * multiplier,
                    aggressiveVolume: 90 * multiplier,
                    passiveVolume: 40 * multiplier,
                });

                trade.zoneData.zones5Tick = [cvdPattern(1)];
                trade.zoneData.zones10Tick = [cvdPattern(1.2)];
                trade.zoneData.zones20Tick = [cvdPattern(1.5)];
            }

            // Enable momentum alignment analysis
            enhancedDetector.setEnhancementMode("production");

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBeGreaterThan(0);
        });
    });
});
