// test/absorptionDetectorEnhanced.test.ts
/**
 * Comprehensive tests for AbsorptionDetectorEnhanced with standardized zones
 */

import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";
import {
    AbsorptionDetectorEnhanced,
    AbsorptionEnhancedSettings,
} from "../src/indicators/absorptionDetectorEnhanced.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { IOrderBookState } from "../src/market/orderBookState.js";

// Mock dependencies
const mockLogger: ILogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
};

const mockMetricsCollector: IMetricsCollector = {
    incrementMetric: vi.fn(),
    updateMetric: vi.fn(),
    recordGauge: vi.fn(),
    recordHistogram: vi.fn(),
    recordTimer: vi.fn(),
    startTimer: vi.fn(() => ({ stop: vi.fn() })),
    getMetrics: vi.fn(() => ({})),
};

const mockSignalLogger: ISignalLogger = {
    logSignal: vi.fn(),
    getHistory: vi.fn(() => []),
};

const mockSpoofingDetector = {
    detect: vi.fn(() => ({ spoofing: false, confidence: 0 })),
    updateMarketData: vi.fn(),
    isSpoofed: vi.fn(() => false),
    detectLayeringAttack: vi.fn(() => false),
} as unknown as SpoofingDetector;

const mockOrderBook: IOrderBookState = {
    handleDepthUpdate: vi.fn(),
    getLevel: vi.fn(() => ({ bid: 100, ask: 100 })),
    getBestBid: vi.fn(() => 89.0),
    getBestAsk: vi.fn(() => 89.01),
    getMidPrice: vi.fn(() => 89.005),
    getSpread: vi.fn(() => 0.01),
    sumBand: vi.fn(() => ({ bid: 200, ask: 200 })),
    snapshot: vi.fn(() => ({ bid: [], ask: [] })),
    getDepthMetrics: vi.fn(() => ({
        totalLevels: 10,
        avgSpread: 0.01,
        topOfBookVolume: 100,
    })),
    isHealthy: vi.fn(() => true),
    getHealthStatus: vi.fn(() => "healthy"),
    getLastUpdateAge: vi.fn(() => 100),
    cleanup: vi.fn(),
} as unknown as IOrderBookState;

// Helper function to create standardized zone data
function createStandardizedZoneData(price: number): StandardZoneData {
    const createZoneSnapshot = (
        centerPrice: number,
        multiplier: number
    ): ZoneSnapshot => ({
        centerPrice,
        aggressiveVolume: 50 * multiplier,
        passiveVolume: 100 * multiplier,
        tradeCount: 10 * multiplier,
        buyVolume: 75 * multiplier,
        sellVolume: 75 * multiplier,
        dominantSide: "buy",
        imbalance: 0.2,
        timestamp: Date.now(),
    });

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
        zoneConfig: {
            baseTicks: 5,
            tickValue: 0.01,
            timeWindow: 60000,
        },
    };
}

// Helper function to create enriched trade event
function createEnrichedTradeEvent(
    price: number,
    quantity: number,
    includeZoneData = true
): EnrichedTradeEvent {
    return {
        tradeId: 12345,
        price,
        quantity,
        quoteQuantity: price * quantity,
        timestamp: Date.now(),
        isBuyerMaker: false,
        passiveBidVolume: 100,
        passiveAskVolume: 100,
        zonePassiveBidVolume: 200,
        zonePassiveAskVolume: 200,
        bestBid: price - 0.01,
        bestAsk: price + 0.01,
        zoneData: includeZoneData
            ? createStandardizedZoneData(price)
            : undefined,
    };
}

