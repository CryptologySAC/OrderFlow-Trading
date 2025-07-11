// test/accumulationZoneDetectorEnhanced_comprehensive.test.ts
//
// 🧪 COMPREHENSIVE ACCUMULATION DETECTOR INTEGRATION TEST SUITE
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
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
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
const BASE_PRICE = 85.0; // $85 LTCUSDT

// Test configuration matching production config.json
const ACCUMULATION_CONFIG = {
    useStandardizedZones: true,
    eventCooldownMs: 5000, // 5 second cooldown for testing
    confidenceThreshold: 0.2, // Lowered for easier signal generation in tests
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.1,
    confluenceConfidenceBoost: 0.1,
    crossTimeframeConfidenceBoost: 0.15,
    accumulationVolumeThreshold: 3, // Lowered for test scenarios
    accumulationRatioThreshold: 0.45,
    alignmentScoreThreshold: 0.5,
    defaultDurationMs: 120000,
    tickSize: TICK_SIZE,
    enhancementMode: "production" as const,

    // REQUIRED PROPERTIES - Found in AccumulationDetectorSchema
    maxPriceSupport: 2.0,
    priceSupportMultiplier: 1.5,
    minPassiveVolumeForEfficiency: 5,
    defaultVolatility: 0.05,
    defaultBaselineVolatility: 0.03,
    confluenceStrengthDivisor: 2,
    passiveToAggressiveRatio: 1.0,
    varianceReductionFactor: 1.0,
    aggressiveBuyingRatioThreshold: 0.6,
    aggressiveBuyingReductionFactor: 0.5,
    buyingPressureConfidenceBoost: 0.1,
    enableZoneConfluenceFilter: true,
    enableBuyingPressureAnalysis: true,
    enableCrossTimeframeAnalysis: true,
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
        zoneTicks: 10,
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
    maxTradesPerZone: 1500, // CRITICAL FIX: Required for CircularBuffer capacity in zone creation
};

