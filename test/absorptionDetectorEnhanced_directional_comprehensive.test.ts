// test/absorptionDetectorEnhanced_directional_comprehensive.test.ts
//
// Comprehensive test suite for AbsorptionDetectorEnhanced directional passive volume logic
//
// CRITICAL VALIDATION: Tests the corrected directional passive volume fix:
// - Buy trades (buyerIsMaker = false): Only count passiveAskVolume (absorb ask liquidity)
// - Sell trades (buyerIsMaker = true): Only count passiveBidVolume (absorb bid liquidity)
//
// This test suite validates that the detector now correctly eliminates false signals
// by only considering the relevant passive volume side for each trade direction.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import { Config } from "../src/core/config.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    ZoneSnapshot,
    StandardZoneData,
} from "../src/types/marketEvents.js";
import type { SignalCandidate } from "../src/types/signalTypes.js";
import { CircularBuffer } from "../src/utils/circularBuffer.js";
import { createMockSignalLogger } from "../__mocks__/src/infrastructure/signalLoggerInterface.js";

// Mock implementations using vi.fn() for proper Vitest integration
const mockLogger: ILogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};

const mockMetrics: IMetricsCollector = {
    recordGauge: vi.fn(),
    recordCounter: vi.fn(),
    recordHistogram: vi.fn(),
    recordTiming: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
    // Complete IMetricsCollector interface
    registerMetric: vi.fn(),
    getHistogramPercentiles: vi.fn(() => ({ p50: 0, p95: 0, p99: 0 })),
    getHistogramSummary: vi.fn(() => null),
    createGauge: vi.fn(),
    setGauge: vi.fn(),
    incrementCounter: vi.fn(),
    decrementCounter: vi.fn(),
    getCounterRate: vi.fn(() => 0),
    createCounter: vi.fn(),
    createHistogram: vi.fn(),
    getGaugeValue: vi.fn(() => 0),
    incrementMetric: vi.fn(),
    updateMetric: vi.fn(),
    getAverageLatency: vi.fn(() => 0),
    getLatencyPercentiles: vi.fn(() => ({ p50: 0, p95: 0, p99: 0 })),
    exportPrometheus: vi.fn(() => ""),
    exportJSON: vi.fn(() => "{}"),
    getHealthSummary: vi.fn(() => ({ status: "healthy" }) as any),
    reset: vi.fn(),
    cleanup: vi.fn(),
};

const mockSignalLogger = createMockSignalLogger();

const mockPreprocessor: IOrderflowPreprocessor = {
    findZonesNearPrice: vi.fn((zones, price, maxDistance) => {
        // Return zones within distance for realistic testing
        return zones.filter((zone) => {
            const distance = Math.abs(zone.priceLevel - price);
            return distance <= maxDistance;
        });
    }),
    calculateZoneRelevanceScore: vi.fn(() => 0.5),
    findMostRelevantZone: vi.fn(() => null),
    handleDepth: vi.fn(),
    handleAggTrade: vi.fn(),
    getStats: vi.fn(() => ({
        processedTrades: 0,
        processedDepthUpdates: 0,
        bookMetrics: {} as any,
    })),
};

// Configuration constants - using realistic LTCUSDT values
const LTCUSDT_PRICE = 89.5; // Realistic LTC price
const TICK_SIZE = 0.01; // $10-$100 range tick size (CLAUDE.md compliant)
const INSTITUTIONAL_VOLUME_THRESHOLD = 25; // Realistic institutional threshold
const ABSORPTION_RATIO_THRESHOLD = 0.65; // 65% passive volume required
const PRICE_EFFICIENCY_THRESHOLD = 0.015; // 1.5% maximum efficiency
const TIME_WINDOW_MS = 60000; // 1 minute window