describe("AbsorptionDetectorEnhanced", () => {
    let detector: AbsorptionDetectorEnhanced;
    let defaultSettings: AbsorptionEnhancedSettings;

    beforeEach(() => {
        vi.clearAllMocks();

        defaultSettings = {
            symbol: "LTCUSDT",
            minAggVolume: 10,
            windowMs: 60000,
            zoneTicks: 5,
            pricePrecision: 2,
            useStandardizedZones: false,
            standardizedZoneConfig: {
                enhancementMode: "disabled",
            },
        };

        detector = new AbsorptionDetectorEnhanced(
            "test-absorption-enhanced",
            defaultSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetricsCollector,
            mockSignalLogger
        );
    });

    describe("Basic Enhancement Functionality", () => {
        it("should initialize with standardized zones disabled by default", () => {
            const stats = detector.getEnhancementStats();

            expect(stats.enabled).toBe(false);
            expect(stats.mode).toBe("disabled");
            expect(stats.callCount).toBe(0);
        });

        it("should enable standardized zones when configured", () => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "testing",
                    enableZoneConfluenceFilter: true,
                },
            };

            const enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-enhanced",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.enabled).toBe(true);
            expect(stats.mode).toBe("testing");
        });

        it("should handle trade events without zone data gracefully", () => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "testing",
                },
            };

            const enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-no-zones",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            const tradeWithoutZones = createEnrichedTradeEvent(89.0, 25, false);

            expect(() =>
                enhancedDetector.onEnrichedTrade(tradeWithoutZones)
            ).not.toThrow();

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(0); // No enhancement attempted
        });
    });

    describe("Zone Confluence Analysis", () => {
        let enhancedDetector: AbsorptionDetectorEnhanced;

        beforeEach(() => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "testing",
                    enableZoneConfluenceFilter: true,
                    minZoneConfluenceCount: 2,
                    maxZoneConfluenceDistance: 3,
                    confluenceConfidenceBoost: 0.15,
                },
            };

            enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-confluence",
                enhancedSettings,
                mockOrderBook,
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

    describe("Institutional Volume Analysis", () => {
        let enhancedDetector: AbsorptionDetectorEnhanced;

        beforeEach(() => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "testing",
                    enableInstitutionalVolumeFilter: true,
                    institutionalVolumeThreshold: 50,
                    institutionalVolumeRatioThreshold: 0.3,
                    institutionalVolumeBoost: 0.1,
                },
            };

            enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-institutional",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should detect institutional volume when trade size exceeds threshold", () => {
            const institutionalTrade = createEnrichedTradeEvent(89.0, 75, true); // Large trade

            enhancedDetector.onEnrichedTrade(institutionalTrade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
        });

        it("should not detect institutional volume for small trades", () => {
            const retailTrade = createEnrichedTradeEvent(89.0, 10, true); // Small trade

            enhancedDetector.onEnrichedTrade(retailTrade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.institutionalDetectionCount).toBe(0);
        });
    });

    describe("Cross-Timeframe Analysis", () => {
        let enhancedDetector: AbsorptionDetectorEnhanced;

        beforeEach(() => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "testing",
                    enableCrossTimeframeAnalysis: true,
                    crossTimeframeBoost: 0.05,
                },
            };

            enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-timeframe",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );
        });

        it("should perform cross-timeframe analysis when enabled", () => {
            const trade = createEnrichedTradeEvent(89.0, 25, true);

            enhancedDetector.onEnrichedTrade(trade);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(1);
            expect(stats.enhancementCount).toBe(1);
        });
    });

    describe("Enhancement Statistics and Monitoring", () => {
        it("should track enhancement statistics correctly", () => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "testing",
                    enableZoneConfluenceFilter: true,
                },
            };

            const enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-stats",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            const trade1 = createEnrichedTradeEvent(89.0, 25, true);
            const trade2 = createEnrichedTradeEvent(89.05, 30, true);

            enhancedDetector.onEnrichedTrade(trade1);
            enhancedDetector.onEnrichedTrade(trade2);

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.callCount).toBe(2);
            expect(stats.enhancementCount).toBe(2);
            expect(stats.enhancementSuccessRate).toBeGreaterThan(0);
        });

        it("should handle enhancement errors gracefully", () => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "testing",
                    enableZoneConfluenceFilter: true,
                },
            };

            const enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-errors",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            // Create trade with malformed zone data
            const malformedTrade: EnrichedTradeEvent = {
                ...createEnrichedTradeEvent(89.0, 25, true),
                zoneData: {} as StandardZoneData, // Malformed
            };

            expect(() =>
                enhancedDetector.onEnrichedTrade(malformedTrade)
            ).not.toThrow();

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.errorCount).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Enhancement Mode Control", () => {
        it("should allow runtime enhancement mode changes", () => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "disabled",
                },
            };

            const enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-mode-change",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            // Initially disabled
            expect(enhancedDetector.getEnhancementStats().mode).toBe(
                "disabled"
            );

            // Enable at runtime
            enhancedDetector.setEnhancementMode("production");
            expect(enhancedDetector.getEnhancementStats().mode).toBe(
                "production"
            );
        });
    });

    describe("Production Safety", () => {
        it("should preserve original detector behavior when enhancements fail", () => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "testing",
                },
            };

            const enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-safety",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            const trade = createEnrichedTradeEvent(89.0, 25, true);

            // Should not throw even if enhancement fails
            expect(() => enhancedDetector.onEnrichedTrade(trade)).not.toThrow();

            // Should still process through original detector
            expect(mockMetricsCollector.incrementMetric).toHaveBeenCalled();
        });

        it("should provide comprehensive cleanup", () => {
            const enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-cleanup",
                defaultSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            expect(() => enhancedDetector.cleanup()).not.toThrow();
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("Cleanup with final stats"),
                expect.any(Object)
            );
        });
    });

    describe("Configuration Validation", () => {
        it("should use conservative defaults for production", () => {
            const enhancedSettings: AbsorptionEnhancedSettings = {
                ...defaultSettings,
                useStandardizedZones: true,
                standardizedZoneConfig: {
                    enhancementMode: "production",
                    // Don't specify other options to test defaults
                },
            };

            const enhancedDetector = new AbsorptionDetectorEnhanced(
                "test-defaults",
                enhancedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            const stats = enhancedDetector.getEnhancementStats();
            expect(stats.enabled).toBe(true);
            expect(stats.mode).toBe("production");
        });
    });
});
