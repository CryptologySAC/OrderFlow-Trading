// test/exhaustionDetectorEnhanced.test.ts
//
// ✅ EXHAUSTION STANDALONE: ExhaustionDetectorEnhanced comprehensive test suite
//
// Tests cover the standalone enhanced exhaustion detector without legacy dependencies,
// including multi-timeframe analysis, liquidity depletion detection, and
// cross-timeframe exhaustion validation.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExhaustionDetectorEnhanced } from "../src/indicators/exhaustionDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import type { SignalCandidate } from "../src/types/signalTypes.js";
// Use proper mock from __mocks__/ directory as per CLAUDE.md
import mockConfig from "../__mocks__/config.json";
import { SpoofingDetector } from "../__mocks__/src/services/spoofingDetector.js";

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
    updateMetric: vi.fn(),
    getMetrics: vi.fn(() => ({}) as any),
    cleanup: vi.fn(),
};

const mockSignalLogger: ISignalLogger = {
    logSignal: vi.fn(),
    logSignalCandidate: vi.fn(),
    logSignalValidation: vi.fn(),
};

const mockPreprocessor: IOrderflowPreprocessor = {
    handleDepth: vi.fn(),
    handleAggTrade: vi.fn(),
    getStats: vi.fn(() => ({
        processedTrades: 0,
        processedDepthUpdates: 0,
        bookMetrics: {} as any,
    })),
    findZonesNearPrice: vi.fn(() => [
        {
            priceLevel: 100.0,
            aggressiveVolume: 50,
            passiveVolume: 10, // Low passive for exhaustion
            aggressiveBuyVolume: 10, // Low buy volume
            aggressiveSellVolume: 40, // High sell volume (triggers buy signal)
            tradeCount: 8,
            strength: 0.9,
            timestamp: Date.now(),
        },
    ]),
    calculateZoneRelevanceScore: vi.fn(() => 0.8),
    findMostRelevantZone: vi.fn(() => ({
        priceLevel: 100.0,
        aggressiveVolume: 50,
        passiveVolume: 10,
        aggressiveBuyVolume: 10,
        aggressiveSellVolume: 40,
        tradeCount: 8,
        strength: 0.9,
        timestamp: Date.now(),
    })),
};

// Use proper mock from __mocks__/ directory as per CLAUDE.md
let mockSpoofingDetector: SpoofingDetector;

// Helper function to create enriched trade events with complete zone data
function createEnrichedTradeEvent(
    price: number,
    quantity: number,
    isBuy: boolean,
    zoneData?: StandardZoneData
): EnrichedTradeEvent {
    const defaultZoneData: StandardZoneData = zoneData || {
        zones5Tick: [
            {
                priceLevel: price,
                aggressiveVolume: 50,
                passiveVolume: 10, // Low passive for exhaustion
                aggressiveBuyVolume: 10, // Low buy volume
                aggressiveSellVolume: 40, // High sell volume
                tradeCount: 8,
                strength: 0.9,
                timestamp: Date.now(),
            },
        ],
        zones10Tick: [],
        zones20Tick: [],
    };

    return {
        tradeId: `test-trade-${Date.now()}`,
        price,
        quantity,
        timestamp: Date.now(),
        buyerIsMaker: !isBuy, // Aggressive side
        totalVolume: 100,
        passiveBidVolume: 20,
        passiveAskVolume: 30,
        aggressiveBuyVolume: isBuy ? quantity : 0,
        aggressiveSellVolume: !isBuy ? quantity : 0,
        spread: 0.05,
        midPrice: price + 0.025,
        imbalance: isBuy ? 0.6 : -0.6,
        zoneData: defaultZoneData,
    };
}

