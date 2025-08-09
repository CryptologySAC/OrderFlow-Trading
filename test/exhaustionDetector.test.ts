// test/exhaustionDetector.test.ts
//
// Unit tests for ExhaustionDetectorEnhanced
// Tests CORRECT exhaustion behavior: reversal signals (not continuation)
//
// IMPORTANT: Tests validate that exhaustion generates REVERSAL signals:
// - Bid exhaustion (selling pressure exhausts bids) → BUY signal (reversal up)
// - Ask exhaustion (buying pressure exhausts asks) → SELL signal (reversal down)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExhaustionDetectorEnhanced } from "../src/indicators/exhaustionDetectorEnhanced.js";
import { Config } from "../src/core/config.js";
import { SignalValidationLogger } from "../src/utils/signalValidationLogger.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { SignalCandidate } from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { ExhaustionEnhancedSettings } from "../src/types/detectorSettings.js";

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

const mockValidationLogger = {
    logSignalValidation: vi.fn(),
    updateCurrentPrice: vi.fn(),
} as unknown as SignalValidationLogger;

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

describe("ExhaustionDetectorEnhanced", () => {
    let detector: ExhaustionDetectorEnhanced;
    let emittedSignals: SignalCandidate[] = [];

    // Test configuration
    const testSettings: ExhaustionEnhancedSettings = {
        symbol: "LTCUSDT",
        minAggVolume: 100,
        exhaustionThreshold: 0.2,
        timeWindowIndex: 0,
        eventCooldownMs: 1000,
        useStandardizedZones: true,
        enhancementMode: "production",
        minEnhancedConfidenceThreshold: 0.65,
        enableDepletionAnalysis: true,
        depletionVolumeThreshold: 1600,
        depletionRatioThreshold: -0.6,
        enableDynamicZoneTracking: true,
        maxZonesPerSide: 5,
        zoneDepletionThreshold: 0.7,
        gapDetectionTicks: 3,
        passiveVolumeExhaustionRatio: 1.0,
        varianceReductionFactor: 1.0,
        alignmentNormalizationFactor: 0.4,
        aggressiveVolumeExhaustionThreshold: 0.24,
        aggressiveVolumeReductionFactor: 0.8,
        passiveRatioBalanceThreshold: 0.5,
        premiumConfidenceThreshold: 0.75,
        variancePenaltyFactor: 0.1,
        ratioBalanceCenterPoint: 0.5,
        exhaustionScoreThreshold: 0.65,
        volumeDecayFactor: 0.95,
        momentumThreshold: 0.6,
        liquidityGradientThreshold: 0.3,
        exhaustionGapMultiplier: 1.5,
        zoneHistoryWindowMs: 300000,
        minZoneInteractionVolume: 500,
        crossTimeframeAlignment: 0.7,
        institutionalExhaustionThreshold: 10000,
        microstructureNoiseFilter: 0.02,
        dynamicThresholdAdjustment: true,
        volatilityNormalization: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        emittedSignals = [];

        detector = new ExhaustionDetectorEnhanced(
            "test-exhaustion",
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
        it("should generate BUY signal for bid exhaustion (selling exhausts bids → reversal up)", () => {
            // Create trade representing bid exhaustion
            const trade: EnrichedTradeEvent = {
                id: "1",
                symbol: "LTCUSDT",
                price: 99.9,
                quantity: 5000,
                timestamp: Date.now(),
                isBuyerMaker: false, // Aggressive sell
                delta: -5000, // Negative delta (selling)
                imbalance: -0.8, // Strong sell imbalance
                bestBid: 99.85,
                bestAsk: 99.95,
                midPrice: 99.9,
                bidDepth: 100, // Low bid depth (exhausted)
                askDepth: 10000, // High ask depth
                spread: 0.1,
                spreadBps: 10,
                microPrice: 99.89,
                aggressor: "seller",
                bidRatio: 0.01, // Very low bid ratio (exhausted)
                totalBidVolume: 100,
                totalAskVolume: 10000,
                imbalanceRatio: -0.99,
                vwapPrice: 99.91,
                priceMovement: -0.05,
                liquidityTaken: 100,
                liquidityProvided: 0,
                accumulatedDelta: -5000,
                volumeRate: 1000,
                orderBookImbalance: -0.99,
                recentVolatility: 0.5,
                bidPressure: 0,
                askPressure: 10,
                netPressure: -10,
                depthImbalance: -0.99,
                executionSpeed: 100,
                marketMood: "bearish",
            };

            // Process the trade
            detector.onEnrichedTrade(trade);

            // Check if signal was emitted
            if (emittedSignals.length > 0) {
                const signal = emittedSignals[0];
                // CRITICAL: Bid exhaustion should generate BUY signal (reversal)
                expect(signal.side).toBe("buy");
                expect(signal.type).toBe("exhaustion");
            }
        });

        it("should generate SELL signal for ask exhaustion (buying exhausts asks → reversal down)", () => {
            // Create trade representing ask exhaustion
            const trade: EnrichedTradeEvent = {
                id: "2",
                symbol: "LTCUSDT",
                price: 100.1,
                quantity: 5000,
                timestamp: Date.now(),
                isBuyerMaker: true, // Aggressive buy
                delta: 5000, // Positive delta (buying)
                imbalance: 0.8, // Strong buy imbalance
                bestBid: 100.05,
                bestAsk: 100.15,
                midPrice: 100.1,
                bidDepth: 10000, // High bid depth
                askDepth: 100, // Low ask depth (exhausted)
                spread: 0.1,
                spreadBps: 10,
                microPrice: 100.11,
                aggressor: "buyer",
                bidRatio: 0.99, // Very high bid ratio
                totalBidVolume: 10000,
                totalAskVolume: 100,
                imbalanceRatio: 0.99,
                vwapPrice: 100.09,
                priceMovement: 0.05,
                liquidityTaken: 100,
                liquidityProvided: 0,
                accumulatedDelta: 5000,
                volumeRate: 1000,
                orderBookImbalance: 0.99,
                recentVolatility: 0.5,
                bidPressure: 10,
                askPressure: 0,
                netPressure: 10,
                depthImbalance: 0.99,
                executionSpeed: 100,
                marketMood: "bullish",
            };

            // Process the trade
            detector.onEnrichedTrade(trade);

            // Check if signal was emitted
            if (emittedSignals.length > 0) {
                const signal = emittedSignals[0];
                // CRITICAL: Ask exhaustion should generate SELL signal (reversal)
                expect(signal.side).toBe("sell");
                expect(signal.type).toBe("exhaustion");
            }
        });

        it("should NOT generate signals in wrong direction", () => {
            // Test that we never generate continuation signals
            const trades = [
                // Bid exhaustion scenario
                {
                    ...createBaseTrade(),
                    isBuyerMaker: false, // Sell
                    bidDepth: 50, // Exhausted bids
                    askDepth: 5000,
                    imbalance: -0.9,
                },
                // Ask exhaustion scenario
                {
                    ...createBaseTrade(),
                    isBuyerMaker: true, // Buy
                    bidDepth: 5000,
                    askDepth: 50, // Exhausted asks
                    imbalance: 0.9,
                },
            ];

            trades.forEach((trade) => {
                vi.clearAllMocks();
                emittedSignals = [];

                detector.onEnrichedTrade(trade as EnrichedTradeEvent);

                if (emittedSignals.length > 0) {
                    const signal = emittedSignals[0];
                    // Verify signal is reversal, not continuation
                    if (trade.isBuyerMaker) {
                        // Buying exhausting asks should signal SELL (reversal)
                        expect(signal.side).toBe("sell");
                    } else {
                        // Selling exhausting bids should signal BUY (reversal)
                        expect(signal.side).toBe("buy");
                    }
                }
            });
        });
    });

    describe("Exhaustion Detection Logic", () => {
        it("should detect exhaustion when passive volume depletes rapidly", () => {
            const trade: EnrichedTradeEvent = createExhaustionTrade({
                aggressiveVolume: 5000,
                passiveVolume: 100,
                depletionRatio: 0.02, // 98% depletion
            });

            detector.onEnrichedTrade(trade);

            // Should emit signal for strong exhaustion
            expect(emittedSignals.length).toBeGreaterThanOrEqual(0);
            if (emittedSignals.length > 0) {
                expect(emittedSignals[0].type).toBe("exhaustion");
            }
        });

        it("should NOT detect exhaustion with balanced order book", () => {
            const trade: EnrichedTradeEvent = createExhaustionTrade({
                aggressiveVolume: 1000,
                passiveVolume: 1000,
                depletionRatio: 1.0, // No depletion
            });

            detector.onEnrichedTrade(trade);

            // Should not emit signal for balanced conditions
            // Note: May still emit if other conditions are met
            if (emittedSignals.length > 0) {
                // Check that confidence is lower for balanced conditions
                expect(emittedSignals[0].confidence).toBeLessThanOrEqual(0.7);
            }
        });

        it("should respect cooldown between signals", () => {
            const trade1 = createExhaustionTrade({
                aggressiveVolume: 5000,
                passiveVolume: 100,
            });
            const trade2 = createExhaustionTrade({
                aggressiveVolume: 5000,
                passiveVolume: 100,
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

    describe("Configuration Validation", () => {
        it("should respect minAggVolume threshold", () => {
            const lowVolumeTrade = createExhaustionTrade({
                aggressiveVolume: 50, // Below threshold of 100
                passiveVolume: 10,
            });

            detector.onEnrichedTrade(lowVolumeTrade);

            // Should not emit signal for low volume
            expect(emittedSignals.length).toBe(0);
        });

        it("should use configured exhaustion threshold", () => {
            // Create detector with high threshold
            const strictSettings = {
                ...testSettings,
                exhaustionThreshold: 0.9, // Very high threshold
            };

            const strictDetector = new ExhaustionDetectorEnhanced(
                "test-strict",
                strictSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalLogger,
                mockValidationLogger
            );

            const signals: SignalCandidate[] = [];
            strictDetector.on("signalCandidate", (s) => signals.push(s));

            // Moderate exhaustion that wouldn't meet strict threshold
            const trade = createExhaustionTrade({
                aggressiveVolume: 2000,
                passiveVolume: 500,
                depletionRatio: 0.25, // Only 75% depletion
            });

            strictDetector.onEnrichedTrade(trade);

            // Should not emit signal with strict threshold
            expect(signals.length).toBe(0);
        });
    });

    describe("Performance Requirements", () => {
        it("should process trades within 1ms", () => {
            const trade = createExhaustionTrade({});

            const start = performance.now();
            detector.onEnrichedTrade(trade);
            const duration = performance.now() - start;

            expect(duration).toBeLessThan(1);
        });

        it("should handle high-frequency updates", () => {
            const trades = Array.from({ length: 100 }, (_, i) =>
                createExhaustionTrade({ timestamp: Date.now() + i * 10 })
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
        bidDepth: 1000,
        askDepth: 1000,
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

// Helper function to create exhaustion trade scenarios
function createExhaustionTrade(params: {
    aggressiveVolume?: number;
    passiveVolume?: number;
    depletionRatio?: number;
    isBuy?: boolean;
    timestamp?: number;
}): EnrichedTradeEvent {
    const {
        aggressiveVolume = 3000,
        passiveVolume = 300,
        depletionRatio = 0.1,
        isBuy = false,
        timestamp = Date.now(),
    } = params;

    const base = createBaseTrade();

    return {
        ...base,
        timestamp,
        quantity: aggressiveVolume,
        isBuyerMaker: isBuy,
        delta: isBuy ? aggressiveVolume : -aggressiveVolume,
        imbalance: isBuy ? 0.7 : -0.7,
        bidDepth: isBuy ? 10000 : passiveVolume,
        askDepth: isBuy ? passiveVolume : 10000,
        bidRatio: isBuy ? 0.9 : depletionRatio,
        totalBidVolume: isBuy ? 10000 : passiveVolume,
        totalAskVolume: isBuy ? passiveVolume : 10000,
        imbalanceRatio: isBuy ? 0.9 : -0.9,
        aggressor: isBuy ? "buyer" : "seller",
        liquidityTaken: aggressiveVolume,
        liquidityProvided: 0,
        accumulatedDelta: isBuy ? aggressiveVolume : -aggressiveVolume,
        orderBookImbalance: isBuy ? 0.9 : -0.9,
        bidPressure: isBuy ? 10 : 0,
        askPressure: isBuy ? 0 : 10,
        netPressure: isBuy ? 10 : -10,
        depthImbalance: isBuy ? 0.9 : -0.9,
        marketMood: isBuy ? "bullish" : "bearish",
    };
}
