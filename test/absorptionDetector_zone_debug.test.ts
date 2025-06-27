// test/absorptionDetector_zone_debug.test.ts
// 🔍 DEBUG: Verify trades are added to zones and checkForSignal is called

import { describe, it, beforeEach, vi } from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

function createZoneDebugEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean
): EnrichedTradeEvent {
    return {
        tradeId: `zone_debug_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        side: buyerIsMaker ? "sell" : "buy",
        aggression: 0.8,
        enriched: true,
        passiveBidVolume: 3000,
        passiveAskVolume: 2500,
        zonePassiveBidVolume: 6000,
        zonePassiveAskVolume: 5000,
    };
}

const createZoneDebugLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        console.log(
            `[ZONE-DEBUG-INFO] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    warn: vi.fn((msg, data) => {
        console.log(
            `[ZONE-DEBUG-WARN] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    error: vi.fn((msg, data) => {
        console.log(
            `[ZONE-DEBUG-ERROR] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    debug: vi.fn((msg, data) => {
        console.log(
            `[ZONE-DEBUG-DEBUG] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

describe("AbsorptionDetector - Zone Debug", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    beforeEach(async () => {
        mockLogger = createZoneDebugLogger();

        const { MetricsCollector: MockMetricsCollector } = await import(
            "../__mocks__/src/infrastructure/metricsCollector.js"
        );
        mockMetrics = new MockMetricsCollector() as any;

        mockSpoofingDetector = createMockSpoofingDetector();

        const mockDepthMap = new Map();
        mockDepthMap.set(50000, { bid: 3000, ask: 2500 });

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
        "should verify zone aggregation and checkForSignal execution",
        { timeout: 5000 },
        () => {
            console.log(`\n🔍 ===== ZONE AGGREGATION DEBUG =====`);

            const zoneDebugSettings: AbsorptionSettings = {
                windowMs: 60000,
                minAggVolume: 1, // Ultra low
                pricePrecision: 2,
                zoneTicks: 3,
                absorptionThreshold: 0.01, // Ultra permissive
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
                "zone-debug",
                zoneDebugSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics
            );

            // Spy on internal methods
            const checkForSignalSpy = vi.spyOn(
                detector as any,
                "checkForSignal"
            );
            const analyzeZoneForAbsorptionSpy = vi.spyOn(
                detector as any,
                "analyzeZoneForAbsorption"
            );

            let signalEmitted = false;
            detector.on("signalCandidate", () => {
                signalEmitted = true;
                console.log(`🎯 ZONE DEBUG: Signal detected!`);
            });

            const now = Date.now();
            const basePrice = 50000;

            console.log(`\n📊 Processing 3 trades at same price (same zone):`);

            const debugTrades = [
                { quantity: 100, offset: -10000 },
                { quantity: 110, offset: -8000 },
                { quantity: 120, offset: -6000 },
            ];

            debugTrades.forEach((trade, i) => {
                const event = createZoneDebugEvent(
                    basePrice,
                    trade.quantity,
                    now + trade.offset,
                    true // All sells
                );

                console.log(
                    `  Trade ${i + 1}: SELL ${trade.quantity} at ${basePrice}`
                );
                detector.onEnrichedTrade(event);
            });

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`\n🔍 ZONE DEBUG RESULTS:`);
                    console.log(
                        `  checkForSignal called: ${checkForSignalSpy.mock.calls.length} times`
                    );
                    console.log(
                        `  analyzeZoneForAbsorption called: ${analyzeZoneForAbsorptionSpy.mock.calls.length} times`
                    );
                    console.log(`  Signal emitted: ${signalEmitted}`);

                    // Check internal zone aggregation
                    const zoneAgg = (detector as any).zoneAgg;
                    console.log(`  Zones in zoneAgg: ${zoneAgg.size}`);

                    if (zoneAgg.size > 0) {
                        console.log(`  Zone contents:`);
                        for (const [zone, bucket] of zoneAgg) {
                            console.log(
                                `    Zone ${zone}: ${bucket.trades.length} trades, vol ${bucket.vol}`
                            );
                        }
                    } else {
                        console.log(
                            `  ❌ CRITICAL: No zones in zoneAgg - trades not being added!`
                        );
                    }

                    if (checkForSignalSpy.mock.calls.length === 0) {
                        console.log(`\n🚨 ISSUE: checkForSignal never called`);
                        console.log(
                            `  This suggests the BaseDetector.addTrade → checkForSignal chain is broken`
                        );
                    } else {
                        console.log(`\n✅ checkForSignal is working`);
                        if (
                            analyzeZoneForAbsorptionSpy.mock.calls.length === 0
                        ) {
                            console.log(
                                `  But analyzeZoneForAbsorption never called`
                            );
                            console.log(
                                `  This suggests empty zones or early returns in checkForSignal`
                            );
                        } else {
                            console.log(
                                `  analyzeZoneForAbsorption is also working`
                            );
                            console.log(
                                `  Issue must be in signal generation logic`
                            );
                        }
                    }

                    console.log(
                        `🔍 ================================================\n`
                    );
                    resolve();
                }, 100);
            });
        }
    );
});
