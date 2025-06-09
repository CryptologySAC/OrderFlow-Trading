// test/detectors_supportResistanceDetector_comprehensive.test.ts
import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";
import { SupportResistanceDetector } from "../src/indicators/supportResistanceDetector.js";
import { Logger } from "../src/infrastructure/logger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { SupportResistanceSignalData } from "../src/types/signalTypes.js";

describe("SupportResistanceDetector - Comprehensive Signal Testing", () => {
    let detector: SupportResistanceDetector;
    let mockCallback: MockedFunction<
        (signal: SupportResistanceSignalData) => void
    >;
    let mockLogger: Logger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;

    const BTCUSDT_PRICE = 50000;
    const PRICE_PRECISION = 2;
    const TICK_SIZE = 0.01;

    beforeEach(() => {
        // Create mocks
        mockCallback = vi.fn();
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as any;
        mockMetrics = {
            incrementMetric: vi.fn(),
            updateMetric: vi.fn(),
            recordHistogram: vi.fn(),
            recordGauge: vi.fn(),
        } as any;
        mockSpoofing = {
            checkWallSpoofing: vi.fn().mockReturnValue(false),
            getWallDetectionMetrics: vi.fn().mockReturnValue({}),
        } as any;

        // Create detector with realistic settings for support/resistance
        detector = new SupportResistanceDetector(
            "test-support-resistance",
            mockCallback,
            {
                priceTolerancePercent: 0.02, // 2% tolerance for testing
                minTouchCount: 3, // Minimum 3 touches to confirm level
                minStrength: 0.5, // 50% minimum strength to emit signal
                timeWindowMs: 300000, // 5 minutes for testing
                volumeWeightFactor: 0.3, // Volume impact on strength
                rejectionConfirmationTicks: 3, // Ticks to confirm rejection
            },
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    describe("Realistic Support Level Scenarios - Should Generate Signals", () => {
        it("should detect strong support level with multiple bounces", () => {
            const supportLevel = BTCUSDT_PRICE - 500; // $49,500 support
            const timestamp = Date.now();
            const tolerance = supportLevel * 0.015; // 1.5% tolerance zone

            // Scenario: Strong support with 4 clear bounces over time
            const supportTrades = [
                // First touch and bounce (1 hour ago)
                ...generateSupportTouch(supportLevel, tolerance, {
                    startTime: timestamp - 240000,
                    touchDuration: 20000,
                    bounceStrength: 0.8,
                    volume: 150,
                    rejectionTicks: 5,
                }),

                // Second touch and bounce (45 minutes ago)
                ...generateSupportTouch(supportLevel, tolerance, {
                    startTime: timestamp - 180000,
                    touchDuration: 15000,
                    bounceStrength: 0.75,
                    volume: 120,
                    rejectionTicks: 4,
                }),

                // Third touch and bounce (30 minutes ago)
                ...generateSupportTouch(supportLevel, tolerance, {
                    startTime: timestamp - 120000,
                    touchDuration: 18000,
                    bounceStrength: 0.9,
                    volume: 200,
                    rejectionTicks: 6,
                }),

                // Fourth touch and strong bounce (recent)
                ...generateSupportTouch(supportLevel, tolerance, {
                    startTime: timestamp - 60000,
                    touchDuration: 12000,
                    bounceStrength: 0.95,
                    volume: 250,
                    rejectionTicks: 8,
                }),
            ];

            // Process all touches
            supportTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: SupportResistanceSignalData =
                mockCallback.mock.calls[0][0];

            expect(signal.levelType).toBe("support");
            expect(signal.price).toBeCloseTo(supportLevel, 0);
            expect(signal.strength).toBeGreaterThan(0.5);
            expect(signal.touchCount).toBeGreaterThanOrEqual(3);
            expect(signal.confidence).toBeGreaterThan(0.6);
        });

        it("should detect resistance level with multiple rejections", () => {
            const resistanceLevel = BTCUSDT_PRICE + 1000; // $51,000 resistance
            const timestamp = Date.now();
            const tolerance = resistanceLevel * 0.012; // 1.2% tolerance

            // Scenario: Strong resistance with multiple failed breakout attempts
            const resistanceTrades = [
                // First rejection (2 hours ago)
                ...generateResistanceTouch(resistanceLevel, tolerance, {
                    startTime: timestamp - 300000,
                    touchDuration: 25000,
                    rejectionStrength: 0.85,
                    volume: 180,
                    rejectionTicks: 7,
                }),

                // Second rejection (1.5 hours ago)
                ...generateResistanceTouch(resistanceLevel, tolerance, {
                    startTime: timestamp - 240000,
                    touchDuration: 20000,
                    rejectionStrength: 0.75,
                    volume: 160,
                    rejectionTicks: 5,
                }),

                // Third rejection (1 hour ago)
                ...generateResistanceTouch(resistanceLevel, tolerance, {
                    startTime: timestamp - 180000,
                    touchDuration: 30000,
                    rejectionStrength: 0.9,
                    volume: 220,
                    rejectionTicks: 8,
                }),

                // Fourth rejection with high volume (recent)
                ...generateResistanceTouch(resistanceLevel, tolerance, {
                    startTime: timestamp - 90000,
                    touchDuration: 15000,
                    rejectionStrength: 0.95,
                    volume: 300,
                    rejectionTicks: 10,
                }),
            ];

            resistanceTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: SupportResistanceSignalData =
                mockCallback.mock.calls[0][0];

            expect(signal.levelType).toBe("resistance");
            expect(signal.price).toBeCloseTo(resistanceLevel, 0);
            expect(signal.strength).toBeGreaterThan(0.5);
            expect(signal.touchCount).toBeGreaterThanOrEqual(3);
            expect(signal.confidence).toBeGreaterThan(0.6);
        });

        it("should detect psychological support at round number", () => {
            const psychologicalLevel = 50000; // Exact round number
            const timestamp = Date.now();
            const tolerance = psychologicalLevel * 0.008; // Tight 0.8% tolerance for psychological levels

            // Psychological support typically has very precise reactions
            const psychologicalTrades = [
                // Touch 1: Precise bounce
                ...generatePsychologicalLevelTouch(
                    psychologicalLevel,
                    tolerance,
                    {
                        startTime: timestamp - 200000,
                        touchType: "support",
                        precision: 0.95, // Very precise reactions
                        volume: 400, // High volume at psychological levels
                        bounceStrength: 0.9,
                    }
                ),

                // Touch 2: Another precise bounce
                ...generatePsychologicalLevelTouch(
                    psychologicalLevel,
                    tolerance,
                    {
                        startTime: timestamp - 150000,
                        touchType: "support",
                        precision: 0.92,
                        volume: 350,
                        bounceStrength: 0.85,
                    }
                ),

                // Touch 3: Strong institutional support
                ...generatePsychologicalLevelTouch(
                    psychologicalLevel,
                    tolerance,
                    {
                        startTime: timestamp - 100000,
                        touchType: "support",
                        precision: 0.98,
                        volume: 500, // Very high volume
                        bounceStrength: 0.95,
                    }
                ),
            ];

            psychologicalTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: SupportResistanceSignalData =
                mockCallback.mock.calls[0][0];

            expect(signal.levelType).toBe("support");
            expect(signal.price).toBeCloseTo(psychologicalLevel, 1);
            expect(signal.strength).toBeGreaterThan(0.7); // Psychological levels are typically strong
            expect(signal.isPsychological).toBe(true);
        });

        it("should detect support level with increasing strength over time", () => {
            const supportLevel = BTCUSDT_PRICE - 1200; // $48,800
            const timestamp = Date.now();
            const tolerance = supportLevel * 0.018;

            // Support gets stronger with each test
            const strengtheningTrades = [
                // Weak initial support
                ...generateSupportTouch(supportLevel, tolerance, {
                    startTime: timestamp - 280000,
                    touchDuration: 30000,
                    bounceStrength: 0.6, // Weak initial bounce
                    volume: 80,
                    rejectionTicks: 2,
                }),

                // Stronger second test
                ...generateSupportTouch(supportLevel, tolerance, {
                    startTime: timestamp - 200000,
                    touchDuration: 25000,
                    bounceStrength: 0.75, // Stronger
                    volume: 120,
                    rejectionTicks: 4,
                }),

                // Strong third test
                ...generateSupportTouch(supportLevel, tolerance, {
                    startTime: timestamp - 120000,
                    touchDuration: 20000,
                    bounceStrength: 0.85, // Strong
                    volume: 180,
                    rejectionTicks: 6,
                }),

                // Very strong final test
                ...generateSupportTouch(supportLevel, tolerance, {
                    startTime: timestamp - 60000,
                    touchDuration: 15000,
                    bounceStrength: 0.95, // Very strong
                    volume: 280,
                    rejectionTicks: 9,
                }),
            ];

            strengtheningTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: SupportResistanceSignalData =
                mockCallback.mock.calls[0][0];

            expect(signal.strength).toBeGreaterThan(0.7); // Should be strong due to strengthening pattern
            expect(signal.strengthTrend).toBe("strengthening");
        });

        it("should detect resistance with volume confirmation", () => {
            const resistanceLevel = BTCUSDT_PRICE + 750;
            const timestamp = Date.now();
            const tolerance = resistanceLevel * 0.015;

            // High-volume resistance rejections
            const volumeConfirmedTrades = [
                // High volume rejection 1
                ...generateVolumeConfirmedLevel(resistanceLevel, tolerance, {
                    startTime: timestamp - 250000,
                    levelType: "resistance",
                    baseVolume: 500, // High base volume
                    volumeSpike: 2.5, // 2.5x volume spike on rejection
                    rejectionStrength: 0.8,
                }),

                // Even higher volume rejection 2
                ...generateVolumeConfirmedLevel(resistanceLevel, tolerance, {
                    startTime: timestamp - 180000,
                    levelType: "resistance",
                    baseVolume: 600,
                    volumeSpike: 3.0, // 3x volume spike
                    rejectionStrength: 0.9,
                }),

                // Massive volume rejection 3
                ...generateVolumeConfirmedLevel(resistanceLevel, tolerance, {
                    startTime: timestamp - 100000,
                    levelType: "resistance",
                    baseVolume: 400,
                    volumeSpike: 4.0, // 4x volume spike
                    rejectionStrength: 0.95,
                }),
            ];

            volumeConfirmedTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: SupportResistanceSignalData =
                mockCallback.mock.calls[0][0];

            expect(signal.levelType).toBe("resistance");
            expect(signal.volumeConfirmation).toBeGreaterThan(0.7); // High volume confirmation
            expect(signal.strength).toBeGreaterThan(0.7);
        });
    });

    describe("Realistic Non-Support/Resistance Scenarios - Should NOT Generate Signals", () => {
        it("should NOT signal with insufficient touches", () => {
            const level = BTCUSDT_PRICE + 300;
            const timestamp = Date.now();
            const tolerance = level * 0.01;

            // Only 2 touches (below minimum of 3)
            const insufficientTouches = [
                ...generateSupportTouch(level, tolerance, {
                    startTime: timestamp - 150000,
                    touchDuration: 20000,
                    bounceStrength: 0.8,
                    volume: 150,
                    rejectionTicks: 4,
                }),

                ...generateSupportTouch(level, tolerance, {
                    startTime: timestamp - 80000,
                    touchDuration: 18000,
                    bounceStrength: 0.75,
                    volume: 130,
                    rejectionTicks: 3,
                }),
            ];

            insufficientTouches.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal when level is broken decisively", () => {
            const brokenLevel = BTCUSDT_PRICE - 800;
            const timestamp = Date.now();
            const tolerance = brokenLevel * 0.01;

            // Initial support touches
            const supportTouches = [
                ...generateSupportTouch(brokenLevel, tolerance, {
                    startTime: timestamp - 200000,
                    touchDuration: 15000,
                    bounceStrength: 0.8,
                    volume: 120,
                    rejectionTicks: 4,
                }),

                ...generateSupportTouch(brokenLevel, tolerance, {
                    startTime: timestamp - 150000,
                    touchDuration: 12000,
                    bounceStrength: 0.75,
                    volume: 100,
                    rejectionTicks: 3,
                }),
            ];

            // Decisive break of the level
            const breakTrades = generateLevelBreak(brokenLevel, {
                startTime: timestamp - 80000,
                breakDirection: "down", // Support broken
                breakStrength: 0.9,
                breakVolume: 300,
                priceTarget: brokenLevel - brokenLevel * 0.03, // 3% break
            });

            [...supportTouches, ...breakTrades].forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal with weak bounces/rejections", () => {
            const weakLevel = BTCUSDT_PRICE + 450;
            const timestamp = Date.now();
            const tolerance = weakLevel * 0.02;

            // Multiple touches but very weak reactions
            const weakTrades = [
                ...generateSupportTouch(weakLevel, tolerance, {
                    startTime: timestamp - 180000,
                    touchDuration: 25000,
                    bounceStrength: 0.3, // Very weak bounce
                    volume: 50,
                    rejectionTicks: 1,
                }),

                ...generateSupportTouch(weakLevel, tolerance, {
                    startTime: timestamp - 120000,
                    touchDuration: 30000,
                    bounceStrength: 0.25, // Even weaker
                    volume: 45,
                    rejectionTicks: 1,
                }),

                ...generateSupportTouch(weakLevel, tolerance, {
                    startTime: timestamp - 70000,
                    touchDuration: 35000,
                    bounceStrength: 0.2, // Extremely weak
                    volume: 40,
                    rejectionTicks: 0, // No real rejection
                }),
            ];

            weakTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should not signal due to weak strength
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal with touches too far apart in time", () => {
            const staleLevel = BTCUSDT_PRICE - 600;
            const timestamp = Date.now();
            const tolerance = staleLevel * 0.015;

            // Touches spread over too long a time period
            const staleTrades = [
                // Very old touch (outside time window)
                ...generateSupportTouch(staleLevel, tolerance, {
                    startTime: timestamp - 400000, // 6.67 minutes ago (outside 5-minute window)
                    touchDuration: 15000,
                    bounceStrength: 0.8,
                    volume: 120,
                    rejectionTicks: 4,
                }),

                // Recent touches
                ...generateSupportTouch(staleLevel, tolerance, {
                    startTime: timestamp - 120000,
                    touchDuration: 12000,
                    bounceStrength: 0.75,
                    volume: 110,
                    rejectionTicks: 3,
                }),

                ...generateSupportTouch(staleLevel, tolerance, {
                    startTime: timestamp - 60000,
                    touchDuration: 10000,
                    bounceStrength: 0.8,
                    volume: 130,
                    rejectionTicks: 5,
                }),
            ];

            staleTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should not have enough valid touches within time window
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal during ranging/choppy market", () => {
            const choppyCenter = BTCUSDT_PRICE;
            const timestamp = Date.now();
            const choppyRange = choppyCenter * 0.025; // 2.5% choppy range

            // Random price action without clear levels
            const choppyTrades = generateChoppyMarket(
                choppyCenter,
                choppyRange,
                {
                    startTime: timestamp - 250000,
                    duration: 250000,
                    tradeCount: 60,
                    volumeRange: [30, 120],
                }
            );

            choppyTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should not detect any clear levels in choppy market
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it("should NOT signal with low volume confirmation", () => {
            const lowVolumeLevel = BTCUSDT_PRICE + 900;
            const timestamp = Date.now();
            const tolerance = lowVolumeLevel * 0.01;

            // Good price action but very low volume
            const lowVolumeTrades = [
                ...generateSupportTouch(lowVolumeLevel, tolerance, {
                    startTime: timestamp - 180000,
                    touchDuration: 20000,
                    bounceStrength: 0.8,
                    volume: 15, // Very low volume
                    rejectionTicks: 4,
                }),

                ...generateSupportTouch(lowVolumeLevel, tolerance, {
                    startTime: timestamp - 120000,
                    touchDuration: 18000,
                    bounceStrength: 0.75,
                    volume: 12, // Very low volume
                    rejectionTicks: 3,
                }),

                ...generateSupportTouch(lowVolumeLevel, tolerance, {
                    startTime: timestamp - 60000,
                    touchDuration: 15000,
                    bounceStrength: 0.85,
                    volume: 18, // Very low volume
                    rejectionTicks: 5,
                }),
            ];

            lowVolumeTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Should not signal due to low volume confirmation
            expect(mockCallback).not.toHaveBeenCalled();
        });
    });

    describe("Edge Cases and Complex Scenarios", () => {
        it("should handle false breakouts and level re-establishment", () => {
            const level = BTCUSDT_PRICE + 200;
            const timestamp = Date.now();
            const tolerance = level * 0.015;

            // Initial level establishment
            const initialTouches = [
                ...generateSupportTouch(level, tolerance, {
                    startTime: timestamp - 280000,
                    touchDuration: 15000,
                    bounceStrength: 0.8,
                    volume: 130,
                    rejectionTicks: 4,
                }),

                ...generateSupportTouch(level, tolerance, {
                    startTime: timestamp - 220000,
                    touchDuration: 12000,
                    bounceStrength: 0.75,
                    volume: 120,
                    rejectionTicks: 3,
                }),
            ];

            // False breakout (quick recovery)
            const falseBreakout = [
                // Brief break below
                createEnrichedTrade(
                    level - level * 0.02,
                    80,
                    true,
                    timestamp - 150000
                ),
                createEnrichedTrade(
                    level - level * 0.025,
                    60,
                    true,
                    timestamp - 148000
                ),

                // Quick recovery back above level
                createEnrichedTrade(
                    level - level * 0.01,
                    100,
                    false,
                    timestamp - 145000
                ),
                createEnrichedTrade(
                    level + level * 0.005,
                    120,
                    false,
                    timestamp - 142000
                ),
            ];

            // Re-establishment of level
            const reestablishment = [
                ...generateSupportTouch(level, tolerance, {
                    startTime: timestamp - 100000,
                    touchDuration: 18000,
                    bounceStrength: 0.85, // Stronger after false breakout
                    volume: 180,
                    rejectionTicks: 6,
                }),
            ];

            [...initialTouches, ...falseBreakout, ...reestablishment].forEach(
                (trade) => {
                    detector.onEnrichedTrade(trade);
                }
            );

            expect(mockCallback).toHaveBeenCalled();
            const signal: SupportResistanceSignalData =
                mockCallback.mock.calls[0][0];
            expect(signal.hasFalseBreakouts).toBe(true);
        });

        it("should detect levels with varying tolerance precision", () => {
            const preciseLevel = 50250; // Non-round number requiring precision
            const timestamp = Date.now();
            const tightTolerance = preciseLevel * 0.003; // Very tight 0.3% tolerance

            const preciseTrades = [
                // Very precise touches
                ...generateSupportTouch(preciseLevel, tightTolerance, {
                    startTime: timestamp - 200000,
                    touchDuration: 10000,
                    bounceStrength: 0.9,
                    volume: 200,
                    rejectionTicks: 6,
                }),

                ...generateSupportTouch(preciseLevel, tightTolerance, {
                    startTime: timestamp - 140000,
                    touchDuration: 8000,
                    bounceStrength: 0.85,
                    volume: 180,
                    rejectionTicks: 5,
                }),

                ...generateSupportTouch(preciseLevel, tightTolerance, {
                    startTime: timestamp - 80000,
                    touchDuration: 12000,
                    bounceStrength: 0.95,
                    volume: 220,
                    rejectionTicks: 7,
                }),
            ];

            preciseTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            expect(mockCallback).toHaveBeenCalled();
            const signal: SupportResistanceSignalData =
                mockCallback.mock.calls[0][0];
            expect(signal.precision).toBeGreaterThan(0.8); // High precision
        });
    });

    // Helper functions for generating realistic test data
    function generateSupportTouch(
        level: number,
        tolerance: number,
        config: {
            startTime: number;
            touchDuration: number;
            bounceStrength: number;
            volume: number;
            rejectionTicks: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const touchCount = 8 + Math.floor(config.touchDuration / 2000); // More trades for longer touches

        for (let i = 0; i < touchCount; i++) {
            const progress = i / (touchCount - 1);
            const timestamp =
                config.startTime + progress * config.touchDuration;

            // Price movement: approach level, touch it, then bounce
            let price;
            if (progress < 0.3) {
                // Approaching support
                price = level - tolerance + (progress / 0.3) * tolerance * 2;
            } else if (progress < 0.6) {
                // At support level (with some variance)
                price = level + (Math.random() - 0.5) * tolerance * 0.5;
            } else {
                // Bouncing up from support
                const bounceProgress = (progress - 0.6) / 0.4;
                price =
                    level +
                    bounceProgress * config.bounceStrength * tolerance * 2;
            }

            // Volume higher at the actual touch
            const volumeMultiplier = progress > 0.3 && progress < 0.6 ? 1.5 : 1;
            const volume =
                config.volume * volumeMultiplier * (0.8 + Math.random() * 0.4);

            // More selling pressure approaching support, more buying during bounce
            const isSell =
                progress < 0.5 ? Math.random() < 0.7 : Math.random() < 0.3;

            trades.push(createEnrichedTrade(price, volume, isSell, timestamp));
        }

        return trades;
    }

    function generateResistanceTouch(
        level: number,
        tolerance: number,
        config: {
            startTime: number;
            touchDuration: number;
            rejectionStrength: number;
            volume: number;
            rejectionTicks: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const touchCount = 8 + Math.floor(config.touchDuration / 2000);

        for (let i = 0; i < touchCount; i++) {
            const progress = i / (touchCount - 1);
            const timestamp =
                config.startTime + progress * config.touchDuration;

            // Price movement: approach resistance, touch it, then get rejected
            let price;
            if (progress < 0.3) {
                // Approaching resistance from below
                price = level - tolerance + (progress / 0.3) * tolerance * 2;
            } else if (progress < 0.6) {
                // At resistance level (with attempts to break)
                price = level + (Math.random() - 0.3) * tolerance * 0.7; // Slight bias to try breaking above
            } else {
                // Getting rejected back down
                const rejectionProgress = (progress - 0.6) / 0.4;
                price =
                    level -
                    rejectionProgress *
                        config.rejectionStrength *
                        tolerance *
                        2;
            }

            // Volume spikes at resistance tests
            const volumeMultiplier = progress > 0.3 && progress < 0.6 ? 1.8 : 1;
            const volume =
                config.volume * volumeMultiplier * (0.8 + Math.random() * 0.4);

            // More buying pressure approaching resistance, more selling during rejection
            const isBuy =
                progress < 0.5 ? Math.random() < 0.7 : Math.random() < 0.3;

            trades.push(createEnrichedTrade(price, volume, !isBuy, timestamp));
        }

        return trades;
    }

    function generatePsychologicalLevelTouch(
        level: number,
        tolerance: number,
        config: {
            startTime: number;
            touchType: "support" | "resistance";
            precision: number;
            volume: number;
            bounceStrength: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const touchCount = 6; // Fewer, more precise touches for psychological levels

        for (let i = 0; i < touchCount; i++) {
            const progress = i / (touchCount - 1);
            const timestamp = config.startTime + progress * 15000; // 15 second touches

            // Very precise price reactions at psychological levels
            const precisionFactor = config.precision;
            let price;

            if (config.touchType === "support") {
                if (progress < 0.4) {
                    price =
                        level -
                        tolerance * (1 - progress / 0.4) * precisionFactor;
                } else {
                    const bounceProgress = (progress - 0.4) / 0.6;
                    price =
                        level +
                        bounceProgress * config.bounceStrength * tolerance;
                }
            } else {
                // resistance
                if (progress < 0.4) {
                    price = level - tolerance + (progress / 0.4) * tolerance;
                } else {
                    const rejectionProgress = (progress - 0.4) / 0.6;
                    price =
                        level -
                        rejectionProgress * config.bounceStrength * tolerance;
                }
            }

            // High volume at psychological levels
            const volume = config.volume * (0.9 + Math.random() * 0.2);
            const isAggressiveSell =
                config.touchType === "support"
                    ? progress < 0.4
                        ? Math.random() < 0.8
                        : Math.random() < 0.2
                    : progress < 0.4
                      ? Math.random() < 0.2
                      : Math.random() < 0.8;

            trades.push(
                createEnrichedTrade(price, volume, isAggressiveSell, timestamp)
            );
        }

        return trades;
    }

    function generateVolumeConfirmedLevel(
        level: number,
        tolerance: number,
        config: {
            startTime: number;
            levelType: "support" | "resistance";
            baseVolume: number;
            volumeSpike: number;
            rejectionStrength: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const touchCount = 10;

        for (let i = 0; i < touchCount; i++) {
            const progress = i / (touchCount - 1);
            const timestamp = config.startTime + progress * 20000;

            // Price at level with reaction
            const isAtLevel = progress > 0.3 && progress < 0.7;
            let price;

            if (config.levelType === "support") {
                price = isAtLevel
                    ? level + (Math.random() - 0.5) * tolerance * 0.3
                    : level +
                      (progress > 0.7
                          ? ((progress - 0.7) / 0.3) *
                            config.rejectionStrength *
                            tolerance
                          : -(1 - progress / 0.3) * tolerance);
            } else {
                price = isAtLevel
                    ? level + (Math.random() - 0.5) * tolerance * 0.3
                    : level -
                      (progress > 0.7
                          ? ((progress - 0.7) / 0.3) *
                            config.rejectionStrength *
                            tolerance
                          : (1 - progress / 0.3) * tolerance);
            }

            // Volume spike during level test
            const volume = isAtLevel
                ? config.baseVolume *
                  config.volumeSpike *
                  (0.8 + Math.random() * 0.4)
                : config.baseVolume * (0.6 + Math.random() * 0.8);

            const isSell =
                config.levelType === "support"
                    ? isAtLevel
                        ? Math.random() < 0.7
                        : Math.random() < 0.3
                    : isAtLevel
                      ? Math.random() < 0.3
                      : Math.random() < 0.7;

            trades.push(createEnrichedTrade(price, volume, isSell, timestamp));
        }

        return trades;
    }

    function generateLevelBreak(
        level: number,
        config: {
            startTime: number;
            breakDirection: "up" | "down";
            breakStrength: number;
            breakVolume: number;
            priceTarget: number;
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const breakCount = 12;

        for (let i = 0; i < breakCount; i++) {
            const progress = i / (breakCount - 1);
            const timestamp = config.startTime + progress * 25000;

            // Progressive break through level
            const breakProgress = Math.pow(progress, 0.7); // Accelerating break
            const price = level + (config.priceTarget - level) * breakProgress;

            // High volume during break
            const volume =
                config.breakVolume *
                (0.8 + Math.random() * 0.4) *
                (progress > 0.2 ? 1.5 : 1); // Volume spike after initial break

            // Direction matches break
            const isSell =
                config.breakDirection === "down"
                    ? Math.random() < 0.8
                    : Math.random() < 0.2;

            trades.push(createEnrichedTrade(price, volume, isSell, timestamp));
        }

        return trades;
    }

    function generateChoppyMarket(
        center: number,
        range: number,
        config: {
            startTime: number;
            duration: number;
            tradeCount: number;
            volumeRange: [number, number];
        }
    ): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];
        const timeStep = config.duration / config.tradeCount;
        let currentPrice = center;

        for (let i = 0; i < config.tradeCount; i++) {
            const timestamp = config.startTime + i * timeStep;

            // Random walk within range
            const priceChange = (Math.random() - 0.5) * range * 0.2;
            currentPrice = Math.max(
                center - range / 2,
                Math.min(center + range / 2, currentPrice + priceChange)
            );

            const volume =
                config.volumeRange[0] +
                Math.random() * (config.volumeRange[1] - config.volumeRange[0]);
            const isSell = Math.random() < 0.5; // Random direction

            trades.push(
                createEnrichedTrade(currentPrice, volume, isSell, timestamp)
            );
        }

        return trades;
    }

    function createEnrichedTrade(
        price: number,
        quantity: number,
        buyerIsMaker: boolean,
        timestamp: number
    ): EnrichedTradeEvent {
        return {
            tradeId: `trade-${timestamp}-${Math.random()}`,
            symbol: "BTCUSDT",
            price,
            quantity,
            timestamp,
            buyerIsMaker,

            // Enriched fields
            zonePassiveBidVolume: buyerIsMaker ? quantity * 0.8 : 100,
            zonePassiveAskVolume: !buyerIsMaker ? quantity * 0.8 : 100,

            // Additional required fields
            isBuyerMaker: buyerIsMaker,
            firstTradeId: `first-${timestamp}`,
            lastTradeId: `last-${timestamp}`,
            count: 1,
        };
    }
});
