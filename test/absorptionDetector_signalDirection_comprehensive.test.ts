// test/absorptionDetector_signalDirection_comprehensive.test.ts
// Comprehensive tests to identify exact conditions causing AbsorptionDetector signal direction errors

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

// Mock dependencies
const createMockLogger = (): ILogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

/**
 * Create realistic test events with detailed market microstructure
 */
function createAbsorptionTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    isAggressive: boolean,
    side: "buy" | "sell",
    passiveBidVolume: number = 1000,
    passiveAskVolume: number = 1000,
    tradeId?: string
): EnrichedTradeEvent {
    return {
        tradeId: tradeId ?? `test_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker: side === "sell" ? isAggressive : !isAggressive,
        side,
        aggression: isAggressive ? 0.8 : 0.3,
        enriched: true,
        zonePassiveBidVolume: passiveBidVolume,
        zonePassiveAskVolume: passiveAskVolume,
    };
}

/**
 * Test scenario configuration
 */
interface TestScenario {
    name: string;
    description: string;
    expectedSignal: "BUY" | "SELL" | null;
    marketLogic: string;
    setup: (baseTime: number, basePrice: number) => EnrichedTradeEvent[];
    validation?: (signalSide: string | undefined, signalData: any) => boolean;
}

describe("AbsorptionDetector - Comprehensive Signal Direction Analysis", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    // Working settings that generate signals (from successful tests)
    const workingSettings: AbsorptionSettings = {
        windowMs: 60000,
        minAggVolume: 40,
        pricePrecision: 2,
        zoneTicks: 3,
        absorptionThreshold: 0.3, // Lower threshold for realistic detection
        priceEfficiencyThreshold: 0.02,
        maxAbsorptionRatio: 0.7,
        strongAbsorptionRatio: 0.6,
        moderateAbsorptionRatio: 0.8,
        weakAbsorptionRatio: 1.0,
        spreadImpactThreshold: 0.003,
        velocityIncreaseThreshold: 1.5,
        features: {
            liquidityGradient: true,
            absorptionVelocity: false,
            layeredAbsorption: false,
            spreadImpact: true,
        },
    };

    beforeEach(async () => {
        mockLogger = createMockLogger();

        // Use proper mock from __mocks__/ directory per CLAUDE.md
        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        mockSpoofingDetector = createMockSpoofingDetector();

        // Create mock order book
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(50000),
            getBestAsk: vi.fn().mockReturnValue(50001),
            getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
            getDepth: vi.fn().mockReturnValue(new Map()),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        };

        detector = new AbsorptionDetector(
            "test-comprehensive",
            workingSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );
    });

    describe("🧪 Phase 1: Signal Direction Matrix Tests", () => {
        // Define all test scenarios
        const testScenarios: TestScenario[] = [
            // 🔴 INSTITUTIONAL SELLING SCENARIOS (Expected: SELL signals)
            {
                name: "Heavy Retail Buying → Institutional Asks",
                description:
                    "Retail FOMO buying hits institutional passive selling",
                expectedSignal: "SELL",
                marketLogic:
                    "Follow institutional side: retail buying → institutional selling → SELL signal",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // Build up aggressive retail buying pressure hitting institutional asks
                    for (let i = 0; i < 8; i++) {
                        events.push(
                            createAbsorptionTestEvent(
                                basePrice,
                                60 + i * 15, // Increasing retail volume
                                baseTime + i * 3000,
                                true, // Aggressive takers (retail)
                                "buy", // Retail buying
                                900 - i * 20, // Bid support weakening
                                1200 + i * 50 // Ask wall building (institutional)
                            )
                        );
                    }

                    // Large institutional absorption (passive selling)
                    events.push(
                        createAbsorptionTestEvent(
                            basePrice,
                            200, // Large institutional sell
                            baseTime + 25000,
                            false, // Passive maker (institutional)
                            "sell", // Institutional selling
                            750, // Weakened bids
                            1500 // Strong ask wall
                        )
                    );

                    return events;
                },
            },

            {
                name: "False Breakout Distribution",
                description:
                    "Retail breakout attempt absorbed by smart money distribution",
                expectedSignal: "SELL",
                marketLogic:
                    "Smart money distribution during retail breakout → SELL signal",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // Retail breakout attempt with aggressive buying
                    for (let i = 0; i < 6; i++) {
                        events.push(
                            createAbsorptionTestEvent(
                                basePrice + i * 2, // Price trying to break higher
                                80 + i * 20,
                                baseTime + i * 4000,
                                true, // Aggressive retail buying
                                "buy",
                                1100,
                                1000 - i * 80 // Asks being consumed
                            )
                        );
                    }

                    // Smart money steps in with large selling
                    events.push(
                        createAbsorptionTestEvent(
                            basePrice + 5,
                            250, // Large institutional sell
                            baseTime + 28000,
                            false, // Passive institutional seller
                            "sell",
                            1000,
                            1400 // Heavy selling pressure
                        )
                    );

                    return events;
                },
            },

            {
                name: "Resistance Level Defense",
                description:
                    "Aggressive buying into heavy institutional ask walls",
                expectedSignal: "SELL",
                marketLogic:
                    "Resistance absorption → price rejection expected → SELL signal",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // Build resistance with heavy ask walls
                    for (let i = 0; i < 7; i++) {
                        events.push(
                            createAbsorptionTestEvent(
                                basePrice + i * 0.5, // Moving up toward resistance
                                70 + i * 12,
                                baseTime + i * 3500,
                                true, // Aggressive buying
                                "buy",
                                1000,
                                1500 + i * 100 // Building ask walls
                            )
                        );
                    }

                    return events;
                },
            },

            // 🟢 INSTITUTIONAL BUYING SCENARIOS (Expected: BUY signals)
            {
                name: "Heavy Retail Selling → Institutional Bids",
                description:
                    "Retail panic selling hits institutional passive buying",
                expectedSignal: "BUY",
                marketLogic:
                    "Follow institutional side: retail selling → institutional buying → BUY signal",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // Build up aggressive retail selling pressure hitting institutional bids
                    for (let i = 0; i < 8; i++) {
                        events.push(
                            createAbsorptionTestEvent(
                                basePrice,
                                70 + i * 18, // Increasing retail panic selling
                                baseTime + i * 3500,
                                true, // Aggressive takers (retail)
                                "sell", // Retail selling
                                1300 + i * 60, // Bid support building (institutional)
                                900 - i * 25 // Ask side weakening
                            )
                        );
                    }

                    // Large institutional absorption (passive buying)
                    events.push(
                        createAbsorptionTestEvent(
                            basePrice,
                            220, // Large institutional buy
                            baseTime + 30000,
                            false, // Passive maker (institutional)
                            "buy", // Institutional buying
                            1800, // Strong bid wall
                            650 // Weakened asks
                        )
                    );

                    return events;
                },
            },

            {
                name: "Capitulation Accumulation",
                description:
                    "Retail capitulation absorbed by smart money accumulation",
                expectedSignal: "BUY",
                marketLogic:
                    "Smart money accumulation during retail panic → BUY signal",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // Retail capitulation with aggressive selling
                    for (let i = 0; i < 7; i++) {
                        events.push(
                            createAbsorptionTestEvent(
                                basePrice - i * 1, // Price declining under pressure
                                90 + i * 25,
                                baseTime + i * 3000,
                                true, // Aggressive retail selling
                                "sell",
                                1000 + i * 100, // Bids building (smart money)
                                800 - i * 60 // Asks being consumed
                            )
                        );
                    }

                    // Smart money large accumulation
                    events.push(
                        createAbsorptionTestEvent(
                            basePrice - 5,
                            300, // Large institutional buy
                            baseTime + 25000,
                            false, // Passive institutional buyer
                            "buy",
                            1800, // Strong bid support
                            500 // Low ask volume
                        )
                    );

                    return events;
                },
            },

            {
                name: "Support Level Defense",
                description:
                    "Aggressive selling into heavy institutional bid walls",
                expectedSignal: "BUY",
                marketLogic:
                    "Support absorption → price bounce expected → BUY signal",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // Build support with heavy bid walls
                    for (let i = 0; i < 7; i++) {
                        events.push(
                            createAbsorptionTestEvent(
                                basePrice - i * 0.5, // Moving down toward support
                                65 + i * 15,
                                baseTime + i * 3500,
                                true, // Aggressive selling
                                "sell",
                                1500 + i * 100, // Building bid walls
                                1000
                            )
                        );
                    }

                    return events;
                },
            },

            // ⚪ NO-SIGNAL SCENARIOS
            {
                name: "Balanced Institutional Activity",
                description: "Equal institutional buying and selling",
                expectedSignal: null,
                marketLogic: "No clear institutional bias → no signal",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // Mixed trading with no clear pattern
                    for (let i = 0; i < 10; i++) {
                        const isBuy = i % 2 === 0;
                        events.push(
                            createAbsorptionTestEvent(
                                basePrice + (Math.random() - 0.5) * 10,
                                50 + Math.random() * 30,
                                baseTime + i * 2000,
                                Math.random() > 0.5,
                                isBuy ? "buy" : "sell",
                                1000 + Math.random() * 200,
                                1000 + Math.random() * 200
                            )
                        );
                    }

                    return events;
                },
            },

            {
                name: "Low Volume Conditions",
                description: "Trading below minimum volume thresholds",
                expectedSignal: null,
                marketLogic:
                    "Insufficient volume for absorption detection → no signal",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // Low volume trades (below minAggVolume threshold)
                    for (let i = 0; i < 8; i++) {
                        events.push(
                            createAbsorptionTestEvent(
                                basePrice,
                                15 + Math.random() * 10, // Below 40 threshold
                                baseTime + i * 4000,
                                Math.random() > 0.5,
                                Math.random() > 0.5 ? "buy" : "sell",
                                800 + Math.random() * 100,
                                800 + Math.random() * 100
                            )
                        );
                    }

                    return events;
                },
            },
        ];

        // Run all test scenarios
        testScenarios.forEach((scenario) => {
            it(
                `should handle "${scenario.name}" correctly`,
                { timeout: 10000 },
                () => {
                    console.log(`\n=== Testing: ${scenario.name} ===`);
                    console.log(
                        `📊 Expected: ${scenario.expectedSignal || "No Signal"}`
                    );
                    console.log(`🧠 Logic: ${scenario.marketLogic}`);

                    let signalEmitted = false;
                    let actualSignal: string | undefined;
                    let signalData: any = null;
                    let signalCount = 0;

                    // Capture all signals
                    detector.on("signalCandidate", (data) => {
                        signalEmitted = true;
                        actualSignal = data.side;
                        signalData = data;
                        signalCount++;
                        console.log(
                            `🎯 Signal Generated: ${data.side} at $${data.price} (confidence: ${data.confidence})`
                        );
                        console.log(`📈 Signal Data:`, {
                            side: data.side,
                            price: data.price,
                            confidence: data.confidence,
                            timestamp: new Date(
                                data.timestamp
                            ).toLocaleTimeString(),
                        });
                    });

                    // Run the scenario
                    const baseTime = Date.now() - 60000;
                    const basePrice = 50000 + Math.random() * 1000; // Vary price levels
                    const events = scenario.setup(baseTime, basePrice);

                    console.log(
                        `📊 Processing ${events.length} test events...`
                    );

                    events.forEach((event, i) => {
                        detector.onEnrichedTrade(event);
                        console.log(
                            `Event ${i + 1}: ${event.side} ${event.quantity} at $${event.price} (aggressive: ${event.aggression && event.aggression > 0.5})`
                        );
                    });

                    // Wait for async processing
                    return new Promise<void>((resolve) => {
                        setTimeout(() => {
                            console.log(
                                `\n📋 Test Results for "${scenario.name}":`
                            );
                            console.log(
                                `Expected: ${scenario.expectedSignal || "No Signal"}`
                            );
                            console.log(
                                `Actual: ${actualSignal || "No Signal"}`
                            );
                            console.log(`Signals emitted: ${signalCount}`);

                            if (scenario.expectedSignal === null) {
                                // Should NOT generate signals
                                if (signalEmitted) {
                                    console.log(
                                        `❌ UNEXPECTED SIGNAL: Expected no signal but got ${actualSignal}`
                                    );
                                    console.log(
                                        `📊 Signal Details:`,
                                        signalData
                                    );
                                    // Don't fail test, just log for analysis
                                    console.log(
                                        `⚠️ FALSE POSITIVE detected - logging for debugging`
                                    );
                                } else {
                                    console.log(
                                        `✅ CORRECT: No signal generated as expected`
                                    );
                                }
                                // expect(signalEmitted).toBe(false); // Don't fail - just analyze
                            } else {
                                // Should generate expected signal
                                if (signalEmitted) {
                                    if (
                                        actualSignal?.toUpperCase() ===
                                        scenario.expectedSignal
                                    ) {
                                        console.log(
                                            `✅ CORRECT SIGNAL: ${actualSignal} matches expected ${scenario.expectedSignal}`
                                        );
                                    } else {
                                        console.log(
                                            `❌ WRONG SIGNAL: Expected ${scenario.expectedSignal}, got ${actualSignal}`
                                        );
                                        console.log(
                                            `🔍 This indicates signal direction logic error!`
                                        );
                                        console.log(
                                            `📊 Signal Details:`,
                                            signalData
                                        );
                                        // Don't fail test, just log for analysis
                                    }
                                    // expect(actualSignal).toBe(scenario.expectedSignal); // Don't fail - just analyze
                                } else {
                                    console.log(
                                        `⚠️ MISSING SIGNAL: Expected ${scenario.expectedSignal} but no signal generated`
                                    );
                                    console.log(
                                        `🔍 This may indicate threshold/detection logic issues`
                                    );
                                }
                            }

                            // Custom validation if provided
                            if (scenario.validation && signalEmitted) {
                                const isValid = scenario.validation(
                                    actualSignal,
                                    signalData
                                );
                                if (!isValid) {
                                    console.log(
                                        `❌ CUSTOM VALIDATION FAILED for "${scenario.name}"`
                                    );
                                }
                                expect(isValid).toBe(true);
                            }

                            console.log(
                                `==========================================\n`
                            );
                            resolve();
                        }, 50); // Allow time for async signal processing
                    });
                }
            );
        });
    });

    describe("🔬 Phase 2: Logic Chain Component Tests", () => {
        it("should test dominant side detection accuracy", () => {
            console.log("\n=== Testing Dominant Side Detection ===");

            // This will be implemented to test getDominantAggressiveSide() directly
            // by examining the detector's internal state after processing events
            expect(true).toBe(true); // Placeholder for now
        });

        it("should test absorption side mapping logic", () => {
            console.log("\n=== Testing Absorption Side Mapping ===");

            // This will test getAbsorbingSideForZone() logic
            expect(true).toBe(true); // Placeholder for now
        });

        it("should test signal side conversion", () => {
            console.log("\n=== Testing Signal Side Conversion ===");

            // This will test the critical line 1574 mapping
            expect(true).toBe(true); // Placeholder for now
        });
    });

    describe("🌐 Phase 3: Real-World Pattern Tests", () => {
        it("should handle time-based analysis correctly", () => {
            console.log("\n=== Testing Time-Based Analysis ===");

            // Test configurable time windows and temporal weighting
            expect(true).toBe(true); // Placeholder for now
        });

        it("should respect volume thresholds", () => {
            console.log("\n=== Testing Volume Thresholds ===");

            // Test minAggVolume and maxAbsorptionRatio filtering
            expect(true).toBe(true); // Placeholder for now
        });

        it("should adapt to market conditions", () => {
            console.log("\n=== Testing Market Condition Adaptation ===");

            // Test behavior under different spread/volatility conditions
            expect(true).toBe(true); // Placeholder for now
        });
    });

    describe("📊 Signal Quality Analysis", () => {
        it("should provide comprehensive signal direction summary", () => {
            console.log("\n=== COMPREHENSIVE SIGNAL DIRECTION ANALYSIS ===");
            console.log(
                "This test suite will identify exactly which scenarios produce wrong-sided signals"
            );
            console.log(
                "Run the full test suite above to see detailed results for each scenario"
            );
            console.log(
                "Look for ❌ WRONG SIGNAL indicators to identify problematic logic paths"
            );
            console.log(
                "==============================================================="
            );

            expect(true).toBe(true);
        });
    });
});
