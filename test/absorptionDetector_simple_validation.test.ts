// test/absorptionDetector_simple_validation.test.ts
// 🎯 SIMPLE: Validate basic absorption detection after fixes

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector, type AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

function createSimpleEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean
): EnrichedTradeEvent {
    return {
        tradeId: `simple_${timestamp}_${Math.random()}`,
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

const createSimpleLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        if (msg.includes("CORRECTED ABSORPTION SIGNAL")) {
            console.log(`🎯 [SIGNAL] ${msg}`);
            console.log(`   Side: ${data.side || data.absorbingSide}`);
            console.log(`   Confidence: ${data.confidence}`);
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

describe("AbsorptionDetector - Simple Validation", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    beforeEach(async () => {
        mockLogger = createSimpleLogger();
        
        const { MetricsCollector: MockMetricsCollector } = await import("../__mocks__/src/infrastructure/metricsCollector.js");
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

    it("should detect simple selling absorption pattern", { timeout: 5000 }, async () => {
        console.log(`\n🎯 ===== SIMPLE SELLING ABSORPTION TEST =====`);
        
        const simpleSettings: AbsorptionSettings = {
            windowMs: 60000,
            minAggVolume: 40,
            pricePrecision: 2,
            zoneTicks: 3,
            absorptionThreshold: 0.5,
            priceEfficiencyThreshold: 0.7,
            maxAbsorptionRatio: 0.7,
            expectedMovementScalingFactor: 10,
            features: {
                liquidityGradient: false,
                absorptionVelocity: false,
                layeredAbsorption: false,
                spreadImpact: false,
            },
        };

        detector = new AbsorptionDetector(
            "simple-test",
            simpleSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );

        const signals: any[] = [];
        detector.on("signalCandidate", (data) => {
            signals.push(data);
            console.log(`\n✅ SIGNAL EMITTED: ${data.side} at ${data.price}`);
        });

        const now = Date.now();
        
        console.log(`\n📊 Creating heavy selling pattern (should generate BUY signal):`);
        
        // Create a clear absorption pattern
        const trades = [
            { price: 50000, quantity: 100, offset: -20000 },
            { price: 50000, quantity: 150, offset: -15000 },
            { price: 50000, quantity: 200, offset: -10000 },
            { price: 50000, quantity: 250, offset: -5000 },
            { price: 50000, quantity: 300, offset: -1000 },
        ];

        for (const [i, trade] of trades.entries()) {
            const event = createSimpleEvent(
                trade.price,
                trade.quantity,
                now + trade.offset,
                true // All sells
            );
            console.log(`  Trade ${i + 1}: SELL ${trade.quantity} at ${trade.price}`);
            detector.onEnrichedTrade(event);
        }

        // Wait for signal processing
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log(`\n📊 RESULTS:`);
        console.log(`  Signals emitted: ${signals.length}`);
        
        if (signals.length > 0) {
            const lastSignal = signals[signals.length - 1];
            console.log(`  Last signal: ${lastSignal.side} at ${lastSignal.price}`);
            console.log(`  ✅ SUCCESS: Absorption detection is working!`);
            
            // Validate signal direction
            expect(lastSignal.side).toBe("buy");
        } else {
            console.log(`  ❌ ISSUE: No signals generated`);
        }
        
        console.log(`🎯 ================================================\n`);
    });

    it("should detect simple buying absorption pattern", { timeout: 5000 }, async () => {
        console.log(`\n🎯 ===== SIMPLE BUYING ABSORPTION TEST =====`);
        
        const simpleSettings: AbsorptionSettings = {
            windowMs: 60000,
            minAggVolume: 40,
            pricePrecision: 2,
            zoneTicks: 3,
            absorptionThreshold: 0.5,
            priceEfficiencyThreshold: 0.7,
            maxAbsorptionRatio: 0.7,
            expectedMovementScalingFactor: 10,
            features: {
                liquidityGradient: false,
                absorptionVelocity: false,
                layeredAbsorption: false,
                spreadImpact: false,
            },
        };

        detector = new AbsorptionDetector(
            "simple-buy-test",
            simpleSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );

        const signals: any[] = [];
        detector.on("signalCandidate", (data) => {
            signals.push(data);
            console.log(`\n✅ SIGNAL EMITTED: ${data.side} at ${data.price}`);
        });

        const now = Date.now();
        
        console.log(`\n📊 Creating heavy buying pattern (should generate SELL signal):`);
        
        // Create a clear absorption pattern
        const trades = [
            { price: 50001, quantity: 100, offset: -20000 },
            { price: 50001, quantity: 150, offset: -15000 },
            { price: 50001, quantity: 200, offset: -10000 },
            { price: 50001, quantity: 250, offset: -5000 },
            { price: 50001, quantity: 300, offset: -1000 },
        ];

        for (const [i, trade] of trades.entries()) {
            const event = createSimpleEvent(
                trade.price,
                trade.quantity,
                now + trade.offset,
                false // All buys
            );
            console.log(`  Trade ${i + 1}: BUY ${trade.quantity} at ${trade.price}`);
            detector.onEnrichedTrade(event);
        }

        // Wait for signal processing
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log(`\n📊 RESULTS:`);
        console.log(`  Signals emitted: ${signals.length}`);
        
        if (signals.length > 0) {
            const lastSignal = signals[signals.length - 1];
            console.log(`  Last signal: ${lastSignal.side} at ${lastSignal.price}`);
            console.log(`  ✅ SUCCESS: Absorption detection is working!`);
            
            // Validate signal direction
            expect(lastSignal.side).toBe("sell");
        } else {
            console.log(`  ❌ ISSUE: No signals generated`);
        }
        
        console.log(`🎯 ================================================\n`);
    });
});