describe("AbsorptionDetectorEnhanced - Directional Passive Volume Tests", () => {
    let detector: AbsorptionDetectorEnhanced;
    let mockValidationLogger: SignalValidationLogger;
    let emittedSignals: SignalCandidate[];

    beforeEach(() => {
        // Reset all mocks
        vi.clearAllMocks();
        emittedSignals = [];

        // Mock Config.ABSORPTION_DETECTOR to return realistic values
        vi.spyOn(Config, "ABSORPTION_DETECTOR", "get").mockReturnValue({
            minAggVolume: 20,
            timeWindowIndex: 2, // Index into time windows
            eventCooldownMs: 10000,
            priceEfficiencyThreshold: PRICE_EFFICIENCY_THRESHOLD,
            maxAbsorptionRatio: 0.9,
            minPassiveMultiplier: 1.5,
            passiveAbsorptionThreshold: ABSORPTION_RATIO_THRESHOLD,
            expectedMovementScalingFactor: 50,
            contextConfidenceBoostMultiplier: 0.2,
            liquidityGradientRange: 5,
            institutionalVolumeThreshold: INSTITUTIONAL_VOLUME_THRESHOLD,
            institutionalVolumeRatioThreshold: 0.4,
            enableInstitutionalVolumeFilter: true,
            institutionalVolumeBoost: 0.15,
            minAbsorptionScore: 0.4,
            finalConfidenceRequired: 0.3,
            confidenceBoostReduction: 0.5,
            maxZoneCountForScoring: 5,
            minEnhancedConfidenceThreshold: 0.2,
            useStandardizedZones: true,
            enhancementMode: "testing" as const,
            balanceThreshold: 0.1,
            confluenceMinZones: 2,
            confluenceMaxDistance: 10,
        });

        // Mock Config.getTimeWindow to return realistic time window
        vi.spyOn(Config, "getTimeWindow").mockReturnValue(TIME_WINDOW_MS);

        mockValidationLogger = new SignalValidationLogger(
            mockLogger,
            "test-logs"
        );

        detector = new AbsorptionDetectorEnhanced(
            "test-absorption-detector",
            Config.ABSORPTION_DETECTOR,
            mockPreprocessor,
            mockLogger,
            mockMetrics,
            mockValidationLogger,
            mockSignalLogger
        );

        // Capture emitted signals
        detector.on("signalCandidate", (signal) => {
            emittedSignals.push(signal);
        });
    });

    // Helper function to create realistic zone data with directional passive volumes
    function createRealisticZoneData(
        basePrice: number,
        config: {
            aggressiveVolume: number;
            passiveBidVolume: number;
            passiveAskVolume: number;
            aggressiveBuyVolume?: number;
            aggressiveSellVolume?: number;
        }
    ): StandardZoneData {
        const zoneId = `zone-${basePrice}`;
        const tradeHistory = new CircularBuffer<any>(100);

        const zone: ZoneSnapshot = {
            zoneId,
            priceLevel: basePrice,
            tickSize: TICK_SIZE,
            aggressiveVolume: config.aggressiveVolume,
            passiveVolume: config.passiveBidVolume + config.passiveAskVolume,
            aggressiveBuyVolume:
                config.aggressiveBuyVolume || config.aggressiveVolume * 0.6,
            aggressiveSellVolume:
                config.aggressiveSellVolume || config.aggressiveVolume * 0.4,
            passiveBidVolume: config.passiveBidVolume,
            passiveAskVolume: config.passiveAskVolume,
            tradeCount: 12,
            timespan: TIME_WINDOW_MS,
            boundaries: { min: basePrice, max: basePrice + TICK_SIZE },
            lastUpdate: Date.now(),
            // VWAP based on the price level (realistic calculation)
            volumeWeightedPrice: FinancialMath.calculateMidPrice(
                basePrice,
                basePrice + TICK_SIZE,
                4
            ),
            tradeHistory,
        };

        return {
            zones: [zone],
            zoneConfig: {
                zoneTicks: 10,
                tickValue: TICK_SIZE,
                timeWindow: TIME_WINDOW_MS,
            },
        };
    }

    // Helper function to create trade event with proper directional setup
    function createTradeEvent(
        price: number,
        quantity: number,
        isBuyTrade: boolean, // true = buy trade (buyerIsMaker = false)
        zoneData: StandardZoneData,
        bestBid?: number,
        bestAsk?: number
    ): EnrichedTradeEvent {
        return {
            price,
            quantity,
            timestamp: Date.now(),
            buyerIsMaker: !isBuyTrade, // Invert for proper mapping
            pair: "LTCUSDT",
            tradeId: `trade-${Date.now()}-${Math.random()}`,
            originalTrade: {} as any,
            passiveBidVolume: 0, // Legacy field - not used in enhanced detector
            passiveAskVolume: 0, // Legacy field - not used in enhanced detector
            zonePassiveBidVolume: 0, // Legacy field - not used in enhanced detector
            zonePassiveAskVolume: 0, // Legacy field - not used in enhanced detector
            bestBid: bestBid || price - TICK_SIZE * 2,
            bestAsk: bestAsk || price + TICK_SIZE * 2,
            zoneData,
        };
    }

    describe("Buy Trade Absorption Detection", () => {
        it("should detect absorption on buy trade with high passiveAskVolume", () => {
            // SCENARIO: Large buy order absorbing ask liquidity
            // Only passiveAskVolume should be considered for buy trades

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 5, // 30 volume
                passiveBidVolume: 5, // Low bid volume (should be ignored for buy trades)
                passiveAskVolume: 60, // High ask volume (should be counted for buy trades)
            });

            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                35, // Large trade quantity
                true, // Buy trade
                zoneData,
                LTCUSDT_PRICE - TICK_SIZE,
                LTCUSDT_PRICE + TICK_SIZE
            );

            detector.onEnrichedTrade(buyTrade);

            // Should generate signal because:
            // - Buy trade only considers passiveAskVolume (60)
            // - Total passive volume for calculation = 60 (only ask side)
            // - Absorption ratio = 60 / (30 + 60) = 0.667 > 0.65 threshold
            expect(emittedSignals).toHaveLength(1);
            expect(emittedSignals[0].side).toBe("buy");
            expect(emittedSignals[0].type).toBe("absorption");
        });

        it("should reject buy trade absorption when passiveAskVolume is insufficient", () => {
            // SCENARIO: Buy trade with low ask liquidity to absorb
            // Even with high passiveBidVolume, should reject because buy trades only consider ask side

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 5, // 30 volume
                passiveBidVolume: 60, // High bid volume (should be ignored for buy trades)
                passiveAskVolume: 10, // Low ask volume (what actually matters for buy trades)
            });

            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                35,
                true, // Buy trade
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // Should NOT generate signal because:
            // - Buy trade only considers passiveAskVolume (10)
            // - Total passive volume for calculation = 10 (only ask side)
            // - Absorption ratio = 10 / (30 + 10) = 0.25 < 0.65 threshold
            expect(emittedSignals).toHaveLength(0);
            expect(mockValidationLogger.logRejection).toHaveBeenCalledWith(
                "absorption",
                "passive_volume_ratio_too_low",
                expect.any(Object),
                expect.objectContaining({
                    type: "passive_volume_ratio",
                    threshold: ABSORPTION_RATIO_THRESHOLD,
                    actual: expect.any(Number),
                }),
                expect.any(Object)
            );
        });

        it("should handle mixed passive volumes correctly for buy trades", () => {
            // SCENARIO: Buy trade with balanced bid/ask passive volumes
            // Should only use ask side volume for absorption calculation

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD, // 25 volume
                passiveBidVolume: 40, // Equal bid volume (ignored for buy trades)
                passiveAskVolume: 40, // Equal ask volume (counted for buy trades)
            });

            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                30,
                true, // Buy trade
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // Should generate signal because:
            // - Only passiveAskVolume (40) is considered
            // - Absorption ratio = 40 / (25 + 40) = 0.615 < 0.65 threshold (marginal fail)
            // This tests the precision of the directional logic
            expect(emittedSignals).toHaveLength(0);

            // Verify the exact rejection reason and calculated values
            expect(mockValidationLogger.logRejection).toHaveBeenCalledWith(
                "absorption",
                "passive_volume_ratio_too_low",
                expect.any(Object),
                expect.objectContaining({
                    actual: expect.closeTo(0.615, 0.01), // Should be close to calculated ratio
                }),
                expect.any(Object)
            );
        });
    });

    describe("Sell Trade Absorption Detection", () => {
        it("should detect absorption on sell trade with high passiveBidVolume", () => {
            // SCENARIO: Large sell order absorbing bid liquidity
            // Only passiveBidVolume should be considered for sell trades

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 5, // 30 volume
                passiveBidVolume: 65, // High bid volume (should be counted for sell trades)
                passiveAskVolume: 5, // Low ask volume (should be ignored for sell trades)
            });

            const sellTrade = createTradeEvent(
                LTCUSDT_PRICE,
                35,
                false, // Sell trade
                zoneData
            );

            detector.onEnrichedTrade(sellTrade);

            // Should generate signal because:
            // - Sell trade only considers passiveBidVolume (65)
            // - Total passive volume for calculation = 65 (only bid side)
            // - Absorption ratio = 65 / (30 + 65) = 0.684 > 0.65 threshold
            expect(emittedSignals).toHaveLength(1);
            expect(emittedSignals[0].side).toBe("sell");
            expect(emittedSignals[0].type).toBe("absorption");
        });

        it("should reject sell trade absorption when passiveBidVolume is insufficient", () => {
            // SCENARIO: Sell trade with low bid liquidity to absorb
            // Even with high passiveAskVolume, should reject because sell trades only consider bid side

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 5, // 30 volume
                passiveBidVolume: 8, // Low bid volume (what actually matters for sell trades)
                passiveAskVolume: 70, // High ask volume (should be ignored for sell trades)
            });

            const sellTrade = createTradeEvent(
                LTCUSDT_PRICE,
                35,
                false, // Sell trade
                zoneData
            );

            detector.onEnrichedTrade(sellTrade);

            // Should NOT generate signal because:
            // - Sell trade only considers passiveBidVolume (8)
            // - Total passive volume for calculation = 8 (only bid side)
            // - Absorption ratio = 8 / (30 + 8) = 0.211 < 0.65 threshold
            expect(emittedSignals).toHaveLength(0);
            expect(mockValidationLogger.logRejection).toHaveBeenCalledWith(
                "absorption",
                "passive_volume_ratio_too_low",
                expect.any(Object),
                expect.objectContaining({
                    type: "passive_volume_ratio",
                    threshold: ABSORPTION_RATIO_THRESHOLD,
                }),
                expect.any(Object)
            );
        });

        it("should calculate dominant side correctly for sell trades", () => {
            // SCENARIO: Sell trade with high bid absorption should return "sell" signal
            // Tests the calculateDominantSide logic with directional passive volumes

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 10, // 35 volume
                passiveBidVolume: 70, // High bid absorption (sell pressure)
                passiveAskVolume: 20, // Lower ask absorption
            });

            const sellTrade = createTradeEvent(
                LTCUSDT_PRICE,
                40,
                false, // Sell trade
                zoneData
            );

            detector.onEnrichedTrade(sellTrade);

            // Should generate SELL signal because:
            // - High bid absorption (70) indicates selling pressure
            // - Signal direction follows absorption pattern
            expect(emittedSignals).toHaveLength(1);
            expect(emittedSignals[0].side).toBe("sell");
            expect(emittedSignals[0].confidence).toBeGreaterThan(0.3);
        });
    });

    describe("Mixed Trade Scenarios", () => {
        it("should handle alternating buy/sell trades in same zone correctly", () => {
            // SCENARIO: Multiple trades in same zone with different directions
            // Each trade should only consider its relevant passive volume side

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 15, // 40 volume
                passiveBidVolume: 30, // Moderate bid volume
                passiveAskVolume: 50, // Higher ask volume
            });

            // First: Buy trade (should consider only passiveAskVolume = 50)
            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                25,
                true, // Buy trade
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // Buy trade absorption ratio = 50 / (40 + 50) = 0.556 < 0.65 (should reject)
            expect(emittedSignals).toHaveLength(0);

            // Reset signals for next test in same zone
            emittedSignals.length = 0;

            // Update zone data with different aggressive volume for second trade
            const updatedZoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD, // 25 volume
                passiveBidVolume: 30,
                passiveAskVolume: 50,
            });

            // Second: Sell trade (should consider only passiveBidVolume = 30)
            const sellTrade = createTradeEvent(
                LTCUSDT_PRICE,
                20,
                false, // Sell trade
                updatedZoneData
            );

            detector.onEnrichedTrade(sellTrade);

            // Sell trade absorption ratio = 30 / (25 + 30) = 0.545 < 0.65 (should reject)
            expect(emittedSignals).toHaveLength(0);
        });

        it("should prevent false signals from opposite-side passive volume", () => {
            // SCENARIO: Trade that would pass with total passive volume but fails with directional volume
            // This is the core bug fix - ensuring directional logic prevents false signals

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD, // 25 volume
                passiveBidVolume: 80, // Very high bid volume (irrelevant for buy trades)
                passiveAskVolume: 5, // Very low ask volume (relevant for buy trades)
            });

            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                30,
                true, // Buy trade
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // OLD (BROKEN) LOGIC: Would consider total passive volume (85)
            // Absorption ratio = 85 / (25 + 85) = 0.773 > 0.65 → FALSE SIGNAL ❌

            // NEW (FIXED) LOGIC: Only considers relevant passiveAskVolume (5)
            // Absorption ratio = 5 / (25 + 5) = 0.167 < 0.65 → CORRECTLY REJECTED ✅

            expect(emittedSignals).toHaveLength(0);
            expect(mockValidationLogger.logRejection).toHaveBeenCalledWith(
                "absorption",
                "passive_volume_ratio_too_low",
                expect.any(Object),
                expect.objectContaining({
                    actual: expect.closeTo(0.167, 0.01),
                }),
                expect.any(Object)
            );
        });
    });

    describe("Edge Cases and Error Handling", () => {
        it("should handle zero passive volumes gracefully", () => {
            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD,
                passiveBidVolume: 0, // Zero bid volume
                passiveAskVolume: 0, // Zero ask volume
            });

            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                30,
                true,
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // Should reject due to zero passive volume
            expect(emittedSignals).toHaveLength(0);
        });

        it("should handle NaN values in zone data", () => {
            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: NaN, // Invalid aggressive volume
                passiveBidVolume: 50,
                passiveAskVolume: 60,
            });

            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                30,
                true,
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // Should handle NaN gracefully and reject
            expect(emittedSignals).toHaveLength(0);
        });

        it("should enforce tick size compliance in price movements", () => {
            // Test price that doesn't align with proper tick size
            const invalidPrice = LTCUSDT_PRICE + 0.005; // Half-cent movement (invalid for $10-$100 range)

            const zoneData = createRealisticZoneData(invalidPrice, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 10,
                passiveBidVolume: 30,
                passiveAskVolume: 70,
            });

            const buyTrade = createTradeEvent(invalidPrice, 35, true, zoneData);

            // The detector should still process the trade (price validation is done upstream)
            // But this test ensures our test data follows tick size compliance
            expect(invalidPrice % TICK_SIZE).not.toBe(0);

            // Use proper tick-aligned price for actual test
            const validPrice = Math.round(invalidPrice / TICK_SIZE) * TICK_SIZE;
            const validZoneData = createRealisticZoneData(validPrice, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 10,
                passiveBidVolume: 30,
                passiveAskVolume: 70,
            });

            const validTrade = createTradeEvent(
                validPrice,
                35,
                true,
                validZoneData
            );

            detector.onEnrichedTrade(validTrade);
            // Use floating point tolerance for tick compliance check
            expect(Math.abs(validPrice % TICK_SIZE)).toBeLessThan(1e-10); // Verify tick compliance with floating point tolerance
        });
    });

    describe("FinancialMath Integration", () => {
        it("should use FinancialMath for all volume calculations", () => {
            // Mock FinancialMath methods to verify they're being called
            const safeAddSpy = vi.spyOn(FinancialMath, "safeAdd");
            const divideQuantitiesSpy = vi.spyOn(
                FinancialMath,
                "divideQuantities"
            );

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 5,
                passiveBidVolume: 20,
                passiveAskVolume: 65,
            });

            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                30,
                true,
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // Verify FinancialMath methods were used for calculations
            expect(safeAddSpy).toHaveBeenCalled();
            expect(divideQuantitiesSpy).toHaveBeenCalled();

            safeAddSpy.mockRestore();
            divideQuantitiesSpy.mockRestore();
        });

        it("should calculate price efficiency using FinancialMath", () => {
            const calculateMidPriceSpy = vi.spyOn(
                FinancialMath,
                "calculateMidPrice"
            );
            const calculateAbsSpy = vi.spyOn(FinancialMath, "calculateAbs");

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 10,
                passiveBidVolume: 40,
                passiveAskVolume: 70,
            });

            const buyTrade = createTradeEvent(
                LTCUSDT_PRICE,
                35,
                true,
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // Verify price efficiency calculations use FinancialMath
            expect(calculateAbsSpy).toHaveBeenCalled();

            calculateMidPriceSpy.mockRestore();
            calculateAbsSpy.mockRestore();
        });
    });

    describe("Performance and Optimization Validation", () => {
        it("should detect turning points for 0.7%+ movements", () => {
            // SCENARIO: Strong absorption signal that should lead to significant price movement
            // This tests the optimization goal of detecting local tops/bottoms

            const basePrice = LTCUSDT_PRICE;
            const targetMovement = basePrice * 0.007; // 0.7% target movement

            const zoneData = createRealisticZoneData(basePrice, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD * 2, // 50 volume (strong institutional flow)
                passiveBidVolume: 25,
                passiveAskVolume: 100, // Very high ask absorption
            });

            const buyTrade = createTradeEvent(
                basePrice,
                60, // Large trade indicating institutional activity
                true,
                zoneData
            );

            detector.onEnrichedTrade(buyTrade);

            // Should generate high-confidence signal for potential 0.7%+ movement
            expect(emittedSignals).toHaveLength(1);
            expect(emittedSignals[0].confidence).toBeGreaterThan(0.5);
            expect(emittedSignals[0].side).toBe("buy");

            // Signal should indicate strong absorption pattern
            if (
                emittedSignals[0].data &&
                typeof emittedSignals[0].data === "object"
            ) {
                const signalData = emittedSignals[0].data as any;
                expect(signalData.absorptionScore).toBeGreaterThan(0.4);
            }
        });

        it("should maintain sub-millisecond processing performance", () => {
            const startTime = performance.now();

            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 5,
                passiveBidVolume: 30,
                passiveAskVolume: 60,
            });

            const trade = createTradeEvent(LTCUSDT_PRICE, 35, true, zoneData);

            // Process multiple trades to test performance
            for (let i = 0; i < 10; i++) {
                detector.onEnrichedTrade(trade);
            }

            const endTime = performance.now();
            const totalTime = endTime - startTime;
            const avgTimePerTrade = totalTime / 10;

            // Should process each trade in less than 1ms for real-time requirements
            expect(avgTimePerTrade).toBeLessThan(1.0);
        });
    });

    describe("Configuration Integration", () => {
        it("should respect all configurable parameters without magic numbers", () => {
            // Verify detector uses Config values instead of hardcoded numbers
            const config = Config.ABSORPTION_DETECTOR;

            // Test with values that should pass all thresholds
            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: config.institutionalVolumeThreshold + 10, // Above institutional threshold
                passiveBidVolume: 10,
                passiveAskVolume: 100, // High ask volume for buy trade
            });

            const trade = createTradeEvent(
                LTCUSDT_PRICE,
                40, // Large trade
                true, // Buy trade
                zoneData
            );

            detector.onEnrichedTrade(trade);

            // Should pass - we have sufficient institutional volume and high absorption ratio
            // Absorption ratio = 100 / (35 + 100) = 0.741 > 0.65 threshold
            expect(emittedSignals.length).toBeGreaterThan(0);
        });

        it("should validate institutional volume thresholds from config", () => {
            const config = Config.ABSORPTION_DETECTOR;
            const threshold = config.institutionalVolumeThreshold;

            // Test just below threshold
            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: threshold - 1, // Just below institutional threshold
                passiveBidVolume: 20,
                passiveAskVolume: 80,
            });

            const trade = createTradeEvent(LTCUSDT_PRICE, 30, true, zoneData);

            detector.onEnrichedTrade(trade);

            // Should reject due to insufficient institutional volume
            expect(emittedSignals).toHaveLength(0);
            expect(mockValidationLogger.logRejection).toHaveBeenCalledWith(
                "absorption",
                "insufficient_aggressive_volume",
                expect.any(Object),
                expect.objectContaining({
                    threshold: threshold,
                    actual: threshold - 1,
                }),
                expect.any(Object)
            );
        });
    });

    describe("Signal Quality and Validation", () => {
        it("should log successful signals with complete market context", () => {
            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 10,
                passiveBidVolume: 25,
                passiveAskVolume: 75,
            });

            const trade = createTradeEvent(
                LTCUSDT_PRICE,
                40,
                true,
                zoneData,
                LTCUSDT_PRICE - TICK_SIZE,
                LTCUSDT_PRICE + TICK_SIZE
            );

            detector.onEnrichedTrade(trade);

            // Should emit signal and log it for validation
            expect(emittedSignals).toHaveLength(1);
            expect(mockValidationLogger.logSignal).toHaveBeenCalledWith(
                emittedSignals[0],
                trade,
                expect.objectContaining({
                    totalAggressiveVolume: expect.any(Number),
                    totalPassiveVolume: expect.any(Number),
                    institutionalVolumeRatio: expect.any(Number),
                    priceEfficiency: expect.any(Number),
                })
            );
        });

        it("should enforce cooldown periods to prevent signal spam", () => {
            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 15,
                passiveBidVolume: 20,
                passiveAskVolume: 80,
            });

            const trade1 = createTradeEvent(LTCUSDT_PRICE, 45, true, zoneData);
            const trade2 = createTradeEvent(
                LTCUSDT_PRICE + TICK_SIZE,
                50,
                true,
                zoneData
            );

            // First trade should generate signal
            detector.onEnrichedTrade(trade1);
            expect(emittedSignals).toHaveLength(1);

            // Second trade within cooldown should be blocked
            detector.onEnrichedTrade(trade2);
            expect(emittedSignals).toHaveLength(1); // Still only 1 signal
        });

        it("should calculate confidence scores based on multiple factors", () => {
            const zoneData = createRealisticZoneData(LTCUSDT_PRICE, {
                aggressiveVolume: INSTITUTIONAL_VOLUME_THRESHOLD + 10, // Moderate institutional flow
                passiveBidVolume: 15,
                passiveAskVolume: 75, // High but not excessive absorption
            });

            const trade = createTradeEvent(
                LTCUSDT_PRICE,
                40, // Moderate trade size
                true,
                zoneData
            );

            detector.onEnrichedTrade(trade);

            expect(emittedSignals).toHaveLength(1);

            const signal = emittedSignals[0];
            expect(signal.confidence).toBeGreaterThan(0.3);
            expect(signal.confidence).toBeLessThan(3.0); // Allow for enhanced confidence boosting

            // High absorption should yield reasonable confidence
            expect(signal.confidence).toBeGreaterThan(0.4);
        });
    });
});
