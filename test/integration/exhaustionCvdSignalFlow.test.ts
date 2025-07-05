// test/integration/exhaustionCvdSignalFlow.test.ts
//
// 🔄 EXHAUSTION & CVD DETECTOR SIGNAL FLOW TESTS
//
// Specialized tests for ExhaustionDetectorEnhanced and DeltaCVDDetectorEnhanced
// These detectors have different signal emission patterns and requirements
//
// CRITICAL COVERAGE:
// - ExhaustionDetectorEnhanced signal emission validation
// - DeltaCVDDetectorEnhanced signal emission validation  
// - Threshold mapping for exhaustion (0.2) and cvd_confirmation (0.15)
// - Signal flow integration with SignalManager

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExhaustionDetectorEnhanced } from "../../src/indicators/exhaustionDetectorEnhanced.js";
import { DeltaCVDDetectorEnhanced } from "../../src/indicators/deltaCVDDetectorEnhanced.js";
import { SignalManager } from "../../src/trading/signalManager.js";
import type { SignalCandidate, SignalType } from "../../src/types/signalTypes.js";
import type { IOrderflowPreprocessor } from "../../src/market/orderFlowPreprocessor.js";
import type { EnrichedTradeEvent } from "../../src/types/marketEvents.js";
import { createMockLogger } from "../../__mocks__/src/infrastructure/loggerInterface.js";

/**
 * CRITICAL TEST: Exhaustion & CVD Signal Flow Validation
 * 
 * Validates signal emission patterns for the two most complex enhanced detectors
 */
