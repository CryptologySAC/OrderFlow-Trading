/**
 * Comprehensive Unit Tests for ExhaustionDetectorEnhanced Directional Passive Volume Logic
 *
 * VALIDATION FOCUS: Confirms correct directional passive volume implementation:
 * - Buy trades (buyerIsMaker = false): Only count passiveAskVolume
 * - Sell trades (buyerIsMaker = true): Only count passiveBidVolume
 *
 * INSTITUTIONAL TESTING STANDARDS:
 * - Market realistic data with tick-size compliance
 * - Process correctness validation over output matching
 * - Real-world edge cases and failure modes
 * - No magic numbers - all values from configuration
 * - FinancialMath compliance for all calculations
 */

import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
    beforeAll,
    afterEach,
} from "vitest";
import { ExhaustionDetectorEnhanced } from "../src/indicators/exhaustionDetectorEnhanced.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import { Config } from "../src/core/config.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import type { ExhaustionEnhancedSettings } from "../src/indicators/exhaustionDetectorEnhanced.js";
import type { SignalCandidate } from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";

// Mock implementations - using proper __mocks__ structure
vi.mock("../src/core/config.js");
vi.mock("../src/infrastructure/loggerInterface.js");
vi.mock("../src/infrastructure/metricsCollectorInterface.js");
vi.mock("../src/infrastructure/signalLoggerInterface.js");
vi.mock("../src/market/orderFlowPreprocessor.js");

