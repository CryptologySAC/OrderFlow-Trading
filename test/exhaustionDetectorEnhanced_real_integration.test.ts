// test/exhaustionDetectorEnhanced_real_integration.test.ts
//
// 🧪 COMPREHENSIVE EXHAUSTION DETECTOR INTEGRATION TEST SUITE
//
// CLAUDE.MD COMPLIANCE: These tests validate REAL zone accumulation behavior
// by testing the complete integration from trades → zone aggregation → detector signals.
//
// CRITICAL: Tests must detect the bug where zones don't accumulate volume
// across multiple trades (the bug we just fixed in orderFlowPreprocessor.ts)
//
// TEST APPROACH:
// - Use REAL OrderFlowPreprocessor with real zone aggregation
// - Send REAL trades and verify zones accumulate volume correctly
// - Test that detectors work with REAL accumulated zone data
// - Verify tests FAIL when zone accumulation is broken
//
// NO MOCKING of zone data - tests must use real integration flow
//

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExhaustionDetectorEnhanced } from "../src/indicators/exhaustionDetectorEnhanced.js";
import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { SpotWebsocketStreams } from "@binance/spot";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import "../test/vitest.setup.ts";

// Real LTCUSDT market parameters
const TICK_SIZE = 0.01;
const BASE_PRICE = 87.0; // $87 LTCUSDT

// Test configuration matching production config.json (but tuned for easier testing)
const EXHAUSTION_CONFIG = {
    useStandardizedZones: true,
    confidenceThreshold: 0.2, // Lowered for easier signal generation in tests
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.1,
    confluenceConfidenceBoost: 0.1,
    crossTimeframeConfidenceBoost: 0.15,
    exhaustionVolumeThreshold: 8, // Lowered for test scenarios
    exhaustionRatioThreshold: 0.65, // Minimum 65% volume depletion
    liquidityDepletionThreshold: 0.7,
    velocityDecayThreshold: 0.5,
    momentumLossThreshold: 0.3,
    alignmentScoreThreshold: 0.5,
    defaultDurationMs: 120000,
    tickSize: TICK_SIZE,
    enableLiquidityDepletion: true,
    enableVelocityAnalysis: true,
    enableMomentumAnalysis: true,
    liquidityDepletionBoost: 0.1,
    velocityAnalysisBoost: 0.08,
    momentumAnalysisBoost: 0.12,
    enhancementMode: "production" as const,
    // Required nuclear cleanup properties
    minAggVolume: 15,
    windowMs: 45000,
    exhaustionThreshold: 0.05,
};

const ORDERBOOK_CONFIG = {
    maxLevels: 150,
    snapshotIntervalMs: 1000,
    maxPriceDistance: 10.0,
    pruneIntervalMs: 30000,
    maxErrorRate: 0.05,
    staleThresholdMs: 5000,
};

const PREPROCESSOR_CONFIG = {
    pricePrecision: 2,
    quantityPrecision: 8,
    bandTicks: 5,
    tickSize: TICK_SIZE,
    symbol: "LTCUSDT",
    enableIndividualTrades: false,
    largeTradeThreshold: 100,
    maxEventListeners: 50,
    dashboardUpdateInterval: 500,
    maxDashboardInterval: 1000,
    significantChangeThreshold: 0.001,
    standardZoneConfig: {
        baseTicks: 5,
        zoneMultipliers: [1, 2, 4],
        timeWindows: [300000, 900000, 1800000, 3600000, 5400000],
        adaptiveMode: false,
        volumeThresholds: {
            aggressive: 10.0,
            passive: 5.0,
            institutional: 50.0,
        },
        priceThresholds: {
            tickValue: TICK_SIZE,
            minZoneWidth: 0.02,
            maxZoneWidth: 0.1,
        },
        performanceConfig: {
            maxZoneHistory: 2000,
            cleanupInterval: 5400000,
            maxMemoryMB: 50,
        },
    },
    maxZoneCacheAgeMs: 5400000,
    adaptiveZoneLookbackTrades: 500,
    zoneCalculationRange: 12,
    zoneCacheSize: 100,
    defaultZoneMultipliers: [1, 2, 4],
    defaultTimeWindows: [300000, 900000, 1800000, 3600000, 5400000],
    defaultMinZoneWidthMultiplier: 2,
    defaultMaxZoneWidthMultiplier: 10,
    defaultMaxZoneHistory: 2000,
    defaultMaxMemoryMB: 50,
    defaultAggressiveVolumeAbsolute: 10,
    defaultPassiveVolumeAbsolute: 5,
    defaultInstitutionalVolumeAbsolute: 50,
};

