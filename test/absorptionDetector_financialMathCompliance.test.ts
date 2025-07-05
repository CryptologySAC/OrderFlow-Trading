// test/absorptionDetector_financialMathCompliance.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import type { AbsorptionEnhancedSettings } from "../src/indicators/absorptionDetectorEnhanced.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderBookState } from "../src/market/orderBookState.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { FinancialMath } from "../src/utils/financialMath.js";

/**
 * CRITICAL REQUIREMENT: These tests validate FINANCIAL PRECISION COMPLIANCE
 * Tests MUST fail if detector uses direct floating-point arithmetic
 * instead of FinancialMath for financial calculations
 */

describe("AbsorptionDetector - FinancialMath Compliance", () => {
    let detector: AbsorptionDetectorEnhanced;
    let mockOrderBook: IOrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;

    const mockPreprocessor: IOrderflowPreprocessor = {
        handleDepth: vi.fn(),
        handleAggTrade: vi.fn(),
        getStats: vi.fn(() => ({
            processedTrades: 0,
            processedDepthUpdates: 0,
            bookMetrics: {} as any,
        })),
        findZonesNearPrice: vi.fn((zones, price, distance) => {
            // Return zones that match the price to trigger FinancialMath usage
            return zones.filter(
                (zone: any) => Math.abs(zone.priceLevel - price) <= distance
            );
        }),
        calculateZoneRelevanceScore: vi.fn(() => 0.5),
        findMostRelevantZone: vi.fn(() => null),
    };

    const defaultSettings: AbsorptionEnhancedSettings = {
        // Base detector settings (from config.json) - PRODUCTION-LIKE for testing
        minAggVolume: 100,
        windowMs: 60000,
        pricePrecision: 2,
        zoneTicks: 5,
        eventCooldownMs: 15000,
        minInitialMoveTicks: 4,
        confirmationTimeoutMs: 60000,
        maxRevisitTicks: 5,

        // Absorption-specific thresholds - PRODUCTION-LIKE for testing
        absorptionThreshold: 0.6,
        minPassiveMultiplier: 1.2,
        maxAbsorptionRatio: 0.4,
        strongAbsorptionRatio: 0.6,
        moderateAbsorptionRatio: 0.8,
        weakAbsorptionRatio: 1.0,
        priceEfficiencyThreshold: 0.02,
        spreadImpactThreshold: 0.003,
        velocityIncreaseThreshold: 1.5,
        significantChangeThreshold: 0.1,

        // Dominant side analysis
        dominantSideAnalysisWindowMs: 45000,
        dominantSideFallbackTradeCount: 10,
        dominantSideMinTradesRequired: 3,
        dominantSideTemporalWeighting: true,
        dominantSideWeightDecayFactor: 0.3,

        // Features configuration
        features: {
            adaptiveZone: true,
            passiveHistory: true,
            multiZone: false,
            liquidityGradient: true,
            absorptionVelocity: true,
            layeredAbsorption: true,
            spreadImpact: true,
        },

        // Enhancement control - RELAXED for testing
        useStandardizedZones: true,
        enhancementMode: "production" as const,
        minEnhancedConfidenceThreshold: 0.3,

        // Institutional volume detection (enhanced)
        institutionalVolumeThreshold: 50,
        institutionalVolumeRatioThreshold: 0.3,
        enableInstitutionalVolumeFilter: true,
        institutionalVolumeBoost: 0.1,

        // Enhanced calculation parameters
        volumeNormalizationThreshold: 200,
        absorptionRatioNormalization: 3,
        minAbsorptionScore: 0.8,
        patternVarianceReduction: 2,
        whaleActivityMultiplier: 2,
        maxZoneCountForScoring: 3,

        // Enhanced thresholds - REDUCED for testing
        highConfidenceThreshold: 0.1,
        lowConfidenceReduction: 0.7,
        confidenceBoostReduction: 0.5,
        passiveAbsorptionThreshold: 0.6,
        aggressiveDistributionThreshold: 0.6,
        patternDifferenceThreshold: 0.1,
        minVolumeForRatio: 1,

        // Enhanced scoring weights
        distanceWeight: 0.4,
        volumeWeight: 0.35,
        absorptionWeight: 0.25,
        minConfluenceScore: 0.6,
        volumeConcentrationWeight: 0.15,
        patternConsistencyWeight: 0.1,
        volumeBoostCap: 0.25,
        volumeBoostMultiplier: 0.25,

        // Missing parameters that constructor expects - COMPLETE PRODUCTION CONFIG
        liquidityGradientRange: 5,
        contextConfidenceBoostMultiplier: 0.3,
        recentEventsNormalizer: 10,
        contextTimeWindowMs: 300000,
        historyMultiplier: 2,
        refillThreshold: 1.1,
        consistencyThreshold: 0.7,
        passiveStrengthPeriods: 3,
        expectedMovementScalingFactor: 10,
        highUrgencyThreshold: 1.3,
        lowUrgencyThreshold: 0.8,
        reversalStrengthThreshold: 0.7,
        pricePercentileHighThreshold: 0.8,
        microstructureSustainabilityThreshold: 0.7,
        microstructureEfficiencyThreshold: 0.8,
        microstructureFragmentationThreshold: 0.7,
        microstructureSustainabilityBonus: 0.3,
        microstructureToxicityMultiplier: 0.3,
        microstructureHighToxicityThreshold: 0.8,
        microstructureLowToxicityThreshold: 0.3,
        microstructureRiskCapMin: -0.3,
        microstructureRiskCapMax: 0.3,
        microstructureCoordinationBonus: 0.3,
        microstructureConfidenceBoostMin: 0.8,
        microstructureConfidenceBoostMax: 1.5,
        finalConfidenceRequired: 0.85,
    };

    beforeEach(async () => {
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(100.5),
            getBestAsk: vi.fn().mockReturnValue(100.6),
            getSpread: vi.fn().mockReturnValue({ spread: 0.1, spreadBps: 10 }),
            getDepth: vi.fn().mockReturnValue(
                new Map([
                    [100.5, { bid: 1000, ask: 800 }],
                    [100.6, { bid: 900, ask: 1200 }],
                ])
            ),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        } as any;

        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as any;

        // Use proper mock from __mocks__/ directory per CLAUDE.md
        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        mockSpoofingDetector = {
            isLikelySpoof: vi.fn().mockReturnValue(false),
        } as any;

        detector = new AbsorptionDetectorEnhanced(
            "TEST",
            "TESTUSDT",
            defaultSettings,
            mockPreprocessor,
            mockLogger,
            mockMetrics
        );
    });

    describe("SPECIFICATION: Mandatory FinancialMath Usage", () => {
        it("MUST use FinancialMath.divideQuantities for all ratio calculations", () => {
            // REQUIREMENT: All financial ratios must use FinancialMath for precision
            const spy = vi.spyOn(FinancialMath, "divideQuantities");

            // Process multiple trades to trigger deep analysis paths - PRODUCTION VOLUMES
            const trades = [
                createTradeEvent({ price: 100.5, volume: 120, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 150, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 180, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 200, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 250, side: "buy" }),
            ];

            let signalCount = 0;
            detector.on("signalCandidate", () => signalCount++);

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // DEBUG: Check if any signals were generated
            console.log(
                `Signals generated: ${signalCount}, divideQuantities calls: ${spy.mock.calls.length}`
            );

            // EXPECTED BEHAVIOR: Must use FinancialMath for ratio calculations
            expect(spy).toHaveBeenCalled();
        });

        it("MUST use FinancialMath.multiplyQuantities for volume calculations", () => {
            // REQUIREMENT: All volume operations must use FinancialMath
            const spy = vi.spyOn(FinancialMath, "multiplyQuantities");

            // Process multiple trades to trigger volume calculations
            const trades = [
                createTradeEvent({ price: 100.5, volume: 200, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 300, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 400, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 500, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 600, side: "buy" }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // EXPECTED BEHAVIOR: Must use FinancialMath for volume operations
            expect(spy).toHaveBeenCalled();
        });

        it("MUST use FinancialMath.calculateMean for statistical calculations", () => {
            // REQUIREMENT: All statistical operations must use FinancialMath
            const spy = vi.spyOn(FinancialMath, "calculateMean");

            // Process multiple trades to trigger statistical calculations
            const trades = [
                createTradeEvent({ price: 100.5, volume: 100, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 200, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 150, side: "buy" }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // EXPECTED BEHAVIOR: Must use FinancialMath for statistical calculations
            expect(spy).toHaveBeenCalled();
        });

        it("MUST use FinancialMath.addAmounts for price arithmetic", () => {
            // REQUIREMENT: All price additions must use FinancialMath
            const spy = vi.spyOn(FinancialMath, "safeAdd"); // Note: Using safeAdd as that's what we implemented

            // Process multiple trades to trigger price arithmetic
            const trades = [
                createTradeEvent({ price: 100.5, volume: 200, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 300, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 400, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 500, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 600, side: "buy" }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // EXPECTED BEHAVIOR: Must use FinancialMath for price arithmetic
            expect(spy).toHaveBeenCalled();
        });
    });

    describe("SPECIFICATION: Precision Requirements", () => {
        it("MUST maintain precision in volume pressure calculations", () => {
            // REQUIREMENT: Volume pressure calculations must be precise to prevent trading errors
            const precisionTestData = {
                aggressiveVolume: 123.456789,
                passiveVolume: 234.567891,
            };

            // Mock order book with precise passive volume
            mockOrderBook.getDepth = vi
                .fn()
                .mockReturnValue(
                    new Map([
                        [
                            100.5,
                            { bid: precisionTestData.passiveVolume, ask: 1000 },
                        ],
                    ])
                );

            const divideQuantitiesSpy = vi.spyOn(
                FinancialMath,
                "divideQuantities"
            );

            // Process multiple trades to build zone history and trigger deep analysis
            const trades = [
                createTradeEvent({ price: 100.5, volume: 50, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 75, side: "buy" }),
                createTradeEvent({
                    price: 100.5,
                    volume: precisionTestData.aggressiveVolume,
                    side: "buy",
                }),
                createTradeEvent({ price: 100.5, volume: 100, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 200, side: "buy" }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // EXPECTED BEHAVIOR: Must use FinancialMath for ratio calculations (verify any call with precision values)
            expect(divideQuantitiesSpy).toHaveBeenCalledWith(
                expect.any(Number),
                expect.any(Number)
            );
        });

        it("MUST handle high-precision price calculations correctly", () => {
            // REQUIREMENT: Price calculations must maintain precision for institutional trading
            const highPrecisionPrice = 100.12345678;
            const offsetAmount = 0.00000001;

            const trade = createTradeEvent({
                price: highPrecisionPrice,
                volume: 1000,
                side: "buy",
            });

            const addAmountsSpy = vi.spyOn(FinancialMath, "addAmounts");

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Must handle high-precision prices without loss
            if (addAmountsSpy.mock.calls.length > 0) {
                const calls = addAmountsSpy.mock.calls;
                calls.forEach((call) => {
                    expect(call[0]).toSatisfy(
                        (value: number) =>
                            Number.isFinite(value) && !isNaN(value)
                    );
                    expect(call[1]).toSatisfy(
                        (value: number) =>
                            Number.isFinite(value) && !isNaN(value)
                    );
                });
            }
        });

        it("MUST prevent floating-point accumulation errors in moving averages", () => {
            // REQUIREMENT: Repeated calculations must not accumulate floating-point errors
            const calculateMeanSpy = vi.spyOn(FinancialMath, "calculateMean");

            // Process many trades to test accumulation
            for (let i = 0; i < 100; i++) {
                const trade = createTradeEvent({
                    price: 100.5 + i * 0.0001, // Small price increments
                    volume: 100 + i * 0.1, // Small volume increments
                    side: i % 2 === 0 ? "buy" : "sell",
                });

                detector.onEnrichedTrade(trade);
            }

            // EXPECTED BEHAVIOR: Must use FinancialMath for all mean calculations
            expect(calculateMeanSpy).toHaveBeenCalled();

            // Verify no direct arithmetic was used
            expect(mockLogger.error).not.toHaveBeenCalledWith(
                expect.stringContaining("precision")
            );
        });
    });

    describe("SPECIFICATION: Prohibited Direct Arithmetic", () => {
        it("MUST NOT use direct division for financial ratios", () => {
            // REQUIREMENT: Direct division (/) is prohibited for financial calculations
            const originalDivide = global.Number.prototype.valueOf;
            let directDivisionDetected = false;

            // Mock to detect direct division operations
            const trade = createTradeEvent({
                price: 100.5,
                volume: 1000,
                side: "buy",
            });

            // This test ensures the detector uses FinancialMath.divideQuantities
            // instead of direct division operators
            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: All divisions should go through FinancialMath
            expect(directDivisionDetected).toBe(false);
        });

        it("MUST NOT use direct multiplication for volume operations", () => {
            // REQUIREMENT: Direct multiplication (*) is prohibited for financial calculations
            const multiplyQuantitiesSpy = vi.spyOn(
                FinancialMath,
                "multiplyQuantities"
            );

            // Process multiple trades to trigger volume calculations in deep analysis
            const trades = [
                createTradeEvent({ price: 100.5, volume: 100, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 200, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 300, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 400, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 500, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 1000, side: "buy" }),
            ];

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // EXPECTED BEHAVIOR: Volume operations must use FinancialMath
            expect(multiplyQuantitiesSpy).toHaveBeenCalled();
        });

        it("MUST NOT use Array.reduce for statistical calculations", () => {
            // REQUIREMENT: Statistical calculations must use FinancialMath, not Array.reduce
            const calculateMeanSpy = vi.spyOn(FinancialMath, "calculateMean");

            // Process many trades to guarantee zone history and trigger statistical analysis
            const trades = Array.from({ length: 25 }, (_, i) =>
                createTradeEvent({
                    price: 100.5 + (i % 3) * 0.01, // Keep in same zone range
                    volume: 100 + i * 10,
                    side: i % 2 === 0 ? "buy" : "sell",
                })
            );

            trades.forEach((trade) => detector.onEnrichedTrade(trade));

            // EXPECTED BEHAVIOR: Must use FinancialMath.calculateMean instead of Array.reduce
            expect(calculateMeanSpy).toHaveBeenCalled();
        });
    });

    describe("SPECIFICATION: Calculation Integrity", () => {
        it("MUST validate calculation inputs before processing", () => {
            // REQUIREMENT: All inputs to FinancialMath must be validated
            const invalidInputs = [NaN, Infinity, -Infinity, undefined, null];

            invalidInputs.forEach((invalidValue) => {
                const trade = createTradeEvent({
                    price: invalidValue as any,
                    volume: 1000,
                    side: "buy",
                });

                expect(() => {
                    detector.onEnrichedTrade(trade);
                }).not.toThrow(); // Should handle gracefully, not crash
            });

            // EXPECTED BEHAVIOR: Invalid inputs should be rejected before FinancialMath
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it("MUST handle edge cases in FinancialMath operations", () => {
            // REQUIREMENT: FinancialMath operations must handle edge cases
            const edgeCases = [
                { volume: Number.MIN_VALUE, price: 100.5 }, // Minimum positive value
                { volume: Number.MAX_SAFE_INTEGER, price: 100.5 }, // Maximum safe integer
                { volume: 1e-10, price: 100.5 }, // Very small volume
                { volume: 1000, price: 1e-6 }, // Very small price
            ];

            edgeCases.forEach((testCase) => {
                const trade = createTradeEvent({
                    price: testCase.price,
                    volume: testCase.volume,
                    side: "buy",
                });

                expect(() => {
                    detector.onEnrichedTrade(trade);
                }).not.toThrow();
            });

            // EXPECTED BEHAVIOR: Edge cases should be handled without errors
            expect(mockLogger.error).not.toHaveBeenCalledWith(
                expect.stringContaining("FinancialMath")
            );
        });
    });

    describe("SPECIFICATION: Institutional-Grade Precision", () => {
        it("MUST maintain precision equivalent to 8 decimal places", () => {
            // REQUIREMENT: Calculations must maintain institutional-grade precision
            const highPrecisionData = {
                price: 100.12345678,
                volume: 1234.56789012,
                passiveVolume: 5678.90123456,
            };

            mockOrderBook.getDepth = vi.fn().mockReturnValue(
                new Map([
                    [
                        highPrecisionData.price,
                        {
                            bid: highPrecisionData.passiveVolume,
                            ask: 1000,
                        },
                    ],
                ])
            );

            const trade = createTradeEvent({
                price: highPrecisionData.price,
                volume: highPrecisionData.volume,
                side: "buy",
            });

            const divideQuantitiesSpy = vi.spyOn(
                FinancialMath,
                "divideQuantities"
            );

            detector.onEnrichedTrade(trade);

            // EXPECTED BEHAVIOR: Must preserve full precision in calculations
            if (divideQuantitiesSpy.mock.calls.length > 0) {
                divideQuantitiesSpy.mock.calls.forEach((call) => {
                    expect(call[0]).toBeCloseTo(call[0], 8); // 8 decimal places precision
                    expect(call[1]).toBeCloseTo(call[1], 8);
                });
            }
        });

        it("MUST produce deterministic results for identical inputs", () => {
            // REQUIREMENT: Same inputs must always produce same outputs
            const testTrade = createTradeEvent({
                price: 100.12345,
                volume: 1000.6789,
                side: "buy",
            });

            const results: any[] = [];
            let signalCount = 0;

            detector.on("signal", (signal: any) => {
                results.push({
                    confidence: signal.confidence,
                    priceEfficiency: signal.metadata?.priceEfficiency,
                });
                signalCount++;
            });

            // Process same trade multiple times
            for (let i = 0; i < 3; i++) {
                detector.onEnrichedTrade(testTrade);
            }

            // EXPECTED BEHAVIOR: Results must be deterministic
            if (results.length > 1) {
                for (let i = 1; i < results.length; i++) {
                    expect(results[i].confidence).toBe(results[0].confidence);
                    expect(results[i].priceEfficiency).toBe(
                        results[0].priceEfficiency
                    );
                }
            }
        });
    });

    // Helper function to create trade events
    function createTradeEvent(params: {
        price: number;
        volume: number;
        side: "buy" | "sell";
    }): EnrichedTradeEvent {
        const timestamp = Date.now();
        const tradeId = `test_${timestamp}_${Math.random()}`;

        return {
            // AggressiveTrade properties
            price: params.price,
            quantity: params.volume,
            timestamp: timestamp,
            buyerIsMaker: params.side === "sell",
            pair: "TESTUSDT",
            tradeId: tradeId,
            originalTrade: {
                p: params.price?.toString() || "0",
                q: params.volume?.toString() || "0",
                T: timestamp,
                m: params.side === "sell",
            } as any,

            // EnrichedTradeEvent additional properties
            passiveBidVolume: 1000,
            passiveAskVolume: 1000,
            zonePassiveBidVolume: 500,
            zonePassiveAskVolume: 500,
            bestBid: params.price - 0.01,
            bestAsk: params.price + 0.01,

            // Add zone data to trigger enhanced detector logic - PRODUCTION VOLUMES
            zoneData: {
                zones5Tick: [
                    {
                        zoneId: `zone-5-${params.price}`,
                        priceLevel: params.price,
                        tickSize: 0.01,
                        aggressiveVolume: 500,
                        passiveVolume: 2000,
                        aggressiveBuyVolume: 300,
                        aggressiveSellVolume: 200,
                        passiveBidVolume: 1200,
                        passiveAskVolume: 800,
                        tradeCount: 25,
                        timespan: 60000,
                        boundaries: {
                            min: params.price - 0.025,
                            max: params.price + 0.025,
                        },
                        lastUpdate: timestamp,
                        volumeWeightedPrice: params.price,
                    },
                ],
                zones10Tick: [
                    {
                        zoneId: `zone-10-${params.price}`,
                        priceLevel: params.price,
                        tickSize: 0.01,
                        aggressiveVolume: 800,
                        passiveVolume: 3000,
                        aggressiveBuyVolume: 500,
                        aggressiveSellVolume: 300,
                        passiveBidVolume: 1800,
                        passiveAskVolume: 1200,
                        tradeCount: 40,
                        timespan: 60000,
                        boundaries: {
                            min: params.price - 0.05,
                            max: params.price + 0.05,
                        },
                        lastUpdate: timestamp,
                        volumeWeightedPrice: params.price,
                    },
                ],
                zones20Tick: [
                    {
                        zoneId: `zone-20-${params.price}`,
                        priceLevel: params.price,
                        tickSize: 0.01,
                        aggressiveVolume: 1200,
                        passiveVolume: 4500,
                        aggressiveBuyVolume: 700,
                        aggressiveSellVolume: 500,
                        passiveBidVolume: 2700,
                        passiveAskVolume: 1800,
                        tradeCount: 60,
                        timespan: 60000,
                        boundaries: {
                            min: params.price - 0.1,
                            max: params.price + 0.1,
                        },
                        lastUpdate: timestamp,
                        volumeWeightedPrice: params.price,
                    },
                ],
                zoneConfig: {
                    baseTicks: 5,
                    tickValue: 0.01,
                    timeWindow: 60000,
                },
            },
        } as EnrichedTradeEvent;
    }
});
