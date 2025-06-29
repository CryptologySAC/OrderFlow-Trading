// test/absorptionDetector_debug_minimal.test.ts
// 🔬 MINIMAL DEBUG: Find exactly why signals aren't generated

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

// Enhanced debug logger - capture ALL absorption-related messages
const createDebugLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        if (
            msg.includes("AbsorptionDetector") ||
            msg.includes("CORRECTED ABSORPTION SIGNAL") ||
            msg.includes("analyzeZoneForAbsorption") ||
            msg.includes("Zone data") ||
            msg.includes("calculatePriceEfficiency") ||
            msg.includes("No book data") ||
            msg.includes("Context-enhanced")
        ) {
            console.log(`[INFO] ${msg}`, JSON.stringify(data, null, 2));
        }
    }),
    warn: vi.fn((msg, data) => {
        if (
            msg.includes("AbsorptionDetector") ||
            msg.includes("No book data")
        ) {
            console.log(`[WARN] ${msg}`, JSON.stringify(data, null, 2));
        }
    }),
    error: vi.fn((msg, data) => {
        console.log(`[ERROR] ${msg}`, JSON.stringify(data, null, 2));
    }),
    debug: vi.fn((msg, data) => {
        if (msg.includes("AbsorptionDetector")) {
            console.log(`[DEBUG] ${msg}`, JSON.stringify(data, null, 2));
        }
    }),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

function createMinimalTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean
): EnrichedTradeEvent {
    return {
        tradeId: `minimal_${timestamp}_${Math.random()}`,
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

describe("AbsorptionDetector - Minimal Debug", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    it(
        "should debug exactly why no signals are generated",
        { timeout: 10000 },
        async () => {
            console.log(
                `\n🔬 ===== MINIMAL DEBUG: Signal Generation Failure =====`
            );

            mockLogger = createDebugLogger();

            const { MetricsCollector: MockMetricsCollector } = await import(
                "../__mocks__/src/infrastructure/metricsCollector.js"
            );
            mockMetrics = new MockMetricsCollector() as any;

            mockSpoofingDetector = createMockSpoofingDetector();

            // Mock order book with proper depth data
            const mockDepthMap = new Map();
            mockDepthMap.set(50000, { bid: 1000, ask: 1000 }); // Price level with liquidity

            mockOrderBook = {
                getBestBid: vi.fn().mockReturnValue(50000),
                getBestAsk: vi.fn().mockReturnValue(50001),
                getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
                getDepth: vi.fn().mockReturnValue(mockDepthMap),
                isHealthy: vi.fn().mockReturnValue(true),
                getLastUpdate: vi.fn().mockReturnValue(Date.now()),
            };

            // Ultra minimal settings - should allow ANY signal
            const minimalSettings: AbsorptionSettings = {
                windowMs: 60000,
                minAggVolume: 1, // Ultra low
                pricePrecision: 2,
                zoneTicks: 3,
                absorptionThreshold: 0.01, // Ultra low
                priceEfficiencyThreshold: 0.99, // Ultra high (less restrictive)
                maxAbsorptionRatio: 0.99, // Ultra high
                strongAbsorptionRatio: 0.01,
                moderateAbsorptionRatio: 0.01,
                weakAbsorptionRatio: 1.0,
                spreadImpactThreshold: 0.1,
                velocityIncreaseThreshold: 0.1,
                finalConfidenceRequired: 0.01, // Ultra low - allow any signal
                features: {
                    liquidityGradient: false, // All features disabled
                    absorptionVelocity: false,
                    layeredAbsorption: false,
                    spreadImpact: false,
                },
            };

            detector = new AbsorptionDetector(
                "minimal-debug",
                minimalSettings,
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
                console.log(`🎯 SIGNAL EMITTED!`);
                console.log(`  Side: ${data.side}`);
                console.log(`  Confidence: ${data.confidence}`);
                console.log(`  Price: ${data.price}`);
            });

            const baseTime = Date.now() - 60000;
            const basePrice = 50000;

            console.log(
                `\n📊 STEP 1: Processing 5 identical trades at same price`
            );
            console.log(
                `  Price: ${basePrice} (all trades same price = same zone)`
            );
            console.log(
                `  Zone calculation: price=${basePrice}, zoneTicks=3, precision=2`
            );

            // 5 trades at exact same price - should all be in same zone
            const trades = [
                { buyerIsMaker: true, quantity: 100 },
                { buyerIsMaker: true, quantity: 100 },
                { buyerIsMaker: true, quantity: 100 },
                { buyerIsMaker: true, quantity: 100 },
                { buyerIsMaker: true, quantity: 100 }, // Total: 500 sells
            ];

            trades.forEach((trade, i) => {
                const event = createMinimalTestEvent(
                    basePrice, // Exact same price
                    trade.quantity,
                    baseTime + i * 1000, // 1 second apart
                    trade.buyerIsMaker
                );

                console.log(
                    `  Trade ${i + 1}: SELL ${trade.quantity} at ${basePrice}`
                );
                detector.onEnrichedTrade(event);
            });

            console.log(`\n📊 STEP 2: Waiting for signal processing...`);

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`\n🎯 MINIMAL DEBUG RESULT:`);
                    console.log(`  Signal Generated: ${signalEmitted}`);

                    if (signalEmitted) {
                        console.log(`  ✅ SUCCESS: Signal generated!`);
                        console.log(`  Signal: ${signalData.side}`);
                        console.log(`  Confidence: ${signalData.confidence}`);
                    } else {
                        console.log(
                            `  ❌ FAILURE: No signal with ultra minimal settings`
                        );
                        console.log(
                            `  This confirms fundamental detection bug`
                        );
                        console.log(`\n🔍 ANALYSIS:`);
                        console.log(
                            `  - 5 trades at same price should be in same zone`
                        );
                        console.log(
                            `  - 100% selling pressure (500 sells, 0 buys)`
                        );
                        console.log(
                            `  - Ultra permissive thresholds (0.01 absorption, 1 minVol)`
                        );
                        console.log(`  - All features disabled`);
                        console.log(
                            `  - If this doesn't work, core detection logic is broken`
                        );
                    }

                    console.log(
                        `🔬 ==============================================\n`
                    );
                    resolve();
                }, 100);
            });
        }
    );
});
