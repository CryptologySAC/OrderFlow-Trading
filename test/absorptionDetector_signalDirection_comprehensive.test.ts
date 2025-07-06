import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import { OrderFlowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { Config } from "../src/core/config.js";
import { createMockLogger } from "../__mocks__/src/infrastructure/loggerInterface.js";
import mockMetricsCollector from "../__mocks__/src/infrastructure/metricsCollector.js";

/**
 * COMPREHENSIVE ABSORPTION DETECTOR SIGNAL DIRECTION VERIFICATION
 *
 * This test suite systematically verifies the absorption detector's signal direction logic
 * across 100 parametric scenarios ranging from obvious buy to obvious sell conditions.
 *
 * THEORETICAL FOUNDATION:
 * - Absorption should emit COUNTER-TREND signals
 * - High aggressive sell (buyerIsMaker=true) + high passive = BUY signal
 * - High aggressive buy (buyerIsMaker=false) + high passive = SELL signal
 */

interface AbsorptionTestScenario {
    id: string;
    description: string;
    buyerIsMaker: boolean;
    aggressiveVolume: number;
    passiveVolume: number;
    price: number;
    expectedSignal: "buy" | "sell" | "neutral";
    confidence: "high" | "medium" | "low";
    category: "obvious_buy" | "obvious_sell" | "neutral_edge" | "transition";
}

interface TestResult {
    scenario: string;
    expected: "buy" | "sell" | "neutral";
    actual: "buy" | "sell" | "neutral";
    passed: boolean;
    confidence: number;
    absorptionRatio: number;
    counterTrendLogic: boolean;
    details: string;
}

describe("AbsorptionDetector Signal Direction - Comprehensive Verification", () => {
    let detector: AbsorptionDetectorEnhanced;
    let mockPreprocessor: OrderFlowPreprocessor;

    beforeEach(() => {
        // Create mock preprocessor
        mockPreprocessor = {
            findZonesNearPrice: vi.fn().mockReturnValue([
                {
                    id: "test-zone",
                    price: 89.0,
                    aggressiveVolume: 100,
                    passiveVolume: 300,
                    aggressiveBuyVolume: 50,
                    aggressiveSellVolume: 50,
                    passiveBuyVolume: 150,
                    passiveSellVolume: 150,
                    tradeCount: 10,
                    lastUpdate: Date.now(),
                    timespan: 60000,
                    strength: 0.8,
                } as ZoneSnapshot,
            ]),
        } as any;

        // Create detector with test configuration
        const testConfig = {
            ...Config.ABSORPTION_DETECTOR_ENHANCED,
            minAggVolume: 50,
            absorptionThreshold: 0.6,
            absorptionRatioThreshold: 0.6,
        };

        detector = new AbsorptionDetectorEnhanced(
            "test-absorption",
            "LTCUSDT",
            testConfig,
            mockPreprocessor,
            createMockLogger(),
            mockMetricsCollector
        );
    });

    /**
     * PHASE 1: TEST DATA GENERATION FRAMEWORK
     */
    function generateAbsorptionTestScenarios(): AbsorptionTestScenario[] {
        const scenarios: AbsorptionTestScenario[] = [];

        // OBVIOUS BUY SCENARIOS (1-25): Aggressive Sell Absorption
        for (let i = 1; i <= 25; i++) {
            const aggressiveVol = 50 + i * 10;
            const passiveMultiplier = 2.0 + i * 0.1; // 2.0 to 4.5

            scenarios.push({
                id: `obvious_buy_${i}`,
                description: `Obvious BUY: Aggressive sell (${aggressiveVol}) absorbed by high passive (${Math.round(aggressiveVol * passiveMultiplier)})`,
                buyerIsMaker: true, // Aggressive SELL
                aggressiveVolume: aggressiveVol,
                passiveVolume: Math.round(aggressiveVol * passiveMultiplier),
                price: 89.0 + i * 0.01,
                expectedSignal: "buy", // Counter-trend to aggressive sell
                confidence: i <= 15 ? "high" : "medium",
                category: "obvious_buy",
            });
        }

        // OBVIOUS SELL SCENARIOS (26-50): Aggressive Buy Absorption
        for (let i = 26; i <= 50; i++) {
            const aggressiveVol = 50 + (i - 25) * 10;
            const passiveMultiplier = 2.0 + (i - 25) * 0.1; // 2.0 to 4.5

            scenarios.push({
                id: `obvious_sell_${i}`,
                description: `Obvious SELL: Aggressive buy (${aggressiveVol}) absorbed by high passive (${Math.round(aggressiveVol * passiveMultiplier)})`,
                buyerIsMaker: false, // Aggressive BUY
                aggressiveVolume: aggressiveVol,
                passiveVolume: Math.round(aggressiveVol * passiveMultiplier),
                price: 89.0 + (i - 25) * 0.01,
                expectedSignal: "sell", // Counter-trend to aggressive buy
                confidence: i <= 40 ? "high" : "medium",
                category: "obvious_sell",
            });
        }

        // NEUTRAL EDGE CASES (51-75): Threshold Boundaries
        for (let i = 51; i <= 75; i++) {
            const testIndex = i - 50;
            let passiveRatio: number;
            let expectedSignal: "buy" | "sell" | "neutral";

            if (testIndex <= 10) {
                // Exactly at threshold boundary
                passiveRatio = 0.6 + (testIndex - 5) * 0.002; // 0.590 to 0.610
                expectedSignal =
                    passiveRatio >= 0.6
                        ? testIndex % 2 === 0
                            ? "buy"
                            : "sell"
                        : "neutral";
            } else if (testIndex <= 15) {
                // Below threshold
                passiveRatio = 0.55 + (testIndex - 10) * 0.008; // 0.55 to 0.595
                expectedSignal = "neutral";
            } else if (testIndex <= 20) {
                // Equal aggressive/passive (50/50)
                passiveRatio = 0.5;
                expectedSignal = "neutral";
            } else {
                // Zero aggressive volume edge cases
                passiveRatio = testIndex % 2 === 0 ? 0.8 : 0.4;
                expectedSignal = "neutral"; // No aggressive flow to counter
            }

            const totalVolume = 200;
            const passiveVol = Math.round(totalVolume * passiveRatio);
            const aggressiveVol = totalVolume - passiveVol;

            scenarios.push({
                id: `neutral_edge_${i}`,
                description: `Neutral edge case: ${passiveRatio.toFixed(3)} passive ratio (${passiveVol}/${aggressiveVol})`,
                buyerIsMaker: testIndex % 2 === 0,
                aggressiveVolume: Math.max(aggressiveVol, 1), // Avoid zero
                passiveVolume: passiveVol,
                price: 89.0 + testIndex * 0.01,
                expectedSignal,
                confidence: "low",
                category: "neutral_edge",
            });
        }

        // TRANSITION SCENARIOS (76-100): Complex Market Conditions
        for (let i = 76; i <= 100; i++) {
            const testIndex = i - 75;
            let scenario: AbsorptionTestScenario;

            if (testIndex <= 8) {
                // Mixed confidence scenarios
                const passiveRatio = 0.65 + testIndex * 0.02; // 0.65 to 0.81
                const aggressiveVol = 80 + testIndex * 10;
                const passiveVol = Math.round(
                    (aggressiveVol * passiveRatio) / (1 - passiveRatio)
                );

                scenario = {
                    id: `transition_confidence_${i}`,
                    description: `Transition: Mixed confidence ${passiveRatio.toFixed(2)} ratio`,
                    buyerIsMaker: testIndex % 2 === 0,
                    aggressiveVolume: aggressiveVol,
                    passiveVolume: passiveVol,
                    price: 89.0 + testIndex * 0.01,
                    expectedSignal: testIndex % 2 === 0 ? "buy" : "sell",
                    confidence: "medium",
                    category: "transition",
                };
            } else if (testIndex <= 15) {
                // High volatility scenarios
                const volatilityFactor = 1.5 + (testIndex - 8) * 0.2;
                scenario = {
                    id: `transition_volatility_${i}`,
                    description: `Transition: High volatility ${volatilityFactor.toFixed(1)}x`,
                    buyerIsMaker: testIndex % 2 === 0,
                    aggressiveVolume: Math.round(100 * volatilityFactor),
                    passiveVolume: Math.round(250 * volatilityFactor),
                    price: 89.0 + (testIndex - 8) * 0.02,
                    expectedSignal: testIndex % 2 === 0 ? "buy" : "sell",
                    confidence: "medium",
                    category: "transition",
                };
            } else {
                // Real market pattern scenarios
                const patterns = [
                    {
                        aggVol: 150,
                        passVol: 450,
                        buyerMaker: true,
                        expected: "buy" as const,
                    },
                    {
                        aggVol: 200,
                        passVol: 500,
                        buyerMaker: false,
                        expected: "sell" as const,
                    },
                    {
                        aggVol: 75,
                        passVol: 300,
                        buyerMaker: true,
                        expected: "buy" as const,
                    },
                    {
                        aggVol: 300,
                        passVol: 600,
                        buyerMaker: false,
                        expected: "sell" as const,
                    },
                    {
                        aggVol: 120,
                        passVol: 200,
                        buyerMaker: true,
                        expected: "buy" as const,
                    },
                    {
                        aggVol: 180,
                        passVol: 360,
                        buyerMaker: false,
                        expected: "sell" as const,
                    },
                    {
                        aggVol: 90,
                        passVol: 270,
                        buyerMaker: true,
                        expected: "buy" as const,
                    },
                    {
                        aggVol: 250,
                        passVol: 750,
                        buyerMaker: false,
                        expected: "sell" as const,
                    },
                    {
                        aggVol: 160,
                        passVol: 400,
                        buyerMaker: true,
                        expected: "buy" as const,
                    },
                ];

                const pattern = patterns[(testIndex - 16) % patterns.length];
                scenario = {
                    id: `transition_real_${i}`,
                    description: `Transition: Real market pattern ${pattern.aggVol}/${pattern.passVol}`,
                    buyerIsMaker: pattern.buyerMaker,
                    aggressiveVolume: pattern.aggVol,
                    passiveVolume: pattern.passVol,
                    price: 89.0 + (testIndex - 15) * 0.01,
                    expectedSignal: pattern.expected,
                    confidence: "high",
                    category: "transition",
                };
            }

            scenarios.push(scenario);
        }

        return scenarios;
    }

    /**
     * PHASE 2: TEST EXECUTION FRAMEWORK
     */
    function createTradeEvent(
        scenario: AbsorptionTestScenario
    ): EnrichedTradeEvent {
        // Calculate zone volumes based on scenario
        const totalVolume = scenario.aggressiveVolume + scenario.passiveVolume;
        const aggressiveBuy = scenario.buyerIsMaker
            ? 0
            : scenario.aggressiveVolume;
        const aggressiveSell = scenario.buyerIsMaker
            ? scenario.aggressiveVolume
            : 0;

        // Mock the zone data that will be returned by findZonesNearPrice
        const mockZone: ZoneSnapshot = {
            id: `zone-${scenario.id}`,
            price: scenario.price,
            aggressiveVolume: scenario.aggressiveVolume,
            passiveVolume: scenario.passiveVolume,
            aggressiveBuyVolume: aggressiveBuy,
            aggressiveSellVolume: aggressiveSell,
            passiveBuyVolume: scenario.passiveVolume / 2,
            passiveSellVolume: scenario.passiveVolume / 2,
            tradeCount: Math.max(Math.round(totalVolume / 20), 3),
            lastUpdate: Date.now(),
            timespan: 60000,
            strength: scenario.passiveVolume / totalVolume,
        };

        // Update mock to return our scenario-specific zone
        mockPreprocessor.findZonesNearPrice = vi
            .fn()
            .mockReturnValue([mockZone]);

        const event: EnrichedTradeEvent = {
            price: scenario.price,
            quantity: 10,
            timestamp: Date.now(),
            buyerIsMaker: scenario.buyerIsMaker,
            pair: "LTCUSDT",
            tradeId: `trade-${scenario.id}`,
            originalTrade: {} as any,
            zoneData: {
                zones5Tick: [mockZone],
                zones10Tick: [mockZone],
                zones20Tick: [mockZone],
            } as StandardZoneData,
            depth: {
                bids: [[scenario.price - 0.01, scenario.passiveVolume / 2]],
                asks: [[scenario.price + 0.01, scenario.passiveVolume / 2]],
            } as any,
            spread: 0.02,
            midPrice: scenario.price,
        };

        return event;
    }

    function verifyAbsorptionLogic(
        scenario: AbsorptionTestScenario
    ): TestResult {
        const event = createTradeEvent(scenario);

        // Execute the detector
        const signals: any[] = [];
        detector.on("signalCandidate", (signal: any) => {
            signals.push(signal);
        });

        detector.onEnrichedTrade(event);

        const result = signals.length > 0 ? signals[0] : null;
        const actualSignal = result?.side || "neutral";
        const confidence = result?.confidence || 0;

        // Calculate absorption ratio for analysis
        const totalVolume = scenario.aggressiveVolume + scenario.passiveVolume;
        const absorptionRatio =
            totalVolume > 0 ? scenario.passiveVolume / totalVolume : 0;

        // Verify counter-trend logic
        const counterTrendLogic = verifyCounterTrendBehavior(
            scenario,
            actualSignal
        );

        return {
            scenario: scenario.id,
            expected: scenario.expectedSignal,
            actual: actualSignal,
            passed: actualSignal === scenario.expectedSignal,
            confidence,
            absorptionRatio,
            counterTrendLogic,
            details: `${scenario.description} | Ratio: ${absorptionRatio.toFixed(3)} | Conf: ${confidence.toFixed(3)}`,
        };
    }

    function verifyCounterTrendBehavior(
        scenario: AbsorptionTestScenario,
        actualSignal: string
    ): boolean {
        if (actualSignal === "neutral") return true; // Neutral is always valid

        // Counter-trend logic verification:
        // - Aggressive SELL (buyerIsMaker=true) should produce BUY signal
        // - Aggressive BUY (buyerIsMaker=false) should produce SELL signal

        const expectedCounterTrend = scenario.buyerIsMaker ? "buy" : "sell";
        return actualSignal === expectedCounterTrend;
    }

    /**
     * PHASE 3: SYSTEMATIC TEST EXECUTION
     */
    describe("100 Parametric Signal Direction Tests", () => {
        const scenarios = generateAbsorptionTestScenarios();
        const results: TestResult[] = [];

        scenarios.forEach((scenario, index) => {
            it(`Test ${index + 1}: ${scenario.description}`, () => {
                const result = verifyAbsorptionLogic(scenario);
                results.push(result);

                // Log detailed information for failed tests
                if (!result.passed) {
                    console.log(`❌ FAILED TEST ${index + 1}:`, {
                        scenario: scenario.id,
                        expected: result.expected,
                        actual: result.actual,
                        buyerIsMaker: scenario.buyerIsMaker,
                        absorptionRatio: result.absorptionRatio,
                        counterTrendLogic: result.counterTrendLogic,
                        details: result.details,
                    });
                }

                expect(result.actual).toBe(result.expected);
            });
        });

        // Summary analysis after all tests
        it("should provide comprehensive test analysis", () => {
            const passedTests = results.filter((r) => r.passed).length;
            const failedTests = results.filter((r) => !r.passed).length;
            const counterTrendFailures = results.filter(
                (r) => !r.counterTrendLogic
            ).length;

            const byCategory = {
                obvious_buy: results.filter((r) =>
                    r.scenario.includes("obvious_buy")
                ),
                obvious_sell: results.filter((r) =>
                    r.scenario.includes("obvious_sell")
                ),
                neutral_edge: results.filter((r) =>
                    r.scenario.includes("neutral_edge")
                ),
                transition: results.filter((r) =>
                    r.scenario.includes("transition")
                ),
            };

            console.log(`
📊 ABSORPTION DETECTOR SIGNAL DIRECTION ANALYSIS:
=================================================
Total Tests: ${results.length}
Passed: ${passedTests} (${((passedTests / results.length) * 100).toFixed(1)}%)
Failed: ${failedTests} (${((failedTests / results.length) * 100).toFixed(1)}%)
Counter-trend Logic Failures: ${counterTrendFailures}

BY CATEGORY:
- Obvious BUY: ${byCategory.obvious_buy.filter((r) => r.passed).length}/${byCategory.obvious_buy.length} passed
- Obvious SELL: ${byCategory.obvious_sell.filter((r) => r.passed).length}/${byCategory.obvious_sell.length} passed  
- Neutral Edge: ${byCategory.neutral_edge.filter((r) => r.passed).length}/${byCategory.neutral_edge.length} passed
- Transition: ${byCategory.transition.filter((r) => r.passed).length}/${byCategory.transition.length} passed

SYSTEMATIC ISSUES DETECTED:
${counterTrendFailures > 50 ? "❌ MAJOR: Counter-trend logic appears to be inverted" : "✅ Counter-trend logic appears correct"}
${failedTests > 10 ? "❌ MAJOR: High failure rate suggests systematic issue" : "✅ Low failure rate indicates correct implementation"}
            `);

            // This test should always pass - it's just for analysis
            expect(true).toBe(true);
        });
    });

    /**
     * PHASE 4: SPECIFIC LOGIC VERIFICATION TESTS
     */
    describe("Core Logic Verification", () => {
        it("should emit BUY signal when aggressive SELL is absorbed (counter-trend)", () => {
            const scenario: AbsorptionTestScenario = {
                id: "core_logic_buy",
                description: "Core logic test: aggressive sell absorption",
                buyerIsMaker: true, // Aggressive SELL
                aggressiveVolume: 200,
                passiveVolume: 800, // 80% passive ratio - high absorption
                price: 89.0,
                expectedSignal: "buy", // Counter-trend signal
                confidence: "high",
                category: "obvious_buy",
            };

            const result = verifyAbsorptionLogic(scenario);

            expect(result.actual).toBe("buy");
            expect(result.counterTrendLogic).toBe(true);
            expect(result.absorptionRatio).toBeGreaterThan(0.7);
        });

        it("should emit SELL signal when aggressive BUY is absorbed (counter-trend)", () => {
            const scenario: AbsorptionTestScenario = {
                id: "core_logic_sell",
                description: "Core logic test: aggressive buy absorption",
                buyerIsMaker: false, // Aggressive BUY
                aggressiveVolume: 200,
                passiveVolume: 800, // 80% passive ratio - high absorption
                price: 89.0,
                expectedSignal: "sell", // Counter-trend signal
                confidence: "high",
                category: "obvious_sell",
            };

            const result = verifyAbsorptionLogic(scenario);

            expect(result.actual).toBe("sell");
            expect(result.counterTrendLogic).toBe(true);
            expect(result.absorptionRatio).toBeGreaterThan(0.7);
        });

        it("should emit NEUTRAL when absorption ratio is below threshold", () => {
            const scenario: AbsorptionTestScenario = {
                id: "core_logic_neutral",
                description: "Core logic test: insufficient absorption",
                buyerIsMaker: true,
                aggressiveVolume: 600, // High aggressive
                passiveVolume: 400, // Low passive (40% ratio)
                price: 89.0,
                expectedSignal: "neutral",
                confidence: "low",
                category: "neutral_edge",
            };

            const result = verifyAbsorptionLogic(scenario);

            expect(result.actual).toBe("neutral");
            expect(result.absorptionRatio).toBeLessThan(0.6);
        });
    });
});