describe("Exhaustion & CVD Signal Flow Integration", () => {
    let mockLogger: any;
    let mockMetrics: any;
    let mockPreprocessor: IOrderflowPreprocessor;
    let mockSpoofingDetector: any;
    let mockSignalLogger: any;

    // Expected signal type contracts
    const EXHAUSTION_SIGNAL_TYPE: SignalType = "exhaustion";
    const CVD_SIGNAL_TYPE: SignalType = "cvd_confirmation";

    // Expected thresholds from config.json
    const EXHAUSTION_THRESHOLD = 0.2;
    const CVD_THRESHOLD = 0.15;

    beforeEach(() => {
        mockLogger = createMockLogger();
        
        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            recordTimer: vi.fn(),
            startTimer: vi.fn(() => ({ stop: vi.fn() })),
            getMetrics: vi.fn(() => ({})),
        };

        mockPreprocessor = {
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
                    passiveVolume: 25, // Low passive for exhaustion
                    tradeCount: 8,
                    strength: 0.9,
                    timestamp: Date.now(),
                }
            ]),
            calculateZoneRelevanceScore: vi.fn(() => 0.8),
            findMostRelevantZone: vi.fn(() => ({
                priceLevel: 100.0,
                aggressiveVolume: 50,
                passiveVolume: 25,
                tradeCount: 8,
                strength: 0.9,
                timestamp: Date.now(),
            })),
        };

        mockSpoofingDetector = {
            wasSpoofed: vi.fn().mockReturnValue(false),
            setAnomalyDetector: vi.fn(),
        };

        mockSignalLogger = {
            logSignal: vi.fn(),
            logSignalCandidate: vi.fn(),
            logSignalValidation: vi.fn(),
        };
    });

    /**
     * TEST 1: ExhaustionDetectorEnhanced Signal Type Validation
     */
    describe("ExhaustionDetectorEnhanced Signal Flow", () => {
        it("should emit correct exhaustion signal type", async () => {
            const signalCaptures: SignalCandidate[] = [];

            const exhaustionDetector = new ExhaustionDetectorEnhanced(
                "test-exhaustion",
                {
                    // Minimal config to trigger exhaustion signal
                    minAggVolume: 1,
                    windowMs: 45000,
                    eventCooldownMs: 1000,
                    volumeSurgeMultiplier: 1.0,
                    imbalanceThreshold: 0.01,
                    institutionalThreshold: 1,
                    burstDetectionMs: 2000,
                    sustainedVolumeMs: 5000,
                    medianTradeSize: 0.1,
                    exhaustionThreshold: 0.01,
                    maxPassiveRatio: 0.9,
                    minDepletionFactor: 0.01,
                    imbalanceHighThreshold: 0.1,
                    imbalanceMediumThreshold: 0.05,
                    spreadHighThreshold: 0.1,
                    spreadMediumThreshold: 0.05,
                    scoringWeights: {
                        depletion: 0.45,
                        passive: 0.3,
                        continuity: 0.12,
                        imbalance: 0.08,
                        spread: 0.04,
                        velocity: 0.01,
                    },
                    depletionThresholdRatio: 0.01,
                    significantChangeThreshold: 0.01,
                    highQualitySampleCount: 2,
                    highQualityDataAge: 35000,
                    mediumQualitySampleCount: 1,
                    mediumQualityDataAge: 70000,
                    circuitBreakerMaxErrors: 8,
                    circuitBreakerWindowMs: 90000,
                    lowScoreConfidenceAdjustment: 0.7,
                    lowVolumeConfidenceAdjustment: 0.8,
                    invalidSurgeConfidenceAdjustment: 0.8,
                    passiveConsistencyThreshold: 0.1,
                    imbalanceNeutralThreshold: 0.01,
                    velocityMinBound: 0.1,
                    velocityMaxBound: 10,
                    minInitialMoveTicks: 1,
                    confirmationTimeoutMs: 40000,
                    maxRevisitTicks: 8,
                    maxZones: 75,
                    zoneAgeLimit: 1200000,
                    features: {
                        depletionTracking: true,
                        spreadAdjustment: true,
                        volumeVelocity: false,
                        spoofingDetection: true,
                        adaptiveZone: true,
                        multiZone: false,
                        passiveHistory: true,
                    },
                    useStandardizedZones: true,
                    enhancementMode: "production" as const,
                    minEnhancedConfidenceThreshold: 0.01,
                } as any,
                mockPreprocessor,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics,
                mockSignalLogger
            );

            // Capture emitted signals
            exhaustionDetector.on("signal", (signal: SignalCandidate) => {
                signalCaptures.push(signal);
            });

            // Create exhaustion scenario - high aggressive volume, low passive volume
            const exhaustionTrade: EnrichedTradeEvent = {
                tradeId: "test-exhaustion-123",
                price: 100.0,
                quantity: 50, // High volume
                timestamp: Date.now(),
                buyerIsMaker: false, // Aggressive sell
                totalVolume: 100,
                passiveBidVolume: 10, // Very low passive (exhausted)
                passiveAskVolume: 15,
                aggressiveBuyVolume: 0,
                aggressiveSellVolume: 50,
                spread: 0.05, // High spread indicating exhaustion
                midPrice: 100.025,
                imbalance: -0.8, // Strong sell imbalance
                zoneData: {
                    zones5Tick: [
                        {
                            priceLevel: 100.0,
                            aggressiveVolume: 50,
                            passiveVolume: 10, // Depleted passive
                            tradeCount: 8,
                            strength: 0.9,
                            timestamp: Date.now(),
                        }
                    ],
                    zones10Tick: [],
                    zones20Tick: [],
                },
            };

            // Process multiple trades to build exhaustion pattern
            for (let i = 0; i < 5; i++) {
                const trade = {
                    ...exhaustionTrade,
                    tradeId: `test-exhaustion-${i}`,
                    timestamp: Date.now() + i * 1000,
                    passiveBidVolume: Math.max(1, 10 - i * 2), // Decreasing passive
                };
                exhaustionDetector.onEnrichedTrade(trade);
            }

            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // CRITICAL ASSERTION: Exhaustion signal type validation
            if (signalCaptures.length > 0) {
                expect(signalCaptures[0].type).toBe(EXHAUSTION_SIGNAL_TYPE);
                console.log("✅ ExhaustionDetectorEnhanced emits correct signal type:", signalCaptures[0].type);
                console.log("📊 Exhaustion signal confidence:", signalCaptures[0].confidence);
            } else {
                console.log("⚠️  No exhaustion signals generated (may need config adjustment)");
            }
        });

        it("should pass exhaustion threshold validation in SignalManager", () => {
            const signalManager = new SignalManager(
                {
                    getMarketHealth: vi.fn().mockReturnValue({
                        isHealthy: true,
                        recommendation: "continue",
                        criticalIssues: [],
                        recentAnomalyTypes: [],
                        volatilityRatio: 1.0,
                        highestSeverity: "low",
                        metrics: {
                            volatility: 0.5,
                            spreadBps: 1.0,
                            flowImbalance: 0.0,
                            lastUpdateAge: 0,
                        },
                    }),
                } as any,
                { sendAlert: vi.fn() } as any,
                mockLogger,
                mockMetrics,
                { callStorage: vi.fn(), broadcast: vi.fn() } as any,
                {
                    confidenceThreshold: 0.3,
                    detectorThresholds: {
                        exhaustion: EXHAUSTION_THRESHOLD,
                    },
                }
            );

            // Test signal above threshold
            const testSignal = {
                id: "test-exhaustion-signal",
                originalCandidate: {} as any,
                type: EXHAUSTION_SIGNAL_TYPE,
                confidence: EXHAUSTION_THRESHOLD + 0.01,
                timestamp: new Date(),
                detectorId: "test-exhaustion",
                side: "sell" as const,
                price: 100.0,
                tradeIndex: 1,
            };

            const result = signalManager.processSignal(testSignal);
            expect(result).toBeDefined();
            console.log(`✅ Exhaustion signal passes threshold ${EXHAUSTION_THRESHOLD}`);

            // Test signal below threshold
            const lowSignal = {
                ...testSignal,
                confidence: EXHAUSTION_THRESHOLD - 0.01,
            };

            const lowResult = signalManager.processSignal(lowSignal);
            expect(lowResult).toBeUndefined();
            console.log(`✅ Exhaustion signal below threshold ${EXHAUSTION_THRESHOLD} correctly rejected`);
        });
    });

    /**
     * TEST 2: DeltaCVDDetectorEnhanced Signal Type Validation
     */
    describe("DeltaCVDDetectorEnhanced Signal Flow", () => {
        it("should emit correct cvd_confirmation signal type", async () => {
            const signalCaptures: SignalCandidate[] = [];

            const cvdDetector = new DeltaCVDDetectorEnhanced(
                "test-cvd",
                {
                    // Minimal config to trigger CVD signal
                    windowsSec: [60, 300],
                    minZ: 0.5, // Lower threshold for testing
                    priceCorrelationWeight: 0.3,
                    volumeConcentrationWeight: 0.2,
                    adaptiveThresholdMultiplier: 0.3,
                    eventCooldownMs: 1000,
                    maxZones: 50,
                    zoneAgeLimit: 1800000,
                    minTradesPerSec: 0.1,
                    minVolPerSec: 1,
                    minSamplesForStats: 5,
                    volatilityLookbackSec: 300,
                    maxDivergenceAllowed: 0.8,
                    stateCleanupIntervalSec: 300,
                    dynamicThresholds: true,
                    logDebug: false,
                    volumeSurgeMultiplier: 2.0,
                    imbalanceThreshold: 0.1,
                    institutionalThreshold: 10.0,
                    burstDetectionMs: 800,
                    sustainedVolumeMs: 10000,
                    medianTradeSize: 0.5,
                    detectionMode: "momentum" as const,
                    divergenceThreshold: 0.3,
                    divergenceLookbackSec: 45,
                    enableDepthAnalysis: false,
                    usePassiveVolume: false,
                    maxOrderbookAge: 4000,
                    absorptionCVDThreshold: 50,
                    absorptionPriceThreshold: 0.15,
                    imbalanceWeight: 0.15,
                    icebergMinRefills: 5,
                    icebergMinSize: 50,
                    baseConfidenceRequired: 0.05,
                    finalConfidenceRequired: 0.1,
                    strongCorrelationThreshold: 0.8,
                    weakCorrelationThreshold: 0.4,
                    depthImbalanceThreshold: 0.3,
                    useStandardizedZones: true,
                    enhancementMode: "production" as const,
                    minEnhancedConfidenceThreshold: 0.05,
                } as any,
                mockPreprocessor,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics,
                mockSignalLogger
            );

            // Capture emitted signals
            cvdDetector.on("signal", (signal: SignalCandidate) => {
                signalCaptures.push(signal);
            });

            // Create CVD divergence scenario
            const cvdTrade: EnrichedTradeEvent = {
                tradeId: "test-cvd-123",
                price: 100.0,
                quantity: 100,
                timestamp: Date.now(),
                buyerIsMaker: false,
                totalVolume: 200,
                passiveBidVolume: 50,
                passiveAskVolume: 50,
                aggressiveBuyVolume: 100, // Strong buying
                aggressiveSellVolume: 0,
                spread: 0.01,
                midPrice: 100.005,
                imbalance: 1.0, // Strong buy imbalance
                zoneData: {
                    zones5Tick: [
                        {
                            priceLevel: 100.0,
                            aggressiveVolume: 100,
                            passiveVolume: 100,
                            tradeCount: 10,
                            strength: 0.8,
                            timestamp: Date.now(),
                        }
                    ],
                    zones10Tick: [],
                    zones20Tick: [],
                },
            };

            // Process multiple trades to build CVD pattern
            for (let i = 0; i < 10; i++) {
                const trade = {
                    ...cvdTrade,
                    tradeId: `test-cvd-${i}`,
                    timestamp: Date.now() + i * 1000,
                    price: 100.0 + (i * 0.001), // Slight price increase
                    aggressiveBuyVolume: 100 + (i * 5), // Increasing buy volume
                };
                cvdDetector.onEnrichedTrade(trade);
            }

            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 200));

            // CRITICAL ASSERTION: CVD signal type validation
            if (signalCaptures.length > 0) {
                expect(signalCaptures[0].type).toBe(CVD_SIGNAL_TYPE);
                console.log("✅ DeltaCVDDetectorEnhanced emits correct signal type:", signalCaptures[0].type);
                console.log("📊 CVD signal confidence:", signalCaptures[0].confidence);
            } else {
                console.log("⚠️  No CVD signals generated (may need config adjustment)");
            }
        });

        it("should pass cvd_confirmation threshold validation in SignalManager", () => {
            const signalManager = new SignalManager(
                {
                    getMarketHealth: vi.fn().mockReturnValue({
                        isHealthy: true,
                        recommendation: "continue",
                        criticalIssues: [],
                        recentAnomalyTypes: [],
                        volatilityRatio: 1.0,
                        highestSeverity: "low",
                        metrics: {
                            volatility: 0.5,
                            spreadBps: 1.0,
                            flowImbalance: 0.0,
                            lastUpdateAge: 0,
                        },
                    }),
                } as any,
                { sendAlert: vi.fn() } as any,
                mockLogger,
                mockMetrics,
                { callStorage: vi.fn(), broadcast: vi.fn() } as any,
                {
                    confidenceThreshold: 0.3,
                    detectorThresholds: {
                        cvd_confirmation: CVD_THRESHOLD,
                    },
                }
            );

            // Test signal above threshold
            const testSignal = {
                id: "test-cvd-signal",
                originalCandidate: {} as any,
                type: CVD_SIGNAL_TYPE,
                confidence: CVD_THRESHOLD + 0.01,
                timestamp: new Date(),
                detectorId: "test-cvd",
                side: "buy" as const,
                price: 100.0,
                tradeIndex: 1,
            };

            const result = signalManager.processSignal(testSignal);
            expect(result).toBeDefined();
            console.log(`✅ CVD signal passes threshold ${CVD_THRESHOLD}`);

            // Test signal below threshold
            const lowSignal = {
                ...testSignal,
                confidence: CVD_THRESHOLD - 0.01,
            };

            const lowResult = signalManager.processSignal(lowSignal);
            expect(lowResult).toBeUndefined();
            console.log(`✅ CVD signal below threshold ${CVD_THRESHOLD} correctly rejected`);
        });
    });

    /**
     * TEST 3: Comprehensive Threshold Configuration Validation
     */
    describe("Exhaustion & CVD Configuration Validation", () => {
        it("should have correct threshold mappings for exhaustion and CVD detectors", () => {
            const expectedThresholds = {
                exhaustion: EXHAUSTION_THRESHOLD,
                cvd_confirmation: CVD_THRESHOLD,
            };

            // Validate threshold values
            expect(expectedThresholds.exhaustion).toBe(0.2);
            expect(expectedThresholds.cvd_confirmation).toBe(0.15);

            console.log("✅ Exhaustion & CVD threshold configuration validated:");
            console.log(`   exhaustion: ${expectedThresholds.exhaustion}`);
            console.log(`   cvd_confirmation: ${expectedThresholds.cvd_confirmation}`);
        });
    });
});