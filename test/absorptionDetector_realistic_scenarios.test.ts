// test/absorptionDetector_realistic_scenarios.test.ts
// 🎯 REALISTIC: Actual absorption patterns with changing passive volumes

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector, type AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

/**
 * Create realistic event with proper passive volume data
 */
function createRealisticEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean,
    passiveBidVolume: number,
    passiveAskVolume: number
): EnrichedTradeEvent {
    return {
        tradeId: `realistic_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        side: buyerIsMaker ? "sell" : "buy",
        aggression: 0.8,
        enriched: true,
        // CRITICAL: Include all required passive volume fields
        passiveBidVolume,
        passiveAskVolume,
        zonePassiveBidVolume: passiveBidVolume * 2,
        zonePassiveAskVolume: passiveAskVolume * 2,
    };
}

const createRealisticLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        if (msg.includes("CORRECTED ABSORPTION SIGNAL")) {
            console.log(`🎯 [SIGNAL] ${msg}`);
            console.log(`   Direction: ${data.side || data.absorbingSide}`);
            console.log(`   Confidence: ${data.confidence}`);
            console.log(`   Absorption Ratio: ${data.absorptionRatio}`);
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

describe("AbsorptionDetector - REALISTIC Scenarios", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    beforeEach(async () => {
        mockLogger = createRealisticLogger();
        
        const { MetricsCollector: MockMetricsCollector } = await import("../__mocks__/src/infrastructure/metricsCollector.js");
        mockMetrics = new MockMetricsCollector() as any;
        
        mockSpoofingDetector = createMockSpoofingDetector();
        
        // Realistic order book depth
        const mockDepthMap = new Map();
        mockDepthMap.set(50000, { bid: 5000, ask: 4500 });
        mockDepthMap.set(50001, { bid: 4800, ask: 4700 });
        
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(50000),
            getBestAsk: vi.fn().mockReturnValue(50001),
            getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
            getDepth: vi.fn().mockReturnValue(mockDepthMap),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        };
    });

    it("should detect BUY signal when institutions absorb panic selling at market bottom", { timeout: 5000 }, async () => {
        console.log(`\n🎯 ===== REALISTIC MARKET BOTTOM SCENARIO =====`);
        console.log(`📊 Context: Panic selling being absorbed by institutional buyers`);
        
        const realisticSettings: AbsorptionSettings = {
            windowMs: 60000,
            minAggVolume: 40,
            pricePrecision: 2,
            zoneTicks: 3,
            absorptionThreshold: 0.3,
            priceEfficiencyThreshold: 0.7,
            maxAbsorptionRatio: 0.7,
            expectedMovementScalingFactor: 10,
            features: {
                liquidityGradient: true,
                absorptionVelocity: false,
                layeredAbsorption: false,
                spreadImpact: true,
            },
        };

        detector = new AbsorptionDetector(
            "realistic-bottom",
            realisticSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );

        const signals: any[] = [];
        detector.on("signalCandidate", (data) => {
            signals.push(data);
            console.log(`\n✅ SIGNAL DETECTED: ${data.side.toUpperCase()} at ${data.price}`);
        });

        const now = Date.now();
        const basePrice = 50000;
        
        console.log(`\n📊 Realistic Absorption Pattern:`);
        console.log(`   - Heavy selling pressure (panic)`);
        console.log(`   - Bid liquidity gets hit but REFILLS (absorption)`);
        console.log(`   - Price stays stable despite selling`);
        
        // REALISTIC: Heavy selling with bid absorption
        const trades = [
            // Initial state: balanced liquidity
            { quantity: 100, offset: -30000, bidVol: 5000, askVol: 4500, desc: "Initial sell" },
            
            // Panic selling starts, bid takes hits but refills
            { quantity: 150, offset: -25000, bidVol: 4800, askVol: 4600, desc: "Bid hit but holding" },
            { quantity: 200, offset: -20000, bidVol: 4600, askVol: 4700, desc: "More selling" },
            
            // ABSORPTION: Bid refills despite continued selling
            { quantity: 250, offset: -15000, bidVol: 4900, askVol: 4500, desc: "Bid REFILLS!" },
            { quantity: 300, offset: -10000, bidVol: 5200, askVol: 4300, desc: "Strong bid support" },
            { quantity: 280, offset: -5000, bidVol: 5500, askVol: 4100, desc: "Bid strengthening" },
            
            // Final heavy sell absorbed
            { quantity: 350, offset: -1000, bidVol: 5300, askVol: 3900, desc: "Final capitulation absorbed" },
        ];

        for (const [i, trade] of trades.entries()) {
            const event = createRealisticEvent(
                basePrice, // Price stable despite selling
                trade.quantity,
                now + trade.offset,
                true, // All sells (buyerIsMaker = true)
                trade.bidVol,
                trade.askVol
            );
            
            console.log(`\n  Trade ${i + 1}: SELL ${trade.quantity}`);
            console.log(`    Bid: ${trade.bidVol} (${trade.bidVol > (trades[i-1]?.bidVol || 5000) ? '↑' : '↓'}) - ${trade.desc}`);
            console.log(`    Ask: ${trade.askVol}`);
            
            detector.onEnrichedTrade(event);
        }

        // Wait for signal processing
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log(`\n📊 RESULTS:`);
        console.log(`  Total sells: 1,630 units`);
        console.log(`  Bid liquidity: 5000 → 5300 (increased despite selling!)`);
        console.log(`  Price movement: ZERO (perfect absorption)`);
        console.log(`  Signals generated: ${signals.length}`);
        
        expect(signals.length).toBeGreaterThan(0);
        if (signals.length > 0) {
            const lastSignal = signals[signals.length - 1];
            expect(lastSignal.side).toBe("buy");
            console.log(`\n✅ CORRECT: BUY signal at market bottom`);
            console.log(`  Confidence: ${lastSignal.confidence}`);
        }
        
        console.log(`🎯 ================================================\n`);
    });

    it("should detect SELL signal when institutions distribute during retail FOMO at market top", { timeout: 5000 }, async () => {
        console.log(`\n🎯 ===== REALISTIC MARKET TOP SCENARIO =====`);
        console.log(`📊 Context: FOMO buying being absorbed by institutional sellers`);
        
        const realisticSettings: AbsorptionSettings = {
            windowMs: 60000,
            minAggVolume: 40,
            pricePrecision: 2,
            zoneTicks: 3,
            absorptionThreshold: 0.3,
            priceEfficiencyThreshold: 0.7,
            maxAbsorptionRatio: 0.7,
            expectedMovementScalingFactor: 10,
            features: {
                liquidityGradient: true,
                absorptionVelocity: false,
                layeredAbsorption: false,
                spreadImpact: true,
            },
        };

        detector = new AbsorptionDetector(
            "realistic-top",
            realisticSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );

        const signals: any[] = [];
        detector.on("signalCandidate", (data) => {
            signals.push(data);
            console.log(`\n✅ SIGNAL DETECTED: ${data.side.toUpperCase()} at ${data.price}`);
        });

        const now = Date.now();
        const basePrice = 50001; // At the ask
        
        console.log(`\n📊 Realistic Distribution Pattern:`);
        console.log(`   - Heavy buying pressure (FOMO)`);
        console.log(`   - Ask liquidity gets hit but REFILLS (distribution)`);
        console.log(`   - Price stays stable despite buying`);
        
        // REALISTIC: Heavy buying with ask absorption
        const trades = [
            // Initial state
            { quantity: 80, offset: -30000, bidVol: 4500, askVol: 5000, desc: "Initial buy" },
            
            // FOMO buying starts, ask takes hits but refills
            { quantity: 120, offset: -25000, bidVol: 4600, askVol: 4800, desc: "Ask hit but holding" },
            { quantity: 180, offset: -20000, bidVol: 4700, askVol: 4600, desc: "More buying" },
            
            // DISTRIBUTION: Ask refills despite continued buying
            { quantity: 220, offset: -15000, bidVol: 4500, askVol: 4900, desc: "Ask REFILLS!" },
            { quantity: 280, offset: -10000, bidVol: 4300, askVol: 5200, desc: "Strong ask supply" },
            { quantity: 300, offset: -5000, bidVol: 4100, askVol: 5500, desc: "Ask strengthening" },
            
            // Final FOMO absorbed
            { quantity: 320, offset: -1000, bidVol: 3900, askVol: 5300, desc: "Final FOMO absorbed" },
        ];

        for (const [i, trade] of trades.entries()) {
            const event = createRealisticEvent(
                basePrice, // Price stable despite buying
                trade.quantity,
                now + trade.offset,
                false, // All buys (buyerIsMaker = false)
                trade.bidVol,
                trade.askVol
            );
            
            console.log(`\n  Trade ${i + 1}: BUY ${trade.quantity}`);
            console.log(`    Ask: ${trade.askVol} (${trade.askVol > (trades[i-1]?.askVol || 5000) ? '↑' : '↓'}) - ${trade.desc}`);
            console.log(`    Bid: ${trade.bidVol}`);
            
            detector.onEnrichedTrade(event);
        }

        // Wait for signal processing
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log(`\n📊 RESULTS:`);
        console.log(`  Total buys: 1,420 units`);
        console.log(`  Ask liquidity: 5000 → 5300 (increased despite buying!)`);
        console.log(`  Price movement: ZERO (perfect distribution)`);
        console.log(`  Signals generated: ${signals.length}`);
        
        expect(signals.length).toBeGreaterThan(0);
        if (signals.length > 0) {
            const lastSignal = signals[signals.length - 1];
            expect(lastSignal.side).toBe("sell");
            console.log(`\n✅ CORRECT: SELL signal at market top`);
            console.log(`  Confidence: ${lastSignal.confidence}`);
        }
        
        console.log(`🎯 ================================================\n`);
    });

    it("should NOT generate signals when no absorption pattern exists", { timeout: 5000 }, async () => {
        console.log(`\n🎯 ===== NO ABSORPTION SCENARIO =====`);
        console.log(`📊 Context: Normal trading without institutional absorption`);
        
        const realisticSettings: AbsorptionSettings = {
            windowMs: 60000,
            minAggVolume: 40,
            pricePrecision: 2,
            zoneTicks: 3,
            absorptionThreshold: 0.3,
            priceEfficiencyThreshold: 0.7,
            maxAbsorptionRatio: 0.7,
            expectedMovementScalingFactor: 10,
            features: {
                liquidityGradient: true,
                absorptionVelocity: false,
                layeredAbsorption: false,
                spreadImpact: true,
            },
        };

        detector = new AbsorptionDetector(
            "no-absorption",
            realisticSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );

        const signals: any[] = [];
        detector.on("signalCandidate", (data) => {
            signals.push(data);
            console.log(`\n⚠️ UNEXPECTED SIGNAL: ${data.side.toUpperCase()}`);
        });

        const now = Date.now();
        const basePrice = 50000;
        
        console.log(`\n📊 Normal Trading Pattern:`);
        console.log(`   - Mixed buying and selling`);
        console.log(`   - Liquidity depletes normally (no refills)`);
        console.log(`   - Price moves with volume`);
        
        // REALISTIC: Normal trading without absorption
        const trades = [
            // Selling depletes bid liquidity (normal)
            { price: 50000, quantity: 100, isSell: true, offset: -20000, bidVol: 5000, askVol: 4500 },
            { price: 49999, quantity: 120, isSell: true, offset: -15000, bidVol: 4700, askVol: 4600 },
            { price: 49998, quantity: 150, isSell: true, offset: -10000, bidVol: 4400, askVol: 4700 },
            
            // Buying depletes ask liquidity (normal)
            { price: 49999, quantity: 110, isSell: false, offset: -8000, bidVol: 4500, askVol: 4500 },
            { price: 50000, quantity: 130, isSell: false, offset: -5000, bidVol: 4600, askVol: 4200 },
            { price: 50001, quantity: 140, isSell: false, offset: -2000, bidVol: 4700, askVol: 3900 },
        ];

        for (const [i, trade] of trades.entries()) {
            const event = createRealisticEvent(
                trade.price, // Price MOVES (no absorption)
                trade.quantity,
                now + trade.offset,
                trade.isSell,
                trade.bidVol,
                trade.askVol
            );
            
            console.log(`\n  Trade ${i + 1}: ${trade.isSell ? 'SELL' : 'BUY'} ${trade.quantity} at ${trade.price}`);
            console.log(`    Bid: ${trade.bidVol} | Ask: ${trade.askVol}`);
            console.log(`    Price moved: ${trade.price !== basePrice ? 'YES' : 'NO'}`);
            
            detector.onEnrichedTrade(event);
        }

        // Wait for signal processing
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log(`\n📊 RESULTS:`);
        console.log(`  Price movement: 49998 → 50001 (normal movement)`);
        console.log(`  Liquidity changes: Normal depletion, no refills`);
        console.log(`  Signals generated: ${signals.length}`);
        
        expect(signals.length).toBe(0);
        console.log(`\n✅ CORRECT: No signals for non-absorption pattern`);
        
        console.log(`🎯 ================================================\n`);
    });
});