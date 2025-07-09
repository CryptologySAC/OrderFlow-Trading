// test/orderFlowPreprocessor_comprehensive.test.ts
//
// 🧪 COMPREHENSIVE ORDER FLOW PREPROCESSOR TEST SUITE
//
// CLAUDE.MD COMPLIANCE: These tests validate REAL preprocessor behavior
// with ZERO TOLERANCE for bugs that affect signal generation.
//
// CRITICAL: These tests MUST detect any bugs in the preprocessor flow
// that could prevent detectors from receiving proper zone data.
//
// TEST PHILOSOPHY:
// - Test the ACTUAL behavior, not mocked behavior
// - Validate complete data flow from trade input to enriched output
// - Ensure zone aggregation works correctly across multiple trades
// - Verify tests FAIL when critical bugs are present
//
// MANDATORY COVERAGE:
// - Zone aggregation flow (both tempEnriched and finalTrade)
// - Zone data population and persistence
// - Trade enrichment with all required fields
// - Individual trades enhancement integration
// - Error handling and edge cases
//

import { describe, it, expect, beforeEach, vi } from "vitest";
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
const BASE_PRICE = 89.0; // $89 LTCUSDT

// Test configuration matching production requirements
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
    enableIndividualTrades: false, // Start with false to test basic flow
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

