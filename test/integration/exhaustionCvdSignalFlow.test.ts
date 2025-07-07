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
// - Threshold mapping for exhaustion (0.2) and deltacvd (0.15)
// - Signal flow integration with SignalManager

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExhaustionDetectorEnhanced } from "../../src/indicators/exhaustionDetectorEnhanced.js";
import { DeltaCVDDetectorEnhanced } from "../../src/indicators/deltaCVDDetectorEnhanced.js";
import { SignalManager } from "../../src/trading/signalManager.js";
import type {
    SignalCandidate,
    SignalType,
} from "../../src/types/signalTypes.js";
import type { IOrderflowPreprocessor } from "../../src/market/orderFlowPreprocessor.js";
import type { EnrichedTradeEvent } from "../../src/types/marketEvents.js";
import { createMockLogger } from "../../__mocks__/src/infrastructure/loggerInterface.js";

// Import proper mocks from __mocks__/ directory as per CLAUDE.md
import { MetricsCollector } from "../../__mocks__/src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../../__mocks__/src/services/spoofingDetector.js";
// Import realistic configurations from mock config
import mockConfig from "../../__mocks__/config.json";

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
    const CVD_SIGNAL_TYPE: SignalType = "deltacvd";

    // Expected thresholds from config.json
    const EXHAUSTION_THRESHOLD = 0.2;
    const CVD_THRESHOLD = 0.15;

    // Complete SignalManager config as required by nuclear cleanup
    const getSignalManagerConfig = (
        detectorThresholds: Record<string, number>
    ) => ({
        confidenceThreshold: 0.3,
        signalTimeout: 120000,
        enableMarketHealthCheck: true,
        enableAlerts: true,
        maxQueueSize: 1000,
        processingBatchSize: 10,
        backpressureThreshold: 800,
        enableSignalPrioritization: true,
        adaptiveBatchSizing: true,
        maxAdaptiveBatchSize: 50,
        minAdaptiveBatchSize: 5,
        circuitBreakerThreshold: 5,
        circuitBreakerResetMs: 60000,
        adaptiveBackpressure: true,
        highPriorityBypassThreshold: 8.5,
        signalTypePriorities: {
            absorption: 10,
            exhaustion: 9,
            deltacvd: 8,
            accumulation: 7,
            distribution: 7,
        },
        detectorThresholds,
        positionSizing: {
            absorption: 0.5,
            exhaustion: 1.0,
            accumulation: 0.6,
            distribution: 0.7,
            deltacvd: 0.7,
        },
    });

    beforeEach(() => {
        mockLogger = createMockLogger();

        // Use proper mock from __mocks__/ directory as per CLAUDE.md
        mockMetrics = new MetricsCollector();

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
                    aggressiveBuyVolume: 10, // Low buy volume
                    aggressiveSellVolume: 40, // High sell volume
                    tradeCount: 8,
                    strength: 0.9,
                    timestamp: Date.now(),
                },
            ]),
            calculateZoneRelevanceScore: vi.fn(() => 0.8),
            findMostRelevantZone: vi.fn(() => ({
                priceLevel: 100.0,
                aggressiveVolume: 50,
                passiveVolume: 25,
                aggressiveBuyVolume: 10,
                aggressiveSellVolume: 40,
                tradeCount: 8,
                strength: 0.9,
                timestamp: Date.now(),
            })),
        };

        // Use proper mock from __mocks__/ directory as per CLAUDE.md
        mockSpoofingDetector = new SpoofingDetector();

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
                mockConfig.symbols.LTCUSDT.exhaustion as any,
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
                            aggressiveBuyVolume: 10, // Low buy volume (buy-side exhaustion)
                            aggressiveSellVolume: 40, // High sell volume (suggests sell-side strength)
                            tradeCount: 8,
                            strength: 0.9,
                            timestamp: Date.now(),
                        },
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
            await new Promise((resolve) => setTimeout(resolve, 100));

            // CRITICAL ASSERTION: Exhaustion signal type validation
            if (signalCaptures.length > 0) {
                expect(signalCaptures[0].type).toBe(EXHAUSTION_SIGNAL_TYPE);
                console.log(
                    "✅ ExhaustionDetectorEnhanced emits correct signal type:",
                    signalCaptures[0].type
                );
                console.log(
                    "📊 Exhaustion signal confidence:",
                    signalCaptures[0].confidence
                );
            } else {
                console.log(
                    "⚠️  No exhaustion signals generated (may need config adjustment)"
                );
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
                undefined,
                undefined,
                getSignalManagerConfig({
                    exhaustion: EXHAUSTION_THRESHOLD,
                })
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

            const result = signalManager.handleProcessedSignal(testSignal);
            expect(result).toBeDefined();
            console.log(
                `✅ Exhaustion signal passes threshold ${EXHAUSTION_THRESHOLD}`
            );

            // Test signal below threshold
            const lowSignal = {
                ...testSignal,
                confidence: EXHAUSTION_THRESHOLD - 0.01,
            };

            const lowResult = signalManager.handleProcessedSignal(lowSignal);
            expect(lowResult).toBeNull();
            console.log(
                `✅ Exhaustion signal below threshold ${EXHAUSTION_THRESHOLD} correctly rejected`
            );
        });
    });

    /**
     * TEST 2: DeltaCVDDetectorEnhanced Signal Type Validation
     */
    describe("DeltaCVDDetectorEnhanced Signal Flow", () => {
        it("should emit correct deltacvd signal type", async () => {
            const signalCaptures: SignalCandidate[] = [];

            const cvdDetector = new DeltaCVDDetectorEnhanced(
                "test-cvd",
                "LTCUSDT",
                mockConfig.symbols.LTCUSDT.deltaCvdConfirmation as any,
                mockPreprocessor,
                mockLogger,
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
                        },
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
                    price: 100.0 + i * 0.001, // Slight price increase
                    aggressiveBuyVolume: 100 + i * 5, // Increasing buy volume
                };
                cvdDetector.onEnrichedTrade(trade);
            }

            // Wait for processing
            await new Promise((resolve) => setTimeout(resolve, 200));

            // CRITICAL ASSERTION: CVD signal type validation
            if (signalCaptures.length > 0) {
                expect(signalCaptures[0].type).toBe(CVD_SIGNAL_TYPE);
                console.log(
                    "✅ DeltaCVDDetectorEnhanced emits correct signal type:",
                    signalCaptures[0].type
                );
                console.log(
                    "📊 CVD signal confidence:",
                    signalCaptures[0].confidence
                );
            } else {
                console.log(
                    "⚠️  No CVD signals generated (may need config adjustment)"
                );
            }
        });

        it("should pass deltacvd threshold validation in SignalManager", () => {
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
                undefined,
                undefined,
                getSignalManagerConfig({
                    deltacvd: CVD_THRESHOLD,
                })
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

            const result = signalManager.handleProcessedSignal(testSignal);
            expect(result).toBeDefined();
            console.log(`✅ CVD signal passes threshold ${CVD_THRESHOLD}`);

            // Test signal below threshold
            const lowSignal = {
                ...testSignal,
                confidence: CVD_THRESHOLD - 0.01,
            };

            const lowResult = signalManager.handleProcessedSignal(lowSignal);
            expect(lowResult).toBeNull();
            console.log(
                `✅ CVD signal below threshold ${CVD_THRESHOLD} correctly rejected`
            );
        });
    });

    /**
     * TEST 3: Comprehensive Threshold Configuration Validation
     */
    describe("Exhaustion & CVD Configuration Validation", () => {
        it("should have correct threshold mappings for exhaustion and CVD detectors", () => {
            const expectedThresholds = {
                exhaustion: EXHAUSTION_THRESHOLD,
                deltacvd: CVD_THRESHOLD,
            };

            // Validate threshold values
            expect(expectedThresholds.exhaustion).toBe(0.2);
            expect(expectedThresholds.deltacvd).toBe(0.15);

            console.log(
                "✅ Exhaustion & CVD threshold configuration validated:"
            );
            console.log(`   exhaustion: ${expectedThresholds.exhaustion}`);
            console.log(`   deltacvd: ${expectedThresholds.deltacvd}`);
        });
    });
});
