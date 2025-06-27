// test/absorptionDetector_trace_execution.test.ts
// 🔬 EXECUTION TRACE: Track exact execution flow to find where blocking occurs

import { describe, it, beforeEach, vi } from "vitest";
import { AbsorptionDetector, type AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

// Trace logger that logs everything
const createTraceLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        console.log(`[TRACE-INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }),
    warn: vi.fn((msg, data) => {
        console.log(`[TRACE-WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }),
    error: vi.fn((msg, data) => {
        console.log(`[TRACE-ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }),
    debug: vi.fn((msg, data) => {
        console.log(`[TRACE-DEBUG] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

function createTraceEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean
): EnrichedTradeEvent {
    return {
        tradeId: `trace_${timestamp}_${Math.random()}`,
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

describe("AbsorptionDetector - Execution Trace", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    it("should trace execution flow to find blocking point", { timeout: 10000 }, async () => {
        console.log(`\n🔬 ===== EXECUTION TRACE: Find Blocking Point =====`);
        
        mockLogger = createTraceLogger();
        
        const { MetricsCollector: MockMetricsCollector } = await import("../__mocks__/src/infrastructure/metricsCollector.js");
        mockMetrics = new MockMetricsCollector() as any;
        
        mockSpoofingDetector = createMockSpoofingDetector();
        
        // Mock order book with depth data
        const mockDepthMap = new Map();
        mockDepthMap.set(50000, { bid: 1500, ask: 1500 });
        
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(50000),
            getBestAsk: vi.fn().mockReturnValue(50001),
            getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
            getDepth: vi.fn().mockReturnValue(mockDepthMap),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        };

        // Super permissive settings
        const traceSettings: AbsorptionSettings = {
            windowMs: 60000,
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

        console.log(`📊 Creating AbsorptionDetector with trace settings...`);
        detector = new AbsorptionDetector(
            "execution-trace",
            traceSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );

        let signalEmitted = false;

        detector.on("signalCandidate", (data) => {
            signalEmitted = true;
            console.log(`🎯 SIGNAL TRACE: ${data.side} at ${data.price}`);
        });

        console.log(`\n📊 Step 1: Process first trade...`);
        const baseTime = Date.now() - 60000;
        const event1 = createTraceEvent(50000, 100, baseTime, true);
        console.log(`  Trade 1: SELL 100 at 50000 (buyerIsMaker=true)`);
        detector.onEnrichedTrade(event1);

        console.log(`\n📊 Step 2: Process second trade...`);
        const event2 = createTraceEvent(50000, 150, baseTime + 5000, true);
        console.log(`  Trade 2: SELL 150 at 50000 (buyerIsMaker=true)`);
        detector.onEnrichedTrade(event2);

        console.log(`\n📊 Step 3: Process third trade...`);
        const event3 = createTraceEvent(50000, 200, baseTime + 10000, true);
        console.log(`  Trade 3: SELL 200 at 50000 (buyerIsMaker=true)`);
        detector.onEnrichedTrade(event3);

        console.log(`\n📊 Step 4: Process fourth trade (should trigger checkForSignal)...`);
        const event4 = createTraceEvent(50000, 250, baseTime + 15000, true);
        console.log(`  Trade 4: SELL 250 at 50000 (buyerIsMaker=true)`);
        detector.onEnrichedTrade(event4);

        console.log(`\n📊 Step 5: Process fifth trade...`);
        const event5 = createTraceEvent(50000, 300, baseTime + 20000, true);
        console.log(`  Trade 5: SELL 300 at 50000 (buyerIsMaker=true)`);
        detector.onEnrichedTrade(event5);

        console.log(`\n🔍 Checking mock function calls...`);
        console.log(`  Logger.info called: ${(mockLogger.info as any).mock.calls.length} times`);
        console.log(`  Logger.warn called: ${(mockLogger.warn as any).mock.calls.length} times`);
        console.log(`  Logger.error called: ${(mockLogger.error as any).mock.calls.length} times`);

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log(`\n🎯 EXECUTION TRACE RESULT:`);
                console.log(`  Signal Generated: ${signalEmitted}`);
                
                if (!signalEmitted) {
                    console.log(`  ❌ No signal generated despite 5 trades and ultra permissive settings`);
                    console.log(`\n📋 Logger Call Summary:`);
                    console.log(`    Info calls: ${(mockLogger.info as any).mock.calls.length}`);
                    console.log(`    Warn calls: ${(mockLogger.warn as any).mock.calls.length}`);
                    console.log(`    Error calls: ${(mockLogger.error as any).mock.calls.length}`);
                    
                    if ((mockLogger.info as any).mock.calls.length === 0) {
                        console.log(`  🚨 CRITICAL: No log messages at all - detector methods not being called`);
                    }
                }
                
                console.log(`🔬 ================================================\n`);
                resolve();
            }, 200);
        });
    });
});