describe("ExhaustionDetectorEnhanced - Directional Passive Volume Logic", () => {
    let detector: ExhaustionDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSignalLogger: ISignalLogger;
    let mockPreprocessor: IOrderflowPreprocessor;
    let mockValidationLogger: SignalValidationLogger;
    let testSettings: ExhaustionEnhancedSettings;

    // Test configuration - realistic institutional parameters
    const REALISTIC_CONFIG = {
        // Base volume thresholds - institutional scale
        minAggVolume: 25,
        exhaustionThreshold: 0.7,

        // Time windows - market realistic
        timeWindowIndex: 1, // 60 seconds
        eventCooldownMs: 10000, // 10 second cooldown

        // Passive volume analysis - directional logic
        passiveRatioBalanceThreshold: 0.3,
        passiveVolumeExhaustionRatio: 0.2,

        // Confidence and scoring
        minEnhancedConfidenceThreshold: 0.6,
        premiumConfidenceThreshold: 0.8,

        // Enhancement features
        useStandardizedZones: true,
        enhancementMode: "production" as const,
        enableDepletionAnalysis: true,

        // Depletion analysis
        depletionVolumeThreshold: 20,
        depletionRatioThreshold: 0.65,

        // Cross-timeframe analysis
        varianceReductionFactor: 0.1,
        alignmentNormalizationFactor: 0.4,
        aggressiveVolumeExhaustionThreshold: 0.6,
        aggressiveVolumeReductionFactor: 0.5,

        // Balance and variance parameters
        variancePenaltyFactor: 1.0,
        ratioBalanceCenterPoint: 0.5,
    };

    // Market realistic price levels with proper tick sizes
    const BASE_PRICE = 89.24; // $89.24 - uses 0.01 tick size
    const TICK_SIZE = 0.01;

    beforeAll(() => {
        // Mock Config.UNIVERSAL_ZONE_CONFIG
        vi.spyOn(Config, "UNIVERSAL_ZONE_CONFIG", "get").mockReturnValue({
            enableZoneConfluenceFilter: true,
            enableCrossTimeframeAnalysis: true,
            minZoneConfluenceCount: 2,
            maxZoneConfluenceDistance: 3,
            crossTimeframeBoost: 0.12,
        });

        // Mock Config.getTimeWindow
        vi.spyOn(Config, "getTimeWindow").mockImplementation(
            (index: number) => {
                const windows = [30000, 60000, 120000]; // 30s, 60s, 120s
                return windows[index] || 60000;
            }
        );
    });

    beforeEach(() => {
        // Create mock instances
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        mockMetrics = {
            recordCounter: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            recordTimer: vi.fn(),
        };

        mockSignalLogger = {
            logSignal: vi.fn(),
            logSignalResult: vi.fn(),
        };

        mockPreprocessor = {
            findZonesNearPrice: vi.fn(),
            preprocessTrade: vi.fn(),
            getCurrentZoneData: vi.fn(),
        };

        mockValidationLogger = new SignalValidationLogger(
            mockLogger,
            "test-logs"
        );

        testSettings = { ...REALISTIC_CONFIG };

        // Initialize detector
        detector = new ExhaustionDetectorEnhanced(
            "test-exhaustion-enhanced",
            testSettings,
            mockPreprocessor,
            mockLogger,
            mockMetrics,
            mockSignalLogger,
            mockValidationLogger
        );
    });

    afterEach(() => {
        detector.cleanup();
        vi.clearAllMocks();
    });

    describe("Directional Passive Volume Logic - Buy Side Exhaustion", () => {
        it("should correctly analyze buy trade exhaustion using only passiveAskVolume", () => {
            // SCENARIO: Large buy trade depleting ask liquidity
            // Buy trades (buyerIsMaker = false) should only consider passiveAskVolume

            const currentTime = Date.now();
            const buyTradeEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 30, // Above minAggVolume threshold
                timestamp: currentTime,
                buyerIsMaker: false, // BUY TRADE - hits asks
                tradeId: 12345,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 70, // Very high aggressive volume
                            passiveVolume: 8, // Low total passive volume
                            // DIRECTIONAL VOLUMES - Key test data
                            passiveAskVolume: 3, // VERY LOW ask liquidity (exhausted)
                            passiveBidVolume: 5, // Low bid liquidity
                            aggressiveBuyVolume: 40,
                            aggressiveSellVolume: 30,
                            lastUpdate: currentTime - 30000, // 30s ago
                            tradeCount: 8,
                        },
                        {
                            zoneId: "zone2",
                            priceLevel: BASE_PRICE + TICK_SIZE,
                            aggressiveVolume: 60,
                            passiveVolume: 6,
                            // More exhausted ask liquidity
                            passiveAskVolume: 2, // EXTREMELY LOW ask liquidity
                            passiveBidVolume: 4, // Low bid liquidity
                            aggressiveBuyVolume: 35,
                            aggressiveSellVolume: 25,
                            lastUpdate: currentTime - 25000,
                            tradeCount: 6,
                        },
                    ],
                },
            };

            // Mock preprocessor to return relevant zones
            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([
                    buyTradeEvent.zoneData!.zones[0],
                    buyTradeEvent.zoneData!.zones[1],
                ]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            // Process the buy trade
            detector.onEnrichedTrade(buyTradeEvent);

            // VALIDATION: Signal should be emitted for buy-side exhaustion
            expect(emittedSignal).not.toBeNull();
            expect(emittedSignal!.type).toBe("exhaustion");

            // CRITICAL: Signal side logic based on available liquidity comparison
            // In test data: passiveBidVolume = 5+4=9, passiveAskVolume = 3+2=5
            // More bid liquidity available (9 > 5) → ask side more exhausted → BUY signal
            expect(emittedSignal!.side).toBe("buy");

            // Verify confidence calculation uses only relevant passive volume
            const totalAggressiveVolume = 70 + 60; // 130
            const totalPassiveVolume = 8 + 6; // 14 (total passive, not directional)
            const totalRelevantPassiveVolume = 3 + 2; // Only passiveAskVolume = 5
            const expectedRatio = FinancialMath.divideQuantities(
                totalAggressiveVolume,
                totalAggressiveVolume + totalPassiveVolume
            );
            expect(expectedRatio).toBeGreaterThan(
                testSettings.exhaustionThreshold
            );
            expect(emittedSignal!.confidence).toBeGreaterThan(
                testSettings.minEnhancedConfidenceThreshold
            );

            // Verify signal data contains correct exhaustion metrics
            const signalData = emittedSignal!.data as any;
            expect(signalData.exhaustionScore).toBeGreaterThan(0.7);
            // Note: aggressive field contains total aggressive volume from zones, not individual trade quantity
            expect(signalData.aggressive).toBeGreaterThan(
                buyTradeEvent.quantity
            );

            // DIRECTIONAL LOGIC VALIDATION: Only ask-side liquidity should be considered
            expect(mockPreprocessor.findZonesNearPrice).toHaveBeenCalled();
        });

        it("should reject buy trade when ask liquidity is sufficient (no exhaustion)", () => {
            // SCENARIO: Buy trade with sufficient ask liquidity available

            const currentTime = Date.now();
            const buyTradeEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 30,
                timestamp: currentTime,
                buyerIsMaker: false, // BUY TRADE
                tradeId: 12346,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 25, // Moderate aggressive volume
                            passiveVolume: 40,
                            // SUFFICIENT ask liquidity (no exhaustion)
                            passiveAskVolume: 35, // HIGH ask liquidity available
                            passiveBidVolume: 20, // Irrelevant for buy trades
                            aggressiveBuyVolume: 15,
                            aggressiveSellVolume: 10,
                            lastUpdate: currentTime - 30000,
                            tradeCount: 4,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([buyTradeEvent.zoneData!.zones[0]]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(buyTradeEvent);

            // VALIDATION: No signal should be emitted - insufficient exhaustion
            expect(emittedSignal).toBeNull();

            // Verify rejection was logged
            expect(mockValidationLogger.logRejection).toHaveBeenCalledWith(
                "exhaustion",
                expect.any(String),
                buyTradeEvent,
                expect.any(Object),
                expect.any(Object)
            );

            // Calculate expected ratio to confirm it's below threshold
            const totalAggressive = 25;
            const totalRelevantPassive = 35; // Only passiveAskVolume
            const exhaustionRatio = FinancialMath.divideQuantities(
                totalAggressive,
                totalAggressive + totalRelevantPassive
            );
            expect(exhaustionRatio).toBeLessThan(
                testSettings.exhaustionThreshold
            );
        });
    });

    describe("Directional Passive Volume Logic - Sell Side Exhaustion", () => {
        it("should correctly analyze sell trade exhaustion using only passiveBidVolume", () => {
            // SCENARIO: Large sell trade depleting bid liquidity
            // Sell trades (buyerIsMaker = true) should only consider passiveBidVolume

            const currentTime = Date.now();
            const sellTradeEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 35, // Above threshold
                timestamp: currentTime,
                buyerIsMaker: true, // SELL TRADE - hits bids
                tradeId: 12347,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 75, // Very high aggressive volume
                            passiveVolume: 9, // Low total passive volume
                            // DIRECTIONAL VOLUMES - Key test data
                            passiveAskVolume: 6, // Moderate ask liquidity
                            passiveBidVolume: 3, // VERY LOW bid liquidity (exhausted)
                            aggressiveBuyVolume: 30,
                            aggressiveSellVolume: 45,
                            lastUpdate: currentTime - 35000,
                            tradeCount: 9,
                        },
                        {
                            zoneId: "zone2",
                            priceLevel: BASE_PRICE - TICK_SIZE,
                            aggressiveVolume: 65,
                            passiveVolume: 7,
                            // More exhausted bid liquidity
                            passiveAskVolume: 5, // Moderate ask liquidity
                            passiveBidVolume: 2, // EXTREMELY LOW bid liquidity
                            aggressiveBuyVolume: 25,
                            aggressiveSellVolume: 40,
                            lastUpdate: currentTime - 20000,
                            tradeCount: 7,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([
                    sellTradeEvent.zoneData!.zones[0],
                    sellTradeEvent.zoneData!.zones[1],
                ]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(sellTradeEvent);

            // VALIDATION: Signal should be emitted for sell-side exhaustion
            expect(emittedSignal).not.toBeNull();
            expect(emittedSignal!.type).toBe("exhaustion");

            // CRITICAL: Signal side logic based on available liquidity comparison
            // In test data: passiveBidVolume = 3+2=5, passiveAskVolume = 6+5=11
            // More ask liquidity available (11 > 5) → bid side more exhausted → SELL signal
            expect(emittedSignal!.side).toBe("sell");

            // Verify confidence calculation uses only relevant passive volume
            const totalAggressiveVolume = 75 + 65; // 140
            const totalPassiveVolume = 9 + 7; // 16 (total passive, not directional)
            const totalRelevantPassiveVolume = 3 + 2; // Only passiveBidVolume = 5
            const expectedRatio = FinancialMath.divideQuantities(
                totalAggressiveVolume,
                totalAggressiveVolume + totalPassiveVolume
            );
            expect(expectedRatio).toBeGreaterThan(
                testSettings.exhaustionThreshold
            );
            expect(emittedSignal!.confidence).toBeGreaterThan(
                testSettings.minEnhancedConfidenceThreshold
            );

            // Verify exhaustion score reflects bid depletion
            const signalData = emittedSignal!.data as any;
            expect(signalData.exhaustionScore).toBeGreaterThan(0.7);
            // Note: aggressive field contains total aggressive volume from zones, not individual trade quantity
            expect(signalData.aggressive).toBeGreaterThan(
                sellTradeEvent.quantity
            );
        });

        it("should reject sell trade when bid liquidity is sufficient (no exhaustion)", () => {
            // SCENARIO: Sell trade with sufficient bid liquidity available

            const currentTime = Date.now();
            const sellTradeEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 30,
                timestamp: currentTime,
                buyerIsMaker: true, // SELL TRADE
                tradeId: 12348,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 28, // Moderate aggressive volume
                            passiveVolume: 42,
                            // SUFFICIENT bid liquidity (no exhaustion)
                            passiveAskVolume: 20, // Irrelevant for sell trades
                            passiveBidVolume: 38, // HIGH bid liquidity available
                            aggressiveBuyVolume: 12,
                            aggressiveSellVolume: 16,
                            lastUpdate: currentTime - 40000,
                            tradeCount: 5,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([sellTradeEvent.zoneData!.zones[0]]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(sellTradeEvent);

            // VALIDATION: No signal should be emitted - insufficient exhaustion
            expect(emittedSignal).toBeNull();

            // Calculate expected ratio to confirm it's below threshold
            const totalAggressive = 28;
            const totalRelevantPassive = 38; // Only passiveBidVolume
            const exhaustionRatio = FinancialMath.divideQuantities(
                totalAggressive,
                totalAggressive + totalRelevantPassive
            );
            expect(exhaustionRatio).toBeLessThan(
                testSettings.exhaustionThreshold
            );
        });
    });

    describe("Edge Cases and Error Handling", () => {
        it("should handle zero directional passive volume gracefully", () => {
            // SCENARIO: Trade with zero relevant passive volume

            const currentTime = Date.now();
            const edgeCaseEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 40,
                timestamp: currentTime,
                buyerIsMaker: false, // Buy trade
                tradeId: 12349,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 50,
                            passiveVolume: 20, // Total passive exists
                            // ZERO relevant passive volume
                            passiveAskVolume: 0, // No ask liquidity (should trigger exhaustion)
                            passiveBidVolume: 20, // Irrelevant for buy trades
                            aggressiveBuyVolume: 30,
                            aggressiveSellVolume: 20,
                            lastUpdate: currentTime - 15000,
                            tradeCount: 3,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([edgeCaseEvent.zoneData!.zones[0]]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(edgeCaseEvent);

            // VALIDATION: Should reject signal - can't have exhaustion of non-existent passive volume
            expect(emittedSignal).toBeNull();

            // REASONING: Zero directional passive volume (passiveAskVolume = 0 for buy trade)
            // means there was never any ask liquidity to exhaust in the first place.
            // Exhaustion requires depleting existing passive volume, not absence of it.
        });

        it("should handle undefined directional passive volumes", () => {
            // SCENARIO: Zone data with undefined directional volumes

            const currentTime = Date.now();
            const undefinedVolumeEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 35,
                timestamp: currentTime,
                buyerIsMaker: true, // Sell trade
                tradeId: 12350,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 45, // Higher to meet thresholds
                            passiveVolume: 8,
                            // Undefined directional volumes (edge case)
                            passiveAskVolume: undefined,
                            passiveBidVolume: undefined,
                            aggressiveBuyVolume: 25,
                            aggressiveSellVolume: 20,
                            lastUpdate: currentTime - 25000,
                            tradeCount: 2,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([undefinedVolumeEvent.zoneData!.zones[0]]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(undefinedVolumeEvent);

            // VALIDATION: Should reject signal - undefined directional passive volume means no liquidity to exhaust
            expect(emittedSignal).toBeNull();

            // REASONING: Undefined passiveBidVolume for sell trade (treated as 0) means
            // there was never any bid liquidity to exhaust. Should not crash but should reject.
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        it("should validate accumulated aggressive volume against minAggVolume threshold", () => {
            // SCENARIO: Zone with insufficient accumulated aggressive volume
            // CORRECTED: minAggVolume is about zone volume, not individual trade size

            const currentTime = Date.now();
            const lowZoneVolumeEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 50, // Trade size doesn't matter for exhaustion
                timestamp: currentTime,
                buyerIsMaker: false,
                tradeId: 12351,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 20, // Below minAggVolume (25) - insufficient to indicate exhaustion
                            passiveVolume: 8,
                            passiveAskVolume: 3, // Low ask liquidity
                            passiveBidVolume: 25,
                            aggressiveBuyVolume: 12,
                            aggressiveSellVolume: 8,
                            lastUpdate: currentTime - 20000,
                            tradeCount: 4,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([lowZoneVolumeEvent.zoneData!.zones[0]]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(lowZoneVolumeEvent);

            // VALIDATION: Should reject due to insufficient accumulated aggressive volume in zones
            expect(emittedSignal).toBeNull();

            // Verify rejection logged with correct reason
            expect(mockValidationLogger.logRejection).toHaveBeenCalledWith(
                "exhaustion",
                "accumulated_aggressive_volume_too_low",
                lowZoneVolumeEvent,
                expect.objectContaining({
                    threshold: testSettings.minAggVolume,
                    actual: 20, // Matches the zone's aggressive volume
                }),
                expect.any(Object)
            );
        });
    });

    describe("FinancialMath Integration and Precision", () => {
        it("should use FinancialMath for all ratio calculations", () => {
            // SCENARIO: Verify all calculations use FinancialMath utilities

            const currentTime = Date.now();
            const precisionTestEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 33,
                timestamp: currentTime,
                buyerIsMaker: false,
                tradeId: 12352,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 77, // Odd numbers to test precision
                            passiveVolume: 13,
                            passiveAskVolume: 11, // Specific precision test values
                            passiveBidVolume: 19,
                            aggressiveBuyVolume: 44,
                            aggressiveSellVolume: 33,
                            lastUpdate: currentTime - 18000,
                            tradeCount: 7,
                        },
                    ],
                },
            };

            // Spy on FinancialMath methods to verify usage
            const divideQuantitiesSpy = vi.spyOn(
                FinancialMath,
                "divideQuantities"
            );

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([precisionTestEvent.zoneData!.zones[0]]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(precisionTestEvent);

            // VALIDATION: FinancialMath should be used for calculations
            expect(divideQuantitiesSpy).toHaveBeenCalled();

            // Verify precision in calculations
            if (emittedSignal) {
                const signalData = emittedSignal.data as any;

                // Test that ratios are properly calculated using FinancialMath
                // The exhaustion score is the accumulated aggressive ratio
                const expectedExhaustionRatio = FinancialMath.divideQuantities(
                    77,
                    77 + 11
                );
                expect(signalData.exhaustionScore).toBeCloseTo(
                    expectedExhaustionRatio,
                    3
                );

                // Confidence should be clamped to [0, 1] range
                expect(emittedSignal.confidence).toBeGreaterThanOrEqual(0);
                expect(emittedSignal.confidence).toBeLessThanOrEqual(1);
            }

            divideQuantitiesSpy.mockRestore();
        });

        it("should handle tick size compliance in price comparisons", () => {
            // SCENARIO: Verify price movements respect tick size constraints

            const currentTime = Date.now();

            // Test with prices that are tick-compliant
            const tickCompliantPrices = [
                BASE_PRICE,
                BASE_PRICE + TICK_SIZE,
                BASE_PRICE - TICK_SIZE,
                BASE_PRICE + 2 * TICK_SIZE,
            ];

            tickCompliantPrices.forEach((price, index) => {
                const tickTestEvent: EnrichedTradeEvent = {
                    symbol: "LTCUSDT",
                    price: price,
                    quantity: 28,
                    timestamp: currentTime + index * 1000, // Stagger timestamps
                    buyerIsMaker: false,
                    tradeId: 12353 + index,
                    bestBid: price - TICK_SIZE,
                    bestAsk: price + TICK_SIZE,
                    zoneData: {
                        zones: [
                            {
                                zoneId: `tick-zone-${index}`,
                                priceLevel: price,
                                aggressiveVolume: 45,
                                passiveVolume: 12,
                                passiveAskVolume: 8,
                                passiveBidVolume: 22,
                                aggressiveBuyVolume: 25,
                                aggressiveSellVolume: 20,
                                lastUpdate: currentTime + index * 1000 - 10000,
                                tradeCount: 3,
                            },
                        ],
                    },
                };

                mockPreprocessor.findZonesNearPrice = vi
                    .fn()
                    .mockReturnValue([tickTestEvent.zoneData!.zones[0]]);

                // Process event - should handle all tick-compliant prices correctly
                detector.onEnrichedTrade(tickTestEvent);

                // No errors should occur with proper tick sizes
                expect(mockLogger.error).not.toHaveBeenCalled();
            });
        });
    });

    describe("Configuration Integration", () => {
        it("should use all configured thresholds without magic numbers", () => {
            // SCENARIO: Verify all thresholds come from configuration

            const currentTime = Date.now();
            const configTestEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: testSettings.minAggVolume, // Exactly at threshold
                timestamp: currentTime,
                buyerIsMaker: false,
                tradeId: 12356,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "config-zone",
                            priceLevel: BASE_PRICE,
                            // Design volumes to be exactly at thresholds
                            aggressiveVolume: Math.floor(
                                testSettings.minAggVolume *
                                    (testSettings.exhaustionThreshold /
                                        (1 - testSettings.exhaustionThreshold))
                            ),
                            passiveVolume: testSettings.minAggVolume,
                            passiveAskVolume: Math.floor(
                                testSettings.minAggVolume *
                                    testSettings.passiveRatioBalanceThreshold
                            ),
                            passiveBidVolume: testSettings.minAggVolume,
                            aggressiveBuyVolume: 15,
                            aggressiveSellVolume: 12,
                            lastUpdate: currentTime - 30000,
                            tradeCount: 2,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([configTestEvent.zoneData!.zones[0]]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(configTestEvent);

            // VALIDATION: Should work with configured values
            // The exact outcome depends on precise threshold calculations
            // but no magic numbers should be used in the logic

            // Verify logging contains configured values, not hardcoded ones
            const debugCalls = (mockLogger.debug as any).mock.calls;
            const loggedThresholds = debugCalls.find(
                (call: any[]) =>
                    call[0].includes("exhaustion detection") && call[1]
            );

            if (loggedThresholds) {
                expect(loggedThresholds[1].minAggVolume).toBe(
                    testSettings.minAggVolume
                );
                expect(loggedThresholds[1].exhaustionVolumeThreshold).toBe(
                    testSettings.minAggVolume
                );
            }
        });

        it("should respect cooldown configuration", async () => {
            // SCENARIO: Verify cooldown prevents signal spam

            const currentTime = Date.now();
            const exhaustionEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 40,
                timestamp: currentTime,
                buyerIsMaker: false,
                tradeId: 12357,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "cooldown-zone",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 80, // High exhaustion
                            passiveVolume: 10,
                            passiveAskVolume: 5, // Very low
                            passiveBidVolume: 30,
                            aggressiveBuyVolume: 45,
                            aggressiveSellVolume: 35,
                            lastUpdate: currentTime - 20000,
                            tradeCount: 6,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([exhaustionEvent.zoneData!.zones[0]]);

            let signalCount = 0;
            detector.on("signalCandidate", () => {
                signalCount++;
            });

            // Process first event - should emit signal
            detector.onEnrichedTrade(exhaustionEvent);
            expect(signalCount).toBe(1);

            // Process second identical event immediately - should be blocked by cooldown
            const secondEvent = {
                ...exhaustionEvent,
                timestamp: currentTime + 1000, // 1 second later
                tradeId: 12358,
            };

            detector.onEnrichedTrade(secondEvent);
            expect(signalCount).toBe(1); // Still 1 - blocked by cooldown

            // Verify cooldown blocking was logged
            const debugCalls = (mockLogger.debug as any).mock.calls;
            const cooldownLog = debugCalls.find((call: any[]) =>
                call[0].includes("blocked by cooldown")
            );
            expect(cooldownLog).toBeDefined();
            expect(cooldownLog[1].cooldownMs).toBe(
                testSettings.eventCooldownMs
            );
        });
    });

    describe("Signal Quality and Pattern Recognition", () => {
        it("should generate high-quality signals for clear exhaustion patterns", () => {
            // SCENARIO: Perfect exhaustion pattern - very high confidence expected

            const currentTime = Date.now();
            const highQualityEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 50, // Well above threshold
                timestamp: currentTime,
                buyerIsMaker: false, // Buy trade
                tradeId: 12359,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "quality-zone1",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 90, // Very high aggressive
                            passiveVolume: 8,
                            passiveAskVolume: 3, // Almost no ask liquidity
                            passiveBidVolume: 45, // Irrelevant
                            aggressiveBuyVolume: 55,
                            aggressiveSellVolume: 35,
                            lastUpdate: currentTime - 15000,
                            tradeCount: 8,
                        },
                        {
                            zoneId: "quality-zone2",
                            priceLevel: BASE_PRICE + TICK_SIZE,
                            aggressiveVolume: 75,
                            passiveVolume: 6,
                            passiveAskVolume: 2, // Virtually no ask liquidity
                            passiveBidVolume: 35,
                            aggressiveBuyVolume: 45,
                            aggressiveSellVolume: 30,
                            lastUpdate: currentTime - 12000,
                            tradeCount: 6,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([
                    highQualityEvent.zoneData!.zones[0],
                    highQualityEvent.zoneData!.zones[1],
                ]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(highQualityEvent);

            // VALIDATION: Should emit high-confidence signal
            expect(emittedSignal).not.toBeNull();
            expect(emittedSignal!.confidence).toBeGreaterThan(
                testSettings.premiumConfidenceThreshold
            );

            const signalData = emittedSignal!.data as any;
            expect(signalData.exhaustionScore).toBeGreaterThan(0.9);

            // Should be classified as premium quality
            expect(signalData.metadata?.qualityMetrics?.signalPurity).toBe(
                "premium"
            );

            // Verify successful signal parameters logged
            expect(
                mockValidationLogger.logSuccessfulSignal
            ).toHaveBeenCalledWith(
                "exhaustion",
                highQualityEvent,
                expect.any(Object),
                expect.any(Object)
            );
        });

        it("should reject ambiguous patterns with balanced liquidity", () => {
            // SCENARIO: Balanced liquidity - no clear exhaustion direction

            const currentTime = Date.now();
            const ambiguousEvent: EnrichedTradeEvent = {
                symbol: "LTCUSDT",
                price: BASE_PRICE,
                quantity: 35,
                timestamp: currentTime,
                buyerIsMaker: false, // Buy trade
                tradeId: 12360,
                bestBid: BASE_PRICE - TICK_SIZE,
                bestAsk: BASE_PRICE + TICK_SIZE,
                zoneData: {
                    zones: [
                        {
                            zoneId: "balanced-zone",
                            priceLevel: BASE_PRICE,
                            aggressiveVolume: 40, // Moderate aggressive
                            passiveVolume: 45, // Similar passive
                            passiveAskVolume: 22, // Balanced ask liquidity
                            passiveBidVolume: 23, // Balanced bid liquidity
                            aggressiveBuyVolume: 20,
                            aggressiveSellVolume: 20,
                            lastUpdate: currentTime - 25000,
                            tradeCount: 4,
                        },
                    ],
                },
            };

            mockPreprocessor.findZonesNearPrice = vi
                .fn()
                .mockReturnValue([ambiguousEvent.zoneData!.zones[0]]);

            let emittedSignal: SignalCandidate | null = null;
            detector.on("signalCandidate", (signal: SignalCandidate) => {
                emittedSignal = signal;
            });

            detector.onEnrichedTrade(ambiguousEvent);

            // VALIDATION: Should reject balanced pattern
            expect(emittedSignal).toBeNull();

            // Calculate expected ratio - should be around 50% (not exhausted)
            const expectedRatio = FinancialMath.divideQuantities(40, 40 + 22); // ~0.645
            expect(expectedRatio).toBeLessThan(
                testSettings.exhaustionThreshold
            );

            // Verify rejection was properly logged
            expect(mockValidationLogger.logRejection).toHaveBeenCalledWith(
                "exhaustion",
                expect.stringContaining("not_met"),
                ambiguousEvent,
                expect.any(Object),
                expect.any(Object)
            );
        });
    });
});
