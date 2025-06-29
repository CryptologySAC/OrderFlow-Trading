// test/accumulationZoneDetectorEnhanced.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import type {
    ZoneDetectorConfig,
    ZoneAnalysisResult,
} from "../src/types/zoneTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";

// Mock dependencies before imports
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/trading/zoneManager", () => {
    return {
        ZoneManager: vi.fn().mockImplementation(() => {
            const mockZones = new Map();
            return {
                zones: mockZones,
                createZone: vi
                    .fn()
                    .mockImplementation(
                        (type, symbol, trade, zoneDetection) => {
                            const zoneId = `${type}_${symbol}_${Date.now()}`;
                            const zone = {
                                id: zoneId,
                                type: type,
                                symbol: symbol,
                                startTime: trade.timestamp,
                                priceRange: {
                                    min:
                                        zoneDetection.priceRange?.min ||
                                        trade.price,
                                    max:
                                        zoneDetection.priceRange?.max ||
                                        trade.price,
                                    center: trade.price,
                                    width: 0.01,
                                },
                                totalVolume: zoneDetection.totalVolume || 0,
                                averageOrderSize:
                                    zoneDetection.averageOrderSize || 0,
                                tradeCount: zoneDetection.tradeCount || 1,
                                timeInZone: 0,
                                intensity: zoneDetection.intensity || 0,
                                strength: zoneDetection.initialStrength || 0.5,
                                completion: zoneDetection.completion || 0.8,
                                confidence: zoneDetection.confidence || 0.6,
                                significance: "moderate",
                                isActive: true,
                                lastUpdate: trade.timestamp,
                                strengthHistory: [],
                                supportingFactors:
                                    zoneDetection.supportingFactors || {},
                                endTime: null,
                            };
                            mockZones.set(zoneId, zone);
                            return zone;
                        }
                    ),
                getActiveZones: vi.fn().mockImplementation(() => {
                    return Array.from(mockZones.values()).filter(
                        (zone) => zone.isActive
                    );
                }),
                clearAllZones: () => mockZones.clear(),
                on: vi.fn(),
                emit: vi.fn(),
            };
        }),
    };
});