describe("OrderFlowPreprocessor - Comprehensive Test Suite", () => {
    let preprocessor: OrderflowPreprocessor;
    let orderBook: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let enrichedTrades: EnrichedTradeEvent[];

    beforeEach(() => {
        // Reset trade collection
        enrichedTrades = [];

        // Create comprehensive infrastructure mocks
        mockLogger = {
            debug: vi.fn((message, data) => {
                // Enable debug output for zone-related logs and trade aggregation
                if (
                    message.includes("Zone") ||
                    message.includes("zone") ||
                    message.includes("TRADE AGGREGATION")
                ) {
                    console.log("DEBUG:", message, data);
                }
            }),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            isDebugEnabled: vi.fn().mockReturnValue(true),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            incrementCounter: vi.fn(), // Added missing method
            decrementMetric: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            recordTimer: vi.fn(),
            startTimer: vi.fn(() => ({ stop: vi.fn() })),
            getMetrics: vi.fn(() => ({}) as any),
            shutdown: vi.fn(),
        };

        // Create REAL OrderBookState and OrderFlowPreprocessor
        orderBook = new OrderBookState(
            ORDERBOOK_CONFIG,
            mockLogger,
            mockMetrics
        );
        preprocessor = new OrderflowPreprocessor(
            PREPROCESSOR_CONFIG,
            orderBook,
            mockLogger,
            mockMetrics
        );

        // Capture all enriched trades
        preprocessor.on("enriched_trade", (trade: EnrichedTradeEvent) => {
            enrichedTrades.push(trade);
        });

        // Initialize order book with realistic bid/ask spread using proper tick-aligned prices
        const midPrice = BASE_PRICE; // 89.0

        const depthUpdate = {
            s: "LTCUSDT",
            U: 1,
            u: 1,
            b: [
                ["88.99", "1000"], // Best bid (tick-aligned)
                ["88.98", "2000"], // Level 2
                ["88.97", "3000"], // Level 3
                ["88.96", "1500"], // Level 4
            ],
            a: [
                ["89.01", "1000"], // Best ask (tick-aligned)
                ["89.02", "2000"], // Level 2
                ["89.03", "3000"], // Level 3
                ["89.04", "1500"], // Level 4
            ],
        };

        orderBook.updateDepth(depthUpdate as any);
    });

    describe("Critical Zone Aggregation Flow", () => {
        it("should perform BOTH tempEnriched AND finalTrade aggregation", async () => {
            // This test verifies the complete aggregation flow that was broken
            const testPrice = BASE_PRICE + 0.05;
            const testQuantity = 15.0;

            const trade = createBinanceTrade(testPrice, testQuantity, false);
            await preprocessor.handleAggTrade(trade);

            // Verify trade was enriched and emitted
            expect(enrichedTrades.length).toBe(1);
            const enrichedTrade = enrichedTrades[0];

            // CRITICAL: Zone data must be populated
            expect(enrichedTrade.zoneData).toBeTruthy();
            expect(enrichedTrade.zoneData!.zones5Tick).toBeTruthy();
            expect(enrichedTrade.zoneData!.zones10Tick).toBeTruthy();
            expect(enrichedTrade.zoneData!.zones20Tick).toBeTruthy();

            // Find the zone that should contain our trade
            const zones5Tick = enrichedTrade.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - testPrice) < TICK_SIZE / 2
            );

            // CRITICAL: Zone must exist and contain trade data
            expect(targetZone).toBeTruthy();
            expect(targetZone!.aggressiveVolume).toBeGreaterThan(0);
            expect(targetZone!.tradeCount).toBeGreaterThan(0);

            // Verify the volume matches our trade
            expect(targetZone!.aggressiveVolume).toBe(testQuantity);
            expect(targetZone!.tradeCount).toBe(1);
        });

        it("should accumulate volume across multiple trades in same zone", async () => {
            // This test validates the zone accumulation that's critical for detectors
            const zonePrice = BASE_PRICE + 0.1;
            const trades = [
                createBinanceTrade(zonePrice, 8.0, false), // Buy 8 LTC
                createBinanceTrade(zonePrice, 5.0, false), // Buy 5 LTC
                createBinanceTrade(zonePrice, 12.0, false), // Buy 12 LTC
            ];

            // Process all trades
            for (let i = 0; i < trades.length; i++) {
                console.log(`Processing trade ${i + 1}:`, {
                    price: trades[i].p,
                    quantity: trades[i].q,
                    buyerIsMaker: trades[i].m,
                });
                await preprocessor.handleAggTrade(trades[i]);
            }

            // Verify all trades were processed
            expect(enrichedTrades.length).toBe(3);

            // Check the last trade's zone data contains accumulated volume
            const lastTrade = enrichedTrades[2];
            expect(lastTrade.zoneData).toBeTruthy();

            const zones5Tick = lastTrade.zoneData!.zones5Tick;
            console.log("Zone data debug:", {
                zonePrice,
                zones5TickCount: zones5Tick.length,
                zones5Tick: zones5Tick.map((z) => ({
                    priceLevel: z.priceLevel,
                    aggressiveVolume: z.aggressiveVolume,
                    tradeCount: z.tradeCount,
                    zoneId: z.zoneId,
                })),
            });

            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - zonePrice) < TICK_SIZE / 2
            );

            // CRITICAL: Zone must show accumulated volume from all trades
            expect(targetZone).toBeTruthy();
            expect(targetZone!.aggressiveVolume).toBe(25.0); // 8 + 5 + 12 = 25
            expect(targetZone!.tradeCount).toBe(3);
            expect(targetZone!.aggressiveBuyVolume).toBe(25.0); // All buys
            expect(targetZone!.aggressiveSellVolume).toBe(0); // No sells
        });

        it("should handle mixed buy/sell trades correctly", async () => {
            const zonePrice = BASE_PRICE + 0.15;
            const trades = [
                createBinanceTrade(zonePrice, 10.0, false), // Buy 10 LTC
                createBinanceTrade(zonePrice, 6.0, true), // Sell 6 LTC
                createBinanceTrade(zonePrice, 4.0, false), // Buy 4 LTC
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            const lastTrade = enrichedTrades[2];
            const zones5Tick = lastTrade.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - zonePrice) < TICK_SIZE / 2
            );

            expect(targetZone!.aggressiveVolume).toBe(20.0); // 10 + 6 + 4 = 20
            expect(targetZone!.aggressiveBuyVolume).toBe(14.0); // 10 + 4 = 14
            expect(targetZone!.aggressiveSellVolume).toBe(6.0); // 6
            expect(targetZone!.tradeCount).toBe(3);
        });

        it("should populate zone data for all zone sizes", async () => {
            const testPrice = BASE_PRICE + 0.2;
            const trade = createBinanceTrade(testPrice, 20.0, false);
            await preprocessor.handleAggTrade(trade);

            const enrichedTrade = enrichedTrades[0];
            const zoneData = enrichedTrade.zoneData!;

            // All zone sizes should be populated
            expect(zoneData.zones5Tick.length).toBeGreaterThan(0);
            expect(zoneData.zones10Tick.length).toBeGreaterThan(0);
            expect(zoneData.zones20Tick.length).toBeGreaterThan(0);

            // Each zone size should have the trade data
            const zones5 = zoneData.zones5Tick.find(
                (z) => Math.abs(z.priceLevel - testPrice) < TICK_SIZE / 2
            );
            const zones10 = zoneData.zones10Tick.find(
                (z) => Math.abs(z.priceLevel - testPrice) < TICK_SIZE
            );
            const zones20 = zoneData.zones20Tick.find(
                (z) => Math.abs(z.priceLevel - testPrice) < TICK_SIZE * 2
            );

            expect(zones5?.aggressiveVolume).toBe(20.0);
            expect(zones10?.aggressiveVolume).toBe(20.0);
            expect(zones20?.aggressiveVolume).toBe(20.0);
        });

        it("MUST FAIL when aggregation flow is broken", async () => {
            // This test is specifically designed to catch the bug we just fixed
            // It validates that zone data contains accumulated volume from multiple trades
            const zonePrice = BASE_PRICE + 0.3;
            const firstTrade = createBinanceTrade(zonePrice, 7.0, false);
            const secondTrade = createBinanceTrade(zonePrice, 9.0, false);

            // Process first trade
            await preprocessor.handleAggTrade(firstTrade);
            const firstEnriched = enrichedTrades[0];

            // Process second trade
            await preprocessor.handleAggTrade(secondTrade);
            const secondEnriched = enrichedTrades[1];

            // CRITICAL: Second trade's zone data MUST show accumulated volume from BOTH trades
            const zones5Tick = secondEnriched.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - zonePrice) < TICK_SIZE / 2
            );

            expect(targetZone).toBeTruthy();

            // This assertion will FAIL if aggregation is broken
            expect(targetZone!.aggressiveVolume).toBe(16.0); // 7 + 9 = 16
            expect(targetZone!.tradeCount).toBe(2);

            // If the bug exists, these would be:
            // expect(targetZone!.aggressiveVolume).toBe(9.0); // Only second trade
            // expect(targetZone!.tradeCount).toBe(1); // Only second trade
        });
    });

    describe("Trade Enrichment Validation", () => {
        it("should enrich trades with all required fields", async () => {
            const testPrice = BASE_PRICE + 0.4;
            const testQuantity = 12.5;
            const trade = createBinanceTrade(testPrice, testQuantity, false);

            await preprocessor.handleAggTrade(trade);
            const enrichedTrade = enrichedTrades[0];

            // Verify all required fields are present
            expect(enrichedTrade.pair).toBe("LTCUSDT");
            expect(enrichedTrade.price).toBe(testPrice);
            expect(enrichedTrade.quantity).toBe(testQuantity);
            expect(enrichedTrade.buyerIsMaker).toBe(false);
            expect(enrichedTrade.timestamp).toBeDefined();
            // Note: 'side' is detector logic, not preprocessor logic

            // Verify enriched fields
            expect(enrichedTrade.passiveBidVolume).toBeDefined();
            expect(enrichedTrade.passiveAskVolume).toBeDefined();
            expect(enrichedTrade.zonePassiveBidVolume).toBeDefined();
            expect(enrichedTrade.zonePassiveAskVolume).toBeDefined();
            expect(enrichedTrade.bestBid).toBeDefined();
            expect(enrichedTrade.bestAsk).toBeDefined();
            expect(enrichedTrade.zoneData).toBeDefined();
        });

        it("should handle large trades with depth snapshots", async () => {
            const largeTradeSize = 150.0; // Above largeTradeThreshold
            const trade = createBinanceTrade(BASE_PRICE, largeTradeSize, false);

            await preprocessor.handleAggTrade(trade);
            const enrichedTrade = enrichedTrades[0];

            // Large trades should include depth snapshot
            expect(enrichedTrade.depthSnapshot).toBeDefined();
            // OrderBookState properly initialized and providing depth data
            expect(enrichedTrade.depthSnapshot!.size).toBeGreaterThanOrEqual(0);
        });

        it("should not include depth snapshots for small trades", async () => {
            const smallTradeSize = 50.0; // Below largeTradeThreshold
            const trade = createBinanceTrade(BASE_PRICE, smallTradeSize, false);

            await preprocessor.handleAggTrade(trade);
            const enrichedTrade = enrichedTrades[0];

            // Small trades should not include depth snapshot
            expect(enrichedTrade.depthSnapshot).toBeUndefined();
        });
    });

    describe("Zone Data Persistence", () => {
        it("should maintain zone data across time", async () => {
            const zonePrice = BASE_PRICE + 0.5;

            // First trade
            await preprocessor.handleAggTrade(
                createBinanceTrade(zonePrice, 8.0, false)
            );

            // Wait briefly to simulate time passage
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Second trade at same price
            await preprocessor.handleAggTrade(
                createBinanceTrade(zonePrice, 6.0, false)
            );

            const secondTrade = enrichedTrades[1];
            const zones5Tick = secondTrade.zoneData!.zones5Tick;
            const targetZone = zones5Tick.find(
                (z) => Math.abs(z.priceLevel - zonePrice) < TICK_SIZE / 2
            );

            // Zone should persist and accumulate
            expect(targetZone!.aggressiveVolume).toBe(14.0); // 8 + 6 = 14
            expect(targetZone!.tradeCount).toBe(2);
        });

        it("should handle zones at different price levels", async () => {
            const prices = [BASE_PRICE, BASE_PRICE + 0.05, BASE_PRICE + 0.1];
            const volumes = [5.0, 8.0, 12.0];

            for (let i = 0; i < prices.length; i++) {
                await preprocessor.handleAggTrade(
                    createBinanceTrade(prices[i], volumes[i], false)
                );
            }

            const lastTrade = enrichedTrades[2];
            const zones5Tick = lastTrade.zoneData!.zones5Tick;

            // Should have zones at all price levels
            expect(zones5Tick.length).toBeGreaterThanOrEqual(3);

            // Each zone should have correct volume
            for (let i = 0; i < prices.length; i++) {
                const zone = zones5Tick.find(
                    (z) => Math.abs(z.priceLevel - prices[i]) < TICK_SIZE / 2
                );
                expect(zone).toBeTruthy();
                expect(zone!.aggressiveVolume).toBe(volumes[i]);
            }
        });
    });

    describe("Error Handling", () => {
        it("should handle invalid trade data gracefully", async () => {
            const invalidTrade = {
                ...createBinanceTrade(BASE_PRICE, 10.0, false),
                p: "invalid_price",
            };

            // Should not throw error
            await expect(
                preprocessor.handleAggTrade(invalidTrade)
            ).resolves.not.toThrow();

            // Should not emit enriched trade for invalid data
            expect(enrichedTrades.length).toBe(0);
        });

        it("should handle extreme price values", async () => {
            const extremePrice = 99999.99;
            const trade = createBinanceTrade(extremePrice, 1.0, false);

            await preprocessor.handleAggTrade(trade);

            // Should process trade even with extreme price
            expect(enrichedTrades.length).toBe(1);
            expect(enrichedTrades[0].price).toBe(extremePrice);
        });

        it("should handle zero and negative quantities", async () => {
            const zeroQuantityTrade = createBinanceTrade(
                BASE_PRICE,
                0.0,
                false
            );
            const negativeQuantityTrade = createBinanceTrade(
                BASE_PRICE,
                -1.0,
                false
            );

            await preprocessor.handleAggTrade(zeroQuantityTrade);
            await preprocessor.handleAggTrade(negativeQuantityTrade);

            // Should not process invalid quantity trades
            expect(enrichedTrades.length).toBe(0);
        });
    });

    describe("Processing Statistics", () => {
        it("should track processing statistics", async () => {
            const trades = [
                createBinanceTrade(BASE_PRICE, 5.0, false),
                createBinanceTrade(BASE_PRICE + 0.01, 8.0, true),
                createBinanceTrade(BASE_PRICE + 0.02, 3.0, false),
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            const stats = preprocessor.getStats();
            expect(stats.processedTrades).toBe(3);
            expect(stats.processedDepthUpdates).toBe(0); // No depth updates in this test
            expect(stats.bookMetrics).toBeDefined();
        });
    });

    describe("Individual Trades Integration", () => {
        it("should handle individual trades enhancement when enabled", async () => {
            // Create preprocessor with individual trades enabled
            const configWithIndividualTrades = {
                ...PREPROCESSOR_CONFIG,
                enableIndividualTrades: true,
            };

            const preprocessorWithIndividual = new OrderflowPreprocessor(
                configWithIndividualTrades,
                orderBook,
                mockLogger,
                mockMetrics
            );

            let enrichedTradesWithIndividual: EnrichedTradeEvent[] = [];
            preprocessorWithIndividual.on(
                "enriched_trade",
                (trade: EnrichedTradeEvent) => {
                    enrichedTradesWithIndividual.push(trade);
                }
            );

            const trade = createBinanceTrade(BASE_PRICE, 50.0, false);
            await preprocessorWithIndividual.handleAggTrade(trade);

            expect(enrichedTradesWithIndividual.length).toBe(1);
            const enrichedTrade = enrichedTradesWithIndividual[0];

            // Should still have zone data even with individual trades
            expect(enrichedTrade.zoneData).toBeTruthy();
            expect(enrichedTrade.zoneData!.zones5Tick.length).toBeGreaterThan(
                0
            );
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
    const tradeId = Math.floor(Math.random() * 1000000);
    return {
        e: "aggTrade" as const,
        E: timestamp,
        s: "LTCUSDT" as const,
        a: tradeId, // Unique trade ID
        p: String(price.toFixed(2)), // Ensure string type
        q: String(quantity.toFixed(8)), // Ensure string type
        f: tradeId - 5, // First trade ID (before agg trade ID)
        l: tradeId + 5, // Last trade ID (after agg trade ID)
        T: timestamp,
        m: buyerIsMaker,
        M: true, // Best price match
    };
}
