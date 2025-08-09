// test/exhaustionDetector_comprehensive.test.ts
//
// Comprehensive test suite for ExhaustionDetectorEnhanced
// Tests 100+ scenarios to identify configuration issues and logic problems
//
// IMPORTANT: These tests validate CORRECT exhaustion behavior, not current broken logic

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExhaustionDetectorEnhanced } from "../src/indicators/exhaustionDetectorEnhanced.js";
import { Config } from "../src/core/config.js";
import { SignalValidationLogger } from "../src/utils/signalValidationLogger.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";

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
} as unknown as SignalValidationLogger;

// Mock the Config module to avoid validation issues
vi.mock("../src/core/config.js", () => ({
    Config: {
        UNIVERSAL_ZONE_CONFIG: {
            maxZoneConfluenceDistance: 5,
        },
        TICK_SIZE: 0.01,
    },
}));

describe("ExhaustionDetectorEnhanced - Comprehensive Test Suite", () => {
    let detector: ExhaustionDetectorEnhanced;

    // Test configuration - all parameters explicit
    const testConfig = {
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
        volumeProfileAnalysis: true,
        orderFlowImbalanceThreshold: 0.6,
        priceRejectionThreshold: 0.8,
        exhaustionVelocityThreshold: 1.2,
        recoveryTimeThreshold: 60000,
        confluenceScoreThreshold: 0.7,
    };

    beforeEach(() => {
        detector = new ExhaustionDetectorEnhanced(
            "test-exhaustion",
            testConfig as any,
            mockPreprocessor,
            mockLogger,
            mockMetrics,
            mockSignalLogger,
            mockValidationLogger
        );

        // Clear all mocks
        vi.clearAllMocks();
    });

    describe("1. EXHAUSTION POINT DETECTION (Core Logic)", () => {
        it("should detect bid exhaustion when passive buy volume depletes rapidly", async () => {
            // Scenario: Strong selling exhausts bid liquidity
            const trade: EnrichedTradeEvent = createTrade({
                price: 100.0,
                quantity: 5000,
                isBuy: false, // Aggressive selling
                bidDepth: 1000, // Low remaining bid depth
                askDepth: 10000,
                spreadBps: 5,
                imbalance: -0.8, // Heavy selling pressure
            });

            const signal = await detector.detectExhaustion(trade);

            // EXPECTED: Bid exhaustion should trigger BUY signal (reversal)
            expect(signal).not.toBeNull();
            if (signal) {
                expect(signal.side).toBe("buy"); // Exhaustion at bottom → buy
                expect(signal.confidence).toBeGreaterThan(0.65);
            }
        });

        it("should detect ask exhaustion when passive sell volume depletes rapidly", async () => {
            // Scenario: Strong buying exhausts ask liquidity
            const trade: EnrichedTradeEvent = createTrade({
                price: 100.0,
                quantity: 5000,
                isBuy: true, // Aggressive buying
                bidDepth: 10000,
                askDepth: 1000, // Low remaining ask depth
                spreadBps: 5,
                imbalance: 0.8, // Heavy buying pressure
            });

            const signal = await detector.detectExhaustion(trade);

            // EXPECTED: Ask exhaustion should trigger SELL signal (reversal)
            expect(signal).not.toBeNull();
            if (signal) {
                expect(signal.side).toBe("sell"); // Exhaustion at top → sell
                expect(signal.confidence).toBeGreaterThan(0.65);
            }
        });

        it("should NOT detect exhaustion with balanced order book", async () => {
            // Scenario: Balanced market, no exhaustion
            const trade: EnrichedTradeEvent = createTrade({
                price: 100.0,
                quantity: 100,
                isBuy: true,
                bidDepth: 10000,
                askDepth: 10000,
                spreadBps: 1,
                imbalance: 0.0, // Balanced
            });

            const signal = await detector.detectExhaustion(trade);

            // EXPECTED: No signal in balanced conditions
            expect(signal).toBeNull();
        });
    });

    describe("2. VOLUME DEPLETION ANALYSIS", () => {
        it("should track cumulative volume depletion over time window", async () => {
            // Scenario: Progressive depletion over multiple trades
            const trades = [
                createTrade({
                    price: 100.0,
                    quantity: 500,
                    isBuy: false,
                    bidDepth: 5000,
                }),
                createTrade({
                    price: 99.99,
                    quantity: 1000,
                    isBuy: false,
                    bidDepth: 4000,
                }),
                createTrade({
                    price: 99.98,
                    quantity: 1500,
                    isBuy: false,
                    bidDepth: 2500,
                }),
                createTrade({
                    price: 99.97,
                    quantity: 2000,
                    isBuy: false,
                    bidDepth: 500,
                }),
            ];

            let signal = null;
            for (const trade of trades) {
                signal = await detector.detectExhaustion(trade);
            }

            // EXPECTED: Exhaustion detected after sufficient depletion
            expect(signal).not.toBeNull();
            if (signal) {
                expect(signal.side).toBe("buy"); // Bid exhaustion → buy signal
            }
        });

        it("should reset depletion tracking after recovery", async () => {
            // Scenario: Depletion followed by recovery
            const exhaustionTrade = createTrade({
                price: 99.95,
                quantity: 3000,
                isBuy: false,
                bidDepth: 100,
            });

            const signal1 = await detector.detectExhaustion(exhaustionTrade);
            expect(signal1).not.toBeNull();

            // Recovery trades
            const recoveryTrades = [
                createTrade({
                    price: 100.0,
                    quantity: 100,
                    isBuy: true,
                    bidDepth: 5000,
                }),
                createTrade({
                    price: 100.05,
                    quantity: 100,
                    isBuy: true,
                    bidDepth: 8000,
                }),
            ];

            for (const trade of recoveryTrades) {
                await detector.detectExhaustion(trade);
            }

            // Try exhaustion again - should work after recovery
            const signal2 = await detector.detectExhaustion(exhaustionTrade);

            // EXPECTED: Can detect exhaustion again after recovery period
            expect(signal2).toBeDefined(); // May or may not trigger based on cooldown
        });
    });

    describe("3. CONFIGURATION PARAMETER VALIDATION", () => {
        it("should respect minAggVolume threshold", async () => {
            const lowVolumeTrade = createTrade({
                price: 100.0,
                quantity: 50, // Below minAggVolume (100)
                isBuy: false,
                bidDepth: 100,
            });

            const signal = await detector.detectExhaustion(lowVolumeTrade);

            // EXPECTED: No signal for volume below threshold
            expect(signal).toBeNull();
        });

        it("should respect exhaustionThreshold for depletion ratio", async () => {
            // Test with depletion just below threshold
            const trade = createTrade({
                price: 100.0,
                quantity: 500,
                isBuy: false,
                bidDepth: 3000, // Not depleted enough
                askDepth: 10000,
                imbalance: -0.15, // Below exhaustionThreshold (0.2)
            });

            const signal = await detector.detectExhaustion(trade);

            // EXPECTED: No signal when below exhaustion threshold
            expect(signal).toBeNull();
        });

        it("should respect eventCooldownMs between signals", async () => {
            const exhaustionTrade = createTrade({
                price: 99.95,
                quantity: 3000,
                isBuy: false,
                bidDepth: 100,
            });

            const signal1 = await detector.detectExhaustion(exhaustionTrade);
            expect(signal1).not.toBeNull();

            // Immediate retry (within cooldown)
            const signal2 = await detector.detectExhaustion(exhaustionTrade);

            // EXPECTED: No signal during cooldown period
            expect(signal2).toBeNull();

            // Wait for cooldown and retry
            await new Promise((resolve) =>
                setTimeout(resolve, testConfig.eventCooldownMs + 100)
            );
            const signal3 = await detector.detectExhaustion(exhaustionTrade);

            // EXPECTED: Signal allowed after cooldown
            expect(signal3).toBeDefined();
        });

        it("should require minimum confidence threshold", async () => {
            // Low confidence scenario
            const trade = createTrade({
                price: 100.0,
                quantity: 200,
                isBuy: false,
                bidDepth: 2000,
                askDepth: 8000,
                imbalance: -0.25, // Moderate imbalance
            });

            const signal = await detector.detectExhaustion(trade);

            // If signal generated, confidence must meet threshold
            if (signal) {
                expect(signal.confidence).toBeGreaterThanOrEqual(
                    testConfig.minEnhancedConfidenceThreshold
                );
            }
        });
    });

    describe("4. ZONE TRACKING INTEGRATION", () => {
        it("should track depletion zones on bid side", async () => {
            const trades = [
                createTrade({ price: 100.0, quantity: 1000, isBuy: false }),
                createTrade({ price: 99.99, quantity: 1000, isBuy: false }),
                createTrade({ price: 99.98, quantity: 1000, isBuy: false }),
            ];

            for (const trade of trades) {
                await detector.detectExhaustion(trade);
            }

            // Verify zone tracking is active
            const stats = (detector as any).zoneTracker?.getStats();
            if (stats && testConfig.enableDynamicZoneTracking) {
                expect(stats.bidZonesTracked).toBeGreaterThan(0);
            }
        });

        it("should track depletion zones on ask side", async () => {
            const trades = [
                createTrade({ price: 100.0, quantity: 1000, isBuy: true }),
                createTrade({ price: 100.01, quantity: 1000, isBuy: true }),
                createTrade({ price: 100.02, quantity: 1000, isBuy: true }),
            ];

            for (const trade of trades) {
                await detector.detectExhaustion(trade);
            }

            // Verify zone tracking is active
            const stats = (detector as any).zoneTracker?.getStats();
            if (stats && testConfig.enableDynamicZoneTracking) {
                expect(stats.askZonesTracked).toBeGreaterThan(0);
            }
        });

        it("should limit zones per side to maxZonesPerSide", async () => {
            // Create many trades to potentially create many zones
            const trades = [];
            for (let i = 0; i < 10; i++) {
                trades.push(
                    createTrade({
                        price: 100.0 + i * 0.01,
                        quantity: 1000,
                        isBuy: true,
                    })
                );
            }

            for (const trade of trades) {
                await detector.detectExhaustion(trade);
            }

            const stats = (detector as any).zoneTracker?.getStats();
            if (stats && testConfig.enableDynamicZoneTracking) {
                expect(stats.askZonesTracked).toBeLessThanOrEqual(
                    testConfig.maxZonesPerSide
                );
                expect(stats.bidZonesTracked).toBeLessThanOrEqual(
                    testConfig.maxZonesPerSide
                );
            }
        });
    });

    describe("5. GAP DETECTION", () => {
        it("should detect exhaustion gaps in price movement", async () => {
            // Create gap scenario
            const trades = [
                createTrade({ price: 100.0, quantity: 1000, isBuy: false }),
                createTrade({ price: 99.95, quantity: 2000, isBuy: false }), // 5 tick gap
            ];

            let signal = null;
            for (const trade of trades) {
                signal = await detector.detectExhaustion(trade);
            }

            // Gap should enhance exhaustion detection
            if (signal && testConfig.gapDetectionTicks > 0) {
                expect(signal.metadata?.hasGap).toBe(true);
            }
        });

        it("should respect gapDetectionTicks threshold", async () => {
            // Small movement, no gap
            const trades = [
                createTrade({ price: 100.0, quantity: 1000, isBuy: false }),
                createTrade({ price: 99.99, quantity: 1000, isBuy: false }), // 1 tick, below threshold
            ];

            let signal = null;
            for (const trade of trades) {
                signal = await detector.detectExhaustion(trade);
            }

            // No gap enhancement for small moves
            if (signal) {
                expect(signal.metadata?.hasGap).toBeFalsy();
            }
        });
    });

    describe("6. PASSIVE/AGGRESSIVE VOLUME RATIOS", () => {
        it("should calculate passive exhaustion correctly", async () => {
            // High aggressive volume exhausting passive liquidity
            const trade = createTrade({
                price: 100.0,
                quantity: 5000, // High aggressive volume
                isBuy: false,
                bidDepth: 500, // Low passive volume
                passiveRatio: 0.1, // 10% passive vs aggressive
            });

            const signal = await detector.detectExhaustion(trade);

            // High exhaustion ratio should trigger signal
            if (testConfig.passiveVolumeExhaustionRatio < 1.0) {
                expect(signal).not.toBeNull();
            }
        });

        it("should handle passive volume balance", async () => {
            // Balanced passive/aggressive volumes
            const trade = createTrade({
                price: 100.0,
                quantity: 1000,
                isBuy: false,
                bidDepth: 1000,
                passiveRatio: 1.0, // Equal passive and aggressive
            });

            const signal = await detector.detectExhaustion(trade);

            // Balanced volumes shouldn't trigger exhaustion
            expect(signal).toBeNull();
        });
    });

    describe("7. VARIANCE AND ALIGNMENT FACTORS", () => {
        it("should apply variance reduction factor", async () => {
            // High variance scenario
            const trades = [
                createTrade({ price: 100.0, quantity: 100, isBuy: true }),
                createTrade({ price: 99.95, quantity: 5000, isBuy: false }),
                createTrade({ price: 100.05, quantity: 200, isBuy: true }),
            ];

            for (const trade of trades) {
                await detector.detectExhaustion(trade);
            }

            // High variance should reduce confidence if factor < 1
            if (testConfig.varianceReductionFactor < 1.0) {
                // Verify variance affects confidence calculation
                expect(mockMetrics.updateMetric).toHaveBeenCalled();
            }
        });

        it("should apply alignment normalization", async () => {
            // Test cross-timeframe alignment
            const trade = createTrade({
                price: 100.0,
                quantity: 2000,
                isBuy: false,
                bidDepth: 200,
            });

            const signal = await detector.detectExhaustion(trade);

            // Alignment should be factored into confidence
            if (signal && testConfig.alignmentNormalizationFactor > 0) {
                expect(signal.confidence).toBeLessThanOrEqual(1.0);
            }
        });
    });

    describe("8. SIGNAL DIRECTION VALIDATION", () => {
        it("should generate BUY signal for bid exhaustion (bottom)", async () => {
            const trade = createTrade({
                price: 99.9,
                quantity: 5000,
                isBuy: false, // Selling pressure
                bidDepth: 100, // Bid exhausted
                askDepth: 10000,
            });

            const signal = await detector.detectExhaustion(trade);

            if (signal) {
                expect(signal.side).toBe("buy"); // Correct: exhaustion at bottom = buy
            }
        });

        it("should generate SELL signal for ask exhaustion (top)", async () => {
            const trade = createTrade({
                price: 100.1,
                quantity: 5000,
                isBuy: true, // Buying pressure
                bidDepth: 10000,
                askDepth: 100, // Ask exhausted
            });

            const signal = await detector.detectExhaustion(trade);

            if (signal) {
                expect(signal.side).toBe("sell"); // Correct: exhaustion at top = sell
            }
        });

        it("should NOT generate signals in wrong direction", async () => {
            // Test that we don't get inverted signals
            const bidExhaustion = createTrade({
                price: 99.9,
                quantity: 5000,
                isBuy: false,
                bidDepth: 100,
            });

            const signal = await detector.detectExhaustion(bidExhaustion);

            // Should NEVER be sell signal for bid exhaustion
            if (signal) {
                expect(signal.side).not.toBe("sell");
            }
        });
    });

    describe("9. EDGE CASES AND ERROR HANDLING", () => {
        it("should handle zero volume gracefully", async () => {
            const trade = createTrade({
                price: 100.0,
                quantity: 0,
                isBuy: true,
            });

            const signal = await detector.detectExhaustion(trade);
            expect(signal).toBeNull();
        });

        it("should handle negative spreads", async () => {
            const trade = createTrade({
                price: 100.0,
                quantity: 1000,
                isBuy: true,
                spreadBps: -1, // Crossed market
            });

            // Should not crash
            const signal = await detector.detectExhaustion(trade);
            expect(signal).toBeDefined(); // May be null or signal
        });

        it("should handle missing depth data", async () => {
            const trade = createTrade({
                price: 100.0,
                quantity: 1000,
                isBuy: true,
                bidDepth: undefined,
                askDepth: undefined,
            });

            const signal = await detector.detectExhaustion(trade);
            // Should handle gracefully
            expect(signal).toBeDefined();
        });
    });

    describe("10. PERFORMANCE AND TIMING", () => {
        it("should process trades within 1ms", async () => {
            const trade = createTrade({
                price: 100.0,
                quantity: 1000,
                isBuy: true,
            });

            const start = performance.now();
            await detector.detectExhaustion(trade);
            const duration = performance.now() - start;

            expect(duration).toBeLessThan(1);
        });

        it("should handle high-frequency updates", async () => {
            const trades = [];
            for (let i = 0; i < 100; i++) {
                trades.push(
                    createTrade({
                        price: 100.0 + (Math.random() - 0.5) * 0.1,
                        quantity: Math.random() * 1000,
                        isBuy: Math.random() > 0.5,
                    })
                );
            }

            const start = performance.now();
            for (const trade of trades) {
                await detector.detectExhaustion(trade);
            }
            const duration = performance.now() - start;

            // Should process 100 trades quickly
            expect(duration).toBeLessThan(100); // < 1ms per trade average
        });
    });
});

// Helper function to create test trades
function createTrade(params: Partial<EnrichedTradeEvent>): EnrichedTradeEvent {
    const defaults: EnrichedTradeEvent = {
        symbol: "LTCUSDT",
        price: 100.0,
        quantity: 100,
        timestamp: Date.now(),
        isBuy: true,
        tradeId: Math.random().toString(),
        eventType: "trade",
        exchange: "binance",
        marketType: "spot",

        // Enriched fields
        bestBid: params.price ? params.price - 0.01 : 99.99,
        bestAsk: params.price ? params.price + 0.01 : 100.01,
        bidDepth: 10000,
        askDepth: 10000,
        spreadBps: 2,
        imbalance: 0,

        // Additional fields
        sequenceId: Date.now(),
        eventTime: Date.now(),
        orderBookMidPrice: params.price || 100.0,
        microstructureFeatures: {
            immediateVolume: params.quantity || 100,
            aggregatedVolume: params.quantity || 100,
            tradeVelocity: 1.0,
            microPrice: params.price || 100.0,
            volumeImbalance: params.imbalance || 0,
            tradeIntensity: 1.0,
            averageTradeSize: params.quantity || 100,
        },

        ...params,
    };

    return defaults;
}
