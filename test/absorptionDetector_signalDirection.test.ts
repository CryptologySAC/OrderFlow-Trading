// test/absorptionDetector_signalDirection.test.ts
// Comprehensive tests to verify AbsorptionDetector signal direction accuracy

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector, type AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
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
 * Create a realistic market event for testing absorption scenarios
 */
function createAbsorptionEvent(
    price: number,
    quantity: number,
    timestamp: number,
    isAggressive: boolean, // true = aggressive taker, false = passive maker
    side: "buy" | "sell",
    passiveBidVolume: number = 1000,
    passiveAskVolume: number = 1000
): EnrichedTradeEvent {
    return {
        tradeId: Math.floor(Math.random() * 1000000),
        price,
        quantity,
        timestamp,
        buyerIsMaker: side === "sell" ? !isAggressive : isAggressive,
        side,
        aggression: isAggressive ? 0.8 : 0.3,
        enriched: true,
        zonePassiveBidVolume: passiveBidVolume,
        zonePassiveAskVolume: passiveAskVolume,
    };
}

describe("AbsorptionDetector - Signal Direction Accuracy", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    beforeEach(async () => {
        mockLogger = createMockLogger();
        
        // Use proper mock from __mocks__/ directory per CLAUDE.md
        const { MetricsCollector: MockMetricsCollector } = await import("../__mocks__/src/infrastructure/metricsCollector.js");
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

        // Use WORKING settings from specifications test that actually generates signals
        const settings: AbsorptionSettings = {
            windowMs: 60000,
            minAggVolume: 40, // Real config value from working test
            pricePrecision: 2,
            zoneTicks: 3, // Real config: 3 ticks = $0.03 zones
            absorptionThreshold: 0.3, // ✅ CRITICAL: Lower threshold from working test (not 0.55!)
            priceEfficiencyThreshold: 0.02, // Real config from working test
            maxAbsorptionRatio: 0.7, // Allow up to 70% aggressive vs passive

            // Realistic absorption level thresholds from working test
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

        detector = new AbsorptionDetector(
            "test-signal-direction",
            settings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );
    });

    describe("🔴 SELL Signal Scenarios (Institutional Selling Absorption)", () => {
        it("should generate SELL signal when institutions absorb retail buying at resistance", () => {
            console.log("\n=== 🔴 INSTITUTIONAL SELLING ABSORPTION TEST ===");
            
            const baseTime = Date.now() - 60000;
            const resistanceLevel = 52000; // Key resistance level
            let signalEmitted = false;
            let signalSide: string | undefined;
            let signalPrice: number | undefined;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                signalSide = data.side;
                signalPrice = data.price;
                console.log(`🔴 SELL Signal detected at $${data.price}: ${data.side} (confidence: ${data.confidence})`);
            });

            // Scenario: Heavy retail buying (aggressive takers) hitting institutional sells (passive makers)
            // This should generate a SELL signal because institutions are distributing to retail
            const events: EnrichedTradeEvent[] = [];

            // Phase 1: Build up retail buying pressure at resistance
            for (let i = 0; i < 8; i++) {
                events.push(
                    createAbsorptionEvent(
                        resistanceLevel,
                        60 + i * 15, // Increasing retail volume
                        baseTime + i * 3000,
                        true, // Aggressive takers (retail FOMO buying)
                        "buy",
                        900 - i * 20, // Bid support weakening (retail exhausting bids)
                        1200 + i * 50 // Ask wall building (institutional selling)
                    )
                );
            }

            // Phase 2: Large institutional absorption event
            events.push(
                createAbsorptionEvent(
                    resistanceLevel,
                    200, // Large institutional sell order
                    baseTime + 25000,
                    false, // Passive maker (institutional seller)
                    "sell",
                    750, // Weakened bids
                    1500 // Strong ask wall
                )
            );

            // Process events
            events.forEach((event, i) => {
                detector.onEnrichedTrade(event);
                console.log(`Event ${i}: ${event.side} ${event.quantity} at $${event.price} (aggressive: ${event.aggression > 0.5})`);
            });

            // Validation: Should generate SELL signal
            expect(signalEmitted).toBe(true);
            if (signalEmitted) {
                expect(signalSide).toBe("SELL");
                expect(signalPrice).toBe(resistanceLevel);
                console.log("✅ Correct SELL signal generated for institutional selling absorption");
            }
        });

        it("should generate SELL signal when smart money distributes during retail breakout attempt", () => {
            console.log("\n=== 🔴 DISTRIBUTION DURING BREAKOUT ATTEMPT ===");
            
            const baseTime = Date.now() - 45000;
            const breakoutLevel = 51500;
            let signalEmitted = false;
            let signalSide: string | undefined;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                signalSide = data.side;
                console.log(`🔴 Signal: ${data.side} at $${data.price} (confidence: ${data.confidence})`);
            });

            // Scenario: Retail attempts breakout but smart money sells into the buying
            const events: EnrichedTradeEvent[] = [];

            // Retail breakout attempt with aggressive buying
            for (let i = 0; i < 6; i++) {
                events.push(
                    createAbsorptionEvent(
                        breakoutLevel + i * 2, // Price trying to break higher
                        80 + i * 20, // Increasing retail volume
                        baseTime + i * 4000,
                        true, // Aggressive retail buying
                        "buy",
                        1100, // Decent bid support
                        1000 - i * 80 // Asks being consumed
                    )
                );
            }

            // Smart money steps in with large selling
            events.push(
                createAbsorptionEvent(
                    breakoutLevel + 5, // Just above breakout level
                    250, // Large institutional sell
                    baseTime + 28000,
                    false, // Passive institutional seller
                    "sell",
                    1000, // Bids present
                    1400 // Heavy selling pressure
                )
            );

            events.forEach((event) => detector.onEnrichedTrade(event));

            // Should generate SELL signal for distribution
            expect(signalEmitted).toBe(true);
            if (signalEmitted) {
                expect(signalSide).toBe("SELL");
                console.log("✅ Correct SELL signal for smart money distribution");
            }
        });
    });

    describe("🟢 BUY Signal Scenarios (Institutional Buying Absorption)", () => {
        it("should generate BUY signal when institutions absorb retail selling at support", () => {
            console.log("\n=== 🟢 INSTITUTIONAL BUYING ABSORPTION TEST ===");
            
            const baseTime = Date.now() - 60000;
            const supportLevel = 49500; // Key support level
            let signalEmitted = false;
            let signalSide: string | undefined;
            let signalPrice: number | undefined;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                signalSide = data.side;
                signalPrice = data.price;
                console.log(`🟢 BUY Signal detected at $${data.price}: ${data.side} (confidence: ${data.confidence})`);
            });

            // Scenario: Heavy retail selling (aggressive takers) hitting institutional bids (passive makers)
            // This should generate a BUY signal because institutions are accumulating from retail
            const events: EnrichedTradeEvent[] = [];

            // Phase 1: Build up retail selling pressure at support
            for (let i = 0; i < 8; i++) {
                events.push(
                    createAbsorptionEvent(
                        supportLevel,
                        70 + i * 18, // Increasing retail panic selling
                        baseTime + i * 3500,
                        true, // Aggressive takers (retail panic selling)
                        "sell",
                        1300 + i * 60, // Bid support building (institutional buying)
                        900 - i * 25 // Ask side weakening (retail exhausting asks)
                    )
                );
            }

            // Phase 2: Large institutional absorption event
            events.push(
                createAbsorptionEvent(
                    supportLevel,
                    220, // Large institutional buy order
                    baseTime + 30000,
                    false, // Passive maker (institutional buyer)
                    "buy",
                    1800, // Strong bid wall
                    650 // Weakened asks
                )
            );

            // Process events
            events.forEach((event, i) => {
                detector.onEnrichedTrade(event);
                console.log(`Event ${i}: ${event.side} ${event.quantity} at $${event.price} (aggressive: ${event.aggression > 0.5})`);
            });

            // Validation: Should generate BUY signal
            expect(signalEmitted).toBe(true);
            if (signalEmitted) {
                expect(signalSide).toBe("BUY");
                expect(signalPrice).toBe(supportLevel);
                console.log("✅ Correct BUY signal generated for institutional buying absorption");
            }
        });

        it("should generate BUY signal when smart money accumulates during retail capitulation", () => {
            console.log("\n=== 🟢 ACCUMULATION DURING CAPITULATION ===");
            
            const baseTime = Date.now() - 50000;
            const capitulationLevel = 48000;
            let signalEmitted = false;
            let signalSide: string | undefined;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                signalSide = data.side;
                console.log(`🟢 Signal: ${data.side} at $${data.price} (confidence: ${data.confidence})`);
            });

            // Scenario: Retail capitulation with aggressive selling but smart money accumulating
            const events: EnrichedTradeEvent[] = [];

            // Retail capitulation with aggressive selling
            for (let i = 0; i < 7; i++) {
                events.push(
                    createAbsorptionEvent(
                        capitulationLevel - i * 1, // Price declining under selling pressure
                        90 + i * 25, // Increasing retail selling volume
                        baseTime + i * 3000,
                        true, // Aggressive retail selling
                        "sell",
                        1000 + i * 100, // Bids building (smart money stepping in)
                        800 - i * 60 // Asks being consumed by selling
                    )
                );
            }

            // Smart money large accumulation
            events.push(
                createAbsorptionEvent(
                    capitulationLevel - 5, // Bottom of the move
                    300, // Large institutional buy
                    baseTime + 25000,
                    false, // Passive institutional buyer
                    "buy",
                    1800, // Strong bid support
                    500 // Low ask volume
                )
            );

            events.forEach((event) => detector.onEnrichedTrade(event));

            // Should generate BUY signal for accumulation
            expect(signalEmitted).toBe(true);
            if (signalEmitted) {
                expect(signalSide).toBe("BUY");
                console.log("✅ Correct BUY signal for smart money accumulation");
            }
        });
    });

    describe("⚪ NO Signal Scenarios (Balanced/Inconclusive)", () => {
        it("should NOT generate signals during balanced institutional activity", () => {
            console.log("\n=== ⚪ BALANCED MARKET TEST ===");
            
            const baseTime = Date.now() - 40000;
            const balancedLevel = 50000;
            let signalEmitted = false;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                console.log(`❌ Unexpected signal: ${data.side} at $${data.price}`);
            });

            // Scenario: Balanced trading with no clear institutional bias
            const events: EnrichedTradeEvent[] = [];

            // Mixed trading with no clear absorption pattern
            for (let i = 0; i < 10; i++) {
                const isBuy = i % 2 === 0; // Alternating buy/sell
                events.push(
                    createAbsorptionEvent(
                        balancedLevel + (Math.random() - 0.5) * 10, // Random price variation
                        50 + Math.random() * 30, // Mixed volume
                        baseTime + i * 2000,
                        Math.random() > 0.5, // Random aggression
                        isBuy ? "buy" : "sell",
                        1000 + Math.random() * 200, // Stable bid volume
                        1000 + Math.random() * 200 // Stable ask volume
                    )
                );
            }

            events.forEach((event) => detector.onEnrichedTrade(event));

            // Should NOT generate any signals
            expect(signalEmitted).toBe(false);
            console.log("✅ Correctly did not generate signal for balanced market");
        });

        it("should NOT generate signals during low volume conditions", () => {
            console.log("\n=== ⚪ LOW VOLUME TEST ===");
            
            const baseTime = Date.now() - 30000;
            const quietLevel = 50500;
            let signalEmitted = false;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                console.log(`❌ Unexpected signal in low volume: ${data.side} at $${data.price}`);
            });

            // Scenario: Low volume trading that shouldn't trigger absorption signals
            const events: EnrichedTradeEvent[] = [];

            for (let i = 0; i < 8; i++) {
                events.push(
                    createAbsorptionEvent(
                        quietLevel,
                        15 + Math.random() * 10, // Low volume (below minAggVolume threshold)
                        baseTime + i * 4000,
                        Math.random() > 0.5,
                        Math.random() > 0.5 ? "buy" : "sell",
                        800 + Math.random() * 100,
                        800 + Math.random() * 100
                    )
                );
            }

            events.forEach((event) => detector.onEnrichedTrade(event));

            // Should NOT generate signals due to low volume
            expect(signalEmitted).toBe(false);
            console.log("✅ Correctly did not generate signal for low volume conditions");
        });
    });

    describe("🎯 Signal Direction Consistency Tests", () => {
        it("should consistently provide directionally correct signals across multiple scenarios", () => {
            console.log("\n=== 🎯 CONSISTENCY VALIDATION ===");
            
            const scenarios = [
                {
                    name: "Resistance Rejection",
                    expectedSignal: "SELL",
                    description: "Heavy buying into institutional selling at resistance",
                    setup: (baseTime: number, level: number) => {
                        const events: EnrichedTradeEvent[] = [];
                        // Aggressive buying hitting passive selling
                        for (let i = 0; i < 6; i++) {
                            events.push(
                                createAbsorptionEvent(
                                    level,
                                    70 + i * 20,
                                    baseTime + i * 4000,
                                    true, // Aggressive buying
                                    "buy",
                                    900 - i * 30, // Weakening bids
                                    1200 + i * 40 // Building asks
                                )
                            );
                        }
                        // Large institutional sell
                        events.push(
                            createAbsorptionEvent(level, 180, baseTime + 26000, false, "sell", 800, 1500)
                        );
                        return events;
                    }
                },
                {
                    name: "Support Hold",
                    expectedSignal: "BUY", 
                    description: "Heavy selling into institutional buying at support",
                    setup: (baseTime: number, level: number) => {
                        const events: EnrichedTradeEvent[] = [];
                        // Aggressive selling hitting passive buying
                        for (let i = 0; i < 6; i++) {
                            events.push(
                                createAbsorptionEvent(
                                    level,
                                    75 + i * 18,
                                    baseTime + i * 3500,
                                    true, // Aggressive selling
                                    "sell",
                                    1300 + i * 45, // Building bids
                                    850 - i * 35 // Weakening asks
                                )
                            );
                        }
                        // Large institutional buy
                        events.push(
                            createAbsorptionEvent(level, 190, baseTime + 24000, false, "buy", 1600, 650)
                        );
                        return events;
                    }
                },
                {
                    name: "False Breakout",
                    expectedSignal: "SELL",
                    description: "Retail breakout attempt absorbed by institutions",
                    setup: (baseTime: number, level: number) => {
                        const events: EnrichedTradeEvent[] = [];
                        // Breakout attempt with aggressive buying
                        for (let i = 0; i < 5; i++) {
                            events.push(
                                createAbsorptionEvent(
                                    level + i * 3,
                                    85 + i * 25,
                                    baseTime + i * 3000,
                                    true, // Aggressive breakout buying
                                    "buy",
                                    1000,
                                    900 - i * 70
                                )
                            );
                        }
                        // Institutional rejection
                        events.push(
                            createAbsorptionEvent(level + 10, 220, baseTime + 18000, false, "sell", 950, 1400)
                        );
                        return events;
                    }
                }
            ];

            let correctSignals = 0;
            let totalSignals = 0;

            for (const scenario of scenarios) {
                // Reset detector for each scenario - use WORKING settings
                detector = new AbsorptionDetector(
                    `test-${scenario.name}`,
                    {
                        windowMs: 60000,
                        minAggVolume: 40,
                        pricePrecision: 2,
                        zoneTicks: 3,
                        absorptionThreshold: 0.3, // ✅ Use working threshold
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
                    },
                    mockOrderBook,
                    mockLogger,
                    mockSpoofingDetector,
                    mockMetrics
                );

                let signalGenerated = false;
                let actualSignal: string | undefined;

                detector.on("signalCandidate", (data) => {
                    signalGenerated = true;
                    actualSignal = data.side;
                    totalSignals++;
                    
                    if (data.side === scenario.expectedSignal) {
                        correctSignals++;
                        console.log(`✅ ${scenario.name}: Expected ${scenario.expectedSignal}, Got ${data.side} ✓`);
                    } else {
                        console.log(`❌ ${scenario.name}: Expected ${scenario.expectedSignal}, Got ${data.side} ✗`);
                    }
                });

                const baseTime = Date.now() - 60000;
                const level = 50000 + Math.random() * 1000; // Vary levels
                const events = scenario.setup(baseTime, level);
                
                events.forEach((event) => detector.onEnrichedTrade(event));

                console.log(`📊 ${scenario.name}: ${scenario.description}`);
                if (!signalGenerated) {
                    console.log(`⚠️  ${scenario.name}: No signal generated (may need threshold adjustment)`);
                }
            }

            console.log(`\n🎯 SIGNAL ACCURACY SUMMARY:`);
            console.log(`Correct signals: ${correctSignals}/${totalSignals}`);
            if (totalSignals > 0) {
                const accuracy = (correctSignals / totalSignals) * 100;
                console.log(`Accuracy: ${accuracy.toFixed(1)}%`);
                
                // Expect at least 80% accuracy for directional signals
                expect(accuracy).toBeGreaterThanOrEqual(80);
            }

            // At minimum, we should have generated some signals
            expect(totalSignals).toBeGreaterThan(0);
        });
    });

    describe("🔍 Edge Cases and False Signals", () => {
        it("should not generate contradictory signals in choppy markets", () => {
            console.log("\n=== 🔍 CHOPPY MARKET TEST ===");
            
            const baseTime = Date.now() - 60000;
            const choppyLevel = 50000;
            const signals: Array<{side: string, price: number, timestamp: number}> = [];

            detector.on("signalCandidate", (data) => {
                signals.push({
                    side: data.side,
                    price: data.price,
                    timestamp: data.timestamp
                });
                console.log(`Signal: ${data.side} at $${data.price} (${new Date(data.timestamp).toLocaleTimeString()})`);
            });

            // Create choppy market conditions
            const events: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 15; i++) {
                const priceVariation = (Math.sin(i * 0.5) * 20); // Oscillating price
                const isBuyPhase = Math.sin(i * 0.3) > 0;
                
                events.push(
                    createAbsorptionEvent(
                        choppyLevel + priceVariation,
                        60 + Math.random() * 40,
                        baseTime + i * 3000,
                        Math.random() > 0.3, // Mostly aggressive
                        isBuyPhase ? "buy" : "sell",
                        1000 + Math.random() * 300,
                        1000 + Math.random() * 300
                    )
                );
            }

            events.forEach((event) => detector.onEnrichedTrade(event));

            // Analyze signal quality
            if (signals.length > 1) {
                // Check for rapid signal reversals (bad sign)
                let rapidReversals = 0;
                for (let i = 1; i < signals.length; i++) {
                    const timeDiff = signals[i].timestamp - signals[i-1].timestamp;
                    const sideChanged = signals[i].side !== signals[i-1].side;
                    
                    if (sideChanged && timeDiff < 15000) { // Less than 15 seconds
                        rapidReversals++;
                        console.log(`⚠️  Rapid reversal: ${signals[i-1].side} → ${signals[i].side} (${timeDiff}ms apart)`);
                    }
                }

                // Should not have excessive rapid reversals
                const reversalRate = rapidReversals / (signals.length - 1);
                expect(reversalRate).toBeLessThan(0.5); // Less than 50% reversal rate
                console.log(`Rapid reversal rate: ${(reversalRate * 100).toFixed(1)}%`);
            }

            console.log(`Total signals in choppy market: ${signals.length}`);
        });

        it("should maintain signal quality during high frequency events", () => {
            console.log("\n=== 🔍 HIGH FREQUENCY TEST ===");
            
            const baseTime = Date.now() - 30000;
            const hfLevel = 51000;
            let signalCount = 0;

            detector.on("signalCandidate", (data) => {
                signalCount++;
                console.log(`HF Signal ${signalCount}: ${data.side} at $${data.price}`);
            });

            // Rapid-fire events (high frequency trading simulation)
            const events: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 20; i++) {
                events.push(
                    createAbsorptionEvent(
                        hfLevel + (Math.random() - 0.5) * 5, // Small price variations
                        30 + Math.random() * 20, // Moderate volumes
                        baseTime + i * 500, // 500ms apart (high frequency)
                        Math.random() > 0.5,
                        Math.random() > 0.5 ? "buy" : "sell",
                        1000 + Math.random() * 100,
                        1000 + Math.random() * 100
                    )
                );
            }

            events.forEach((event) => detector.onEnrichedTrade(event));

            // Should not spam signals in high frequency conditions
            expect(signalCount).toBeLessThanOrEqual(3); // At most 3 signals for 20 rapid events
            console.log(`Signal count for 20 HF events: ${signalCount} (should be ≤ 3)`);
        });
    });
});