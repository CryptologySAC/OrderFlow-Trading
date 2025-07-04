// test/absorptionDetector_timestamp_fix.test.ts
// 🔬 TIMESTAMP FIX: Test if timestamp pruning is causing the blocking

import { describe, it, beforeEach, vi } from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

const createTimestampLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        console.log(`[INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
    }),
    warn: vi.fn((msg, data) => {
        console.log(`[WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
    }),
    error: vi.fn((msg, data) => {
        console.log(
            `[ERROR] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    debug: vi.fn((msg, data) => {
        console.log(
            `[DEBUG] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

function createTimestampTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean
): EnrichedTradeEvent {
    return {
        tradeId: `timestamp_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        side: buyerIsMaker ? "sell" : "buy",
        aggression: 0.8,
        enriched: true,
        zonePassiveBidVolume: 1000,
        zonePassiveAskVolume: 1000,
    };
}

describe("AbsorptionDetector - Timestamp Fix", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    it(
        "should test if timestamp pruning is blocking signal generation",
        { timeout: 10000 },
        async () => {
            console.log(`\n🔬 ===== TIMESTAMP FIX: Pruning Analysis =====`);

            mockLogger = createTimestampLogger();

            const { MetricsCollector: MockMetricsCollector } = await import(
                "../__mocks__/src/infrastructure/metricsCollector.js"
            );
            mockMetrics = new MockMetricsCollector() as any;

            mockSpoofingDetector = createMockSpoofingDetector();

            const mockDepthMap = new Map();
            mockDepthMap.set(50000, { bid: 2000, ask: 2000 });

            mockOrderBook = {
                getBestBid: vi.fn().mockReturnValue(50000),
                getBestAsk: vi.fn().mockReturnValue(50001),
                getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
                getDepth: vi.fn().mockReturnValue(mockDepthMap),
                isHealthy: vi.fn().mockReturnValue(true),
                getLastUpdate: vi.fn().mockReturnValue(Date.now()),
            };

            const timestampSettings: AbsorptionSettings = {
                windowMs: 60000, // 60 second window
                minAggVolume: 1,
                pricePrecision: 2,
                zoneTicks: 3,
                absorptionThreshold: 0.01,
                priceEfficiencyThreshold: 0.99,
                maxAbsorptionRatio: 0.99,
                strongAbsorptionRatio: 0.01,
                moderateAbsorptionRatio: 0.01,
                weakAbsorptionRatio: 1.0,
                spreadImpactThreshold: 0.1,
                velocityIncreaseThreshold: 0.1,
                features: {
                    liquidityGradient: false,
                    absorptionVelocity: false,
                    layeredAbsorption: false,
                    spreadImpact: false,
                },
            };

            detector = new AbsorptionDetector(
                "timestamp-fix",
                timestampSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics
            );

            let signalEmitted = false;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                console.log(
                    `🎯 SIGNAL GENERATED: ${data.side} at ${data.price}`
                );
            });

            const now = Date.now();
            console.log(`\n📊 Current time: ${now}`);
            console.log(`📊 Window size: 60000ms (60 seconds)`);

            console.log(`\n📊 Test 1: Recent timestamps (within window)`);
            console.log(
                `  Using timestamps from last 30 seconds to ensure they're within window`
            );

            // Use RECENT timestamps to avoid pruning
            const recentTrades = [
                { timestamp: now - 5000, quantity: 100 }, // 5 seconds ago
                { timestamp: now - 10000, quantity: 150 }, // 10 seconds ago
                { timestamp: now - 15000, quantity: 200 }, // 15 seconds ago
                { timestamp: now - 20000, quantity: 250 }, // 20 seconds ago
                { timestamp: now - 25000, quantity: 300 }, // 25 seconds ago
            ];

            recentTrades.forEach((trade, i) => {
                const event = createTimestampTestEvent(
                    50000,
                    trade.quantity,
                    trade.timestamp,
                    true // All sells
                );

                const ageMs = now - trade.timestamp;
                console.log(
                    `  Trade ${i + 1}: SELL ${trade.quantity} (${ageMs}ms ago, within ${ageMs < 60000 ? "YES" : "NO"} window)`
                );
                detector.onEnrichedTrade(event);
            });

            console.log(
                `\n📊 Waiting for signal processing with recent timestamps...`
            );

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`\n🎯 TIMESTAMP FIX RESULT:`);
                    console.log(`  Signal Generated: ${signalEmitted}`);

                    if (signalEmitted) {
                        console.log(
                            `  ✅ SUCCESS: Recent timestamps allow signal generation!`
                        );
                        console.log(
                            `  CONFIRMED: Timestamp pruning was the blocking issue`
                        );
                    } else {
                        console.log(
                            `  ❌ STILL BLOCKED: Even recent timestamps don't work`
                        );
                        console.log(
                            `  The issue is deeper than timestamp pruning`
                        );

                        console.log(`\n🔍 DEBUGGING INFO:`);
                        console.log(
                            `    All trades were within the 60-second window`
                        );
                        console.log(
                            `    Issue must be in zone aggregation or analysis logic`
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
