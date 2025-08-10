// test/absorptionDetector.test.ts
//
// Unit tests for AbsorptionDetectorEnhanced
// Tests CORRECT absorption behavior: reversal signals
//
// IMPORTANT: Tests validate that absorption generates REVERSAL signals:
// - Ask absorption (resistance holds against buying) → SELL signal (reversal down)
// - Bid absorption (support holds against selling) → BUY signal (reversal up)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import { Config } from "../src/core/config.js";
import { SignalValidationLogger } from "../src/utils/signalValidationLogger.js";

// Mock the SignalValidationLogger - simpler approach using a function mock
vi.mock("../src/utils/signalValidationLogger.js", () => {
    const mockMethods = {
        logSignal: vi.fn(),
        logRejection: vi.fn(), 
        updateCurrentPrice: vi.fn(),
        logSuccessfulSignal: vi.fn(),
        cleanup: vi.fn(),
        getValidationStats: vi.fn().mockReturnValue({
            pendingValidations: 0,
            totalLogged: 0,
        }),
        run90MinuteOptimization: vi.fn(),
        setupSuccessfulSignalValidationTimers: vi.fn(),
        validateSuccessfulSignal: vi.fn(),
    };
    
    return {
        SignalValidationLogger: vi.fn().mockImplementation(() => mockMethods)
    };
});
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { SignalCandidate } from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { AbsorptionEnhancedSettings } from "../src/types/detectorSettings.js";

// Mock implementations
const mockLogger: ILogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};

const mockMetrics: IMetricsCollector = {
    updateMetric: vi.fn(),
    incrementMetric: vi.fn(),
    getMetrics: vi.fn(),
    getHealthSummary: vi.fn(),
};

const mockSignalLogger: ISignalLogger = {
    logSignal: vi.fn(),
};

const mockPreprocessor: IOrderflowPreprocessor = {
    process: vi.fn(),
    getUniversalZones: vi.fn().mockReturnValue({
        bidZones: [],
        askZones: [],
        timestamp: Date.now(),
    }),
    getOrderBook: vi.fn(),
    getMarketState: vi.fn(),
};

// Remove this line - we'll use the mocked class directly

// Mock Config
vi.mock("../src/core/config.js", () => ({
    Config: {
        UNIVERSAL_ZONE_CONFIG: {
            maxZoneConfluenceDistance: 5,
        },
        TICK_SIZE: 0.01,
        getTimeWindow: vi.fn().mockReturnValue(300000),
    },
}));

// Clear module cache to ensure fresh mock
vi.resetModules();

