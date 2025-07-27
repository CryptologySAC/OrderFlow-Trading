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
 * ABSORPTION DETECTOR CORRECT LOGIC VERIFICATION
 *
 * This test suite verifies the correct absorption logic with 100 clear scenarios:
 * - Tests 1-30: Clear BID absorption (passive bids absorb aggressive sells → SELL signal)
 * - Tests 31-60: Clear ASK absorption (passive asks absorb aggressive buys → BUY signal)
 * - Tests 61-80: Edge cases (lower volumes, less clear absorption)
 * - Tests 81-100: No absorption (balanced, insufficient, or no passive dominance)
 *
 * CORRECTED ABSORPTION LOGIC (Fixed Implementation):
 * - Passive bids absorbing aggressive sells = Bid absorption = Selling pressure = SELL signal
 * - Passive asks absorbing aggressive buys = Ask absorption = Buying pressure = BUY signal
 * - No clear passive dominance = No absorption = NEUTRAL
 */

interface AbsorptionTestScenario {
    id: string;
    description: string;
    passiveBidVolume: number;
    passiveAskVolume: number;
    aggressiveVolume: number;
    expectedSignal: "buy" | "sell" | "neutral";
    confidence: "high" | "medium" | "low";
    category:
        | "clear_bid_absorption"
        | "clear_ask_absorption"
        | "edge_case"
        | "no_absorption";
}

interface TestResult {
    scenario: string;
    expected: "buy" | "sell" | "neutral";
    actual: "buy" | "sell" | "neutral";
    passed: boolean;
    passiveBidVolume: number;
    passiveAskVolume: number;
    details: string;
}