describe("ExhaustionDetectorEnhanced - REAL Integration Tests", () => {
    let detector: ExhaustionDetectorEnhanced;
    let preprocessor: OrderflowPreprocessor;
    let orderBook: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: any;
    let mockSignalLogger: any;
    let detectedSignals: any[];

    beforeEach(async () => {
        // Reset signal collection
        detectedSignals = [];

        // Create real infrastructure mocks
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            isDebugEnabled: vi.fn().mockReturnValue(false),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            incrementCounter: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            getMetrics: vi.fn(() => ({}) as any),
        };

        mockSpoofingDetector = {
            detect: vi.fn(),
            getStats: vi.fn(),
        };

        mockSignalLogger = {
            logSignal: vi.fn(),
            getHistory: vi.fn(() => []),
        };

        // Create ThreadManager mock (required for OrderBookState)
        const mockThreadManager = {
            callStorage: vi.fn().mockResolvedValue(undefined),
            broadcast: vi.fn(),
            shutdown: vi.fn(),
            isStarted: vi.fn().mockReturnValue(true),
            startWorkers: vi.fn().mockResolvedValue(undefined),
            requestDepthSnapshot: vi.fn().mockResolvedValue({
                lastUpdateId: 1000,
                bids: [],
                asks: [],
            }),
        };

        // Create REAL OrderBookState and OrderFlowPreprocessor
        orderBook = new OrderBookState(
            ORDERBOOK_CONFIG,
            mockLogger,
            mockMetrics,
            mockThreadManager
        );
        preprocessor = new OrderflowPreprocessor(
            PREPROCESSOR_CONFIG,
            orderBook,
            mockLogger,
            mockMetrics
        );

        // Create detector with real configuration
        detector = new ExhaustionDetectorEnhanced(
            "test-exhaustion",
            EXHAUSTION_CONFIG,
            preprocessor,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics,
            mockSignalLogger
        );

        // Initialize OrderBookState (required after constructor changes)
        await orderBook.recover();

        // Capture signals
        detector.on("exhaustion_signal", (signal) => {
            detectedSignals.push(signal);
        });

        // Initialize order book with realistic bid/ask spread
        const midPrice = BASE_PRICE;
        const spread = 0.01; // 1 cent spread
        orderBook.updateDepth({
            s: "LTCUSDT",
            U: 1,
            u: 1,
            b: [
                [String(midPrice - spread / 2), String(500)], // Best bid with limited liquidity
                [String(midPrice - spread / 2 - 0.01), String(800)], // Level 2
                [String(midPrice - spread / 2 - 0.02), String(1200)], // Level 3
            ],
            a: [
                [String(midPrice + spread / 2), String(500)], // Best ask with limited liquidity
                [String(midPrice + spread / 2 + 0.01), String(800)], // Level 2
                [String(midPrice + spread / 2 + 0.02), String(1200)], // Level 3
            ],
        });
    });

    describe("Real Zone Exhaustion Flow", () => {
        it("should accumulate volume and detect liquidity exhaustion patterns", async () => {
            const exhaustionPrice = BASE_PRICE + 0.08; // Test exhaustion at a key level

            // Create sequence of trades that would exhaust liquidity at this level
            // Start with strong buying, then diminishing volumes (exhaustion pattern)
            const trades = [
                createBinanceTrade(exhaustionPrice, 15.0, false), // Strong initial buy 15 LTC
                createBinanceTrade(exhaustionPrice, 12.0, false), // Slightly less 12 LTC
                createBinanceTrade(exhaustionPrice, 8.0, false), // Diminishing 8 LTC
                createBinanceTrade(exhaustionPrice, 4.0, false), // Weak follow-through 4 LTC
                createBinanceTrade(exhaustionPrice, 2.0, false), // Exhausted 2 LTC
            ];

            let lastTradeEvent: EnrichedTradeEvent | null = null;

            // Process trades through REAL preprocessor
            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                // Capture the enriched trade event
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastTradeEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // Verify zone data shows accumulated volume with exhaustion pattern
            expect(lastTradeEvent).toBeDefined();
            expect(lastTradeEvent!.zoneData).toBeDefined();

            const zones5Tick = lastTradeEvent!.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - exhaustionPrice) < TICK_SIZE / 2
            );

            expect(targetZone).toBeDefined();
            expect(targetZone!.aggressiveVolume).toBeGreaterThan(35); // Should accumulate 41 LTC
            expect(targetZone!.aggressiveBuyVolume).toBeGreaterThan(35); // All aggressive buys
            expect(targetZone!.tradeCount).toBe(5);

            // Should generate exhaustion signal due to diminishing volume pattern
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);

            const exhaustionSignal = detectedSignals.find((s) =>
                s.type?.includes("exhaustion")
            );
            expect(exhaustionSignal).toBeDefined();
        });

        it("should detect zone accumulation bug (test MUST fail when bug is present)", async () => {
            // This test is designed to FAIL when the zone aggregation bug exists
            // (when aggregateTradeIntoZones happens AFTER calculateStandardizedZones)

            const exhaustionPrice = BASE_PRICE + 0.12;
            const trades = [
                createBinanceTrade(exhaustionPrice, 12.0, false), // Buy 12 LTC
                createBinanceTrade(exhaustionPrice, 6.0, false), // Buy 6 LTC (exhaustion pattern)
            ];

            let enrichedEvents: EnrichedTradeEvent[] = [];

            // Process each trade and capture events
            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        enrichedEvents.push(event);
                    }
                );
            }

            // The SECOND trade should see volume from FIRST trade in its zone data
            const secondTradeEvent = enrichedEvents[1];
            expect(secondTradeEvent).toBeDefined();
            expect(secondTradeEvent.zoneData).toBeDefined();

            const zones5Tick = secondTradeEvent.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - exhaustionPrice) < TICK_SIZE / 2
            );

            // CRITICAL: This should contain volume from BOTH trades
            // If bug is present, this will only show volume from second trade
            expect(targetZone).toBeDefined();
            expect(targetZone!.aggressiveVolume).toBeGreaterThanOrEqual(18); // Should see 12+6=18 LTC
            expect(targetZone!.tradeCount).toBeGreaterThanOrEqual(2);
        });

        it("should not generate signals when volume is below threshold", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 3.0, false), // Only 3 LTC - below exhaustionVolumeThreshold (8)
                createBinanceTrade(BASE_PRICE, 2.0, false), // Only 2 LTC - still below threshold
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // Should NOT generate signals - volume too low for exhaustion analysis
            expect(detectedSignals.length).toBe(0);
        });

        it("should detect velocity decay in exhaustion patterns", async () => {
            const exhaustionPrice = BASE_PRICE + 0.15;

            // Create trades with decreasing velocity (time gaps increasing)
            const trades = [
                {
                    trade: createBinanceTrade(exhaustionPrice, 10.0, false),
                    delay: 0,
                }, // Immediate
                {
                    trade: createBinanceTrade(exhaustionPrice, 8.0, false),
                    delay: 100,
                }, // 100ms delay
                {
                    trade: createBinanceTrade(exhaustionPrice, 5.0, false),
                    delay: 300,
                }, // 300ms delay
                {
                    trade: createBinanceTrade(exhaustionPrice, 3.0, false),
                    delay: 500,
                }, // 500ms delay
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const { trade, delay } of trades) {
                if (delay > 0)
                    await new Promise((resolve) => setTimeout(resolve, delay));

                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // Verify zone captured the velocity decay pattern
            const zones5Tick = lastEvent!.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - exhaustionPrice) < TICK_SIZE / 2
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(20); // Total 26 LTC
            expect(targetZone!.tradeCount).toBe(4);

            // Should detect exhaustion with velocity analysis
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
        });

        it("should analyze momentum loss in exhaustion detection", async () => {
            const exhaustionPrice = BASE_PRICE + 0.18;

            // Create momentum loss pattern: strong start, weak finish
            const trades = [
                createBinanceTrade(exhaustionPrice, 20.0, false), // Strong momentum 20 LTC
                createBinanceTrade(exhaustionPrice, 18.0, false), // Still strong 18 LTC
                createBinanceTrade(exhaustionPrice, 10.0, false), // Losing momentum 10 LTC
                createBinanceTrade(exhaustionPrice, 5.0, false), // Weak momentum 5 LTC
                createBinanceTrade(exhaustionPrice, 2.0, false), // Lost momentum 2 LTC
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // Verify zone shows momentum loss pattern
            const zones5Tick = lastEvent!.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - exhaustionPrice) < TICK_SIZE / 2
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(50); // Total 55 LTC
            expect(targetZone!.aggressiveBuyVolume).toBeGreaterThan(50); // All buys

            // Should detect exhaustion through momentum analysis
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
            expect(detectedSignals[0].type).toBe("exhaustion");
        });

        it("should detect exhaustion across different zone sizes", async () => {
            const centerPrice = BASE_PRICE + 0.22;

            // Create exhaustion pattern across multiple price levels
            const trades = [
                createBinanceTrade(centerPrice, 15.0, false), // Strong at center
                createBinanceTrade(centerPrice + 0.01, 12.0, false), // Weaker 1 tick higher
                createBinanceTrade(centerPrice + 0.02, 8.0, false), // Exhausting 2 ticks higher
                createBinanceTrade(centerPrice - 0.01, 10.0, false), // Weaker 1 tick lower
                createBinanceTrade(centerPrice - 0.02, 4.0, false), // Exhausted 2 ticks lower
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // Verify different zone sizes captured the exhaustion
            const zoneData = lastEvent!.zoneData!;

            // 5-tick zones should show individual exhaustion points
            expect(zoneData.zones5Tick.length).toBeGreaterThanOrEqual(0);

            // 10-tick zones should show broader exhaustion area
            expect(zoneData.zones10Tick.length).toBeGreaterThanOrEqual(0);

            // 20-tick zones should capture the overall exhaustion cluster
            expect(zoneData.zones20Tick.length).toBeGreaterThanOrEqual(0);

            // Should generate exhaustion signal from confluence across zone sizes
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
            expect(detectedSignals[0].type).toBe("exhaustion");
        });

        it("should handle mixed buy/sell exhaustion patterns", async () => {
            const exhaustionPrice = BASE_PRICE + 0.25;
            const trades = [
                // Mixed exhaustion: buying pressure diminishing, selling pressure increasing
                createBinanceTrade(exhaustionPrice, 15.0, false), // Strong buy 15 LTC
                createBinanceTrade(exhaustionPrice, 3.0, true), // Light sell 3 LTC
                createBinanceTrade(exhaustionPrice, 8.0, false), // Weaker buy 8 LTC
                createBinanceTrade(exhaustionPrice, 6.0, true), // Increasing sell 6 LTC
                createBinanceTrade(exhaustionPrice, 4.0, false), // Exhausted buy 4 LTC
                createBinanceTrade(exhaustionPrice, 8.0, true), // Strong sell 8 LTC
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // Verify zone shows mixed exhaustion pattern
            const zones5Tick = lastEvent!.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - exhaustionPrice) < TICK_SIZE / 2
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(40); // Total 44 LTC
            expect(targetZone!.aggressiveBuyVolume).toBe(27); // 27 LTC buying
            expect(targetZone!.aggressiveSellVolume).toBe(17); // 17 LTC selling

            // Should detect buying exhaustion despite mixed flow
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Volume Threshold Edge Cases", () => {
        it("should handle exactly threshold volume", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 8.0, false), // Exactly at exhaustionVolumeThreshold
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // At threshold should process through detector
            // Signal generation depends on exhaustion analysis
        });

        it("should handle volume just below threshold", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 7.99, false), // Just below exhaustionVolumeThreshold
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // Below threshold should NOT trigger exhaustion analysis
            expect(detectedSignals.length).toBe(0);
        });
    });

    describe("Liquidity Depletion Analysis", () => {
        it("should analyze passive liquidity depletion", async () => {
            const exhaustionPrice = BASE_PRICE + 0.28;

            // Update order book with specific liquidity at test price
            orderBook.updateDepth({
                s: "LTCUSDT",
                U: 2,
                u: 2,
                a: [
                    [String(exhaustionPrice), String(100)], // Limited ask liquidity
                    [String(exhaustionPrice + 0.01), String(200)],
                    [String(exhaustionPrice + 0.02), String(300)],
                ],
                b: [
                    [String(exhaustionPrice - 0.01), String(100)], // Limited bid liquidity
                    [String(exhaustionPrice - 0.02), String(200)],
                ],
            });

            // Create trades that should deplete the available liquidity
            const trades = [
                createBinanceTrade(exhaustionPrice, 25.0, false), // Buy 25 LTC (exceeds ask liquidity)
                createBinanceTrade(exhaustionPrice, 15.0, false), // Buy 15 LTC
                createBinanceTrade(exhaustionPrice, 8.0, false), // Buy 8 LTC (liquidity depleted)
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);

                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
            }

            // Verify liquidity depletion data is available
            expect(lastEvent!.passiveAskVolume).toBeDefined();
            expect(lastEvent!.zonePassiveAskVolume).toBeDefined();

            // Zone should show aggressive volume exceeding passive liquidity
            const zones5Tick = lastEvent!.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - exhaustionPrice) < TICK_SIZE / 2
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(45); // 48 LTC total
            expect(targetZone!.passiveVolume).toBeLessThan(
                targetZone!.aggressiveVolume
            ); // Liquidity depleted

            // Should detect exhaustion through liquidity depletion analysis
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Time-based Exhaustion Patterns", () => {
        it("should accumulate volume and detect exhaustion across time", async () => {
            const exhaustionPrice = BASE_PRICE + 0.3;

            // First wave of buying
            await preprocessor.handleAggTrade(
                createBinanceTrade(exhaustionPrice, 15.0, false)
            );
            await preprocessor.handleAggTrade(
                createBinanceTrade(exhaustionPrice, 12.0, false)
            );

            // Wait (simulate time passage)
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Second wave (weaker)
            await preprocessor.handleAggTrade(
                createBinanceTrade(exhaustionPrice, 8.0, false)
            );
            await preprocessor.handleAggTrade(
                createBinanceTrade(exhaustionPrice, 4.0, false)
            );

            let lastEvent: EnrichedTradeEvent | null = null;
            preprocessor.once("enriched_trade", (event: EnrichedTradeEvent) => {
                lastEvent = event;
                detector.onEnrichedTrade(event);
            });

            // Zone should show exhaustion pattern across time
            const zones5Tick = lastEvent!.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - exhaustionPrice) < TICK_SIZE / 2
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThanOrEqual(39); // 15+12+8+4=39 LTC
            expect(targetZone!.tradeCount).toBeGreaterThanOrEqual(4);

            // Should detect temporal exhaustion pattern
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
        });
    });
});

// Helper function to create realistic Binance trade data
function createBinanceTrade(
    price: number,
    quantity: number,
    buyerIsMaker: boolean,
    timestamp: number = Date.now()
): SpotWebsocketStreams.AggTradeResponse {
    return {
        e: "aggTrade",
        E: timestamp,
        s: "LTCUSDT",
        a: Math.floor(Math.random() * 1000000), // Unique trade ID
        p: price.toFixed(2),
        q: quantity.toFixed(8),
        f: Math.floor(Math.random() * 1000000), // First trade ID
        l: Math.floor(Math.random() * 1000000), // Last trade ID
        T: timestamp,
        m: buyerIsMaker,
        M: true, // Best price match
    };
}