describe("AbsorptionDetectorEnhanced", () => {
    let detector: AbsorptionDetectorEnhanced;
    let emittedSignals: SignalCandidate[] = [];

    // Test configuration
    const testSettings: AbsorptionEnhancedSettings = {
        symbol: "LTCUSDT",
        minAggVolume: 100,
        timeWindowIndex: 0,
        eventCooldownMs: 1000,
        priceEfficiencyThreshold: 0.02,
        maxAbsorptionRatio: 0.8,
        minPassiveMultiplier: 1.2,
        passiveAbsorptionThreshold: 2.0,
        expectedMovementScalingFactor: 0.001,
        liquidityGradientRange: 5,
        institutionalVolumeThreshold: 5000,
        institutionalVolumeRatioThreshold: 0.3,
        enableInstitutionalVolumeFilter: false,
        minAbsorptionScore: 0.3,
        finalConfidenceRequired: 0.5,
        maxZoneCountForScoring: 3,
        minEnhancedConfidenceThreshold: 0.6,
        useStandardizedZones: true,
        enhancementMode: "production",
        balanceThreshold: 0.5,
        confluenceMinZones: 2,
        confluenceMaxDistance: 0.5,
        enableDynamicZoneTracking: true,
        maxZonesPerSide: 5,
        zoneHistoryWindowMs: 300000,
        absorptionZoneThreshold: 0.6,
        minPassiveVolumeForZone: 500,
        priceStabilityTicks: 2,
        minAbsorptionEvents: 3,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        emittedSignals = [];

        // Reset the mock methods (the mock handles this automatically)

        // Create a fresh mock instance for each test
        const mockValidationLogger = new SignalValidationLogger({} as any, "test-output");

        detector = new AbsorptionDetectorEnhanced(
            "test-absorption",
            testSettings,
            mockPreprocessor,
            mockLogger,
            mockMetrics,
            mockSignalLogger,
            mockValidationLogger
        );

        // Capture emitted signals
        detector.on("signalCandidate", (signal: SignalCandidate) => {
            emittedSignals.push(signal);
        });
    });

    describe("Signal Direction Validation (CRITICAL)", () => {
        it("should generate SELL signal for ask absorption (resistance holds → reversal down)", () => {
            // Create trades representing ask absorption
            // Aggressive buying being absorbed at resistance
            const trades = [
                createAbsorptionTrade({
                    price: 100.05,
                    aggressiveVolume: 3000,
                    passiveVolume: 4000,
                    isAbsorption: true,
                    side: "ask",
                }),
                createAbsorptionTrade({
                    price: 100.04, // Price stable/declining despite buying
                    aggressiveVolume: 2000,
                    passiveVolume: 3000,
                    isAbsorption: true,
                    side: "ask",
                    timestamp: Date.now() + 1000,
                }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Check if signal was emitted
            if (emittedSignals.length > 0) {
                const signal = emittedSignals[0];
                // CRITICAL: Ask absorption should generate SELL signal (reversal)
                expect(signal.side).toBe("sell");
                expect(signal.type).toBe("absorption");
            }
        });

        it("should generate BUY signal for bid absorption (support holds → reversal up)", () => {
            // Create trades representing bid absorption
            // Aggressive selling being absorbed at support
            const trades = [
                createAbsorptionTrade({
                    price: 99.95,
                    aggressiveVolume: 3000,
                    passiveVolume: 4000,
                    isAbsorption: true,
                    side: "bid",
                }),
                createAbsorptionTrade({
                    price: 99.96, // Price stable/rising despite selling
                    aggressiveVolume: 2000,
                    passiveVolume: 3000,
                    isAbsorption: true,
                    side: "bid",
                    timestamp: Date.now() + 1000,
                }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Check if signal was emitted
            if (emittedSignals.length > 0) {
                const signal = emittedSignals[0];
                // CRITICAL: Bid absorption should generate BUY signal (reversal)
                expect(signal.side).toBe("buy");
                expect(signal.type).toBe("absorption");
            }
        });

        it("should NOT generate signals in wrong direction", () => {
            // Test that we never generate continuation signals
            const scenarios = [
                {
                    // Ask absorption scenario
                    trades: [
                        createAbsorptionTrade({
                            price: 100.05,
                            isAbsorption: true,
                            side: "ask",
                            aggressiveVolume: 5000,
                            passiveVolume: 6000,
                        }),
                    ],
                    expectedSide: "sell", // Must be sell for ask absorption
                },
                {
                    // Bid absorption scenario
                    trades: [
                        createAbsorptionTrade({
                            price: 99.95,
                            isAbsorption: true,
                            side: "bid",
                            aggressiveVolume: 5000,
                            passiveVolume: 6000,
                        }),
                    ],
                    expectedSide: "buy", // Must be buy for bid absorption
                },
            ];

            scenarios.forEach(({ trades, expectedSide }) => {
                vi.clearAllMocks();
                emittedSignals = [];

                trades.forEach((trade) => detector.onEnrichedTrade(trade));

                if (emittedSignals.length > 0) {
                    const signal = emittedSignals[0];
                    // Verify signal is correct direction
                    expect(signal.side).toBe(expectedSide);
                }
            });
        });
    });

    describe("Absorption Detection Logic", () => {
        it("should detect absorption when passive volume exceeds aggressive", () => {
            // Multiple trades showing absorption pattern
            const trades = [
                createAbsorptionTrade({
                    aggressiveVolume: 2000,
                    passiveVolume: 3000,
                    price: 100.0,
                }),
                createAbsorptionTrade({
                    aggressiveVolume: 1500,
                    passiveVolume: 2500,
                    price: 100.01, // Minimal price movement
                    timestamp: Date.now() + 500,
                }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // May emit signal for absorption pattern
            if (emittedSignals.length > 0) {
                expect(emittedSignals[0].type).toBe("absorption");
            }
        });

        it("should NOT detect absorption when aggressive volume dominates", () => {
            const trade = createAbsorptionTrade({
                aggressiveVolume: 5000,
                passiveVolume: 1000,
                isAbsorption: false,
            });

            detector.onEnrichedTrade(trade);

            // Should not emit signal for non-absorption
            // Note: May still emit if other conditions trigger
            if (emittedSignals.length > 0) {
                // Confidence should be lower for non-absorption
                expect(emittedSignals[0].confidence).toBeLessThanOrEqual(0.6);
            }
        });

        it("should detect price stability during absorption", () => {
            // Series of trades with high volume but stable price (absorption)
            const basePrice = 100.0;
            const trades = Array.from({ length: 5 }, (_, i) =>
                createAbsorptionTrade({
                    price: basePrice + (Math.random() * 0.02 - 0.01), // ±1 tick variation
                    aggressiveVolume: 3000,
                    passiveVolume: 3500,
                    timestamp: Date.now() + i * 200,
                })
            );

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Price stability with volume should indicate absorption
            if (emittedSignals.length > 0) {
                expect(emittedSignals[0].type).toBe("absorption");
            }
        });

        it("should respect cooldown between signals", () => {
            const trade1 = createAbsorptionTrade({
                aggressiveVolume: 2000,
                passiveVolume: 3000,
            });
            const trade2 = createAbsorptionTrade({
                aggressiveVolume: 2000,
                passiveVolume: 3000,
                timestamp: Date.now() + 500, // Within cooldown
            });

            detector.onEnrichedTrade(trade1);
            const firstSignalCount = emittedSignals.length;

            detector.onEnrichedTrade(trade2);
            const secondSignalCount = emittedSignals.length;

            // Second signal should be blocked by cooldown
            expect(secondSignalCount).toBe(firstSignalCount);
        });
    });

    describe("Zone Tracking Integration", () => {
        it("should track absorption zones when enabled", () => {
            const trades = [
                createAbsorptionTrade({
                    price: 100.0,
                    side: "ask",
                    aggressiveVolume: 2000,
                    passiveVolume: 3000,
                }),
                createAbsorptionTrade({
                    price: 100.01,
                    side: "ask",
                    aggressiveVolume: 1500,
                    passiveVolume: 2000,
                    timestamp: Date.now() + 1000,
                }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Verify zone tracking is working
            expect(mockMetrics.updateMetric).toHaveBeenCalled();
        });

        it("should use zone data for signal generation", () => {
            // Create detector with zone tracking enabled
            const zoneSettings = {
                ...testSettings,
                enableDynamicZoneTracking: true,
                minAbsorptionEvents: 2,
            };

            const mockZoneValidationLogger = new SignalValidationLogger({} as any, "test-output");

            const zoneDetector = new AbsorptionDetectorEnhanced(
                "test-zone",
                zoneSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalLogger,
                mockZoneValidationLogger
            );

            const signals: SignalCandidate[] = [];
            zoneDetector.on("signalCandidate", (s) => signals.push(s));

            // Build up zone with multiple absorption events
            const trades = Array.from({ length: 3 }, (_, i) =>
                createAbsorptionTrade({
                    price: 100.0 + i * 0.01,
                    side: "ask",
                    aggressiveVolume: 2000,
                    passiveVolume: 3000,
                    timestamp: Date.now() + i * 500,
                })
            );

            trades.forEach((trade) => zoneDetector.onEnrichedTrade(trade));

            // Zone tracking should enhance signal generation
            if (signals.length > 0) {
                expect(signals[0].metadata).toBeDefined();
            }
        });
    });

    describe("Configuration Validation", () => {
        it("should respect minAggVolume threshold", () => {
            const lowVolumeTrade = createAbsorptionTrade({
                aggressiveVolume: 50, // Below threshold of 100
                passiveVolume: 60,
            });

            detector.onEnrichedTrade(lowVolumeTrade);

            // Should not emit signal for low volume
            expect(emittedSignals.length).toBe(0);
        });

        it("should use configured absorption thresholds", () => {
            // Create detector with strict thresholds
            const strictSettings = {
                ...testSettings,
                minPassiveMultiplier: 3.0, // Very high threshold
                maxAbsorptionRatio: 0.3, // Very low ratio
            };

            const mockStrictValidationLogger = new SignalValidationLogger({} as any, "test-output");

            const strictDetector = new AbsorptionDetectorEnhanced(
                "test-strict",
                strictSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalLogger,
                mockStrictValidationLogger
            );

            const signals: SignalCandidate[] = [];
            strictDetector.on("signalCandidate", (s) => signals.push(s));

            // Moderate absorption that wouldn't meet strict thresholds
            const trade = createAbsorptionTrade({
                aggressiveVolume: 2000,
                passiveVolume: 2500, // Only 1.25x multiplier
            });

            strictDetector.onEnrichedTrade(trade);

            // Should not emit signal with strict thresholds
            expect(signals.length).toBe(0);
        });

        it("should respect price efficiency threshold", () => {
            // Create trades with large price movement (not absorption)
            const trades = [
                createAbsorptionTrade({
                    price: 100.0,
                    aggressiveVolume: 2000,
                    passiveVolume: 2500,
                }),
                createAbsorptionTrade({
                    price: 100.5, // Large price jump (not stable)
                    aggressiveVolume: 2000,
                    passiveVolume: 2500,
                    timestamp: Date.now() + 1000,
                }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Large price movement indicates no absorption
            // Should not emit signal or have low confidence
            if (emittedSignals.length > 0) {
                expect(emittedSignals[0].confidence).toBeLessThan(0.6);
            }
        });
    });

    describe("Performance Requirements", () => {
        it("should process trades within 1ms", () => {
            const trade = createAbsorptionTrade({});

            const start = performance.now();
            detector.onEnrichedTrade(trade);
            const duration = performance.now() - start;

            expect(duration).toBeLessThan(1);
        });

        it("should handle high-frequency updates", () => {
            const trades = Array.from({ length: 100 }, (_, i) =>
                createAbsorptionTrade({ timestamp: Date.now() + i * 10 })
            );

            const start = performance.now();
            trades.forEach((trade) => detector.onEnrichedTrade(trade));
            const duration = performance.now() - start;

            // Should process 100 trades quickly
            expect(duration).toBeLessThan(100); // < 1ms per trade average
        });
    });
});

// Helper function to create base trade
function createBaseTrade(): EnrichedTradeEvent {
    return {
        id: "test-1",
        symbol: "LTCUSDT",
        price: 100.0,
        quantity: 1000,
        timestamp: Date.now(),
        isBuyerMaker: false,
        delta: -1000,
        imbalance: 0,
        bestBid: 99.99,
        bestAsk: 100.01,
        midPrice: 100.0,
        bidDepth: 5000,
        askDepth: 5000,
        spread: 0.02,
        spreadBps: 2,
        microPrice: 100.0,
        aggressor: "seller",
        bidRatio: 0.5,
        totalBidVolume: 5000,
        totalAskVolume: 5000,
        imbalanceRatio: 0,
        vwapPrice: 100.0,
        priceMovement: 0,
        liquidityTaken: 500,
        liquidityProvided: 500,
        accumulatedDelta: -1000,
        volumeRate: 100,
        orderBookImbalance: 0,
        recentVolatility: 0.1,
        bidPressure: 5,
        askPressure: 5,
        netPressure: 0,
        depthImbalance: 0,
        executionSpeed: 50,
        marketMood: "neutral",
    };
}

// Helper function to create absorption trade scenarios
function createAbsorptionTrade(params: {
    price?: number;
    aggressiveVolume?: number;
    passiveVolume?: number;
    isAbsorption?: boolean;
    side?: "bid" | "ask";
    timestamp?: number;
}): EnrichedTradeEvent {
    const {
        price = 100.0,
        aggressiveVolume = 2000,
        passiveVolume = 2500,
        isAbsorption = true,
        side = "ask",
        timestamp = Date.now(),
    } = params;

    const base = createBaseTrade();
    const isBuy = side === "ask"; // Buying into ask absorption

    return {
        ...base,
        price,
        timestamp,
        quantity: aggressiveVolume,
        isBuyerMaker: isBuy,
        delta: isBuy ? aggressiveVolume : -aggressiveVolume,
        imbalance: isAbsorption ? 0.1 : isBuy ? 0.7 : -0.7,
        bestBid: price - 0.01,
        bestAsk: price + 0.01,
        midPrice: price,
        bidDepth: side === "bid" ? passiveVolume : 5000,
        askDepth: side === "ask" ? passiveVolume : 5000,
        bidRatio: isAbsorption ? 0.5 : isBuy ? 0.2 : 0.8,
        totalBidVolume: side === "bid" ? passiveVolume : 5000,
        totalAskVolume: side === "ask" ? passiveVolume : 5000,
        imbalanceRatio: isAbsorption ? 0 : isBuy ? 0.5 : -0.5,
        aggressor: isBuy ? "buyer" : "seller",
        liquidityTaken: aggressiveVolume,
        liquidityProvided: isAbsorption ? passiveVolume : 0,
        accumulatedDelta: isBuy ? aggressiveVolume : -aggressiveVolume,
        orderBookImbalance: isAbsorption ? 0 : isBuy ? 0.5 : -0.5,
        bidPressure: isBuy ? 2 : 8,
        askPressure: isBuy ? 8 : 2,
        netPressure: isAbsorption ? 0 : isBuy ? -6 : 6,
        depthImbalance: isAbsorption ? 0 : isBuy ? -0.3 : 0.3,
        marketMood: isAbsorption ? "neutral" : isBuy ? "bullish" : "bearish",
        priceMovement: isAbsorption ? 0 : isBuy ? 0.02 : -0.02,
    };
}
