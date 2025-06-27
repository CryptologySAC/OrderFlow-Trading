// test/absorptionDetector_debug_conditions.test.ts
// 🔬 DEBUG: Trace which specific condition blocks signal generation after CLAUDE.md fixes

import { describe, it, beforeEach, vi } from "vitest";
import { AbsorptionDetector, type AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

// Debug logger that captures ALL absorption-related messages
const createDebugLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        if (msg.includes("AbsorptionDetector") || 
            msg.includes("analyzeZoneForAbsorption") ||
            msg.includes("calculatePriceEfficiency") ||
            msg.includes("analyzeAbsorptionConditions") ||
            msg.includes("checkAbsorptionConditions") ||
            msg.includes("CORRECTED ABSORPTION SIGNAL")) {
            console.log(`[DEBUG-INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
        }
    }),
    warn: vi.fn((msg, data) => {
        if (msg.includes("AbsorptionDetector") || msg.includes("No book data")) {
            console.log(`[DEBUG-WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
        }
    }),
    error: vi.fn((msg, data) => {
        console.log(`[DEBUG-ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }),
    debug: vi.fn((msg, data) => {
        if (msg.includes("AbsorptionDetector")) {
            console.log(`[DEBUG-DEBUG] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
        }
    }),
});

function createDebugEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean,
    passiveBidVolume: number,
    passiveAskVolume: number
): EnrichedTradeEvent {
    return {
        tradeId: `debug_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        side: buyerIsMaker ? "sell" : "buy",
        aggression: 0.8,
        enriched: true,
        passiveBidVolume,
        passiveAskVolume,
        zonePassiveBidVolume: passiveBidVolume * 2,
        zonePassiveAskVolume: passiveAskVolume * 2,
    };
}

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

describe("AbsorptionDetector - Debug Blocking Conditions", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    beforeEach(async () => {
        mockLogger = createDebugLogger();
        
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

    it("should debug exact blocking conditions after CLAUDE.md fixes", { timeout: 15000 }, () => {
        console.log(`\n🔬 ===== DEBUGGING BLOCKING CONDITIONS =====`);
        
        // Use ultra permissive settings to minimize blocking
        const debugSettings: AbsorptionSettings = {
            windowMs: 120000, // Longer window
            minAggVolume: 1, // Ultra low
            pricePrecision: 2,
            zoneTicks: 3,
            absorptionThreshold: 0.01, // Ultra permissive
            priceEfficiencyThreshold: 0.99, // Ultra permissive  
            maxAbsorptionRatio: 0.99, // Ultra permissive
            strongAbsorptionRatio: 0.01,
            moderateAbsorptionRatio: 0.01,
            weakAbsorptionRatio: 1.0,
            spreadImpactThreshold: 0.1,
            velocityIncreaseThreshold: 0.1,
            expectedMovementScalingFactor: 1, // Minimal scaling
            features: {
                liquidityGradient: false, // All disabled
                absorptionVelocity: false,
                layeredAbsorption: false,
                spreadImpact: false,
            },
        };

        console.log(`📊 Ultra Permissive Debug Settings:`, {
            minAggVolume: debugSettings.minAggVolume,
            absorptionThreshold: debugSettings.absorptionThreshold,
            priceEfficiencyThreshold: debugSettings.priceEfficiencyThreshold,
            expectedMovementScalingFactor: debugSettings.expectedMovementScalingFactor,
        });

        detector = new AbsorptionDetector(
            "debug-conditions",
            debugSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );

        let signalEmitted = false;

        detector.on("signalCandidate", (data) => {
            signalEmitted = true;
            console.log(`🎯 DEBUG SIGNAL: ${data.side} at ${data.price}`);
        });

        const now = Date.now();
        const basePrice = 50000;
        
        console.log(`\n📊 Debug Pattern: Extreme Selling Pressure`);
        
        // Extreme pattern to maximize absorption probability
        const debugTrades = [
            { buyerIsMaker: true, quantity: 50, bidVol: 5000, askVol: 4000, offset: -40000 },
            { buyerIsMaker: true, quantity: 60, bidVol: 4800, askVol: 4100, offset: -35000 },
            { buyerIsMaker: true, quantity: 70, bidVol: 4600, askVol: 4200, offset: -30000 },
            { buyerIsMaker: true, quantity: 80, bidVol: 4700, askVol: 4000, offset: -25000 },
            { buyerIsMaker: true, quantity: 90, bidVol: 4900, askVol: 3800, offset: -20000 },
            { buyerIsMaker: true, quantity: 100, bidVol: 5100, askVol: 3600, offset: -15000 },
            { buyerIsMaker: true, quantity: 110, bidVol: 5300, askVol: 3400, offset: -10000 },
            { buyerIsMaker: true, quantity: 120, bidVol: 5500, askVol: 3200, offset: -5000 },
        ];

        let totalVolume = 0;
        debugTrades.forEach((trade, i) => {
            const event = createDebugEvent(
                basePrice,
                trade.quantity,
                now + trade.offset,
                trade.buyerIsMaker,
                trade.bidVol,
                trade.askVol
            );
            
            totalVolume += trade.quantity;
            console.log(`  Trade ${i + 1}: SELL ${trade.quantity} | Bid: ${trade.bidVol} Ask: ${trade.askVol}`);
            
            detector.onEnrichedTrade(event);
        });

        console.log(`\n📊 Debug Pattern Summary:`);
        console.log(`  Total Sell Volume: ${totalVolume}`);
        console.log(`  100% Selling (no buying pressure)`);
        console.log(`  Bid Liquidity Increase: 5000→5500 (clear absorption)`);
        console.log(`  All at same price (same zone)`);
        console.log(`  Extended time window (40 seconds)`);

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log(`\n🔍 DEBUG ANALYSIS:`);
                console.log(`  Signal Generated: ${signalEmitted}`);
                
                const logCalls = (mockLogger.info as any).mock.calls;
                const warnCalls = (mockLogger.warn as any).mock.calls;
                const errorCalls = (mockLogger.error as any).mock.calls;
                
                console.log(`\n📋 Debug Log Analysis:`);
                console.log(`  Info calls: ${logCalls.length}`);
                console.log(`  Warn calls: ${warnCalls.length}`);
                console.log(`  Error calls: ${errorCalls.length}`);
                
                if (logCalls.length === 0 && warnCalls.length === 0) {
                    console.log(`\n🚨 CRITICAL: Still no method execution despite:`);
                    console.log(`    - CLAUDE.md fixes applied`);
                    console.log(`    - Ultra permissive settings`);
                    console.log(`    - Proper passive volume data`);
                    console.log(`    - Extreme absorption pattern`);
                    console.log(`\n🔍 Possible remaining issues:`);
                    console.log(`    1. Zone aggregation not working (trades not in same zone)`);
                    console.log(`    2. checkForSignal() override not calling analysis methods`);
                    console.log(`    3. analyzeZoneForAbsorption() has early returns we haven't found`);
                    console.log(`    4. Zone history population failing silently`);
                } else {
                    console.log(`\n✅ PROGRESS: Some logging detected`);
                    console.log(`  Analysis methods are executing but blocked by conditions`);
                    
                    if (warnCalls.length > 0) {
                        console.log(`\n⚠️ WARNINGS DETECTED:`);
                        warnCalls.forEach((call: any, i: number) => {
                            console.log(`    Warning ${i + 1}: ${call[0]}`);
                        });
                    }
                }
                
                console.log(`\n🔧 NEXT STEPS:`);
                if (logCalls.length === 0) {
                    console.log(`  1. Investigate zone aggregation mechanism`);
                    console.log(`  2. Check if analyzeZoneForAbsorption() is being called`);
                    console.log(`  3. Add more granular debug logging in production methods`);
                } else {
                    console.log(`  1. Analyze specific blocking conditions from logs`);
                    console.log(`  2. Adjust thresholds based on logged values`);
                    console.log(`  3. Investigate zone history population requirements`);
                }
                
                console.log(`🔬 ================================================\n`);
                resolve();
            }, 500);
        });
    });
});