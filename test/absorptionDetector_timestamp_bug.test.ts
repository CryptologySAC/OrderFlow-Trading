// test/absorptionDetector_timestamp_bug.test.ts
// 🚨 CRITICAL BUG: getDominantAggressiveSide uses Date.now() instead of trade timestamps

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

function createTimestampTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean
): EnrichedTradeEvent {
    return {
        tradeId: `timestamp_bug_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        side: buyerIsMaker ? "sell" : "buy",
        aggression: 0.8,
        enriched: true,
        passiveBidVolume: 3000,
        passiveAskVolume: 2000,
        zonePassiveBidVolume: 6000,
        zonePassiveAskVolume: 4000,
    };
}

const createTestLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        if (msg.includes("CORRECTED ABSORPTION SIGNAL")) {
            console.log(`🎯 [SIGNAL] ${msg}`, JSON.stringify(data, null, 2));
        }
    }),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

describe("AbsorptionDetector - Timestamp Bug Investigation", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    beforeEach(async () => {
        mockLogger = createTestLogger();

        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        mockSpoofingDetector = createMockSpoofingDetector();

        const mockDepthMap = new Map();
        mockDepthMap.set(50000, { bid: 3000, ask: 2000 });

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
        "should demonstrate timestamp bug causing wrong signal direction",
        { timeout: 10000 },
        () => {
            console.log(`\n🚨 ===== TIMESTAMP BUG INVESTIGATION =====`);
            console.log(
                `🎯 HYPOTHESIS: getDominantAggressiveSide uses Date.now() instead of trade timestamps`
            );

            const settings: AbsorptionSettings = {
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
                // The bug is in these time-based settings:
                dominantSideAnalysisWindowMs: 45000, // 45 second window
                dominantSideMinTradesRequired: 3,
                dominantSideFallbackTradeCount: 10,
                features: {
                    liquidityGradient: true,
                    absorptionVelocity: false,
                    layeredAbsorption: false,
                    spreadImpact: true,
                },
            };

            detector = new AbsorptionDetector(
                "timestamp-bug",
                settings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics
            );

            let signalEmitted = false;
            let signalData: any = null;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                signalData = data;
                console.log(
                    `\n🎯 SIGNAL DETECTED: ${data.side} at ${data.price}`
                );
                console.log(`  Confidence: ${data.confidence}`);
            });

            const now = Date.now();
            console.log(`\n📊 Current time: ${now}`);
            console.log(
                `📊 dominantSideAnalysisWindowMs: ${settings.dominantSideAnalysisWindowMs}`
            );
            console.log(
                `📊 Cutoff time: ${now - settings.dominantSideAnalysisWindowMs!}`
            );

            console.log(
                `\n📊 Test Pattern: Heavy Selling (should generate BUY signal)`
            );

            // BUG DEMONSTRATION: Old timestamps that will be filtered out
            const problemTrades = [
                { buyerIsMaker: true, quantity: 100, offset: -50000 }, // 50s ago (outside 45s window)
                { buyerIsMaker: true, quantity: 120, offset: -40000 }, // 40s ago (outside 45s window)
                { buyerIsMaker: true, quantity: 150, offset: -35000 }, // 35s ago (inside 45s window)
                { buyerIsMaker: true, quantity: 180, offset: -30000 }, // 30s ago (inside 45s window)
                { buyerIsMaker: true, quantity: 200, offset: -25000 }, // 25s ago (inside 45s window)
                { buyerIsMaker: true, quantity: 220, offset: -20000 }, // 20s ago (inside 45s window)
            ];

            let totalSellVolume = 0;
            let withinWindowCount = 0;

            problemTrades.forEach((trade, i) => {
                const tradeTimestamp = now + trade.offset;
                const withinWindow =
                    tradeTimestamp >=
                    now - settings.dominantSideAnalysisWindowMs!;

                console.log(
                    `  Trade ${i + 1}: SELL ${trade.quantity} at ${tradeTimestamp} (${Math.abs(trade.offset / 1000)}s ago) - ${withinWindow ? "WITHIN" : "OUTSIDE"} window`
                );

                if (withinWindow) withinWindowCount++;
                totalSellVolume += trade.quantity;

                const event = createTimestampTestEvent(
                    50000,
                    trade.quantity,
                    tradeTimestamp,
                    true // All sells
                );

                detector.onEnrichedTrade(event);
            });

            console.log(`\n📊 Timestamp Analysis:`);
            console.log(`  Total Trades: ${problemTrades.length}`);
            console.log(`  Trades Within Window: ${withinWindowCount}`);
            console.log(
                `  Trades Outside Window: ${problemTrades.length - withinWindowCount}`
            );
            console.log(`  Total Sell Volume: ${totalSellVolume}`);
            console.log(
                `  Expected: BUY signal (bid absorption of selling pressure)`
            );

            console.log(`\n🚨 BUG EFFECT:`);
            console.log(
                `  - getDominantAggressiveSide() filters trades by Date.now() - windowMs`
            );
            console.log(`  - Test trades with old timestamps get filtered out`);
            console.log(
                `  - Method falls back to last few trades (inconsistent sample)`
            );
            console.log(`  - Results in wrong dominant side calculation`);
            console.log(`  - Leads to wrong absorption side determination`);
            console.log(`  - Produces wrong signal direction`);

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`\n🔍 TIMESTAMP BUG RESULT:`);
                    console.log(`  Signal Generated: ${signalEmitted}`);

                    if (signalEmitted) {
                        console.log(`  Signal Direction: ${signalData.side}`);
                        console.log(`\n🚨 TIMESTAMP BUG ANALYSIS:`);

                        if (signalData.side === "buy") {
                            console.log(
                                `  ✅ CORRECT: BUY signal for selling pressure`
                            );
                            console.log(
                                `  The timestamp filtering worked correctly this time`
                            );
                        } else {
                            console.log(
                                `  ❌ WRONG: ${signalData.side.toUpperCase()} signal for selling pressure`
                            );
                            console.log(
                                `  🚨 CONFIRMED: Timestamp bug causing wrong signal direction!`
                            );
                            console.log(`\n💡 SOLUTION NEEDED:`);
                            console.log(`    Change line 876 from:`);
                            console.log(
                                `    const cutoff = Date.now() - this.dominantSideAnalysisWindowMs;`
                            );
                            console.log(`    To:`);
                            console.log(
                                `    const latestTimestamp = Math.max(...trades.map(t => t.timestamp));`
                            );
                            console.log(
                                `    const cutoff = latestTimestamp - this.dominantSideAnalysisWindowMs;`
                            );
                        }
                    } else {
                        console.log(
                            `  No signal generated - but timestamp bug still exists`
                        );
                    }

                    console.log(
                        `🚨 ================================================\n`
                    );
                    resolve();
                }, 200);
            });
        }
    );

    it(
        "should test with CURRENT timestamps (production scenario)",
        { timeout: 5000 },
        () => {
            console.log(`\n🔬 ===== CURRENT TIMESTAMP TEST =====`);
            console.log(
                `🎯 Testing with current timestamps (how production works)`
            );

            const settings: AbsorptionSettings = {
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
                dominantSideAnalysisWindowMs: 45000,
                features: {
                    liquidityGradient: true,
                    absorptionVelocity: false,
                    layeredAbsorption: false,
                    spreadImpact: true,
                },
            };

            detector = new AbsorptionDetector(
                "current-timestamps",
                settings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics
            );

            let signalEmitted = false;
            let signalData: any = null;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                signalData = data;
                console.log(`🎯 CURRENT TIMESTAMP SIGNAL: ${data.side}`);
            });

            const now = Date.now();

            // Current timestamps (like production)
            const currentTrades = [
                { buyerIsMaker: true, quantity: 100, offset: -5000 }, // 5s ago
                { buyerIsMaker: true, quantity: 120, offset: -4000 }, // 4s ago
                { buyerIsMaker: true, quantity: 150, offset: -3000 }, // 3s ago
                { buyerIsMaker: true, quantity: 180, offset: -2000 }, // 2s ago
                { buyerIsMaker: true, quantity: 200, offset: -1000 }, // 1s ago
            ];

            console.log(`\n📊 Processing with CURRENT timestamps:`);
            currentTrades.forEach((trade, i) => {
                const event = createTimestampTestEvent(
                    50000,
                    trade.quantity,
                    now + trade.offset, // Recent timestamps
                    true
                );

                console.log(
                    `  Trade ${i + 1}: SELL ${trade.quantity} (${Math.abs(trade.offset / 1000)}s ago)`
                );
                detector.onEnrichedTrade(event);
            });

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`\n🔍 CURRENT TIMESTAMP RESULT:`);
                    console.log(`  Signal Generated: ${signalEmitted}`);

                    if (signalEmitted) {
                        console.log(`  Signal: ${signalData.side}`);
                        console.log(
                            `  This shows how the detector behaves with proper timestamps`
                        );
                    }

                    console.log(
                        `🔬 ===============================================\n`
                    );
                    resolve();
                }, 200);
            });
        }
    );
});
