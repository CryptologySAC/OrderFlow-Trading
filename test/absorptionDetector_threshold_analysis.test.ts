// test/absorptionDetector_threshold_analysis.test.ts
// 🔬 THRESHOLD ANALYSIS: Find exactly why normal scenarios don't generate signals

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

// Enhanced logger to capture all debug information
const createDebugLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        console.log(`[INFO] ${msg}`, JSON.stringify(data, null, 2));
    }),
    warn: vi.fn((msg, data) => {
        console.log(`[WARN] ${msg}`, JSON.stringify(data, null, 2));
    }),
    error: vi.fn((msg, data) => {
        console.log(`[ERROR] ${msg}`, JSON.stringify(data, null, 2));
    }),
    debug: vi.fn((msg, data) => {
        console.log(`[DEBUG] ${msg}`, JSON.stringify(data, null, 2));
    }),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

function createDebugTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean,
    passiveBidVolume: number = 1000,
    passiveAskVolume: number = 1000
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
        zonePassiveBidVolume: passiveBidVolume,
        zonePassiveAskVolume: passiveAskVolume,
    };
}

describe("AbsorptionDetector - Threshold Analysis", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    // Multiple threshold configurations to test
    const thresholdConfigurations = [
        {
            name: "Current Settings (from spec test)",
            settings: {
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
            } as AbsorptionSettings,
        },
        {
            name: "Ultra Permissive Settings",
            settings: {
                windowMs: 60000,
                minAggVolume: 10, // Much lower
                pricePrecision: 2,
                zoneTicks: 3,
                absorptionThreshold: 0.1, // Much lower
                priceEfficiencyThreshold: 0.5, // Much higher (less restrictive)
                maxAbsorptionRatio: 0.9, // Higher
                strongAbsorptionRatio: 0.1,
                moderateAbsorptionRatio: 0.3,
                weakAbsorptionRatio: 1.0,
                spreadImpactThreshold: 0.01, // Less restrictive
                velocityIncreaseThreshold: 1.0, // Lower
                features: {
                    liquidityGradient: false, // Disable features that might block
                    absorptionVelocity: false,
                    layeredAbsorption: false,
                    spreadImpact: false,
                },
            } as AbsorptionSettings,
        },
    ];

    describe("🔬 Threshold Configuration Testing", () => {
        thresholdConfigurations.forEach((config) => {
            describe(`Testing with: ${config.name}`, () => {
                beforeEach(async () => {
                    mockLogger = createDebugLogger();

                    const { MetricsCollector: MockMetricsCollector } =
                        await import(
                            "../__mocks__/src/infrastructure/metricsCollector.js"
                        );
                    mockMetrics = new MockMetricsCollector() as any;

                    mockSpoofingDetector = createMockSpoofingDetector();

                    mockOrderBook = {
                        getBestBid: vi.fn().mockReturnValue(50000),
                        getBestAsk: vi.fn().mockReturnValue(50001),
                        getSpread: vi
                            .fn()
                            .mockReturnValue({ spread: 1, spreadBps: 2 }),
                        getDepth: vi.fn().mockReturnValue(new Map()),
                        isHealthy: vi.fn().mockReturnValue(true),
                        getLastUpdate: vi.fn().mockReturnValue(Date.now()),
                    };

                    detector = new AbsorptionDetector(
                        `threshold-test-${config.name}`,
                        config.settings,
                        mockOrderBook,
                        mockLogger,
                        mockSpoofingDetector,
                        mockMetrics
                    );
                });

                it(
                    "should detect simple 80/20 selling pressure",
                    { timeout: 5000 },
                    () => {
                        console.log(
                            `\n🔬 ===== THRESHOLD TEST: Simple 80/20 Selling =====`
                        );
                        console.log(`Configuration: ${config.name}`);
                        console.log(
                            `Settings:`,
                            JSON.stringify(config.settings, null, 2)
                        );

                        let signalEmitted = false;
                        let actualSignal: string | undefined;
                        let signalData: any = null;

                        detector.on("signalCandidate", (data) => {
                            signalEmitted = true;
                            actualSignal = data.side;
                            signalData = data;

                            console.log(
                                `🎯 SIGNAL EMITTED WITH ${config.name}:`
                            );
                            console.log(`  Side: ${data.side}`);
                            console.log(`  Confidence: ${data.confidence}`);
                            console.log(`  Internal Data:`, {
                                absorbingSide:
                                    data.data?.metrics?.absorbingSide,
                                aggressiveSide:
                                    data.data?.metrics?.aggressiveSide,
                                absorptionScore:
                                    data.data?.metrics?.absorptionScore,
                                absorptionRatio:
                                    data.data?.metrics?.absorptionRatio,
                            });
                        });

                        const baseTime = Date.now() - 60000;
                        const basePrice = 50000;

                        // Simple 80/20 selling pressure pattern
                        const trades = [
                            // 8 aggressive sells (buyerIsMaker=true)
                            { buyerIsMaker: true, quantity: 60 },
                            { buyerIsMaker: true, quantity: 65 },
                            { buyerIsMaker: true, quantity: 70 },
                            { buyerIsMaker: true, quantity: 60 },
                            { buyerIsMaker: true, quantity: 75 },
                            { buyerIsMaker: true, quantity: 65 },
                            { buyerIsMaker: true, quantity: 70 },
                            { buyerIsMaker: true, quantity: 65 },
                            // 2 aggressive buys (buyerIsMaker=false)
                            { buyerIsMaker: false, quantity: 50 },
                            { buyerIsMaker: false, quantity: 55 },
                        ];

                        console.log(`\n📊 PROCESSING TRADES:`);
                        let sellVolume = 0,
                            buyVolume = 0;

                        trades.forEach((trade, i) => {
                            const event = createDebugTestEvent(
                                basePrice,
                                trade.quantity,
                                baseTime + i * 3000,
                                trade.buyerIsMaker
                            );

                            if (trade.buyerIsMaker) {
                                sellVolume += trade.quantity;
                                console.log(
                                    `  ${i + 1}. SELL ${trade.quantity} (aggressive seller)`
                                );
                            } else {
                                buyVolume += trade.quantity;
                                console.log(
                                    `  ${i + 1}. BUY ${trade.quantity} (aggressive buyer)`
                                );
                            }

                            detector.onEnrichedTrade(event);
                        });

                        console.log(`\n📈 VOLUME SUMMARY:`);
                        console.log(`  Total Sell Volume: ${sellVolume}`);
                        console.log(`  Total Buy Volume: ${buyVolume}`);
                        console.log(
                            `  Sell Ratio: ${((sellVolume / (sellVolume + buyVolume)) * 100).toFixed(1)}%`
                        );
                        console.log(
                            `  Expected: BUY signal (bid side absorbing selling pressure)`
                        );

                        return new Promise<void>((resolve) => {
                            setTimeout(() => {
                                console.log(`\n🎯 RESULT WITH ${config.name}:`);
                                console.log(
                                    `  Signal Emitted: ${signalEmitted}`
                                );
                                console.log(
                                    `  Signal Side: ${actualSignal || "None"}`
                                );

                                if (signalEmitted) {
                                    console.log(
                                        `  ✅ SUCCESS: Signal generated with ${config.name}`
                                    );
                                    console.log(
                                        `  Expected BUY, Got: ${actualSignal}`
                                    );

                                    if (actualSignal?.toUpperCase() === "BUY") {
                                        console.log(
                                            `  ✅ CORRECT DIRECTION: BUY signal for selling pressure`
                                        );
                                    } else {
                                        console.log(
                                            `  ❌ WRONG DIRECTION: Expected BUY, got ${actualSignal}`
                                        );
                                    }
                                } else {
                                    console.log(
                                        `  ❌ BLOCKED: No signal generated - thresholds too restrictive`
                                    );
                                }

                                console.log(
                                    `🔬 ================================================\n`
                                );
                                resolve();
                            }, 100);
                        });
                    }
                );

                it(
                    "should detect simple 80/20 buying pressure",
                    { timeout: 5000 },
                    () => {
                        console.log(
                            `\n🔬 ===== THRESHOLD TEST: Simple 80/20 Buying =====`
                        );
                        console.log(`Configuration: ${config.name}`);

                        let signalEmitted = false;
                        let actualSignal: string | undefined;

                        detector.on("signalCandidate", (data) => {
                            signalEmitted = true;
                            actualSignal = data.side;
                            console.log(
                                `🎯 SIGNAL: ${data.side} (confidence: ${data.confidence})`
                            );
                        });

                        const baseTime = Date.now() - 60000;
                        const basePrice = 50000;

                        // Simple 80/20 buying pressure pattern
                        const trades = [
                            // 8 aggressive buys (buyerIsMaker=false)
                            { buyerIsMaker: false, quantity: 60 },
                            { buyerIsMaker: false, quantity: 65 },
                            { buyerIsMaker: false, quantity: 70 },
                            { buyerIsMaker: false, quantity: 60 },
                            { buyerIsMaker: false, quantity: 75 },
                            { buyerIsMaker: false, quantity: 65 },
                            { buyerIsMaker: false, quantity: 70 },
                            { buyerIsMaker: false, quantity: 65 },
                            // 2 aggressive sells (buyerIsMaker=true)
                            { buyerIsMaker: true, quantity: 50 },
                            { buyerIsMaker: true, quantity: 55 },
                        ];

                        let sellVolume = 0,
                            buyVolume = 0;
                        trades.forEach((trade, i) => {
                            const event = createDebugTestEvent(
                                basePrice,
                                trade.quantity,
                                baseTime + i * 3000,
                                trade.buyerIsMaker
                            );

                            if (trade.buyerIsMaker)
                                sellVolume += trade.quantity;
                            else buyVolume += trade.quantity;

                            detector.onEnrichedTrade(event);
                        });

                        console.log(
                            `  Buy Volume: ${buyVolume}, Sell Volume: ${sellVolume}`
                        );
                        console.log(
                            `  Buy Ratio: ${((buyVolume / (buyVolume + sellVolume)) * 100).toFixed(1)}%`
                        );
                        console.log(
                            `  Expected: SELL signal (ask side absorbing buying pressure)`
                        );

                        return new Promise<void>((resolve) => {
                            setTimeout(() => {
                                console.log(
                                    `\n🎯 RESULT: ${signalEmitted ? actualSignal : "No Signal"}`
                                );

                                if (
                                    signalEmitted &&
                                    actualSignal?.toUpperCase() === "SELL"
                                ) {
                                    console.log(
                                        `  ✅ CORRECT: SELL signal for buying pressure with ${config.name}`
                                    );
                                } else if (signalEmitted) {
                                    console.log(
                                        `  ❌ WRONG: Expected SELL, got ${actualSignal} with ${config.name}`
                                    );
                                } else {
                                    console.log(
                                        `  ❌ BLOCKED: No signal with ${config.name}`
                                    );
                                }

                                console.log(
                                    `🔬 ================================================\n`
                                );
                                resolve();
                            }, 100);
                        });
                    }
                );
            });
        });
    });

    describe("🎯 Minimal Signal Generation Test", () => {
        it(
            "should find the absolute minimum scenario that generates ANY signal",
            { timeout: 5000 },
            () => {
                console.log(`\n🎯 ===== MINIMAL SIGNAL TEST =====`);

                // Use ultra permissive settings
                const ultraPermissive: AbsorptionSettings = {
                    windowMs: 60000,
                    minAggVolume: 1, // Absolutely minimal
                    pricePrecision: 2,
                    zoneTicks: 3,
                    absorptionThreshold: 0.01, // Almost zero
                    priceEfficiencyThreshold: 0.99, // Almost no price efficiency required
                    maxAbsorptionRatio: 0.99, // Almost no limit
                    strongAbsorptionRatio: 0.01,
                    moderateAbsorptionRatio: 0.01,
                    weakAbsorptionRatio: 1.0,
                    spreadImpactThreshold: 0.1, // Very permissive
                    velocityIncreaseThreshold: 0.1, // Very low
                    features: {
                        liquidityGradient: false, // All features off
                        absorptionVelocity: false,
                        layeredAbsorption: false,
                        spreadImpact: false,
                    },
                };

                return new Promise<void>(async (resolve) => {
                    mockLogger = createDebugLogger();

                    const { MetricsCollector: MockMetricsCollector } =
                        await import(
                            "../__mocks__/src/infrastructure/metricsCollector.js"
                        );
                    mockMetrics = new MockMetricsCollector() as any;

                    mockSpoofingDetector = createMockSpoofingDetector();

                    mockOrderBook = {
                        getBestBid: vi.fn().mockReturnValue(50000),
                        getBestAsk: vi.fn().mockReturnValue(50001),
                        getSpread: vi
                            .fn()
                            .mockReturnValue({ spread: 1, spreadBps: 2 }),
                        getDepth: vi.fn().mockReturnValue(new Map()),
                        isHealthy: vi.fn().mockReturnValue(true),
                        getLastUpdate: vi.fn().mockReturnValue(Date.now()),
                    };

                    detector = new AbsorptionDetector(
                        "minimal-test",
                        ultraPermissive,
                        mockOrderBook,
                        mockLogger,
                        mockSpoofingDetector,
                        mockMetrics
                    );

                    let signalEmitted = false;
                    let actualSignal: string | undefined;

                    detector.on("signalCandidate", (data) => {
                        signalEmitted = true;
                        actualSignal = data.side;
                        console.log(`🎯 MINIMAL SIGNAL ACHIEVED: ${data.side}`);
                        console.log(`  Confidence: ${data.confidence}`);
                        console.log(`  Settings that worked: Ultra Permissive`);
                    });

                    const baseTime = Date.now() - 60000;
                    const basePrice = 50000;

                    // Extreme scenario - should definitely generate signal with ultra permissive settings
                    const extremeTrades = [
                        // 20 sells
                        ...Array.from({ length: 20 }, (_, i) => ({
                            buyerIsMaker: true,
                            quantity: 100,
                            timestampOffset: i * 1000,
                        })),
                        // 1 buy
                        {
                            buyerIsMaker: false,
                            quantity: 50,
                            timestampOffset: 21000,
                        },
                    ];

                    console.log(
                        `Processing ${extremeTrades.length} trades with ultra permissive settings...`
                    );

                    extremeTrades.forEach((trade) => {
                        const event = createDebugTestEvent(
                            basePrice,
                            trade.quantity,
                            baseTime + trade.timestampOffset,
                            trade.buyerIsMaker
                        );
                        detector.onEnrichedTrade(event);
                    });

                    setTimeout(() => {
                        console.log(`\n🎯 MINIMAL TEST RESULT:`);
                        console.log(`  Signal Generated: ${signalEmitted}`);

                        if (signalEmitted) {
                            console.log(
                                `  ✅ SUCCESS: Found settings that generate signals!`
                            );
                            console.log(`  Signal: ${actualSignal}`);
                            console.log(
                                `  This proves the detector CAN work with proper thresholds`
                            );
                        } else {
                            console.log(
                                `  ❌ CRITICAL: Even ultra permissive settings don't generate signals`
                            );
                            console.log(
                                `  This indicates a fundamental bug in detection logic`
                            );
                        }

                        console.log(
                            `🎯 =============================================\n`
                        );
                        resolve();
                    }, 100);
                });
            }
        );
    });
});
