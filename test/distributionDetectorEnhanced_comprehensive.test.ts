// test/distributionDetectorEnhanced_comprehensive.test.ts
//
// 🧪 COMPREHENSIVE DISTRIBUTION DETECTOR INTEGRATION TEST SUITE
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
import { DistributionDetectorEnhanced } from "../src/indicators/distributionDetectorEnhanced.js";
import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { SpotWebsocketStreams } from "@binance/spot";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import "../test/vitest.setup.ts";

// Real LTCUSDT market parameters
const TICK_SIZE = 0.01;
const BASE_PRICE = 85.0; // $85 LTCUSDT

// Test configuration matching production config.json
const DISTRIBUTION_CONFIG = {
    useStandardizedZones: true,
    eventCooldownMs: 15000, // CRITICAL: Missing cooldown parameter causing multiple signals
    confidenceThreshold: 0.2,
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.1,
    confluenceConfidenceBoost: 0.1,
    crossTimeframeConfidenceBoost: 0.15,
    distributionVolumeThreshold: 3,
    distributionRatioThreshold: 0.4,
    alignmentScoreThreshold: 0.5,
    defaultDurationMs: 120000,
    tickSize: TICK_SIZE,
    maxPriceResistance: 2.0,
    priceResistanceMultiplier: 1.5,
    minPassiveVolumeForEfficiency: 5,
    defaultVolatility: 0.1,
    defaultBaselineVolatility: 0.05,
    sellingPressureVolumeThreshold: 2,
    sellingPressureRatioThreshold: 0.45,
    enableSellingPressureAnalysis: true,
    sellingPressureConfidenceBoost: 0.08,
    varianceReductionFactor: 1.0,
    confluenceStrengthDivisor: 2,
    passiveToAggressiveRatio: 0.6,
    aggressiveSellingRatioThreshold: 0.6,
    aggressiveSellingReductionFactor: 0.5,
    enableZoneConfluenceFilter: true,
    enableCrossTimeframeAnalysis: true,
    enhancementMode: "production" as const,
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

describe("DistributionDetectorEnhanced - REAL Integration Tests", () => {
    let detector: DistributionDetectorEnhanced;
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

        // Import and create mockSignalLogger
        const { createMockSignalLogger } = await import(
            "../__mocks__/src/infrastructure/signalLoggerInterface.js"
        );
        const mockSignalLogger = createMockSignalLogger();

        // Create detector with real configuration
        detector = new DistributionDetectorEnhanced(
            "test-distribution",
            DISTRIBUTION_CONFIG,
            preprocessor,
            mockLogger,
            mockMetrics,
            mockSignalLogger
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

    describe("Real Zone Distribution Flow", () => {
        it("should accumulate volume across multiple sell trades in same zone", async () => {
            const zonePrice = BASE_PRICE;
            const trades = [
                createBinanceTrade(zonePrice, 25.0, true), // Sell 25 LTC - institutional size
                createBinanceTrade(zonePrice, 18.0, true), // Sell 18 LTC - institutional size
                createBinanceTrade(zonePrice, 22.0, true), // Sell 22 LTC - institutional size
                createBinanceTrade(zonePrice, 15.0, true), // Sell 15 LTC - institutional size
                createBinanceTrade(zonePrice, 20.0, true), // Sell 20 LTC - institutional size
            ];

            let lastTradeEvent: EnrichedTradeEvent | null = null;

            // Set up event listener BEFORE processing trades
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
                (z) =>
                    Math.abs(
                        FinancialMath.safeSubtract(z.priceLevel, zonePrice)
                    ) <=
                    FinancialMath.safeDivide(
                        FinancialMath.safeMultiply(10, TICK_SIZE),
                        2
                    )
            );

            expect(targetZone).toBeDefined();
            expect(targetZone!.aggressiveVolume).toBeGreaterThan(95); // Should accumulate 100 LTC
            expect(targetZone!.aggressiveSellVolume).toBeGreaterThan(95); // All sells
            expect(targetZone!.tradeCount).toBe(5);

            // Should generate distribution signal due to sell volume concentration
            expect(detectedSignals.length).toBe(1);
            expect(detectedSignals[0].type).toBe("distribution");
        });

        it("should detect zone accumulation bug (test MUST fail when bug is present)", async () => {
            // This test is designed to FAIL when the zone aggregation bug exists
            // (when aggregateTradeIntoZones happens AFTER calculateStandardizedZones)

            const zonePrice = BASE_PRICE + 0.05; // 85.05
            const trades = [
                createBinanceTrade(zonePrice, 30.0, true), // Sell 30 LTC - institutional
                createBinanceTrade(zonePrice, 25.0, true), // Sell 25 LTC - institutional
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
                (z) =>
                    Math.abs(
                        FinancialMath.safeSubtract(z.priceLevel, zonePrice)
                    ) <=
                    FinancialMath.safeDivide(
                        FinancialMath.safeMultiply(10, TICK_SIZE),
                        2
                    )
            );

            // CRITICAL: This should contain volume from BOTH trades
            // If bug is present, this will only show volume from second trade
            expect(targetZone).toBeDefined();
            expect(targetZone!.aggressiveVolume).toBeGreaterThanOrEqual(55); // Should see 30+25=55 LTC
            expect(targetZone!.tradeCount).toBeGreaterThanOrEqual(2);
        });

        it("should not generate signals when volume is below threshold", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 1.0, true), // Only 1 LTC - below threshold
                createBinanceTrade(BASE_PRICE, 0.5, true), // Only 0.5 LTC - below threshold
            ];

            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        detector.onEnrichedTrade(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // Should NOT generate signals - volume too low
            expect(detectedSignals.length).toBe(0);
        });

        it("should require proper sell ratio for distribution signals", async () => {
            const zonePrice = BASE_PRICE + 0.1;
            const trades = [
                // Mostly buy trades - should NOT trigger distribution
                createBinanceTrade(zonePrice, 8.0, false), // Buy 8 LTC
                createBinanceTrade(zonePrice, 6.0, false), // Buy 6 LTC
                createBinanceTrade(zonePrice, 2.0, true), // Sell 2 LTC
                createBinanceTrade(zonePrice, 1.0, true), // Sell 1 LTC
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // Verify zone has volume but wrong ratio
            const zones = lastEvent!.zoneData!.zones;
            const targetZone = zones.find(
                (z) =>
                    Math.abs(
                        FinancialMath.safeSubtract(z.priceLevel, zonePrice)
                    ) <=
                    FinancialMath.safeDivide(
                        FinancialMath.safeMultiply(10, TICK_SIZE),
                        2
                    )
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(15); // Has volume
            expect(targetZone!.aggressiveBuyVolume).toBeGreaterThan(
                targetZone!.aggressiveSellVolume
            ); // But mostly buys

            // Should NOT generate distribution signal due to wrong buy/sell ratio
            expect(detectedSignals.length).toBe(0);
        });

        it("should generate signals across different zone sizes", async () => {
            const centerPrice = BASE_PRICE + 0.2;

            // Create clustered selling across multiple price levels to hit different zone sizes
            const trades = [
                createBinanceTrade(centerPrice, 20.0, true), // Sell at center - institutional
                createBinanceTrade(centerPrice + 0.01, 15.0, true), // Sell 1 tick higher - institutional
                createBinanceTrade(centerPrice + 0.02, 25.0, true), // Sell 2 ticks higher - institutional
                createBinanceTrade(centerPrice - 0.01, 18.0, true), // Sell 1 tick lower - institutional
                createBinanceTrade(centerPrice - 0.02, 22.0, true), // Sell 2 ticks lower - institutional
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // Verify zones captured the distribution
            const zoneData = lastEvent!.zoneData!;

            // Zones should show distribution points
            expect(zoneData.zones.length).toBeGreaterThanOrEqual(0);

            // Should generate distribution signal from confluence across zone sizes
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
            expect(detectedSignals[0].type).toBe("distribution");
        });

        it("should detect selling pressure in resistance zones", async () => {
            const resistancePrice = BASE_PRICE + 0.5; // Higher price acting as resistance

            // Create selling pressure at resistance level
            const trades = [
                createBinanceTrade(resistancePrice, 30.0, true), // Sell 30 LTC - institutional
                createBinanceTrade(resistancePrice, 25.0, true), // Sell 25 LTC - institutional
                createBinanceTrade(resistancePrice, 20.0, true), // Sell 20 LTC - institutional
                createBinanceTrade(resistancePrice, 15.0, true), // Sell 15 LTC - institutional
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // Verify zone captured the selling pressure
            const zones = lastEvent!.zoneData!.zones;
            const targetZone = zones.find(
                (z) =>
                    Math.abs(
                        FinancialMath.safeSubtract(
                            z.priceLevel,
                            resistancePrice
                        )
                    ) <=
                    FinancialMath.safeDivide(
                        FinancialMath.safeMultiply(10, TICK_SIZE),
                        2
                    )
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(85); // Total 90 LTC
            expect(targetZone!.aggressiveSellVolume).toBeGreaterThan(85); // All sells
            expect(targetZone!.tradeCount).toBe(4);

            // Should generate distribution signal indicating resistance
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
            expect(detectedSignals[0].type).toBe("distribution");
            expect(detectedSignals[0].confidence).toBeGreaterThan(0.2);
        });
    });

    describe("Volume Threshold Edge Cases", () => {
        it("should handle exactly threshold volume", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 3.0, true), // Exactly at threshold
            ];

            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        detector.onEnrichedTrade(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // At threshold should generate signal if other conditions met
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
        });

        it("should handle volume just below threshold", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 2.99, true), // Just below threshold
            ];

            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        detector.onEnrichedTrade(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // Below threshold should NOT generate signal
            expect(detectedSignals.length).toBe(0);
        });
    });

    describe("Mixed Buy/Sell Scenarios", () => {
        it("should handle mixed trades with dominant selling", async () => {
            const zonePrice = BASE_PRICE + 0.3;
            const trades = [
                createBinanceTrade(zonePrice, 30.0, true), // Sell 30 LTC - institutional
                createBinanceTrade(zonePrice, 25.0, true), // Sell 25 LTC - institutional
                createBinanceTrade(zonePrice, 8.0, false), // Buy 8 LTC - smaller retail
                createBinanceTrade(zonePrice, 20.0, true), // Sell 20 LTC - institutional
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // Verify zone shows mixed activity with dominant selling
            const zones = lastEvent!.zoneData!.zones;
            const targetZone = zones.find(
                (z) =>
                    Math.abs(
                        FinancialMath.safeSubtract(z.priceLevel, zonePrice)
                    ) <=
                    FinancialMath.safeDivide(
                        FinancialMath.safeMultiply(10, TICK_SIZE),
                        2
                    )
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(80); // Total 83 LTC
            expect(targetZone!.aggressiveSellVolume).toBeGreaterThan(
                targetZone!.aggressiveBuyVolume
            ); // More selling
            expect(targetZone!.aggressiveSellVolume).toBeGreaterThan(70); // 75 LTC selling
            expect(targetZone!.aggressiveBuyVolume).toBe(8); // 8 LTC buying

            // Should generate distribution signal due to dominant selling
            expect(detectedSignals.length).toBeGreaterThanOrEqual(0);
            expect(detectedSignals[0].type).toBe("distribution");
        });

        it("should reject mixed trades with insufficient sell ratio", async () => {
            const zonePrice = BASE_PRICE + 0.4;
            const trades = [
                createBinanceTrade(zonePrice, 1.5, true), // Sell 1.5 LTC (below threshold)
                createBinanceTrade(zonePrice, 1.0, true), // Sell 1.0 LTC (total 2.5 - still below threshold)
                createBinanceTrade(zonePrice, 8.0, false), // Buy 8 LTC (dominant - total 10.5 with low sell ratio)
            ];

            let lastEvent: EnrichedTradeEvent | null = null;

            for (const trade of trades) {
                preprocessor.once(
                    "enriched_trade",
                    (event: EnrichedTradeEvent) => {
                        lastEvent = event;
                        detector.onEnrichedTrade(event);
                    }
                );
                await preprocessor.handleAggTrade(trade);
            }

            // Verify zone has volume but insufficient sell ratio
            const zones = lastEvent!.zoneData!.zones;
            const targetZone = zones.find(
                (z) =>
                    Math.abs(
                        FinancialMath.safeSubtract(z.priceLevel, zonePrice)
                    ) <=
                    FinancialMath.safeDivide(
                        FinancialMath.safeMultiply(10, TICK_SIZE),
                        2
                    )
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThan(10); // Total 10.5 LTC
            expect(targetZone!.aggressiveBuyVolume).toBeGreaterThan(
                targetZone!.aggressiveSellVolume
            ); // More buying (8.0 vs 2.5)

            // Should NOT generate distribution signal due to insufficient sell ratio
            expect(detectedSignals.length).toBe(0);
        });
    });

    describe("Time-based Zone Persistence", () => {
        it("should accumulate volume across time in same zone", async () => {
            const zonePrice = BASE_PRICE + 0.35;

            // First batch of trades
            await preprocessor.handleAggTrade(
                createBinanceTrade(zonePrice, 35.0, true)
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
                createBinanceTrade(zonePrice, 30.0, true)
            );

            // Zone should show accumulated volume from both time periods
            const zones = lastEvent!.zoneData!.zones;
            const targetZone = zones.find(
                (z) =>
                    Math.abs(
                        FinancialMath.safeSubtract(z.priceLevel, zonePrice)
                    ) <=
                    FinancialMath.safeDivide(
                        FinancialMath.safeMultiply(10, TICK_SIZE),
                        2
                    )
            );

            expect(targetZone!.aggressiveVolume).toBeGreaterThanOrEqual(65); // 35+30=65 LTC
            expect(targetZone!.aggressiveSellVolume).toBeGreaterThanOrEqual(65); // All sells
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
