// test/absorptionDetector_detailed_debug.test.ts
// 🔍 DETAILED DEBUG: Find exact null return points

import { describe, it, beforeEach, vi } from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

function createDetailedDebugEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean
): EnrichedTradeEvent {
    return {
        tradeId: `detailed_debug_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        side: buyerIsMaker ? "sell" : "buy",
        aggression: 0.8,
        enriched: true,
        passiveBidVolume: 5000,
        passiveAskVolume: 4000,
        zonePassiveBidVolume: 10000,
        zonePassiveAskVolume: 8000,
    };
}

const createDetailedDebugLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        console.log(
            `[DETAILED-INFO] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    warn: vi.fn((msg, data) => {
        console.log(
            `[DETAILED-WARN] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    error: vi.fn((msg, data) => {
        console.log(
            `[DETAILED-ERROR] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    debug: vi.fn((msg, data) => {
        console.log(
            `[DETAILED-DEBUG] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

describe("AbsorptionDetector - Detailed Debug", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    beforeEach(async () => {
        mockLogger = createDetailedDebugLogger();

        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        mockSpoofingDetector = createMockSpoofingDetector();

        const mockDepthMap = new Map();
        mockDepthMap.set(50000, { bid: 5000, ask: 4000 });

        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(50000),
            getBestAsk: vi.fn().mockReturnValue(50001),
            getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
            getDepth: vi.fn().mockReturnValue(mockDepthMap),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        };
    });

    it(
        "should trace null returns in signal generation",
        { timeout: 5000 },
        () => {
            console.log(`\n🔍 ===== DETAILED NULL RETURN DEBUG =====`);

            const detailedSettings: AbsorptionSettings = {
                windowMs: 60000,
                minAggVolume: 1,
                pricePrecision: 2,
                zoneTicks: 3,
                absorptionThreshold: 0.01,
                priceEfficiencyThreshold: 0.01, // Ultra permissive
                maxAbsorptionRatio: 0.99,
                strongAbsorptionRatio: 0.01,
                moderateAbsorptionRatio: 0.01,
                weakAbsorptionRatio: 1.0,
                spreadImpactThreshold: 0.1,
                velocityIncreaseThreshold: 0.1,
                expectedMovementScalingFactor: 1,
                dominantSideAnalysisWindowMs: 60000, // Full window
                dominantSideMinTradesRequired: 2, // Only need 2 trades
                dominantSideFallbackTradeCount: 5,
                features: {
                    liquidityGradient: false,
                    absorptionVelocity: false,
                    layeredAbsorption: false,
                    spreadImpact: false,
                },
            };

            detector = new AbsorptionDetector(
                "detailed-debug",
                detailedSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics
            );

            // Spy on key methods
            const getAbsorbingSideForZoneSpy = vi.spyOn(
                detector as any,
                "getAbsorbingSideForZone"
            );
            const getDominantAggressiveSideSpy = vi.spyOn(
                detector as any,
                "getDominantAggressiveSide"
            );
            const calculatePriceEfficiencySpy = vi.spyOn(
                detector as any,
                "calculatePriceEfficiency"
            );
            const checkAbsorptionConditionsSpy = vi.spyOn(
                detector as any,
                "checkAbsorptionConditions"
            );

            let signalEmitted = false;
            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                console.log(`🎯 SIGNAL DETECTED: ${data.side}`);
            });

            const now = Date.now();
            const basePrice = 50000;

            console.log(`\n📊 Processing extreme selling pattern:`);

            // Create extreme pattern to maximize signal probability
            const debugTrades = [
                { quantity: 100, offset: -30000 },
                { quantity: 120, offset: -25000 },
                { quantity: 140, offset: -20000 },
                { quantity: 160, offset: -15000 },
                { quantity: 180, offset: -10000 },
                { quantity: 200, offset: -5000 },
            ];

            debugTrades.forEach((trade, i) => {
                const event = createDetailedDebugEvent(
                    basePrice,
                    trade.quantity,
                    now + trade.offset,
                    true // All sells
                );

                console.log(`  Trade ${i + 1}: SELL ${trade.quantity}`);
                detector.onEnrichedTrade(event);
            });

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`\n🔍 METHOD CALL ANALYSIS:`);

                    // getAbsorbingSideForZone analysis
                    console.log(`\n1️⃣ getAbsorbingSideForZone:`);
                    console.log(
                        `   Called: ${getAbsorbingSideForZoneSpy.mock.calls.length} times`
                    );
                    if (getAbsorbingSideForZoneSpy.mock.calls.length > 0) {
                        const lastResult =
                            getAbsorbingSideForZoneSpy.mock.results[
                                getAbsorbingSideForZoneSpy.mock.results.length -
                                    1
                            ];
                        console.log(`   Last return: ${lastResult.value}`);
                        if (lastResult.value === null) {
                            console.log(
                                `   ❌ Returning null - blocking signal generation!`
                            );
                        }
                    }

                    // getDominantAggressiveSide analysis
                    console.log(`\n2️⃣ getDominantAggressiveSide:`);
                    console.log(
                        `   Called: ${getDominantAggressiveSideSpy.mock.calls.length} times`
                    );
                    if (getDominantAggressiveSideSpy.mock.calls.length > 0) {
                        const lastResult =
                            getDominantAggressiveSideSpy.mock.results[
                                getDominantAggressiveSideSpy.mock.results
                                    .length - 1
                            ];
                        console.log(`   Last return: ${lastResult.value}`);
                        if (lastResult.value === null) {
                            console.log(
                                `   ❌ Returning null - insufficient data for dominant side!`
                            );
                            const lastCall =
                                getDominantAggressiveSideSpy.mock.calls[
                                    getDominantAggressiveSideSpy.mock.calls
                                        .length - 1
                                ];
                            console.log(
                                `   Trades passed: ${lastCall[0].length}`
                            );
                        }
                    }

                    // calculatePriceEfficiency analysis
                    console.log(`\n3️⃣ calculatePriceEfficiency:`);
                    console.log(
                        `   Called: ${calculatePriceEfficiencySpy.mock.calls.length} times`
                    );
                    if (calculatePriceEfficiencySpy.mock.calls.length > 0) {
                        const lastResult =
                            calculatePriceEfficiencySpy.mock.results[
                                calculatePriceEfficiencySpy.mock.results
                                    .length - 1
                            ];
                        console.log(`   Last return: ${lastResult.value}`);
                        if (lastResult.value === null) {
                            console.log(
                                `   ❌ Returning null - price efficiency calculation failed!`
                            );
                        }
                    }

                    // checkAbsorptionConditions analysis
                    console.log(`\n4️⃣ checkAbsorptionConditions:`);
                    console.log(
                        `   Called: ${checkAbsorptionConditionsSpy.mock.calls.length} times`
                    );
                    if (checkAbsorptionConditionsSpy.mock.calls.length > 0) {
                        const lastResult =
                            checkAbsorptionConditionsSpy.mock.results[
                                checkAbsorptionConditionsSpy.mock.results
                                    .length - 1
                            ];
                        console.log(`   Last return:`, lastResult.value);
                    }

                    console.log(`\n📊 FINAL RESULT:`);
                    console.log(`   Signal emitted: ${signalEmitted}`);

                    console.log(`\n🔧 DIAGNOSIS:`);
                    if (!signalEmitted) {
                        if (
                            getAbsorbingSideForZoneSpy.mock.results.some(
                                (r) => r.value === null
                            )
                        ) {
                            console.log(
                                `   Primary issue: getAbsorbingSideForZone returning null`
                            );
                            if (
                                getDominantAggressiveSideSpy.mock.results.some(
                                    (r) => r.value === null
                                )
                            ) {
                                console.log(
                                    `   Root cause: getDominantAggressiveSide returning null`
                                );
                                console.log(
                                    `   Fix needed: Check trade count and time window logic`
                                );
                            } else if (
                                calculatePriceEfficiencySpy.mock.results.some(
                                    (r) => r.value === null
                                )
                            ) {
                                console.log(
                                    `   Root cause: calculatePriceEfficiency returning null`
                                );
                                console.log(
                                    `   Fix needed: Check price movement calculation`
                                );
                            }
                        } else if (
                            checkAbsorptionConditionsSpy.mock.calls.length === 0
                        ) {
                            console.log(
                                `   Issue: checkAbsorptionConditions never called`
                            );
                            console.log(
                                `   Fix needed: Check early returns in analyzeZoneForAbsorption`
                            );
                        }
                    }

                    console.log(
                        `🔍 ================================================\n`
                    );
                    resolve();
                }, 200);
            });
        }
    );
});
