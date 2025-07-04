// test/absorptionDetector_mathematical_evidence.test.ts
// MATHEMATICAL EVIDENCE: Show exact side generation logic for every scenario

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
    info: vi.fn((msg, data) =>
        console.log(`[INFO] ${msg}`, JSON.stringify(data, null, 2))
    ),
    warn: vi.fn((msg, data) =>
        console.log(`[WARN] ${msg}`, JSON.stringify(data, null, 2))
    ),
    error: vi.fn((msg, data) =>
        console.log(`[ERROR] ${msg}`, JSON.stringify(data, null, 2))
    ),
    debug: vi.fn((msg, data) =>
        console.log(`[DEBUG] ${msg}`, JSON.stringify(data, null, 2))
    ),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

/**
 * Create test event with PRECISE control over buyerIsMaker flag
 */
function createMathematicalTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean, // DIRECT control
    passiveBidVolume: number = 1000,
    passiveAskVolume: number = 1000,
    tradeId?: string
): EnrichedTradeEvent {
    return {
        tradeId: tradeId ?? `math_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker, // EXACT control
        side: buyerIsMaker ? "sell" : "buy", // Derived correctly
        aggression: 0.8,
        enriched: true,
        zonePassiveBidVolume: passiveBidVolume,
        zonePassiveAskVolume: passiveAskVolume,
    };
}

interface MathematicalScenario {
    name: string;
    description: string;
    expectedDominantAggressiveSide: "buy" | "sell";
    expectedAbsorbingSide: "bid" | "ask";
    expectedSignalSide: "buy" | "sell";
    mathLogic: string;
    setup: (baseTime: number, basePrice: number) => EnrichedTradeEvent[];
}

describe("AbsorptionDetector - MATHEMATICAL EVIDENCE for Signal Direction", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    const testSettings: AbsorptionSettings = {
        windowMs: 60000,
        minAggVolume: 40,
        pricePrecision: 2,
        zoneTicks: 3,
        absorptionThreshold: 0.3,
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

        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        mockSpoofingDetector = createMockSpoofingDetector();

        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(50000),
            getBestAsk: vi.fn().mockReturnValue(50001),
            getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
            getDepth: vi.fn().mockReturnValue(new Map()),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        };

        detector = new AbsorptionDetector(
            "mathematical-evidence",
            testSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );
    });

    describe("🧮 MATHEMATICAL SCENARIO BREAKDOWN", () => {
        const mathematicalScenarios: MathematicalScenario[] = [
            // 📊 SCENARIO 1: Pure Aggressive Buying
            {
                name: "Pure Aggressive Buying",
                description: "8 aggressive BUY trades (buyerIsMaker=false)",
                expectedDominantAggressiveSide: "buy",
                expectedAbsorbingSide: "ask", // opposite of aggressive side
                expectedSignalSide: "sell", // ask absorbing = institutions selling
                mathLogic:
                    "buyVolume=8×qty > sellVolume=0 → dominantSide='buy' → absorbingSide='ask' → signal='sell'",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // 8 aggressive BUY trades: buyerIsMaker=false
                    for (let i = 0; i < 8; i++) {
                        events.push(
                            createMathematicalTestEvent(
                                basePrice,
                                60 + i * 15, // volume: 60, 75, 90, 105, 120, 135, 150, 165
                                baseTime + i * 3000,
                                false, // buyerIsMaker=false → aggressive buy
                                900 - i * 20, // weakening bids
                                1200 + i * 50 // building asks
                            )
                        );
                    }

                    return events;
                },
            },

            // 📊 SCENARIO 2: Pure Aggressive Selling
            {
                name: "Pure Aggressive Selling",
                description: "8 aggressive SELL trades (buyerIsMaker=true)",
                expectedDominantAggressiveSide: "sell",
                expectedAbsorbingSide: "bid", // opposite of aggressive side
                expectedSignalSide: "buy", // bid absorbing = institutions buying
                mathLogic:
                    "sellVolume=8×qty > buyVolume=0 → dominantSide='sell' → absorbingSide='bid' → signal='buy'",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // 8 aggressive SELL trades: buyerIsMaker=true
                    for (let i = 0; i < 8; i++) {
                        events.push(
                            createMathematicalTestEvent(
                                basePrice,
                                70 + i * 18, // volume: 70, 88, 106, 124, 142, 160, 178, 196
                                baseTime + i * 3500,
                                true, // buyerIsMaker=true → aggressive sell
                                1300 + i * 60, // building bids
                                900 - i * 25 // weakening asks
                            )
                        );
                    }

                    return events;
                },
            },

            // 📊 SCENARIO 3: Mixed but Buy-Dominant
            {
                name: "Mixed but Buy-Dominant",
                description: "6 aggressive BUY + 2 aggressive SELL trades",
                expectedDominantAggressiveSide: "buy",
                expectedAbsorbingSide: "ask",
                expectedSignalSide: "sell",
                mathLogic:
                    "buyVolume=6×qty > sellVolume=2×qty → dominantSide='buy' → absorbingSide='ask' → signal='sell'",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // 6 aggressive BUY trades
                    for (let i = 0; i < 6; i++) {
                        events.push(
                            createMathematicalTestEvent(
                                basePrice,
                                80,
                                baseTime + i * 2000,
                                false, // buyerIsMaker=false → aggressive buy
                                1000,
                                1000
                            )
                        );
                    }

                    // 2 aggressive SELL trades
                    for (let i = 0; i < 2; i++) {
                        events.push(
                            createMathematicalTestEvent(
                                basePrice,
                                80,
                                baseTime + (6 + i) * 2000,
                                true, // buyerIsMaker=true → aggressive sell
                                1000,
                                1000
                            )
                        );
                    }

                    return events;
                },
            },

            // 📊 SCENARIO 4: Mixed but Sell-Dominant
            {
                name: "Mixed but Sell-Dominant",
                description: "2 aggressive BUY + 6 aggressive SELL trades",
                expectedDominantAggressiveSide: "sell",
                expectedAbsorbingSide: "bid",
                expectedSignalSide: "buy",
                mathLogic:
                    "sellVolume=6×qty > buyVolume=2×qty → dominantSide='sell' → absorbingSide='bid' → signal='buy'",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // 2 aggressive BUY trades
                    for (let i = 0; i < 2; i++) {
                        events.push(
                            createMathematicalTestEvent(
                                basePrice,
                                80,
                                baseTime + i * 2000,
                                false, // buyerIsMaker=false → aggressive buy
                                1000,
                                1000
                            )
                        );
                    }

                    // 6 aggressive SELL trades
                    for (let i = 0; i < 6; i++) {
                        events.push(
                            createMathematicalTestEvent(
                                basePrice,
                                80,
                                baseTime + (2 + i) * 2000,
                                true, // buyerIsMaker=true → aggressive sell
                                1000,
                                1000
                            )
                        );
                    }

                    return events;
                },
            },

            // 📊 SCENARIO 5: Exactly Balanced (Edge Case)
            {
                name: "Exactly Balanced Volumes",
                description:
                    "4 aggressive BUY + 4 aggressive SELL trades (same volume)",
                expectedDominantAggressiveSide: "sell", // tie-breaker: returns "sell" in current logic
                expectedAbsorbingSide: "bid",
                expectedSignalSide: "buy",
                mathLogic:
                    "buyVolume=sellVolume → tie-breaker returns 'sell' → absorbingSide='bid' → signal='buy'",
                setup: (baseTime: number, basePrice: number) => {
                    const events: EnrichedTradeEvent[] = [];

                    // 4 aggressive BUY trades
                    for (let i = 0; i < 4; i++) {
                        events.push(
                            createMathematicalTestEvent(
                                basePrice,
                                100, // exact same volume
                                baseTime + i * 2000,
                                false, // buyerIsMaker=false → aggressive buy
                                1000,
                                1000
                            )
                        );
                    }

                    // 4 aggressive SELL trades
                    for (let i = 0; i < 4; i++) {
                        events.push(
                            createMathematicalTestEvent(
                                basePrice,
                                100, // exact same volume
                                baseTime + (4 + i) * 2000,
                                true, // buyerIsMaker=true → aggressive sell
                                1000,
                                1000
                            )
                        );
                    }

                    return events;
                },
            },
        ];

        // Run mathematical evidence tests for each scenario
        mathematicalScenarios.forEach((scenario) => {
            it(
                `should provide mathematical evidence for: ${scenario.name}`,
                { timeout: 15000 },
                () => {
                    console.log(
                        `\n🧮 ========================= MATHEMATICAL EVIDENCE =========================`
                    );
                    console.log(`📊 SCENARIO: ${scenario.name}`);
                    console.log(`📝 DESCRIPTION: ${scenario.description}`);
                    console.log(`🧠 MATH LOGIC: ${scenario.mathLogic}`);
                    console.log(`\n📐 EXPECTED CALCULATIONS:`);
                    console.log(
                        `  • Dominant Aggressive Side: ${scenario.expectedDominantAggressiveSide}`
                    );
                    console.log(
                        `  • Absorbing Side: ${scenario.expectedAbsorbingSide}`
                    );
                    console.log(
                        `  • Final Signal Side: ${scenario.expectedSignalSide}`
                    );
                    console.log(`\n🔬 PROCESSING TRADES...`);

                    let signalEmitted = false;
                    let actualSignal: string | undefined;
                    let signalData: any = null;
                    let calculationData: any = null;

                    // Capture signals and internal calculations
                    detector.on("signalCandidate", (data) => {
                        signalEmitted = true;
                        actualSignal = data.side;
                        signalData = data;
                        calculationData = data.data?.metrics;

                        console.log(`\n🎯 SIGNAL CAPTURED!`);
                        console.log(`  Signal Side: ${data.side}`);
                        console.log(`  Confidence: ${data.confidence}`);
                        console.log(`  Price: ${data.price}`);
                    });

                    // Process scenario events
                    const baseTime = Date.now() - 60000;
                    const basePrice = 50000;
                    const events = scenario.setup(baseTime, basePrice);

                    console.log(`\n📊 TRADE BREAKDOWN:`);
                    let totalBuyVolume = 0;
                    let totalSellVolume = 0;

                    events.forEach((event, i) => {
                        if (event.buyerIsMaker) {
                            // buyerIsMaker=true → aggressive sell
                            totalSellVolume += event.quantity;
                            console.log(
                                `  Trade ${i + 1}: SELL ${event.quantity} (buyerIsMaker=true) → aggressive sell volume`
                            );
                        } else {
                            // buyerIsMaker=false → aggressive buy
                            totalBuyVolume += event.quantity;
                            console.log(
                                `  Trade ${i + 1}: BUY ${event.quantity} (buyerIsMaker=false) → aggressive buy volume`
                            );
                        }

                        detector.onEnrichedTrade(event);
                    });

                    console.log(`\n📈 VOLUME CALCULATIONS:`);
                    console.log(
                        `  • Total Aggressive Buy Volume: ${totalBuyVolume}`
                    );
                    console.log(
                        `  • Total Aggressive Sell Volume: ${totalSellVolume}`
                    );
                    console.log(
                        `  • Dominant Side: ${totalBuyVolume > totalSellVolume ? "buy" : "sell"}`
                    );
                    console.log(
                        `  • Expected Absorbing Side: ${totalBuyVolume > totalSellVolume ? "ask" : "bid"} (opposite of dominant)`
                    );
                    console.log(
                        `  • Expected Signal: ${totalBuyVolume > totalSellVolume ? "sell" : "buy"} (follow absorbing side)`
                    );

                    // Wait for processing
                    return new Promise<void>((resolve) => {
                        setTimeout(() => {
                            console.log(`\n📋 MATHEMATICAL VERIFICATION:`);

                            if (signalEmitted) {
                                console.log(
                                    `✅ Signal Generated: ${actualSignal}`
                                );
                                console.log(`📊 Internal Calculations:`, {
                                    absorbingSide:
                                        calculationData?.absorbingSide,
                                    aggressiveSide:
                                        calculationData?.aggressiveSide,
                                    signalInterpretation:
                                        calculationData?.signalInterpretation,
                                    absorptionType:
                                        calculationData?.absorptionType,
                                });

                                // Mathematical verification
                                const expectedSignal =
                                    scenario.expectedSignalSide;
                                const matchesExpected =
                                    actualSignal === expectedSignal;

                                console.log(`\n🎯 RESULT ANALYSIS:`);
                                console.log(`  Expected: ${expectedSignal}`);
                                console.log(`  Actual: ${actualSignal}`);
                                console.log(
                                    `  Match: ${matchesExpected ? "✅ CORRECT" : "❌ WRONG"}`
                                );

                                if (!matchesExpected) {
                                    console.log(
                                        `\n🚨 MATHEMATICAL ERROR DETECTED!`
                                    );
                                    console.log(
                                        `  This indicates a bug in the calculation logic`
                                    );
                                    console.log(
                                        `  Expected math: ${scenario.mathLogic}`
                                    );
                                    console.log(
                                        `  Actual result violates mathematical expectations`
                                    );
                                }
                            } else {
                                console.log(`⚠️ No Signal Generated`);
                                console.log(
                                    `  This may indicate threshold/filtering issues`
                                );
                                console.log(
                                    `  Or the scenario didn't meet detection criteria`
                                );
                            }

                            console.log(
                                `🧮 ====================================================================\n`
                            );
                            resolve();
                        }, 100);
                    });
                }
            );
        });
    });

    describe("🔍 EDGE CASE MATHEMATICAL ANALYSIS", () => {
        it(
            "should show tie-breaker logic for equal volumes",
            { timeout: 10000 },
            () => {
                console.log(`\n🔍 TESTING TIE-BREAKER LOGIC`);

                let signalEmitted = false;
                let actualSignal: string | undefined;

                detector.on("signalCandidate", (data) => {
                    signalEmitted = true;
                    actualSignal = data.side;
                    console.log(`  Tie-breaker result: ${data.side}`);
                    console.log(`  Calculations:`, data.data?.metrics);
                });

                const baseTime = Date.now() - 60000;
                const basePrice = 50000;

                // Create exactly equal buy/sell volumes
                const events = [
                    // 2 aggressive buys: 200 total volume
                    createMathematicalTestEvent(
                        basePrice,
                        100,
                        baseTime,
                        false,
                        1000,
                        1000
                    ),
                    createMathematicalTestEvent(
                        basePrice,
                        100,
                        baseTime + 5000,
                        false,
                        1000,
                        1000
                    ),
                    // 2 aggressive sells: 200 total volume
                    createMathematicalTestEvent(
                        basePrice,
                        100,
                        baseTime + 10000,
                        true,
                        1000,
                        1000
                    ),
                    createMathematicalTestEvent(
                        basePrice,
                        100,
                        baseTime + 15000,
                        true,
                        1000,
                        1000
                    ),
                ];

                events.forEach((event) => detector.onEnrichedTrade(event));

                return new Promise<void>((resolve) => {
                    setTimeout(() => {
                        console.log(`  Signal emitted: ${signalEmitted}`);
                        console.log(
                            `  Tie-breaker chose: ${actualSignal || "None"}`
                        );
                        resolve();
                    }, 100);
                });
            }
        );
    });
});