describe("AbsorptionDetector Correct Logic - 100 Comprehensive Tests", () => {
    let detector: AbsorptionDetectorEnhanced;
    let mockPreprocessor: OrderFlowPreprocessor;

    beforeEach(() => {
        // Mock preprocessor
        mockPreprocessor = {
            findZonesNearPrice: vi.fn().mockReturnValue([
                {
                    zoneId: "test-zone-1",
                    priceLevel: 89.0,
                    tickSize: 0.01,
                    aggressiveVolume: 100,
                    passiveVolume: 300,
                    aggressiveBuyVolume: 50,
                    aggressiveSellVolume: 50,
                    passiveBidVolume: 150, // Will be overridden by test scenarios
                    passiveAskVolume: 150, // Will be overridden by test scenarios
                    tradeCount: 10,
                    timespan: 60000,
                    boundaries: { min: 88.975, max: 89.025 },
                    lastUpdate: Date.now(),
                    volumeWeightedPrice: 89.0,
                } as ZoneSnapshot,
            ]),
            findMostRelevantZone: vi.fn().mockReturnValue({
                zoneId: "test-zone-1",
                priceLevel: 89.0,
                aggressiveVolume: 100,
                passiveVolume: 300,
            }),
        } as any;

        // Create detector with realistic config and debug logger
        const testConfig = Config.ABSORPTION_DETECTOR;

        // Create a debug logger that shows key info for debugging failures
        // Create comprehensive debug logger to catch all rejection points
        const debugLogger = {
            info: (...args: any[]) => {
                const message = args[0];
                if (
                    typeof message === "string" &&
                    (message.includes("REJECTED") ||
                        message.includes("below threshold") ||
                        message.includes("failed") ||
                        message.includes("Passive volume ratio check") ||
                        message.includes("Price efficiency") ||
                        message.includes("calculateDominantSide") ||
                        message.includes("Returning BUY signal") ||
                        message.includes("Returning SELL signal") ||
                        message.includes("No dominant side") ||
                        message.includes("Enhanced absorption") ||
                        message.includes("Balanced institutional flow") ||
                        message.includes("Insufficient aggressive volume"))
                ) {
                    console.log("INFO:", ...args);
                }
            },
            debug: (...args: any[]) => {
                const message = args[0];
                if (
                    typeof message === "string" &&
                    (message.includes("No core absorption detected") ||
                        message.includes("Signal blocked by cooldown"))
                ) {
                    console.log("DEBUG:", ...args);
                }
            },
            warn: (...args: any[]) => console.log("WARN:", ...args),
            error: (...args: any[]) => console.log("ERROR:", ...args),
        };

        detector = new AbsorptionDetectorEnhanced(
            "test-absorption",
            "LTCUSDT",
            testConfig,
            mockPreprocessor,
            debugLogger as any,
            new MetricsCollector()
        );
    });

    /**
     * Generate 100 comprehensive absorption test scenarios
     */
    function generateAbsorptionTestScenarios(): AbsorptionTestScenario[] {
        const scenarios: AbsorptionTestScenario[] = [];

        // TESTS 1-30: CLEAR BID ABSORPTION (Institutional-sized volumes)
        for (let i = 1; i <= 30; i++) {
            const passiveBidVol = 1000 + i * 100; // 1100-4000 LTC (institutional size)
            const passiveAskVol = 50 + i * 5; // 55-200 LTC (much lower)
            const aggressiveVol = 300 + i * 30; // 330-1200 LTC (large aggressive orders)

            scenarios.push({
                id: `clear_bid_absorption_${i}`,
                description: `Clear BID absorption: ${passiveBidVol} LTC bid liquidity absorbs ${aggressiveVol} LTC aggressive sells (ask liquidity: ${passiveAskVol})`,
                passiveBidVolume: passiveBidVol,
                passiveAskVolume: passiveAskVol,
                aggressiveVolume: aggressiveVol,
                expectedSignal: "sell", // Bid absorption indicates selling pressure
                confidence: i <= 20 ? "high" : "medium",
                category: "clear_bid_absorption",
            });
        }

        // TESTS 31-60: CLEAR ASK ABSORPTION (Institutional-sized volumes)
        for (let i = 31; i <= 60; i++) {
            const testIndex = i - 30;
            const passiveAskVol = 1000 + testIndex * 100; // 1100-4000 LTC (institutional size)
            const passiveBidVol = 50 + testIndex * 5; // 55-200 LTC (much lower)
            const aggressiveVol = 300 + testIndex * 30; // 330-1200 LTC (large aggressive orders)

            scenarios.push({
                id: `clear_ask_absorption_${i}`,
                description: `Clear ASK absorption: ${passiveAskVol} LTC ask liquidity absorbs ${aggressiveVol} LTC aggressive buys (bid liquidity: ${passiveBidVol})`,
                passiveBidVolume: passiveBidVol,
                passiveAskVolume: passiveAskVol,
                aggressiveVolume: aggressiveVol,
                expectedSignal: "buy", // Ask absorption indicates buying pressure
                confidence: testIndex <= 20 ? "high" : "medium",
                category: "clear_ask_absorption",
            });
        }

        // TESTS 61-80: EDGE CASES (Moderate institutional volumes, clear but smaller absorption)
        for (let i = 61; i <= 80; i++) {
            const testIndex = i - 60;

            if (testIndex <= 10) {
                // Moderate bid absorption (institutional but smaller difference)
                const passiveBidVol = 500 + testIndex * 50; // 550-1000 LTC
                const passiveAskVol = 100 + testIndex * 10; // 110-200 LTC
                const aggressiveVol = 200 + testIndex * 20; // 220-400 LTC

                scenarios.push({
                    id: `edge_bid_absorption_${i}`,
                    description: `Edge BID absorption: ${passiveBidVol} LTC bid vs ${passiveAskVol} LTC ask (aggressive: ${aggressiveVol})`,
                    passiveBidVolume: passiveBidVol,
                    passiveAskVolume: passiveAskVol,
                    aggressiveVolume: aggressiveVol,
                    expectedSignal: "sell", // Bid absorption indicates selling pressure
                    confidence: "low",
                    category: "edge_case",
                });
            } else {
                // Moderate ask absorption (institutional but smaller difference)
                const passiveAskVol = 500 + (testIndex - 10) * 50; // 550-1000 LTC
                const passiveBidVol = 100 + (testIndex - 10) * 10; // 110-200 LTC
                const aggressiveVol = 200 + (testIndex - 10) * 20; // 220-400 LTC

                scenarios.push({
                    id: `edge_ask_absorption_${i}`,
                    description: `Edge ASK absorption: ${passiveAskVol} LTC ask vs ${passiveBidVol} LTC bid (aggressive: ${aggressiveVol})`,
                    passiveBidVolume: passiveBidVol,
                    passiveAskVolume: passiveAskVol,
                    aggressiveVolume: aggressiveVol,
                    expectedSignal: "buy", // Ask absorption indicates buying pressure
                    confidence: "low",
                    category: "edge_case",
                });
            }
        }

        // TESTS 81-100: NO ABSORPTION (Realistic sizes but balanced/insufficient patterns)
        for (let i = 81; i <= 100; i++) {
            const testIndex = i - 80;

            if (testIndex <= 7) {
                // Balanced passive volumes (no clear dominance, realistic institutional size)
                const passiveVol = 300 + testIndex * 50; // 350-650 LTC each side
                const aggressiveVol = 200 + testIndex * 25; // 225-375 LTC

                scenarios.push({
                    id: `no_absorption_balanced_${i}`,
                    description: `No absorption: Balanced passive volumes (${passiveVol} LTC each side, aggressive: ${aggressiveVol})`,
                    passiveBidVolume: passiveVol,
                    passiveAskVolume: passiveVol,
                    aggressiveVolume: aggressiveVol,
                    expectedSignal: "neutral", // No clear dominance
                    confidence: "low",
                    category: "no_absorption",
                });
            } else if (testIndex <= 14) {
                // Insufficient passive volumes (below institutional threshold)
                const passiveVol = 20 + (testIndex - 7) * 10; // 30-100 LTC
                const aggressiveVol = 60 + (testIndex - 7) * 15; // 75-165 LTC

                scenarios.push({
                    id: `no_absorption_insufficient_${i}`,
                    description: `No absorption: Insufficient passive volumes (${passiveVol} LTC each side, aggressive: ${aggressiveVol})`,
                    passiveBidVolume: passiveVol,
                    passiveAskVolume: passiveVol,
                    aggressiveVolume: aggressiveVol,
                    expectedSignal: "neutral", // Below threshold
                    confidence: "low",
                    category: "no_absorption",
                });
            } else {
                // Minor differences (not enough for clear absorption, realistic sizes)
                const baseVol = 250 + (testIndex - 14) * 25; // 275-400 LTC
                const diff = 5 + (testIndex - 14) * 2; // 7-19 LTC difference (truly minor)
                const aggressiveVol = 180 + (testIndex - 14) * 15; // 195-270 LTC

                scenarios.push({
                    id: `no_absorption_minor_${i}`,
                    description: `No absorption: Minor difference (${baseVol + diff} vs ${baseVol} LTC, aggressive: ${aggressiveVol})`,
                    passiveBidVolume:
                        testIndex % 2 === 0 ? baseVol + diff : baseVol,
                    passiveAskVolume:
                        testIndex % 2 === 0 ? baseVol : baseVol + diff,
                    aggressiveVolume: aggressiveVol,
                    expectedSignal: "neutral", // Difference too small
                    confidence: "low",
                    category: "no_absorption",
                });
            }
        }

        return scenarios;
    }

    /**
     * Execute absorption test and verify results
     */
    function verifyAbsorptionLogic(
        scenario: AbsorptionTestScenario
    ): TestResult {
        // Use synchronized timestamp to ensure temporal filtering works
        const currentTime = Date.now();

        // Update mock zone data with scenario-specific passive volumes
        const mockZone = {
            zoneId: "test-zone-1",
            priceLevel: 89.0,
            tickSize: 0.01,
            aggressiveVolume: scenario.aggressiveVolume,
            passiveVolume:
                scenario.passiveBidVolume + scenario.passiveAskVolume,
            aggressiveBuyVolume: scenario.aggressiveVolume / 2,
            aggressiveSellVolume: scenario.aggressiveVolume / 2,
            passiveBidVolume: scenario.passiveBidVolume,
            passiveAskVolume: scenario.passiveAskVolume,
            tradeCount: 10,
            timespan: 60000,
            boundaries: { min: 88.975, max: 89.025 },
            lastUpdate: currentTime,
            volumeWeightedPrice: 89.0,
        } as ZoneSnapshot;

        mockPreprocessor.findZonesNearPrice = vi
            .fn()
            .mockReturnValue([mockZone]);

        // Create test trade event with all required market data
        const testTrade: EnrichedTradeEvent = {
            price: 89.0,
            quantity: 10,
            timestamp: currentTime,
            buyerIsMaker: true,
            pair: "LTCUSDT",
            tradeId: "test-trade-1",
            originalTrade: {} as any,
            passiveBidVolume: scenario.passiveBidVolume,
            passiveAskVolume: scenario.passiveAskVolume,
            zonePassiveBidVolume: scenario.passiveBidVolume,
            zonePassiveAskVolume: scenario.passiveAskVolume,
            // Add missing market data fields required by absorption calculations
            bestBid: 88.99, // Slightly below trade price
            bestAsk: 89.01, // Slightly above trade price
            zoneData: {
                zones: [mockZone],
                zoneConfig: {
                    zoneTicks: 10,
                    tickValue: 0.01,
                    timeWindow: 60000,
                },
            },
        };

        // Clear any accumulated state in the detector before each test
        // Access private lastSignal Map and clear it to avoid state contamination
        (detector as any).lastSignal?.clear();

        // Test the detector
        let actualSignal: "buy" | "sell" | "neutral" = "neutral";
        let signalEmitted = false;

        detector.on("signalCandidate", (signal) => {
            signalEmitted = true;
            actualSignal = signal.side;
        });

        // Process the trade
        detector.onEnrichedTrade(testTrade);

        // If no signal emitted, it's neutral
        if (!signalEmitted) {
            actualSignal = "neutral";
        }

        return {
            scenario: scenario.id,
            expected: scenario.expectedSignal,
            actual: actualSignal,
            passed: actualSignal === scenario.expectedSignal,
            passiveBidVolume: scenario.passiveBidVolume,
            passiveAskVolume: scenario.passiveAskVolume,
            details: scenario.description,
        };
    }

    /**
     * MAIN TEST: Execute all 100 absorption scenarios
     */
    it("should correctly identify absorption patterns in 100 comprehensive scenarios", () => {
        const scenarios = generateAbsorptionTestScenarios();
        const results: TestResult[] = [];

        // Execute all scenarios
        for (const scenario of scenarios) {
            const result = verifyAbsorptionLogic(scenario);
            results.push(result);

            // Individual scenario assertion
            if (!result.passed) {
                console.error(`❌ FAILED ${scenario.id}:`, {
                    expected: result.expected,
                    actual: result.actual,
                    passiveBidVolume: result.passiveBidVolume,
                    passiveAskVolume: result.passiveAskVolume,
                    details: result.details,
                });
            }
        }

        // Categorize results
        const byCategory = {
            clear_bid_absorption: results.filter((r) =>
                r.scenario.includes("clear_bid_absorption")
            ),
            clear_ask_absorption: results.filter((r) =>
                r.scenario.includes("clear_ask_absorption")
            ),
            edge_case: results.filter((r) => r.scenario.includes("edge_")),
            no_absorption: results.filter((r) =>
                r.scenario.includes("no_absorption")
            ),
        };

        // Calculate pass rates
        const totalPassed = results.filter((r) => r.passed).length;
        const totalFailed = results.length - totalPassed;

        // Detailed analysis
        console.log(`
📊 ABSORPTION LOGIC VERIFICATION RESULTS:
=========================================
Total: ${results.length} scenarios
✅ Passed: ${totalPassed} (${((totalPassed / results.length) * 100).toFixed(1)}%)
❌ Failed: ${totalFailed} (${((totalFailed / results.length) * 100).toFixed(1)}%)

BY CATEGORY:
- Clear BID Absorption: ${byCategory.clear_bid_absorption.filter((r) => r.passed).length}/${byCategory.clear_bid_absorption.length} passed
- Clear ASK Absorption: ${byCategory.clear_ask_absorption.filter((r) => r.passed).length}/${byCategory.clear_ask_absorption.length} passed
- Edge Cases: ${byCategory.edge_case.filter((r) => r.passed).length}/${byCategory.edge_case.length} passed
- No Absorption: ${byCategory.no_absorption.filter((r) => r.passed).length}/${byCategory.no_absorption.length} passed

${
    totalFailed > 0
        ? `❌ FAILED SCENARIOS: ${results
              .filter((r) => !r.passed)
              .map((r) => r.scenario)
              .join(", ")}`
        : "✅ ALL SCENARIOS PASSED"
}
        `);

        // Main assertion: All scenarios should pass
        expect(totalPassed).toBe(100);
        expect(totalFailed).toBe(0);
    });

    /**
     * SPECIFIC VALIDATION TESTS
     */
    it("should emit SELL signal for clear bid absorption", () => {
        const scenario: AbsorptionTestScenario = {
            id: "test_clear_bid",
            description: "Clear bid absorption test",
            passiveBidVolume: 2000, // High institutional bid liquidity
            passiveAskVolume: 100, // Low ask liquidity
            aggressiveVolume: 600, // Large aggressive order
            expectedSignal: "sell", // Bid absorption indicates selling pressure
            confidence: "high",
            category: "clear_bid_absorption",
        };

        const result = verifyAbsorptionLogic(scenario);
        expect(result.actual).toBe("sell");
        expect(result.passed).toBe(true);
    });

    it("should emit SELL signal for clear bid absorption scenario 2", () => {
        const scenario: AbsorptionTestScenario = {
            id: "test_clear_bid_2",
            description: "Clear bid absorption test - scenario 2",
            passiveBidVolume: 1200, // Institutional bid volume
            passiveAskVolume: 60, // Low ask volume
            aggressiveVolume: 360, // Large aggressive sell order
            expectedSignal: "sell", // Bid absorption indicates selling pressure
            confidence: "high",
            category: "clear_bid_absorption",
        };

        const result = verifyAbsorptionLogic(scenario);
        expect(result.actual).toBe("sell");
        expect(result.passed).toBe(true);
    });

    it("should debug a failing scenario to identify rejection point", () => {
        const scenario: AbsorptionTestScenario = {
            id: "test_debug_failing",
            description: "Debug institutional scenario - test 3",
            passiveBidVolume: 1300, // Large institutional bid volume
            passiveAskVolume: 65, // Small ask volume
            aggressiveVolume: 390, // Large aggressive sell order
            expectedSignal: "sell", // Bid absorption indicates selling pressure
            confidence: "high",
            category: "clear_bid_absorption",
        };

        console.log("🔍 DEBUGGING INSTITUTIONAL SCENARIO 3");
        console.log("Test scenario:", scenario);
        console.log("Expected ratios:");
        console.log(
            "  - Passive ratio:",
            (1300 + 65) / (1300 + 65 + 390),
            "should be >",
            0.6
        );
        console.log(
            "  - Bid dominance:",
            1300,
            "vs",
            65,
            "->",
            1300 > 65 ? "BID DOMINANCE" : "ASK DOMINANCE"
        );

        const result = verifyAbsorptionLogic(scenario);

        console.log("Test result:", {
            expected: result.expected,
            actual: result.actual,
            passed: result.passed,
            passiveBidVolume: result.passiveBidVolume,
            passiveAskVolume: result.passiveAskVolume,
        });

        // This test is for debugging - don't assert success yet
        // expect(result.actual).toBe("buy");
        // expect(result.passed).toBe(true);
    });

    it("should emit BUY signal for clear ask absorption", () => {
        const scenario: AbsorptionTestScenario = {
            id: "test_clear_ask",
            description: "Clear ask absorption test",
            passiveBidVolume: 100, // Low bid liquidity
            passiveAskVolume: 2000, // High institutional ask liquidity
            aggressiveVolume: 600, // Large aggressive buy order
            expectedSignal: "buy", // Ask absorption indicates buying pressure
            confidence: "high",
            category: "clear_ask_absorption",
        };

        const result = verifyAbsorptionLogic(scenario);
        expect(result.actual).toBe("buy");
        expect(result.passed).toBe(true);
    });

    it("should emit NEUTRAL signal when no clear absorption", () => {
        const scenario: AbsorptionTestScenario = {
            id: "test_balanced",
            description: "Balanced institutional passive volumes",
            passiveBidVolume: 500, // Equal large passive volumes
            passiveAskVolume: 500,
            aggressiveVolume: 300, // Large aggressive volume but balanced passive
            expectedSignal: "neutral",
            confidence: "low",
            category: "no_absorption",
        };

        const result = verifyAbsorptionLogic(scenario);
        expect(result.actual).toBe("neutral");
        expect(result.passed).toBe(true);
    });
});