describe("ExhaustionDetectorEnhanced - Standalone Architecture", () => {
    let enhancedDetector: ExhaustionDetectorEnhanced;
    const exhaustionConfig = mockConfig.symbols.LTCUSDT.exhaustion as any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Use proper mock from __mocks__/ directory as per CLAUDE.md
        mockSpoofingDetector = new SpoofingDetector();

        enhancedDetector = new ExhaustionDetectorEnhanced(
            "test-enhanced-exhaustion",
            exhaustionConfig,
            mockPreprocessor,
            mockLogger,
            mockSpoofingDetector,
            mockMetricsCollector,
            mockSignalLogger
        );
    });

    describe("Standalone Architecture", () => {
        it("should extend Detector base class directly (not ExhaustionDetector)", () => {
            expect(enhancedDetector).toBeDefined();
            expect(enhancedDetector.getId()).toBe("test-enhanced-exhaustion");
            expect(enhancedDetector.getStatus()).toContain(
                "Exhaustion Enhanced"
            );
        });

        it("should implement required abstract methods", () => {
            expect(typeof enhancedDetector.getStatus).toBe("function");
            expect(typeof enhancedDetector.markSignalConfirmed).toBe(
                "function"
            );
            expect(typeof enhancedDetector.getId).toBe("function");
            expect(typeof enhancedDetector.onEnrichedTrade).toBe("function");
        });

        it("should have cleanup method for resource management", () => {
            expect(typeof enhancedDetector.cleanup).toBe("function");
            expect(() => enhancedDetector.cleanup()).not.toThrow();
        });
    });

    describe("Configuration Validation", () => {
        it("should use configuration from config.json", () => {
            expect(exhaustionConfig.minAggVolume).toBe(15);
            expect(exhaustionConfig.enhancementMode).toBe("production");
            expect(exhaustionConfig.useStandardizedZones).toBe(true);
        });

        it("should validate all required threshold properties", () => {
            expect(exhaustionConfig.depletionVolumeThreshold).toBeDefined();
            expect(exhaustionConfig.depletionRatioThreshold).toBeDefined();
            expect(
                exhaustionConfig.minEnhancedConfidenceThreshold
            ).toBeDefined();
        });

        it("should reject invalid configuration", () => {
            expect(() => {
                new ExhaustionDetectorEnhanced(
                    "test-invalid",
                    {} as any, // Missing required properties
                    mockPreprocessor,
                    mockLogger,
                    mockSpoofingDetector,
                    mockMetricsCollector,
                    mockSignalLogger
                );
            }).toThrow("Missing required configuration properties");
        });
    });

    describe("Signal Generation", () => {
        it("should emit signals with correct type and structure", (done) => {
            const signalCaptures: SignalCandidate[] = [];

            enhancedDetector.on("signal", (signal: SignalCandidate) => {
                signalCaptures.push(signal);

                try {
                    expect(signal.type).toBe("exhaustion");
                    expect(signal.side).toMatch(/^(buy|sell)$/);
                    expect(signal.confidence).toBeGreaterThan(0);
                    expect(signal.confidence).toBeLessThanOrEqual(1);
                    expect(signal.timestamp).toBeTypeOf("number");
                    expect(signal.id).toContain("core-exhaustion");
                    expect(signal.data).toBeDefined();

                    done();
                } catch (error) {
                    done(error);
                }
            });

            // Create exhaustion scenario
            const exhaustionTrade = createEnrichedTradeEvent(100.0, 50, false); // Large sell
            enhancedDetector.onEnrichedTrade(exhaustionTrade);
        });

        it("should calculate confidence correctly", (done) => {
            enhancedDetector.on("signal", (signal: SignalCandidate) => {
                try {
                    // With our test data: aggressiveRatio ~0.833 + zoneBoost 0.1 = ~0.933
                    expect(signal.confidence).toBeGreaterThan(0.7);
                    expect(signal.confidence).toBeLessThanOrEqual(1.0);
                    done();
                } catch (error) {
                    done(error);
                }
            });

            const trade = createEnrichedTradeEvent(100.0, 50, false);
            enhancedDetector.onEnrichedTrade(trade);
        });

        it("should determine signal side based on buy/sell volume ratio", (done) => {
            enhancedDetector.on("signal", (signal: SignalCandidate) => {
                try {
                    // With aggressiveBuyVolume: 10, aggressiveSellVolume: 40
                    // buyRatio = 10/50 = 0.2 < 0.35, should return "buy"
                    expect(signal.side).toBe("buy");
                    done();
                } catch (error) {
                    done(error);
                }
            });

            const trade = createEnrichedTradeEvent(100.0, 50, false);
            enhancedDetector.onEnrichedTrade(trade);
        });
    });

    describe("Zone-Based Analysis", () => {
        it("should require zone data for processing", () => {
            const tradeWithoutZones = createEnrichedTradeEvent(
                100.0,
                50,
                false
            );
            tradeWithoutZones.zoneData = undefined;

            // Should skip processing without throwing
            expect(() =>
                enhancedDetector.onEnrichedTrade(tradeWithoutZones)
            ).not.toThrow();

            // Should log warning about skipped processing
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining("Skipping trade processing"),
                expect.objectContaining({
                    reason: "no_zone_data",
                })
            );
        });

        it("should analyze exhaustion patterns in zones", () => {
            const trade = createEnrichedTradeEvent(100.0, 50, false);

            expect(() => enhancedDetector.onEnrichedTrade(trade)).not.toThrow();

            // Should call preprocessor to find zones near price
            expect(mockPreprocessor.findZonesNearPrice).toHaveBeenCalled();
        });

        it("should skip processing when standardized zones are disabled", () => {
            const disabledConfig = {
                ...exhaustionConfig,
                useStandardizedZones: false,
            };

            const detectorWithDisabledZones = new ExhaustionDetectorEnhanced(
                "test-disabled-zones",
                disabledConfig,
                mockPreprocessor,
                mockLogger,
                mockSpoofingDetector,
                mockMetricsCollector,
                mockSignalLogger
            );

            const trade = createEnrichedTradeEvent(100.0, 50, false);

            expect(() =>
                detectorWithDisabledZones.onEnrichedTrade(trade)
            ).not.toThrow();

            // Should log warning about zones being disabled
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining("Skipping trade processing"),
                expect.objectContaining({
                    reason: "zones_disabled",
                })
            );
        });
    });

    describe("Volume and Ratio Thresholds", () => {
        it("should reject trades below minimum volume threshold", () => {
            const lowVolumeTrade = createEnrichedTradeEvent(100.0, 5, false); // Below minAggVolume: 15

            expect(() =>
                enhancedDetector.onEnrichedTrade(lowVolumeTrade)
            ).not.toThrow();

            // Should not emit any signals for low volume
            const signalCaptures: SignalCandidate[] = [];
            enhancedDetector.on("signal", (signal) =>
                signalCaptures.push(signal)
            );

            enhancedDetector.onEnrichedTrade(lowVolumeTrade);

            // Wait for potential async processing
            setTimeout(() => {
                expect(signalCaptures).toHaveLength(0);
            }, 50);
        });

        it("should detect exhaustion when aggressive volume exceeds thresholds", (done) => {
            enhancedDetector.on("signal", (signal: SignalCandidate) => {
                try {
                    expect(signal.type).toBe("exhaustion");
                    expect(signal.data).toMatchObject({
                        aggressive: expect.any(Number),
                        exhaustionScore: expect.any(Number),
                        confidence: expect.any(Number),
                        side: expect.stringMatching(/^(buy|sell)$/),
                    });
                    done();
                } catch (error) {
                    done(error);
                }
            });

            // High volume trade that should trigger exhaustion
            const highVolumeTrade = createEnrichedTradeEvent(100.0, 50, false);
            enhancedDetector.onEnrichedTrade(highVolumeTrade);
        });
    });

    describe("Enhancement Statistics", () => {
        it("should track enhancement statistics", () => {
            const stats = enhancedDetector.getEnhancementStats();

            expect(stats).toMatchObject({
                callCount: expect.any(Number),
                enhancementCount: expect.any(Number),
                errorCount: expect.any(Number),
                confluenceDetectionCount: expect.any(Number),
                depletionDetectionCount: expect.any(Number),
                crossTimeframeAnalysisCount: expect.any(Number),
                averageConfidenceBoost: expect.any(Number),
                totalConfidenceBoost: expect.any(Number),
                enhancementSuccessRate: expect.any(Number),
            });
        });

        it("should increment call count on each trade", () => {
            const initialStats = enhancedDetector.getEnhancementStats();
            const initialCallCount = initialStats.callCount;

            const trade = createEnrichedTradeEvent(100.0, 50, false);
            enhancedDetector.onEnrichedTrade(trade);

            const updatedStats = enhancedDetector.getEnhancementStats();
            expect(updatedStats.callCount).toBe(initialCallCount + 1);
        });
    });

    describe("Enhancement Mode Control", () => {
        it("should support runtime enhancement mode changes", () => {
            expect(() =>
                enhancedDetector.setEnhancementMode("monitoring")
            ).not.toThrow();
            expect(() =>
                enhancedDetector.setEnhancementMode("disabled")
            ).not.toThrow();
            expect(() =>
                enhancedDetector.setEnhancementMode("production")
            ).not.toThrow();

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("Enhancement mode updated"),
                expect.any(Object)
            );
        });

        it("should skip processing when enhancement mode is disabled", () => {
            enhancedDetector.setEnhancementMode("disabled");

            const trade = createEnrichedTradeEvent(100.0, 50, false);

            expect(() => enhancedDetector.onEnrichedTrade(trade)).not.toThrow();

            // Should log warning about detector being disabled
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining("Skipping trade processing"),
                expect.objectContaining({
                    reason: "detector_disabled",
                })
            );
        });
    });

    describe("Error Handling", () => {
        it("should handle errors gracefully during processing", () => {
            // Mock preprocessor to throw an error
            mockPreprocessor.findZonesNearPrice.mockImplementation(() => {
                throw new Error("Mock preprocessor error");
            });

            const trade = createEnrichedTradeEvent(100.0, 50, false);

            // Most important test: should not crash on errors
            expect(() => enhancedDetector.onEnrichedTrade(trade)).not.toThrow();

            // Detector should continue to function after error
            expect(enhancedDetector.getId()).toBe("test-enhanced-exhaustion");
            expect(enhancedDetector.getStatus()).toContain(
                "Exhaustion Enhanced"
            );
        });
    });

    describe("Signal Confirmation", () => {
        it("should handle signal confirmation tracking", () => {
            expect(() =>
                enhancedDetector.markSignalConfirmed(100.0, "buy")
            ).not.toThrow();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining("Signal confirmed"),
                expect.objectContaining({
                    detectorId: "test-enhanced-exhaustion",
                    zone: 100.0,
                    side: "buy",
                })
            );
        });
    });
});
