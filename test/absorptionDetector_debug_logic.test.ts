// test/absorptionDetector_debug_logic.test.ts
// Focused debugging to trace exact signal direction logic

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
    info: vi.fn((msg, data) => console.log(`[INFO] ${msg}`, data)),
    warn: vi.fn((msg, data) => console.log(`[WARN] ${msg}`, data)),
    error: vi.fn((msg, data) => console.log(`[ERROR] ${msg}`, data)),
    debug: vi.fn((msg, data) => console.log(`[DEBUG] ${msg}`, data)),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

/**
 * Create simple test event with clear buyerIsMaker logic
 */
function createSimpleTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean, // Direct control of this flag
    passiveBidVolume: number = 1000,
    passiveAskVolume: number = 1000
): EnrichedTradeEvent {
    return {
        tradeId: `debug_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        side: buyerIsMaker ? "sell" : "buy", // Derived from buyerIsMaker
        aggression: 0.8,
        enriched: true,
        zonePassiveBidVolume: passiveBidVolume,
        zonePassiveAskVolume: passiveAskVolume,
    };
}

describe("AbsorptionDetector - Debug Logic Chain", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    const debugSettings: AbsorptionSettings = {
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
            "debug-logic",
            debugSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );
    });

    it("should trace aggressive buying pattern with clear buyerIsMaker flags", () => {
        console.log("\n=== DEBUGGING: Aggressive Buying Pattern ===");

        const baseTime = Date.now() - 60000;
        const basePrice = 50000;

        let signalEmitted = false;
        let signalData: any = null;

        detector.on("signalCandidate", (data) => {
            signalEmitted = true;
            signalData = data;
            console.log("\n🎯 SIGNAL EMITTED:");
            console.log(`  Signal Side: ${data.side}`);
            console.log(`  Signal Price: ${data.price}`);
            console.log(`  Signal Confidence: ${data.confidence}`);
            console.log(
                `  Absorbing Side: ${data.data?.metrics?.absorbingSide}`
            );
            console.log(
                `  Aggressive Side: ${data.data?.metrics?.aggressiveSide}`
            );
            console.log(
                `  Signal Interpretation: ${data.data?.metrics?.signalInterpretation}`
            );
        });

        // Create 8 aggressive BUY trades (buyerIsMaker = false)
        console.log(
            "\n📊 Creating 8 aggressive BUY trades (buyerIsMaker = false):"
        );
        for (let i = 0; i < 8; i++) {
            const trade = createSimpleTestEvent(
                basePrice,
                60 + i * 15, // Increasing volume
                baseTime + i * 3000,
                false, // buyerIsMaker = false → aggressive buy hitting ask
                900 - i * 20, // Weakening bids
                1200 + i * 50 // Building asks (institutional)
            );

            console.log(
                `  Trade ${i + 1}: buyerIsMaker=${trade.buyerIsMaker}, side=${trade.side}, quantity=${trade.quantity}`
            );
            detector.onEnrichedTrade(trade);
        }

        // Add 1 large passive SELL (buyerIsMaker = true)
        console.log("\n📊 Adding 1 large passive SELL (buyerIsMaker = true):");
        const passiveSell = createSimpleTestEvent(
            basePrice,
            200, // Large institutional sell
            baseTime + 25000,
            true, // buyerIsMaker = true → buyer is maker, seller is taker (passive sell)
            750, // Weakened bids
            1500 // Strong ask wall
        );
        console.log(
            `  Passive Trade: buyerIsMaker=${passiveSell.buyerIsMaker}, side=${passiveSell.side}, quantity=${passiveSell.quantity}`
        );
        detector.onEnrichedTrade(passiveSell);

        // Wait for processing
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log("\n📋 ANALYSIS RESULTS:");
                console.log(`Signal Emitted: ${signalEmitted}`);
                if (signalEmitted) {
                    console.log(
                        `Expected: SELL (institutional selling direction)`
                    );
                    console.log(`Actual: ${signalData.side}`);
                    console.log(
                        `Match: ${signalData.side.toUpperCase() === "SELL" ? "✅" : "❌"}`
                    );

                    console.log("\n🔍 DETAILED DEBUG INFO:");
                    console.log(
                        `absorbingSide: ${signalData.data?.metrics?.absorbingSide}`
                    );
                    console.log(
                        `aggressiveSide: ${signalData.data?.metrics?.aggressiveSide}`
                    );
                    console.log(
                        `flowAnalysis:`,
                        signalData.data?.metrics?.flowAnalysis
                    );
                } else {
                    console.log(
                        "No signal generated - check threshold conditions"
                    );
                }

                console.log("\n============================================");
                resolve();
            }, 100);
        });
    });

    it("should trace aggressive selling pattern with clear buyerIsMaker flags", () => {
        console.log("\n=== DEBUGGING: Aggressive Selling Pattern ===");

        const baseTime = Date.now() - 60000;
        const basePrice = 50000;

        let signalEmitted = false;
        let signalData: any = null;

        detector.on("signalCandidate", (data) => {
            signalEmitted = true;
            signalData = data;
            console.log("\n🎯 SIGNAL EMITTED:");
            console.log(`  Signal Side: ${data.side}`);
            console.log(
                `  Absorbing Side: ${data.data?.metrics?.absorbingSide}`
            );
            console.log(
                `  Aggressive Side: ${data.data?.metrics?.aggressiveSide}`
            );
        });

        // Create 8 aggressive SELL trades (buyerIsMaker = true)
        console.log(
            "\n📊 Creating 8 aggressive SELL trades (buyerIsMaker = true):"
        );
        for (let i = 0; i < 8; i++) {
            const trade = createSimpleTestEvent(
                basePrice,
                70 + i * 18, // Increasing volume
                baseTime + i * 3500,
                true, // buyerIsMaker = true → aggressive sell hitting bid
                1300 + i * 60, // Building bids (institutional)
                900 - i * 25 // Weakening asks
            );

            console.log(
                `  Trade ${i + 1}: buyerIsMaker=${trade.buyerIsMaker}, side=${trade.side}, quantity=${trade.quantity}`
            );
            detector.onEnrichedTrade(trade);
        }

        // Add 1 large passive BUY (buyerIsMaker = false)
        console.log("\n📊 Adding 1 large passive BUY (buyerIsMaker = false):");
        const passiveBuy = createSimpleTestEvent(
            basePrice,
            220, // Large institutional buy
            baseTime + 30000,
            false, // buyerIsMaker = false → buyer is taker, seller is maker (passive buy)
            1800, // Strong bid wall
            650 // Weakened asks
        );
        console.log(
            `  Passive Trade: buyerIsMaker=${passiveBuy.buyerIsMaker}, side=${passiveBuy.side}, quantity=${passiveBuy.quantity}`
        );
        detector.onEnrichedTrade(passiveBuy);

        // Wait for processing
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log("\n📋 ANALYSIS RESULTS:");
                console.log(`Signal Emitted: ${signalEmitted}`);
                if (signalEmitted) {
                    console.log(
                        `Expected: BUY (institutional buying direction)`
                    );
                    console.log(`Actual: ${signalData.side}`);
                    console.log(
                        `Match: ${signalData.side.toUpperCase() === "BUY" ? "✅" : "❌"}`
                    );
                } else {
                    console.log(
                        "No signal generated - check threshold conditions"
                    );
                }

                console.log("\n============================================");
                resolve();
            }, 100);
        });
    });
});
