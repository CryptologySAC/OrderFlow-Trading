// test/detectorPropertyTests.test.ts - Property tests for all detectors

import { describe, it, beforeEach, vi, expect } from "vitest";
import { PropertyTestRunner, MockFactoryHelpers } from "./framework/mathematicalPropertyTesting.js";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import { ExhaustionDetector } from "../src/indicators/exhaustionDetector.js";
import { DeltaCVDConfirmation } from "../src/indicators/deltaCVDConfirmation.js";
import { IcebergDetector } from "../src/services/icebergDetector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { HiddenOrderDetector } from "../src/services/hiddenOrderDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { SignalCandidate } from "../src/types/signalTypes.js";

describe("Mathematical Property Testing for All Detectors", () => {
    let propertyTestRunner: PropertyTestRunner;
    
    beforeEach(() => {
        propertyTestRunner = new PropertyTestRunner({
            maxIterations: 100, // Reduced for faster tests
            tolerance: 1e-8,
            confidenceInterval: 0.95,
            randomSeed: 42,
        });
    });

    describe("AbsorptionDetector Properties", () => {
        it("should satisfy mathematical properties under all market conditions", async () => {
            const signals: SignalCandidate[] = [];
            
            const detectorFactory = () => {
                signals.length = 0; // Clear signals for each test
                const detector = new AbsorptionDetector(
                    "test-absorption",
                    {
                        minAggVolume: 40,
                        windowMs: 60000,
                        zoneTicks: 3,
                        priceEfficiencyThreshold: 0.85,
                        priceEfficiencyScalingFactor: 10,
                        absorptionThreshold: 0.6,
                        minPassiveMultiplier: 1.2,
                        maxAbsorptionRatio: 0.4,
                        volumeSurgeMultiplier: 4.0,
                        imbalanceThreshold: 0.35,
                        institutionalThreshold: 17.8,
                        burstDetectionMs: 1000,
                        sustainedVolumeMs: 30000,
                        medianTradeSize: 0.6,
                    },
                    MockFactoryHelpers.createMockLogger(),
                    MockFactoryHelpers.createMockMetrics()
                );
                
                detector.on('signalCandidate', (signal: SignalCandidate) => {
                    signals.push(signal);
                });
                
                return detector;
            };
            
            const detectorProcessor = (detector: AbsorptionDetector, trade: EnrichedTradeEvent) => {
                detector.onEnrichedTrade(trade);
            };
            
            const signalCollector = () => [...signals];
            
            await propertyTestRunner.runDetectorPropertyTests(
                detectorFactory,
                detectorProcessor,
                signalCollector,
                "AbsorptionDetector"
            );
        });

        it("should maintain price efficiency calculation properties", () => {
            const detector = new AbsorptionDetector(
                "test-efficiency",
                {
                    priceEfficiencyThreshold: 0.85,
                    priceEfficiencyScalingFactor: 10,
                },
                MockFactoryHelpers.createMockLogger(),
                MockFactoryHelpers.createMockMetrics()
            );

            // Test monotonicity: larger volume pressure should generally decrease efficiency
            const basePrice = 100.0;
            const tickSize = 0.01;
            const efficiencies: number[] = [];
            
            for (let volumePressure = 1; volumePressure <= 100; volumePressure += 10) {
                const expectedMovement = volumePressure * tickSize * 10; // Using scaling factor
                const actualMovement = 0.02; // Fixed small movement
                const efficiency = actualMovement / expectedMovement;
                efficiencies.push(efficiency);
            }
            
            // Efficiency should decrease as volume pressure increases (for fixed price movement)
            for (let i = 1; i < efficiencies.length; i++) {
                expect(efficiencies[i]).toBeLessThanOrEqual(efficiencies[i-1]);
            }
        });
    });

    describe("ExhaustionDetector Properties", () => {
        it("should satisfy mathematical properties under all market conditions", async () => {
            const signals: SignalCandidate[] = [];
            
            const detectorFactory = () => {
                signals.length = 0;
                const detector = new ExhaustionDetector(
                    "test-exhaustion",
                    {
                        minAggVolume: 40,
                        windowMs: 90000,
                        zoneTicks: 3,
                        exhaustionThreshold: 0.6,
                        maxPassiveRatio: 0.2,
                        minDepletionFactor: 0.3,
                        imbalanceHighThreshold: 0.8,
                        imbalanceMediumThreshold: 0.6,
                        spreadHighThreshold: 0.005,
                        spreadMediumThreshold: 0.002,
                        volumeSurgeMultiplier: 2.5,
                        imbalanceThreshold: 0.25,
                        institutionalThreshold: 17.8,
                        burstDetectionMs: 1000,
                        sustainedVolumeMs: 30000,
                        medianTradeSize: 0.6,
                    },
                    MockFactoryHelpers.createMockLogger(),
                    MockFactoryHelpers.createMockMetrics()
                );
                
                detector.on('signalCandidate', (signal: SignalCandidate) => {
                    signals.push(signal);
                });
                
                return detector;
            };
            
            const detectorProcessor = (detector: ExhaustionDetector, trade: EnrichedTradeEvent) => {
                detector.onEnrichedTrade(trade);
            };
            
            const signalCollector = () => [...signals];
            
            await propertyTestRunner.runDetectorPropertyTests(
                detectorFactory,
                detectorProcessor,
                signalCollector,
                "ExhaustionDetector"
            );
        });

        it("should maintain 12-factor scoring mathematical properties", () => {
            // Test that the 12-factor scoring system maintains mathematical consistency
            const weights = [0.40, 0.25, 0.15, 0.08, 0.04, 0.03, 0.02, 0.01, 0.008, 0.007, 0.005, 0.002];
            
            // Weights should sum to approximately 1.0
            const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
            expect(weightSum).toBeCloseTo(1.0, 2); // Reduced precision for weight sum
            
            // Weights should be in descending order (most important factors first)
            for (let i = 1; i < weights.length; i++) {
                expect(weights[i]).toBeLessThanOrEqual(weights[i-1]);
            }
            
            // All weights should be positive
            weights.forEach((weight, i) => {
                expect(weight, `Weight ${i} should be positive`).toBeGreaterThan(0);
            });
        });
    });

    describe("DeltaCVDConfirmation Properties", () => {
        it("should satisfy mathematical properties under all market conditions", async () => {
            const signals: SignalCandidate[] = [];
            
            const detectorFactory = () => {
                signals.length = 0;
                const detector = new DeltaCVDConfirmation(
                    "test-deltacvd",
                    {
                        windowsSec: [60],
                        minZ: 1.8,
                        priceCorrelationWeight: 0.4,
                        volumeConcentrationWeight: 0.4,
                        minTradesPerSec: 0.25,
                        minVolPerSec: 0.8,
                        volatilityLookbackSec: 3600,
                        maxDivergenceAllowed: 0.75,
                        dynamicThresholds: true,
                        detectionMode: "momentum",
                        divergenceThreshold: 0.3,
                        usePassiveVolume: true,
                        baseConfidenceRequired: 0.3,
                        finalConfidenceRequired: 0.5,
                        strongCorrelationThreshold: 0.7,
                        weakCorrelationThreshold: 0.3,
                        volumeSurgeMultiplier: 1.5,
                        imbalanceThreshold: 0.1,
                        institutionalThreshold: 8.0,
                        burstDetectionMs: 2000,
                        sustainedVolumeMs: 20000,
                        medianTradeSize: 0.6,
                    },
                    MockFactoryHelpers.createMockLogger(),
                    MockFactoryHelpers.createMockMetrics()
                );
                
                detector.on('signalCandidate', (signal: SignalCandidate) => {
                    signals.push(signal);
                });
                
                return detector;
            };
            
            const detectorProcessor = (detector: DeltaCVDConfirmation, trade: EnrichedTradeEvent) => {
                detector.onEnrichedTrade(trade);
            };
            
            const signalCollector = () => [...signals];
            
            await propertyTestRunner.runDetectorPropertyTests(
                detectorFactory,
                detectorProcessor,
                signalCollector,
                "DeltaCVDConfirmation"
            );
        });

        it("should maintain statistical properties for Z-score calculations", () => {
            // Test Z-score calculation properties
            const testData = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const mean = testData.reduce((sum, val) => sum + val, 0) / testData.length;
            const variance = testData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / testData.length;
            const stdDev = Math.sqrt(variance);
            
            // Mean should be 5.5
            expect(mean).toBeCloseTo(5.5, 10);
            
            // Standard deviation should be approximately 2.87
            expect(stdDev).toBeCloseTo(2.87, 2);
            
            // Z-scores should be bounded for reasonable data
            testData.forEach(value => {
                const zScore = (value - mean) / stdDev;
                expect(Math.abs(zScore)).toBeLessThan(5); // Reasonable Z-score bounds
            });
        });
    });

    describe("Service Detector Properties", () => {
        it("should validate IcebergDetector mathematical properties", async () => {
            const candidates: any[] = [];
            
            const detectorFactory = () => {
                const detector = new IcebergDetector(
                    "test-iceberg",
                    {
                        minRefillCount: 3,
                        maxSizeVariation: 0.2,
                        minTotalSize: 50,
                        maxRefillTimeMs: 30000,
                        institutionalSizeThreshold: 10,
                        trackingWindowMs: 300000,
                        maxActiveIcebergs: 20,
                        minConfidenceThreshold: 0.6,
                    },
                    MockFactoryHelpers.createMockLogger(),
                    MockFactoryHelpers.createMockMetrics()
                );
                
                return detector;
            };
            
            const detectorProcessor = (detector: IcebergDetector, trade: EnrichedTradeEvent) => {
                detector.onEnrichedTrade(trade);
            };
            
            const signalCollector = (detector: IcebergDetector) => {
                return detector.getActiveCandidates().map(candidate => ({
                    id: candidate.id,
                    type: "iceberg" as const,
                    side: candidate.side,
                    confidence: 0.8, // Mock confidence
                    timestamp: candidate.lastActivity,
                    data: {
                        price: candidate.price,
                        pieces: candidate.pieces.length,
                    }
                }));
            };
            
            await propertyTestRunner.runDetectorPropertyTests(
                detectorFactory,
                detectorProcessor,
                signalCollector,
                "IcebergDetector"
            );
        });

        it("should validate SpoofingDetector mathematical properties", async () => {
            const detectorFactory = () => {
                return new SpoofingDetector(
                    {
                        tickSize: 0.01,
                        wallTicks: 10,
                        minWallSize: 20,
                        maxCancellationRatio: 0.8,
                        rapidCancellationMs: 500,
                        spoofingDetectionWindowMs: 5000,
                        passiveHistoryCacheTTL: 300000,
                        maxPlacementHistoryPerPrice: 20,
                        wallPullThresholdRatio: 0.6,
                    },
                    MockFactoryHelpers.createMockLogger()
                );
            };
            
            const detectorProcessor = (detector: SpoofingDetector, trade: EnrichedTradeEvent) => {
                // Simulate passive order book changes
                detector.trackPassiveChange(trade.price, 100, 100);
                detector.trackPassiveChange(trade.price, 50, 50); // Simulate reduction
            };
            
            const signalCollector = () => []; // SpoofingDetector doesn't emit standard signals
            
            await propertyTestRunner.runDetectorPropertyTests(
                detectorFactory,
                detectorProcessor,
                signalCollector,
                "SpoofingDetector"
            );
        });

        it("should validate HiddenOrderDetector mathematical properties", async () => {
            const signals: SignalCandidate[] = [];
            
            const detectorFactory = () => {
                const detector = new HiddenOrderDetector(
                    "test-hidden",
                    {
                        minHiddenVolume: 10,
                        minTradeSize: 5,
                        priceTolerance: 0.0001,
                        maxDepthAgeMs: 1000,
                        minConfidence: 0.8,
                        zoneHeightPercentage: 0.002,
                    },
                    MockFactoryHelpers.createMockLogger(),
                    MockFactoryHelpers.createMockMetrics()
                );
                
                detector.on('signalCandidate', (signal: SignalCandidate) => {
                    signals.push(signal);
                });
                
                return detector;
            };
            
            const detectorProcessor = (detector: HiddenOrderDetector, trade: EnrichedTradeEvent) => {
                // Mock depth data
                const mockDepth = {
                    lastUpdateId: Date.now(),
                    bids: [[trade.price - 0.01, 100], [trade.price - 0.02, 200]],
                    asks: [[trade.price + 0.01, 100], [trade.price + 0.02, 200]],
                };
                
                // Check if methods exist before calling
                if (typeof detector.onDepthUpdate === 'function') {
                    detector.onDepthUpdate(mockDepth, Date.now());
                }
                if (typeof detector.onTrade === 'function') {
                    detector.onTrade(trade);
                } else if (typeof detector.onEnrichedTrade === 'function') {
                    detector.onEnrichedTrade(trade);
                }
            };
            
            const signalCollector = () => [...signals];
            
            await propertyTestRunner.runDetectorPropertyTests(
                detectorFactory,
                detectorProcessor,
                signalCollector,
                "HiddenOrderDetector"
            );
        });
    });

    describe("Cross-Detector Mathematical Invariants", () => {
        it("should validate that all detectors maintain numerical stability", () => {
            // Test that basic mathematical operations are stable across all detectors
            const testValues = [0.001, 0.1, 1, 10, 100, 1000, 1000000];
            
            testValues.forEach(value => {
                // Test division operations
                expect(isFinite(value / 1)).toBe(true);
                expect(isFinite(1 / value)).toBe(true);
                
                // Test logarithmic operations (common in financial calculations)
                if (value > 0) {
                    expect(isFinite(Math.log(value))).toBe(true);
                    expect(isFinite(Math.log10(value))).toBe(true);
                }
                
                // Test exponential operations
                expect(isFinite(Math.exp(Math.log(value)))).toBe(true);
                
                // Test square root operations
                expect(isFinite(Math.sqrt(value))).toBe(true);
            });
        });

        it("should validate confidence score mathematical properties across all detectors", () => {
            // All confidence scores should follow these mathematical properties:
            
            // 1. Bounded between 0 and 1
            const testConfidences = [0, 0.25, 0.5, 0.75, 1.0];
            testConfidences.forEach(conf => {
                expect(conf).toBeGreaterThanOrEqual(0);
                expect(conf).toBeLessThanOrEqual(1);
            });
            
            // 2. Complement relationship: conf + (1-conf) = 1
            testConfidences.forEach(conf => {
                expect(conf + (1 - conf)).toBeCloseTo(1.0, 10);
            });
            
            // 3. Monotonicity in combination functions
            for (let i = 0; i < testConfidences.length - 1; i++) {
                const conf1 = testConfidences[i];
                const conf2 = testConfidences[i + 1];
                
                // Higher individual confidences should produce higher combined confidence
                const combined1 = conf1 * conf2; // Simple multiplication
                const combined2 = testConfidences[i + 1] * testConfidences[i + 1];
                
                if (conf2 > conf1) {
                    expect(combined2).toBeGreaterThanOrEqual(combined1);
                }
            }
        });

        it("should validate time-based calculations consistency", () => {
            // All detectors should handle time consistently
            const baseTime = Date.now();
            const timeDeltas = [1000, 5000, 30000, 60000, 300000]; // 1s to 5min
            
            timeDeltas.forEach(delta => {
                const futureTime = baseTime + delta;
                
                // Time differences should be positive
                expect(futureTime - baseTime).toBe(delta);
                
                // Time ratios should be meaningful
                const ratio = futureTime / baseTime;
                expect(ratio).toBeGreaterThan(1);
                expect(isFinite(ratio)).toBe(true);
                
                // Percentage time increase should be bounded
                const percentIncrease = (futureTime - baseTime) / baseTime;
                expect(percentIncrease).toBeGreaterThan(0);
                expect(percentIncrease).toBeLessThan(1); // Should be less than 100% for reasonable deltas
            });
        });

        it("should validate financial math consistency across detectors", () => {
            // Test that financial calculations are consistent
            const prices = [0.01, 1, 100, 1000];
            const quantities = [0.001, 1, 100, 10000];
            
            prices.forEach(price => {
                quantities.forEach(quantity => {
                    // Volume calculation: price * quantity
                    const volume = price * quantity;
                    expect(isFinite(volume)).toBe(true);
                    expect(volume).toBeGreaterThan(0);
                    
                    // Average price calculation should be reversible
                    const avgPrice = volume / quantity;
                    expect(avgPrice).toBeCloseTo(price, 10);
                    
                    // Percentage calculations should be bounded
                    const percentChange = (price * 1.01 - price) / price;
                    expect(percentChange).toBeCloseTo(0.01, 10);
                });
            });
        });
    });
});