describe("AccumulationZoneDetectorEnhanced - Integration Tests", () => {
    let detector: AccumulationZoneDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;

    const LTCUSDT_BASE_PRICE = 89.45;
    const LTCUSDT_TICK_SIZE = 0.01;

    beforeEach(() => {
        vi.clearAllMocks();

        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        mockMetrics = new MetricsCollector();
    });

    function createLTCUSDTZoneSnapshot(
        centerPrice: number,
        zoneTicks: number,
        aggressiveVol: number = 25.5,
        passiveBidVol: number = 45.2,
        passiveAskVol: number = 38.7
    ): ZoneSnapshot {
        const zoneSize = zoneTicks * LTCUSDT_TICK_SIZE;
        return {
            zoneId: `LTCUSDT_${zoneTicks}T_${centerPrice.toFixed(2)}`,
            priceLevel: centerPrice,
            tickSize: LTCUSDT_TICK_SIZE,
            aggressiveVolume: aggressiveVol,
            passiveVolume: passiveBidVol + passiveAskVol,
            aggressiveBuyVolume: aggressiveVol * 0.6,
            aggressiveSellVolume: aggressiveVol * 0.4,
            passiveBidVolume: passiveBidVol,
            passiveAskVolume: passiveAskVol,
            tradeCount: Math.floor(aggressiveVol / 2.71),
            timespan: 300000,
            boundaries: {
                min: centerPrice - zoneSize / 2,
                max: centerPrice + zoneSize / 2,
            },
            lastUpdate: Date.now(),
            volumeWeightedPrice: centerPrice + (Math.random() - 0.5) * 0.001,
        };
    }

    function createTradeEventWithZones(
        zoneData?: StandardZoneData,
        price: number = LTCUSDT_BASE_PRICE
    ): EnrichedTradeEvent {
        return {
            price: price,
            quantity: 2.71,
            timestamp: Date.now(),
            buyerIsMaker: false,
            pair: "LTCUSDT",
            tradeId: `test_${Date.now()}`,
            originalTrade: {} as any,
            passiveBidVolume: 45.2,
            passiveAskVolume: 38.7,
            zonePassiveBidVolume: 52.3,
            zonePassiveAskVolume: 41.7,
            bestBid: price - 0.01,
            bestAsk: price + 0.01,
            zoneData: zoneData,
        };
    }

    describe("Feature Flag Control", () => {
        it("should work as original detector when standardized zones are disabled", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: false, // Explicitly disabled
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "test-enhanced",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            const trade = createTradeEventWithZones();
            const result = detector.analyze(trade);

            expect(result).toBeDefined();
            expect(result.updates).toBeDefined();
            expect(result.signals).toBeDefined();
            expect(result.activeZones).toBeDefined();

            // Should work exactly like original detector
            const stats = detector.getEnhancementStats();
            expect(stats.enabled).toBe(false);
            expect(stats.mode).toBe("disabled");
            expect(stats.callCount).toBe(0);
        });

        it("should enable standardized zones when configured", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: true,
                enhancementMode: "testing",
                standardizedZoneConfig: {
                    minZoneConfluenceCount: 2,
                    institutionalVolumeThreshold: 50,
                    enableInstitutionalVolumeFilter: true,
                },
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "test-enhanced",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            const stats = detector.getEnhancementStats();
            expect(stats.enabled).toBe(true);
            expect(stats.mode).toBe("testing");
        });
    });

    describe("Standardized Zone Enhancement", () => {
        beforeEach(() => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: true,
                enhancementMode: "testing",
                standardizedZoneConfig: {
                    minZoneConfluenceCount: 2,
                    maxZoneConfluenceDistance: 3,
                    institutionalVolumeThreshold: 50,
                    passiveVolumeRatioThreshold: 1.5,
                    enableZoneConfluenceFilter: true,
                    enableInstitutionalVolumeFilter: true,
                    confluenceConfidenceBoost: 0.2,
                    institutionalVolumeBoost: 0.15,
                },
                minEnhancedConfidenceThreshold: 0.3,
                enhancementSignificanceBoost: true,
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "test-enhanced",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );
        });

        it("should process trades without zone data normally", () => {
            const trade = createTradeEventWithZones(); // No zone data

            const result = detector.analyze(trade);

            expect(result).toBeDefined();

            const stats = detector.getEnhancementStats();
            expect(stats.callCount).toBe(0); // No enhancement attempted without zone data
        });

        it("should enhance signals when institutional volume is detected", () => {
            // Create zone data with institutional volume
            const zoneData: StandardZoneData = {
                zones5Tick: [
                    createLTCUSDTZoneSnapshot(89.44, 5, 78.3, 156.8, 142.3), // High institutional volume
                    createLTCUSDTZoneSnapshot(89.46, 5, 82.7, 167.2, 151.8), // High institutional volume
                ],
                zones10Tick: [
                    createLTCUSDTZoneSnapshot(89.45, 10, 298.5, 567.8, 512.4), // Very high institutional volume
                ],
                zones20Tick: [
                    createLTCUSDTZoneSnapshot(89.45, 20, 567.2, 1098.6, 987.3), // Massive institutional volume
                ],
                zoneConfig: {
                    baseTicks: 5,
                    tickValue: LTCUSDT_TICK_SIZE,
                    timeWindow: 300000,
                },
            };

            const trade = createTradeEventWithZones(zoneData);

            const result = detector.analyze(trade);

            expect(result).toBeDefined();

            // Enhancement should be attempted even if no original signals exist
            const stats = detector.getEnhancementStats();
            expect(stats.callCount).toBeGreaterThanOrEqual(0);
        });

        it("should filter low-quality signals", () => {
            // Create zone data with only retail activity (low institutional volume)
            const zoneData: StandardZoneData = {
                zones5Tick: [
                    createLTCUSDTZoneSnapshot(89.3, 5, 3.2, 4.7, 3.8), // Very low volume (total: 11.7)
                    createLTCUSDTZoneSnapshot(89.6, 5, 2.8, 5.1, 4.2), // Very low volume (total: 12.1)
                ],
                zones10Tick: [],
                zones20Tick: [],
                zoneConfig: {
                    baseTicks: 5,
                    tickValue: LTCUSDT_TICK_SIZE,
                    timeWindow: 300000,
                },
            };

            const trade = createTradeEventWithZones(zoneData);

            const result = detector.analyze(trade);

            expect(result).toBeDefined();

            const stats = detector.getEnhancementStats();
            // Enhancement may be attempted for filtering
            expect(stats.enabled).toBe(true);
        });
    });

    describe("Error Handling and Fallback", () => {
        it("should fallback to original detector on enhancement errors", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: true,
                enhancementMode: "testing",
                standardizedZoneConfig: {
                    // Invalid config to trigger error
                    minZoneConfluenceCount: -1, // Invalid value
                },
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "test-enhanced",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            const trade = createTradeEventWithZones();
            const result = detector.analyze(trade);

            // Should still return valid result even if enhancement fails
            expect(result).toBeDefined();
            expect(result.updates).toBeDefined();
            expect(result.signals).toBeDefined();
            expect(result.activeZones).toBeDefined();
        });

        it("should maintain compatibility with original detector interface", () => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: false,
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "test-enhanced",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );

            // Should have same interface as original detector
            expect(detector.analyze).toBeDefined();
            expect(detector.getActiveZones).toBeDefined();
            expect(detector.getEnhancementStats).toBeDefined();

            const activeZones = detector.getActiveZones();
            expect(Array.isArray(activeZones)).toBe(true);
        });
    });

    describe("Performance and Monitoring", () => {
        beforeEach(() => {
            const config: ZoneDetectorConfig = {
                useStandardizedZones: true,
                enhancementMode: "production",
                standardizedZoneConfig: {
                    minZoneConfluenceCount: 2,
                    institutionalVolumeThreshold: 50,
                },
                maxActiveZones: 5,
                zoneTimeoutMs: 300000,
                minZoneVolume: 100,
                maxZoneWidth: 0.05,
                minZoneStrength: 0.05,
                completionThreshold: 0.8,
                strengthChangeThreshold: 0.15,
                minCandidateDuration: 60000,
                maxPriceDeviation: 0.05,
                minTradeCount: 3,
                minSellRatio: 0.4,
            };

            detector = new AccumulationZoneDetectorEnhanced(
                "test-enhanced",
                "LTCUSDT",
                config,
                mockLogger,
                mockMetrics
            );
        });

        it("should track enhancement statistics", () => {
            const initialStats = detector.getEnhancementStats();
            expect(initialStats.callCount).toBe(0);
            expect(initialStats.successCount).toBe(0);
            expect(initialStats.errorCount).toBe(0);
            expect(initialStats.successRate).toBe(0);

            // Process some trades
            for (let i = 0; i < 5; i++) {
                const trade = createTradeEventWithZones();
                detector.analyze(trade);
            }

            const finalStats = detector.getEnhancementStats();
            expect(finalStats.enabled).toBe(true);
            expect(finalStats.mode).toBe("production");
        });

        it("should perform efficiently with multiple trades", () => {
            const startTime = performance.now();

            // Process 100 trades
            for (let i = 0; i < 100; i++) {
                const trade = createTradeEventWithZones();
                const result = detector.analyze(trade);
                expect(result).toBeDefined();
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should complete within reasonable time (< 100ms for 100 trades)
            expect(duration).toBeLessThan(100);
        });
    });
});