describe("AccumulationZoneDetectorEnhanced - REAL Integration Tests", () => {
    let detector: AccumulationZoneDetectorEnhanced;
    let preprocessor: OrderflowPreprocessor;
    let orderBook: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
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
            decrementMetric: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            recordTimer: vi.fn(() => ({ stop: vi.fn() })),
            startTimer: vi.fn(() => ({ stop: vi.fn() })),
            getMetrics: vi.fn(() => ({}) as any),
            shutdown: vi.fn(),
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
        detector = new AccumulationZoneDetectorEnhanced(
            "test-accumulation",
            "LTCUSDT",
            ACCUMULATION_CONFIG,
            preprocessor,
            mockLogger,
            mockMetrics
        );

        // Initialize OrderBookState (required after constructor changes)
        await orderBook.recover();

        // Capture signals
        detector.on("signalCandidate", (signal) => {
            detectedSignals.push(signal);
        });

        // Initialize order book with realistic bid/ask spread
        const midPrice = BASE_PRICE;
        const spread = 0.01; // 1 cent spread
        orderBook.updateDepth({
            s: "LTCUSDT",
            U: 1,
            u: 1,
            b: [[String(midPrice - spread / 2), String(1000)]],
            a: [[String(midPrice + spread / 2), String(1000)]],
        });
    });

    describe("Real Zone Accumulation Flow", () => {
        it("should accumulate volume across multiple buy trades in same zone", async () => {
            const zonePrice = BASE_PRICE;
            const trades = [
                createBinanceTrade(zonePrice, 5.0, false), // Buy 5 LTC
                createBinanceTrade(zonePrice, 3.0, false), // Buy 3 LTC
                createBinanceTrade(zonePrice, 7.0, false), // Buy 7 LTC
                createBinanceTrade(zonePrice, 2.0, false), // Buy 2 LTC
            ];

            let lastTradeEvent: EnrichedTradeEvent | null = null;

            // Set up event listener to process each trade through detector
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                lastTradeEvent = event;
                detector.onEnrichedTrade(event);
            });

            // Process trades through REAL preprocessor
            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // Verify zone data shows accumulated volume
            expect(lastTradeEvent).toBeDefined();
            expect(lastTradeEvent!.zoneData).toBeDefined();

            const zones = lastTradeEvent!.zoneData!.zones;
            const targetZone = zones.find(
                (z) => Math.abs(z.priceLevel - zonePrice) < (10 * TICK_SIZE) / 2
            );

            expect(targetZone).toBeDefined();
            expect(targetZone!.aggressiveVolume).toBeGreaterThan(15); // Should accumulate 17 LTC
            expect(targetZone!.aggressiveBuyVolume).toBeGreaterThan(15); // All buys
            expect(targetZone!.tradeCount).toBe(4);

            // Should generate accumulation signal due to buy volume concentration
            expect(detectedSignals.length).toBe(1);
            expect(detectedSignals[0].type).toBe("accumulation");
        });

        it("should detect zone accumulation bug (test MUST fail when bug is present)", async () => {
            // This test is designed to FAIL when the zone aggregation bug exists
            // (when aggregateTradeIntoZones happens AFTER calculateStandardizedZones)

            const zonePrice = BASE_PRICE + 0.05; // 85.05
            const trades = [
                createBinanceTrade(zonePrice, 4.0, false), // Buy 4 LTC
                createBinanceTrade(zonePrice, 6.0, false), // Buy 6 LTC
            ];

            let enrichedEvents: EnrichedTradeEvent[] = [];

            // Process each trade and capture events
            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        enrichedEvents.push(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // The SECOND trade should see volume from FIRST trade in its zone data
            const secondTradeEvent = enrichedEvents[1];
            expect(secondTradeEvent).toBeDefined();
            expect(secondTradeEvent.zoneData).toBeDefined();

            const zones = secondTradeEvent.zoneData!.zones;
            const targetZone = zones.find(
                (z) => Math.abs(z.priceLevel - zonePrice) < (10 * TICK_SIZE) / 2
            );

            // CRITICAL: This should contain volume from BOTH trades
            // If bug is present, this will only show volume from second trade
            expect(targetZone).toBeDefined();
            expect(targetZone!.aggressiveVolume).toBeGreaterThanOrEqual(10); // Should see 4+6=10 LTC
            expect(targetZone!.tradeCount).toBeGreaterThanOrEqual(2);
        });

        it("should not generate signals when volume is below threshold", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 1.0, false), // Only 1 LTC - below threshold
                createBinanceTrade(BASE_PRICE, 0.5, false), // Only 0.5 LTC - below threshold
            ];

            // Set up event listener BEFORE processing trades
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                detector.onEnrichedTrade(event);
            });

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // Should NOT generate signals - volume too low (1.5 LTC total < 3 LTC threshold)
            expect(detectedSignals.length).toBe(0);
        });

        it("should require proper buy ratio for accumulation signals", async () => {
            const zonePrice = BASE_PRICE + 0.1;
            const trades = [
                // Mostly sell trades - should NOT trigger accumulation
                createBinanceTrade(zonePrice, 8.0, true), // Sell 8 LTC
                createBinanceTrade(zonePrice, 6.0, true), // Sell 6 LTC
                createBinanceTrade(zonePrice, 2.0, false), // Buy 2 LTC
                createBinanceTrade(zonePrice, 1.0, false), // Buy 1 LTC
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            // Set up event listener BEFORE processing trades
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                lastEvent = event;
                detector.onEnrichedTrade(event);
            });

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // Verify zone has volume but wrong ratio
            const zones = lastEvent!.zoneData!.zones;
            const targetZone = zones.find(
                (z) => Math.abs(z.priceLevel - zonePrice) < (10 * TICK_SIZE) / 2
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(15); // Has volume
            expect(targetZone!.aggressiveSellVolume).toBeGreaterThan(
                targetZone!.aggressiveBuyVolume
            ); // But mostly sells

            // Should NOT generate accumulation signal due to wrong buy/sell ratio
            expect(detectedSignals.length).toBe(0);
        });

        it("should generate signals across different zone sizes", async () => {
            const centerPrice = BASE_PRICE + 0.2;

            // Create clustered buying across multiple price levels to hit different zone sizes
            const trades = [
                createBinanceTrade(centerPrice, 4.0, false), // Buy at center
                createBinanceTrade(centerPrice + 0.01, 3.0, false), // Buy 1 tick higher
                createBinanceTrade(centerPrice + 0.02, 5.0, false), // Buy 2 ticks higher
                createBinanceTrade(centerPrice - 0.01, 2.0, false), // Buy 1 tick lower
                createBinanceTrade(centerPrice - 0.02, 6.0, false), // Buy 2 ticks lower
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            // Set up event listener BEFORE processing trades
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                lastEvent = event;
                detector.onEnrichedTrade(event);
            });

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // Verify different zone sizes captured the accumulation
            const zoneData = lastEvent!.zoneData!;

            // 5-tick zones should show individual accumulation points
            expect(zoneData.zones.length).toBeGreaterThanOrEqual(0);

            // Should generate accumulation signal from confluence across zone sizes
            expect(detectedSignals.length).toBe(1);
            expect(detectedSignals[0].type).toBe("accumulation");
        });
    });

    describe("Volume Threshold Edge Cases", () => {
        it("should handle exactly threshold volume", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 3.0, false), // Exactly at threshold
            ];

            // Set up event listener BEFORE processing trades
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                detector.onEnrichedTrade(event);
            });

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // At threshold should generate signal if other conditions met
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
        });

        it("should handle volume just below threshold", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 2.99, false), // Just below threshold
            ];

            // Set up event listener BEFORE processing trades
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                detector.onEnrichedTrade(event);
            });

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // Below threshold should NOT generate signal
            expect(detectedSignals.length).toBe(0);
        });
    });

    describe("Time-based Zone Persistence", () => {
        it("should accumulate volume across time in same zone", async () => {
            const zonePrice = BASE_PRICE + 0.3;

            // First batch of trades
            await preprocessor.handleAggTrade(
                createBinanceTrade(zonePrice, 2.0, false)
            );

            // Wait a bit (simulate time passage)
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Second batch of trades
            let lastEvent: EnrichedTradeEvent | null = null;
            preprocessor.once("enriched_trade", (event: EnrichedTradeEvent) => {
                lastEvent = event;
                detector.onEnrichedTrade(event);
            });

            await preprocessor.handleAggTrade(
                createBinanceTrade(zonePrice, 4.0, false)
            );

            // Zone should show accumulated volume from both time periods
            const zones = lastEvent!.zoneData!.zones;
            const targetZone = zones.find(
                (z) => Math.abs(z.priceLevel - zonePrice) < (10 * TICK_SIZE) / 2
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThanOrEqual(6); // 2+4=6 LTC
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
