// test/absorptionDetector_signal_trace.test.ts
// 🔍 TRACE: Follow complete signal generation path

import { describe, it, beforeEach, vi } from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

function createTraceEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean,
    passiveBid: number,
    passiveAsk: number
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
        passiveBidVolume: passiveBid,
        passiveAskVolume: passiveAsk,
        zonePassiveBidVolume: passiveBid * 2,
        zonePassiveAskVolume: passiveAsk * 2,
    };
}

const createTraceLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        console.log(
            `[TRACE-INFO] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    warn: vi.fn((msg, data) => {
        console.log(
            `[TRACE-WARN] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    error: vi.fn((msg, data) => {
        console.log(
            `[TRACE-ERROR] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
    debug: vi.fn((msg, data) => {
        console.log(
            `[TRACE-DEBUG] ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    }),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

describe("AbsorptionDetector - Signal Trace", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    beforeEach(async () => {
        mockLogger = createTraceLogger();

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
        "should trace complete signal generation flow",
        { timeout: 5000 },
        () => {
            console.log(`\n🔍 ===== SIGNAL GENERATION TRACE =====`);

            // Use same settings as successful validation test
            const traceSettings: AbsorptionSettings = {
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
                expectedMovementScalingFactor: 8,
                features: {
                    liquidityGradient: true,
                    absorptionVelocity: false,
                    layeredAbsorption: false,
                    spreadImpact: true,
                },
            };

            detector = new AbsorptionDetector(
                "trace-test",
                traceSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics
            );

            // Spy on ALL critical methods
            const analyzeZoneForAbsorptionSpy = vi.spyOn(
                detector as any,
                "analyzeZoneForAbsorption"
            );
            const getAbsorbingSideForZoneSpy = vi.spyOn(
                detector as any,
                "getAbsorbingSideForZone"
            );
            const checkAbsorptionConditionsSpy = vi.spyOn(
                detector as any,
                "checkAbsorptionConditions"
            );
            const calculateAbsorptionScoreSpy = vi.spyOn(
                detector as any,
                "calculateAbsorptionScore"
            );
            const checkCooldownSpy = vi.spyOn(detector as any, "checkCooldown");
            const emitSpy = vi.spyOn(detector, "emit");

            let signalEmitted = false;
            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                console.log(`\n✅ SIGNAL EMITTED!`);
            });

            const now = Date.now();

            console.log(
                `\n📊 Creating test pattern (same as validation test):`
            );

            // Use same pattern as successful validation test
            const trades = [
                { quantity: 80, bidVol: 3000, askVol: 2500, offset: -30000 },
                { quantity: 90, bidVol: 2900, askVol: 2600, offset: -25000 },
                { quantity: 100, bidVol: 2800, askVol: 2700, offset: -20000 },
                { quantity: 110, bidVol: 2900, askVol: 2400, offset: -15000 },
                { quantity: 120, bidVol: 3100, askVol: 2200, offset: -10000 },
                { quantity: 100, bidVol: 3200, askVol: 2100, offset: -5000 },
            ];

            trades.forEach((trade, i) => {
                const event = createTraceEvent(
                    50000,
                    trade.quantity,
                    now + trade.offset,
                    true, // All sells
                    trade.bidVol,
                    trade.askVol
                );
                console.log(
                    `  Trade ${i + 1}: SELL ${trade.quantity} | Bid: ${trade.bidVol} Ask: ${trade.askVol}`
                );
                detector.onEnrichedTrade(event);
            });

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`\n🔍 METHOD EXECUTION TRACE:`);

                    console.log(
                        `\n1️⃣ analyzeZoneForAbsorption: ${analyzeZoneForAbsorptionSpy.mock.calls.length} calls`
                    );

                    console.log(
                        `\n2️⃣ getAbsorbingSideForZone: ${getAbsorbingSideForZoneSpy.mock.calls.length} calls`
                    );
                    if (getAbsorbingSideForZoneSpy.mock.results.length > 0) {
                        const results =
                            getAbsorbingSideForZoneSpy.mock.results.map(
                                (r) => r.value
                            );
                        console.log(`   Returns: ${results.join(", ")}`);
                    }

                    console.log(
                        `\n3️⃣ checkCooldown: ${checkCooldownSpy.mock.calls.length} calls`
                    );
                    if (checkCooldownSpy.mock.results.length > 0) {
                        const results = checkCooldownSpy.mock.results.map(
                            (r) => r.value
                        );
                        console.log(`   Returns: ${results.join(", ")}`);
                    }

                    console.log(
                        `\n4️⃣ checkAbsorptionConditions: ${checkAbsorptionConditionsSpy.mock.calls.length} calls`
                    );
                    if (checkAbsorptionConditionsSpy.mock.results.length > 0) {
                        const results =
                            checkAbsorptionConditionsSpy.mock.results.map(
                                (r) => r.value
                            );
                        console.log(`   Returns:`, results);
                    }

                    console.log(
                        `\n5️⃣ calculateAbsorptionScore: ${calculateAbsorptionScoreSpy.mock.calls.length} calls`
                    );
                    if (calculateAbsorptionScoreSpy.mock.results.length > 0) {
                        const results =
                            calculateAbsorptionScoreSpy.mock.results.map(
                                (r) => r.value
                            );
                        console.log(`   Returns: ${results.join(", ")}`);
                    }

                    console.log(
                        `\n6️⃣ emit calls: ${emitSpy.mock.calls.length}`
                    );
                    if (emitSpy.mock.calls.length > 0) {
                        emitSpy.mock.calls.forEach((call, i) => {
                            console.log(`   Call ${i + 1}: ${call[0]}`);
                        });
                    }

                    console.log(
                        `\n📊 FINAL RESULT: Signal emitted = ${signalEmitted}`
                    );

                    if (!signalEmitted) {
                        console.log(`\n🚨 BLOCKING POINT ANALYSIS:`);

                        if (
                            checkCooldownSpy.mock.results.some(
                                (r) => r.value === false
                            )
                        ) {
                            console.log(`   ❌ Cooldown blocking signals`);
                        }

                        if (
                            checkAbsorptionConditionsSpy.mock.calls.length === 0
                        ) {
                            console.log(
                                `   ❌ Never reached absorption condition check`
                            );
                            console.log(
                                `      Likely blocked earlier in analyzeZoneForAbsorption`
                            );
                        } else if (
                            checkAbsorptionConditionsSpy.mock.results.some(
                                (r) => !r.value
                            )
                        ) {
                            console.log(`   ❌ Absorption conditions not met`);
                        }

                        if (
                            calculateAbsorptionScoreSpy.mock.calls.length === 0
                        ) {
                            console.log(
                                `   ❌ Never calculated absorption score`
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
