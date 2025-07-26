import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import { OrderFlowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { Config } from "../__mocks__/src/core/config.js"; // Use mocked config, not production
import { createMockLogger } from "../__mocks__/src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../__mocks__/src/infrastructure/metricsCollector.js";

/**
 * MARKET-REALISTIC ABSORPTION DETECTOR SIGNAL VALIDATION
 *
 * This test suite validates absorption detector signal direction correctness using
 * 100 market-realistic scenarios where the correct signal can be definitively determined.
 *
 * OBJECTIVE: Determine if absorption detector produces correct buy/sell signals
 * compared to theoretical expectations based on market microstructure.
 */

interface DefinitiveTestCase {
    id: string;
    description: string;
    marketScenario: string;
    rawData: {
        buyerIsMaker: boolean;
        aggressiveVolume: number;
        passiveVolume: number;
        aggressiveBuyVolume: number;
        aggressiveSellVolume: number;
        passiveBuyVolume: number;
        passiveSellVolume: number;
        price: number;
        tradeCount: number;
    };
    theoreticalSignal: "buy" | "sell" | "neutral";
    reasoning: string;
    confidence: "high" | "medium" | "low";
    category: "clear_buy" | "clear_sell" | "neutral" | "edge_case";
}

interface ValidationResult {
    testId: string;
    expected: "buy" | "sell" | "neutral";
    actual: "buy" | "sell" | "neutral";
    correct: boolean;
    reasoning: string;
    marketContext: string;
    absorptionRatio: number;
    actualConfidence: number;
    confidenceLevel: "high" | "medium" | "low";
}

describe("Absorption Detector Market-Realistic Signal Validation", () => {
    let detector: AbsorptionDetectorEnhanced;
    let mockPreprocessor: OrderFlowPreprocessor;

    beforeEach(() => {
        // Create mock preprocessor
        mockPreprocessor = {
            findZonesNearPrice: vi.fn().mockReturnValue([]),
        } as any;

        // Use mock configuration for testing
        const testConfig = Config.ABSORPTION_DETECTOR;

        // Create mock signal logger
        const mockSignalLogger = {
            logSignal: (...args: any[]) => {},
            logSignalProcessing: (...args: any[]) => {},
            logSignalResult: (...args: any[]) => {},
        };

        detector = new AbsorptionDetectorEnhanced(
            "test-absorption-realistic",
            "LTCUSDT",
            testConfig,
            mockPreprocessor,
            createMockLogger(),
            new MetricsCollector()
        );

        // Clear any accumulated state to prevent test contamination
        (detector as any).lastSignal?.clear();
    });

    /**
     * PHASE 1: GENERATE 100 MARKET-REALISTIC TEST CASES
     */
    function generateMarketRealisticTestCases(): DefinitiveTestCase[] {
        const testCases: DefinitiveTestCase[] = [];

        // CLEAR SELL SCENARIOS (1-25): Institution absorbing retail selling pressure
        for (let i = 1; i <= 25; i++) {
            const baseAggressive = 100 + i * 20; // 120-620 LTC aggressive selling
            const absorptionMultiplier = 2.5 + i * 0.1; // 2.6x to 5.0x passive absorption
            const passiveVol = Math.round(
                baseAggressive * absorptionMultiplier
            );

            // Realistic retail panic selling patterns
            const sellRatio = 0.8 + i * 0.005; // 80-92.5% of aggressive is selling
            const aggressiveSell = Math.round(baseAggressive * sellRatio);
            const aggressiveBuy = baseAggressive - aggressiveSell;

            // Institution providing buy liquidity (70-85% of passive)
            const institutionalBuyRatio = 0.7 + i * 0.006; // 70-84% institutional buying
            const passiveBuy = Math.round(passiveVol * institutionalBuyRatio);
            const passiveSell = passiveVol - passiveBuy;

            testCases.push({
                id: `clear_buy_${i}`,
                description: `Retail panic selling (${aggressiveSell} LTC) absorbed by institution (${passiveBuy} LTC buy liquidity)`,
                marketScenario: "retail_panic_selling",
                rawData: {
                    buyerIsMaker: true, // Aggressive retail SELLING
                    aggressiveVolume: baseAggressive,
                    passiveVolume: passiveVol,
                    aggressiveBuyVolume: aggressiveBuy,
                    aggressiveSellVolume: aggressiveSell,
                    passiveBuyVolume: passiveBuy,
                    passiveSellVolume: passiveSell,
                    price: 89.5 + i * 0.01, // Realistic LTC pricing
                    tradeCount: Math.max(Math.floor(baseAggressive / 25), 8),
                },
                theoreticalSignal: "buy", // Flow-following: follow institutional buying direction
                reasoning: `Institution absorbing ${Math.round((passiveVol / (baseAggressive + passiveVol)) * 100)}% of flow against retail selling. Institutional BUY signal expected.`,
                confidence: i <= 15 ? "high" : "medium",
                category: "clear_buy",
            });
        }

        // CLEAR BUY SCENARIOS (26-50): Institution absorbing retail buying pressure
        for (let i = 26; i <= 50; i++) {
            const testIndex = i - 25;
            const baseAggressive = 120 + testIndex * 22; // 142-670 LTC aggressive buying
            const absorptionMultiplier = 2.3 + testIndex * 0.12; // 2.42x to 5.3x passive absorption
            const passiveVol = Math.round(
                baseAggressive * absorptionMultiplier
            );

            // Realistic retail FOMO buying patterns
            const buyRatio = 0.82 + testIndex * 0.004; // 82-92% of aggressive is buying
            const aggressiveBuy = Math.round(baseAggressive * buyRatio);
            const aggressiveSell = baseAggressive - aggressiveBuy;

            // Institution providing sell liquidity (72-86% of passive)
            const institutionalSellRatio = 0.72 + testIndex * 0.0056; // 72-86% institutional selling
            const passiveSell = Math.round(passiveVol * institutionalSellRatio);
            const passiveBuy = passiveVol - passiveSell;

            testCases.push({
                id: `clear_sell_${i}`,
                description: `Retail FOMO buying (${aggressiveBuy} LTC) absorbed by institution (${passiveSell} LTC sell liquidity)`,
                marketScenario: "retail_fomo_buying",
                rawData: {
                    buyerIsMaker: false, // Aggressive retail BUYING
                    aggressiveVolume: baseAggressive,
                    passiveVolume: passiveVol,
                    aggressiveBuyVolume: aggressiveBuy,
                    aggressiveSellVolume: aggressiveSell,
                    passiveBuyVolume: passiveBuy,
                    passiveSellVolume: passiveSell,
                    price: 89.75 + testIndex * 0.015,
                    tradeCount: Math.max(Math.floor(baseAggressive / 23), 9),
                },
                theoreticalSignal: "sell", // Flow-following: follow institutional selling direction
                reasoning: `Institution absorbing ${Math.round((passiveVol / (baseAggressive + passiveVol)) * 100)}% of flow against retail buying. Institutional SELL signal expected.`,
                confidence: testIndex <= 15 ? "high" : "medium",
                category: "clear_sell",
            });
        }

        // NEUTRAL SCENARIOS (51-75): Balanced or insufficient absorption
        for (let i = 51; i <= 75; i++) {
            const testIndex = i - 50;
            let scenario: DefinitiveTestCase;

            if (testIndex <= 10) {
                // Insufficient absorption ratio (40-55%)
                const baseAggressive = 200 + testIndex * 15;
                const lowPassiveMultiplier = 0.6 + testIndex * 0.02; // 0.6x to 0.8x
                const passiveVol = Math.round(
                    baseAggressive * lowPassiveMultiplier
                );

                scenario = {
                    id: `neutral_low_absorption_${i}`,
                    description: `Insufficient absorption: ${Math.round((passiveVol / (baseAggressive + passiveVol)) * 100)}% passive ratio`,
                    marketScenario: "insufficient_absorption",
                    rawData: {
                        buyerIsMaker: testIndex % 2 === 0,
                        aggressiveVolume: baseAggressive,
                        passiveVolume: passiveVol,
                        aggressiveBuyVolume:
                            testIndex % 2 === 0
                                ? baseAggressive * 0.3
                                : baseAggressive * 0.7,
                        aggressiveSellVolume:
                            testIndex % 2 === 0
                                ? baseAggressive * 0.7
                                : baseAggressive * 0.3,
                        passiveBuyVolume: passiveVol * 0.5,
                        passiveSellVolume: passiveVol * 0.5,
                        price: 89.25 + testIndex * 0.02,
                        tradeCount: Math.floor(baseAggressive / 30),
                    },
                    theoreticalSignal: "neutral",
                    reasoning: `Passive ratio ${Math.round((passiveVol / (baseAggressive + passiveVol)) * 100)}% below absorption threshold. No institutional dominance.`,
                    confidence: "high",
                    category: "neutral",
                };
            } else if (testIndex <= 20) {
                // Balanced flow (both sides similar strength)
                const baseVolume = 180 + testIndex * 12;
                const aggressiveVol = Math.round(baseVolume * 0.52); // 52% aggressive
                const passiveVol = baseVolume - aggressiveVol; // 48% passive

                scenario = {
                    id: `neutral_balanced_${i}`,
                    description: `Balanced flow: ${aggressiveVol} aggressive vs ${passiveVol} passive`,
                    marketScenario: "balanced_market",
                    rawData: {
                        buyerIsMaker: testIndex % 2 === 0,
                        aggressiveVolume: aggressiveVol,
                        passiveVolume: passiveVol,
                        aggressiveBuyVolume: aggressiveVol * 0.5,
                        aggressiveSellVolume: aggressiveVol * 0.5,
                        passiveBuyVolume: passiveVol * 0.5,
                        passiveSellVolume: passiveVol * 0.5,
                        price: 89.6 + testIndex * 0.01,
                        tradeCount: Math.floor(aggressiveVol / 25),
                    },
                    theoreticalSignal: "neutral",
                    reasoning: `Balanced flow with 50/50 buy/sell distribution. No clear directional pressure.`,
                    confidence: "high",
                    category: "neutral",
                };
            } else {
                // Low total volume scenarios
                const lowVolume = 40 + testIndex * 3; // 49-64 LTC total
                const aggressiveVol = Math.round(lowVolume * 0.6);
                const passiveVol = lowVolume - aggressiveVol;

                scenario = {
                    id: `neutral_low_volume_${i}`,
                    description: `Low volume: ${lowVolume} LTC total volume`,
                    marketScenario: "low_volume_period",
                    rawData: {
                        buyerIsMaker: testIndex % 2 === 0,
                        aggressiveVolume: aggressiveVol,
                        passiveVolume: passiveVol,
                        aggressiveBuyVolume: aggressiveVol * 0.6,
                        aggressiveSellVolume: aggressiveVol * 0.4,
                        passiveBuyVolume: passiveVol * 0.4,
                        passiveSellVolume: passiveVol * 0.6,
                        price: 89.3 + testIndex * 0.005,
                        tradeCount: Math.max(Math.floor(aggressiveVol / 15), 2),
                    },
                    theoreticalSignal: "neutral", // Low volume scenarios below institutional threshold (updated for optimized config)
                    reasoning: `Total volume ${lowVolume} LTC below institutional threshold (3000 LTC). Optimized config requires higher volume for signal generation.`,
                    confidence: "medium",
                    category: "neutral",
                };
            }

            testCases.push(scenario);
        }

        // EDGE CASE SCENARIOS (76-100): Boundary conditions and complex cases
        for (let i = 76; i <= 100; i++) {
            const testIndex = i - 75;
            let scenario: DefinitiveTestCase;

            if (testIndex <= 8) {
                // Exactly at absorption threshold (60% passive)
                const baseAggressive = 150 + testIndex * 25;
                const passiveVol = Math.round(baseAggressive * 1.5); // Exactly 60% passive ratio

                scenario = {
                    id: `edge_threshold_${i}`,
                    description: `Exactly at 60% absorption threshold`,
                    marketScenario: "threshold_boundary",
                    rawData: {
                        buyerIsMaker: testIndex % 2 === 0,
                        aggressiveVolume: baseAggressive,
                        passiveVolume: passiveVol,
                        aggressiveBuyVolume:
                            testIndex % 2 === 0
                                ? baseAggressive * 0.2
                                : baseAggressive * 0.8,
                        aggressiveSellVolume:
                            testIndex % 2 === 0
                                ? baseAggressive * 0.8
                                : baseAggressive * 0.2,
                        passiveBuyVolume:
                            testIndex % 2 === 0
                                ? passiveVol * 0.8
                                : passiveVol * 0.2,
                        passiveSellVolume:
                            testIndex % 2 === 0
                                ? passiveVol * 0.2
                                : passiveVol * 0.8,
                        price: 89.8 + testIndex * 0.02,
                        tradeCount: Math.floor(baseAggressive / 20),
                    },
                    theoreticalSignal: testIndex % 2 === 0 ? "buy" : "sell", // Flow-following: follow institutional direction
                    reasoning: `At 60% threshold with clear directional absorption pattern. Flow-following: ${testIndex % 2 === 0 ? "buy" : "sell"} signal.`,
                    confidence: "low",
                    category: "edge_case",
                };
            } else if (testIndex <= 16) {
                // Extreme absorption (>90% passive)
                const baseAggressive = 80 + testIndex * 8;
                const extremePassive = Math.round(baseAggressive * 9); // 90% passive ratio

                scenario = {
                    id: `edge_extreme_${i}`,
                    description: `Extreme absorption: 90% passive ratio`,
                    marketScenario: "extreme_institutional_absorption",
                    rawData: {
                        buyerIsMaker: testIndex % 2 === 0,
                        aggressiveVolume: baseAggressive,
                        passiveVolume: extremePassive,
                        aggressiveBuyVolume:
                            testIndex % 2 === 0
                                ? baseAggressive * 0.1
                                : baseAggressive * 0.9,
                        aggressiveSellVolume:
                            testIndex % 2 === 0
                                ? baseAggressive * 0.9
                                : baseAggressive * 0.1,
                        passiveBuyVolume:
                            testIndex % 2 === 0
                                ? extremePassive * 0.95
                                : extremePassive * 0.05,
                        passiveSellVolume:
                            testIndex % 2 === 0
                                ? extremePassive * 0.05
                                : extremePassive * 0.95,
                        price: 90.0 + testIndex * 0.03,
                        tradeCount: Math.floor(baseAggressive / 12),
                    },
                    theoreticalSignal: testIndex % 2 === 0 ? "buy" : "sell", // Flow-following: follow institutional direction
                    reasoning: `Extreme 90% absorption with clear institutional dominance. Flow-following: ${testIndex % 2 === 0 ? "buy" : "sell"} signal.`,
                    confidence: "high",
                    category: "edge_case",
                };
            } else {
                // Mixed institutional vs institutional scenarios
                const baseAggressive = 300 + testIndex * 20;
                const passiveVol = Math.round(baseAggressive * 2.2); // 69% passive

                scenario = {
                    id: `edge_institutional_battle_${i}`,
                    description: `Institutional vs institutional flow`,
                    marketScenario: "institutional_battle",
                    rawData: {
                        buyerIsMaker: testIndex % 2 === 0,
                        aggressiveVolume: baseAggressive,
                        passiveVolume: passiveVol,
                        aggressiveBuyVolume: baseAggressive * 0.5, // Balanced institutional aggression
                        aggressiveSellVolume: baseAggressive * 0.5,
                        passiveBuyVolume: passiveVol * 0.5, // Balanced institutional passive
                        passiveSellVolume: passiveVol * 0.5,
                        price: 90.2 + testIndex * 0.025,
                        tradeCount: Math.floor(baseAggressive / 18),
                    },
                    theoreticalSignal: "neutral", // No clear retail vs institutional pattern
                    reasoning: `Institutional vs institutional flow - no clear retail absorption pattern.`,
                    confidence: "medium",
                    category: "edge_case",
                };
            }

            testCases.push(scenario);
        }

        return testCases;
    }

    /**
     * PHASE 2: EXECUTE TESTS AND VALIDATE SIGNALS
     */
    function createRealisticTradeEvent(
        testCase: DefinitiveTestCase
    ): EnrichedTradeEvent {
        const data = testCase.rawData;

        // Create realistic zone snapshot matching production format
        const zone: ZoneSnapshot = {
            zoneId: `zone-${testCase.id}`,
            priceLevel: data.price,
            tickSize: 0.01,
            aggressiveVolume: data.aggressiveVolume,
            passiveVolume: data.passiveVolume,
            aggressiveBuyVolume: data.aggressiveBuyVolume,
            aggressiveSellVolume: data.aggressiveSellVolume,
            passiveBidVolume: data.passiveBuyVolume,
            passiveAskVolume: data.passiveSellVolume,
            tradeCount: data.tradeCount,
            timespan: 60000, // 1-minute window
            boundaries: {
                min: data.price - 0.025,
                max: data.price + 0.025,
            },
            lastUpdate: Date.now(),
            volumeWeightedPrice: data.price,
            tradeHistory: [], // Empty trade history for test zones
        };

        // Update mock to return realistic zone data
        mockPreprocessor.findZonesNearPrice = vi.fn().mockReturnValue([zone]);

        // Use synchronized timestamp for zones and trade events
        const currentTime = Date.now();
        zone.lastUpdate = currentTime;

        const event: EnrichedTradeEvent = {
            price: data.price,
            quantity: Math.max(data.aggressiveVolume / data.tradeCount, 60), // Institutional-grade trade size (above 50 LTC minimum)
            timestamp: currentTime,
            buyerIsMaker: data.buyerIsMaker,
            pair: "LTCUSDT",
            tradeId: `trade-${testCase.id}`,
            originalTrade: {} as any,
            passiveBidVolume: data.passiveBuyVolume,
            passiveAskVolume: data.passiveSellVolume,
            zonePassiveBidVolume: data.passiveBuyVolume,
            zonePassiveAskVolume: data.passiveSellVolume,
            bestBid: data.price - 0.01,
            bestAsk: data.price + 0.01,
            zoneData: {
                zones: [zone],
                zoneConfig: {
                    zoneTicks: 10,
                    tickValue: 0.01,
                    timeWindow: 60000,
                },
            } as StandardZoneData,
        };

        return event;
    }

    function validateAbsorptionSignal(
        testCase: DefinitiveTestCase
    ): ValidationResult {
        const event = createRealisticTradeEvent(testCase);

        // Capture signals
        const signals: any[] = [];
        detector.on("signalCandidate", (signal: any) => {
            signals.push(signal);
        });

        // Execute detector
        detector.onEnrichedTrade(event);

        const result = signals.length > 0 ? signals[0] : null;
        const actualSignal = result?.side || "neutral";
        const actualConfidence = result?.confidence || 0;

        // Calculate actual absorption ratio for analysis
        const totalVolume =
            testCase.rawData.aggressiveVolume + testCase.rawData.passiveVolume;
        const absorptionRatio =
            totalVolume > 0 ? testCase.rawData.passiveVolume / totalVolume : 0;

        return {
            testId: testCase.id,
            expected: testCase.theoreticalSignal,
            actual: actualSignal,
            correct: actualSignal === testCase.theoreticalSignal,
            reasoning: testCase.reasoning,
            marketContext: testCase.marketScenario,
            absorptionRatio,
            actualConfidence,
            confidenceLevel: testCase.confidence,
        };
    }

    /**
     * PHASE 3: COMPREHENSIVE TEST EXECUTION
     */
    describe("100 Market-Realistic Signal Validation Tests", () => {
        const testCases = generateMarketRealisticTestCases();
        const results: ValidationResult[] = [];

        testCases.forEach((testCase, index) => {
            it(`Test ${index + 1}: ${testCase.description}`, () => {
                const result = validateAbsorptionSignal(testCase);
                results.push(result);

                // Log failed tests with detailed analysis
                if (!result.correct) {
                    console.log(`❌ SIGNAL MISMATCH - Test ${index + 1}:`, {
                        testId: testCase.id,
                        category: testCase.category,
                        expected: result.expected,
                        actual: result.actual,
                        absorptionRatio: result.absorptionRatio.toFixed(3),
                        actualConfidence: result.actualConfidence.toFixed(3),
                        buyerIsMaker: testCase.rawData.buyerIsMaker,
                        marketScenario: result.marketContext,
                        reasoning: result.reasoning,
                    });
                } else {
                    console.log(
                        `✅ CORRECT SIGNAL - Test ${index + 1}: Expected ${result.expected}, Got ${result.actual}`
                    );
                }

                // Test passes if signal matches expectation
                expect(result.actual).toBe(result.expected);
            });
        });

        // Comprehensive accuracy analysis
        it("should provide comprehensive signal accuracy analysis", () => {
            const totalTests = results.length;
            const correctSignals = results.filter((r) => r.correct).length;
            const overallAccuracy =
                totalTests > 0 ? (correctSignals / totalTests) * 100 : 0;

            // Category-specific accuracy
            const byCategory = {
                clear_buy: results.filter((r) =>
                    r.testId.includes("clear_buy")
                ),
                clear_sell: results.filter((r) =>
                    r.testId.includes("clear_sell")
                ),
                neutral: results.filter((r) => r.testId.includes("neutral")),
                edge_case: results.filter((r) => r.testId.includes("edge")),
            };

            const categoryAccuracy = {
                clear_buy:
                    (byCategory.clear_buy.filter((r) => r.correct).length /
                        byCategory.clear_buy.length) *
                    100,
                clear_sell:
                    (byCategory.clear_sell.filter((r) => r.correct).length /
                        byCategory.clear_sell.length) *
                    100,
                neutral:
                    (byCategory.neutral.filter((r) => r.correct).length /
                        byCategory.neutral.length) *
                    100,
                edge_case:
                    (byCategory.edge_case.filter((r) => r.correct).length /
                        byCategory.edge_case.length) *
                    100,
            };

            // Signal distribution analysis
            const signalDistribution = {
                expected_buy: results.filter((r) => r.expected === "buy")
                    .length,
                expected_sell: results.filter((r) => r.expected === "sell")
                    .length,
                expected_neutral: results.filter(
                    (r) => r.expected === "neutral"
                ).length,
                actual_buy: results.filter((r) => r.actual === "buy").length,
                actual_sell: results.filter((r) => r.actual === "sell").length,
                actual_neutral: results.filter((r) => r.actual === "neutral")
                    .length,
            };

            // Systematic bias detection
            const buySignalsCorrect = results.filter(
                (r) => r.expected === "buy" && r.correct
            ).length;
            const buySignalsTotal = results.filter(
                (r) => r.expected === "buy"
            ).length;
            const sellSignalsCorrect = results.filter(
                (r) => r.expected === "sell" && r.correct
            ).length;
            const sellSignalsTotal = results.filter(
                (r) => r.expected === "sell"
            ).length;

            const buyAccuracy =
                buySignalsTotal > 0
                    ? (buySignalsCorrect / buySignalsTotal) * 100
                    : 0;
            const sellAccuracy =
                sellSignalsTotal > 0
                    ? (sellSignalsCorrect / sellSignalsTotal) * 100
                    : 0;

            console.log(`
📊 COMPREHENSIVE ABSORPTION DETECTOR SIGNAL VALIDATION RESULTS:
==================================================================

OVERALL PERFORMANCE:
• Total Tests: ${totalTests}
• Correct Signals: ${correctSignals}
• Overall Accuracy: ${overallAccuracy.toFixed(1)}%

CATEGORY BREAKDOWN:
• Clear BUY Scenarios: ${categoryAccuracy.clear_buy.toFixed(1)}% (${byCategory.clear_buy.filter((r) => r.correct).length}/${byCategory.clear_buy.length})
• Clear SELL Scenarios: ${categoryAccuracy.clear_sell.toFixed(1)}% (${byCategory.clear_sell.filter((r) => r.correct).length}/${byCategory.clear_sell.length})
• NEUTRAL Scenarios: ${categoryAccuracy.neutral.toFixed(1)}% (${byCategory.neutral.filter((r) => r.correct).length}/${byCategory.neutral.length})
• EDGE Cases: ${categoryAccuracy.edge_case.toFixed(1)}% (${byCategory.edge_case.filter((r) => r.correct).length}/${byCategory.edge_case.length})

SIGNAL DIRECTION ACCURACY:
• BUY Signal Accuracy: ${buyAccuracy.toFixed(1)}% (${buySignalsCorrect}/${buySignalsTotal})
• SELL Signal Accuracy: ${sellAccuracy.toFixed(1)}% (${sellSignalsCorrect}/${sellSignalsTotal})

SIGNAL DISTRIBUTION:
Expected: ${signalDistribution.expected_buy} BUY, ${signalDistribution.expected_sell} SELL, ${signalDistribution.expected_neutral} NEUTRAL
Actual:   ${signalDistribution.actual_buy} BUY, ${signalDistribution.actual_sell} SELL, ${signalDistribution.actual_neutral} NEUTRAL

SYSTEMATIC BIAS DETECTION:
${buyAccuracy < 50 ? "❌ CRITICAL: BUY signal systematic failure" : buyAccuracy < 80 ? "⚠️  BUY signals need improvement" : "✅ BUY signals accurate"}
${sellAccuracy < 50 ? "❌ CRITICAL: SELL signal systematic failure" : sellAccuracy < 80 ? "⚠️  SELL signals need improvement" : "✅ SELL signals accurate"}
${overallAccuracy < 70 ? "❌ CRITICAL: Overall signal accuracy unacceptable" : overallAccuracy < 85 ? "⚠️  Signal accuracy needs improvement" : "✅ Signal accuracy acceptable"}

CONCLUSION:
${overallAccuracy >= 85 ? "✅ ABSORPTION DETECTOR SIGNALS ARE RELIABLE" : "❌ ABSORPTION DETECTOR SIGNALS REQUIRE CORRECTION"}
            `);

            // This test always passes - it's for analysis
            expect(true).toBe(true);
        });
    });
});
