// test/orderFlowPreprocessor_exactNumbers.test.ts
//
// 🔢 EXACT NUMBERS VALIDATION TEST SUITE
//
// Tests validate EXACT NUMERICAL OUTPUTS:
// - Exact array lengths (zones.length = 25)
// - Exact volume accumulation (37.75 LTC)
// - Exact trade counts (3 trades)
// - Exact price levels ($89.05)
// - Exact buy/sell splits (25.0 buy, 12.75 sell)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { SpotWebsocketStreams } from "@binance/spot";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import "../test/vitest.setup.ts";

const TICK_SIZE = 0.01;
const BASE_PRICE = 89.0;

const CONFIG = {
    orderbook: {
        maxLevels: 150,
        snapshotIntervalMs: 1000,
        maxPriceDistance: 10.0,
        pruneIntervalMs: 30000,
        maxErrorRate: 0.05,
        staleThresholdMs: 5000,
    },
    preprocessor: {
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
    },
};

describe("OrderFlowPreprocessor - Exact Numbers Validation", () => {
    let preprocessor: OrderflowPreprocessor;
    let orderBook: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let enrichedTrades: EnrichedTradeEvent[];

    beforeEach(() => {
        enrichedTrades = [];

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
            recordTimer: vi.fn(),
            startTimer: vi.fn(() => ({ stop: vi.fn() })),
            getMetrics: vi.fn(() => ({}) as any),
            shutdown: vi.fn(),
        };

        orderBook = new OrderBookState(
            CONFIG.orderbook,
            mockLogger,
            mockMetrics
        );
        preprocessor = new OrderflowPreprocessor(
            CONFIG.preprocessor,
            orderBook,
            mockLogger,
            mockMetrics
        );

        preprocessor.on("enriched_trade", (trade: EnrichedTradeEvent) => {
            enrichedTrades.push(trade);
        });

        // Setup exact orderbook
        orderBook.updateDepth({
            s: "LTCUSDT",
            U: 1,
            u: 1,
            b: [
                ["88.995", "1000.0"],
                ["88.985", "2000.0"],
                ["88.975", "3000.0"],
            ],
            a: [
                ["89.005", "1000.0"],
                ["89.015", "2000.0"],
                ["89.025", "3000.0"],
            ],
        });
    });

    describe("Exact Array Lengths", () => {
        it("should create exactly 25 zones in simplified structure", async () => {
            const trade = createExactTrade(89.05, 15.5, false);
            await preprocessor.handleAggTrade(trade);

            const enrichedTrade = enrichedTrades[0];

            // EXACT NUMBERS: Zone array lengths based on simplified single zone structure
            expect(enrichedTrade.zoneData!.zones.length).toBe(25); // 2*12+1 = 25 zones
        });

        it("should create exactly 2 active zones across price levels", async () => {
            const trades = [
                createExactTrade(89.0, 10.0, false),
                createExactTrade(89.05, 15.0, false),
                createExactTrade(89.1, 20.0, false),
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            const finalTrade = enrichedTrades[2];
            const zones = finalTrade.zoneData!.zones;

            // EXACT NUMBERS: Count zones with volume > 0
            const activeZones = zones.filter((z) => z.aggressiveVolume > 0);
            expect(activeZones.length).toBe(2);

            // EXACT NUMBERS: Each zone should have exact volume
            const zone1 = zones.find(
                (z) => Math.abs(z.priceLevel - 89.0) < 0.05
            );
            const zone2 = zones.find(
                (z) => Math.abs(z.priceLevel - 89.1) < 0.05
            );

            expect(zone1!.aggressiveVolume).toBeGreaterThan(0);
            expect(zone2!.aggressiveVolume).toBeGreaterThan(0);
        });
    });

    describe("Exact Volume Accumulation", () => {
        it("should accumulate exactly 37.75 LTC across 3 trades", async () => {
            const exactPrice = 89.1;
            const trades = [
                createExactTrade(exactPrice, 10.0, false), // 10.0 LTC
                createExactTrade(exactPrice, 15.25, false), // 15.25 LTC
                createExactTrade(exactPrice, 12.5, false), // 12.5 LTC
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            const finalTrade = enrichedTrades[2];
            const targetZone = finalTrade.zoneData!.zones.find(
                (z) => Math.abs(z.priceLevel - exactPrice) < 0.05
            );

            // EXACT NUMBERS: Volume accumulation
            expect(targetZone!.aggressiveVolume).toBe(37.75); // 10.0 + 15.25 + 12.5
            expect(targetZone!.aggressiveBuyVolume).toBe(37.75); // All buys
            expect(targetZone!.aggressiveSellVolume).toBe(0); // No sells
            expect(targetZone!.tradeCount).toBe(3); // Exactly 3 trades
        });

        it("should split exactly 25.0 buy and 12.75 sell", async () => {
            const exactPrice = 89.15;
            const trades = [
                createExactTrade(exactPrice, 10.0, false), // Buy 10.0 LTC
                createExactTrade(exactPrice, 5.75, true), // Sell 5.75 LTC
                createExactTrade(exactPrice, 15.0, false), // Buy 15.0 LTC
                createExactTrade(exactPrice, 7.0, true), // Sell 7.0 LTC
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            const finalTrade = enrichedTrades[3];
            // Fix: Look for zone by lower boundary, not trade price
            // Price 89.15 belongs to zone with lower boundary 89.10
            const zoneLowerBoundary = 89.1; // exactPrice 89.15 maps to zone 89.10-89.19
            const targetZone = finalTrade.zoneData!.zones.find(
                (z) => Math.abs(z.priceLevel - zoneLowerBoundary) < 0.01
            );

            // EXACT NUMBERS: Buy/sell split
            expect(targetZone!.aggressiveVolume).toBe(37.75); // 10.0 + 5.75 + 15.0 + 7.0
            expect(targetZone!.aggressiveBuyVolume).toBe(25.0); // 10.0 + 15.0
            expect(targetZone!.aggressiveSellVolume).toBe(12.75); // 5.75 + 7.0
            expect(targetZone!.tradeCount).toBe(4); // Exactly 4 trades
        });
    });

    describe("Exact Price Levels", () => {
        it("should place zones at exact price levels", async () => {
            const trade = createExactTrade(89.05, 15.5, false);
            await preprocessor.handleAggTrade(trade);

            const enrichedTrade = enrichedTrades[0];
            const zones = enrichedTrade.zoneData!.zones;

            // Find target zone and validate exact price
            const targetZone = zones.find(
                (z) => Math.abs(z.priceLevel - 89.0) < 0.05 // Zone center is 89.0
            );

            // EXACT NUMBERS: Price level (zone lower boundary)
            expect(targetZone!.priceLevel).toBe(89.0); // 89.05 belongs to zone 89.00-89.09
            expect(targetZone!.tickSize).toBe(0.01);
            expect(targetZone!.boundaries.min).toBe(89.0); // Zone starts at lower boundary
            expect(targetZone!.boundaries.max).toBe(89.09); // Zone ends 9 ticks later
        });

        it("should create zones at exact 10-tick intervals", async () => {
            const trade = createExactTrade(89.05, 10.0, false);
            await preprocessor.handleAggTrade(trade);

            const enrichedTrade = enrichedTrades[0];
            const zones = enrichedTrade.zoneData!.zones;

            // EXACT NUMBERS: Zone prices should be 10 ticks apart (0.10)
            const zonePrices = zones
                .map((z) => z.priceLevel)
                .sort((a, b) => a - b);

            for (let i = 1; i < zonePrices.length; i++) {
                const priceDiff = FinancialMath.calculateSpread(
                    zonePrices[i],
                    zonePrices[i - 1],
                    2
                );
                expect(priceDiff).toBe(0.1); // Exactly 10 ticks = 0.10
            }
        });
    });

    describe("Exact Trade Counts", () => {
        it("should track exactly 1, 2, 3, 4, 5 trades per zone", async () => {
            const exactPrice = 89.2;
            const trades = [
                createExactTrade(exactPrice, 5.0, false),
                createExactTrade(exactPrice, 6.0, false),
                createExactTrade(exactPrice, 7.0, false),
                createExactTrade(exactPrice, 8.0, false),
                createExactTrade(exactPrice, 9.0, false),
            ];

            for (let i = 0; i < trades.length; i++) {
                await preprocessor.handleAggTrade(trades[i]);

                const tradeEvent = enrichedTrades[i];
                const targetZone = tradeEvent.zoneData!.zones.find(
                    (z) => Math.abs(z.priceLevel - exactPrice) < 0.05
                );

                // EXACT NUMBERS: Trade count should increment exactly by 1
                expect(targetZone!.tradeCount).toBe(i + 1);

                // EXACT NUMBERS: Volume should accumulate exactly
                const expectedVolume = 5.0 + 6.0 + 7.0 + 8.0 + 9.0;
                const actualExpectedVolume = trades
                    .slice(0, i + 1)
                    .reduce((sum, t) => sum + parseFloat(t.q), 0);
                expect(targetZone!.aggressiveVolume).toBe(actualExpectedVolume);
            }
        });
    });

    describe("Exact Zone Boundaries", () => {
        it("should create zones with exact boundaries", async () => {
            const trade = createExactTrade(89.05, 10.0, false);
            await preprocessor.handleAggTrade(trade);

            const enrichedTrade = enrichedTrades[0];
            const zones = enrichedTrade.zoneData!.zones;

            // Find zone containing our trade based on boundaries
            const tradePrice = 89.05;
            const targetZone = zones.find(
                (z) =>
                    tradePrice >= z.boundaries.min &&
                    tradePrice <= z.boundaries.max
            );

            // EXACT NUMBERS: Zone boundaries (10-tick zone spans 9 tick intervals)
            expect(
                FinancialMath.calculateSpread(
                    targetZone!.boundaries.max,
                    targetZone!.boundaries.min,
                    2
                )
            ).toBe(0.09); // 9 tick intervals (89.00-89.09 = 0.09)
        });
    });

    describe("Exact Processing Statistics", () => {
        it("should track exactly 5 processed trades", async () => {
            const trades = [
                createExactTrade(89.0, 10.0, false),
                createExactTrade(89.01, 11.0, false),
                createExactTrade(89.02, 12.0, false),
                createExactTrade(89.03, 13.0, false),
                createExactTrade(89.04, 14.0, false),
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            const stats = preprocessor.getStats();

            // EXACT NUMBERS: Processing statistics
            expect(stats.processedTrades).toBe(5);
            expect(stats.processedDepthUpdates).toBe(0);
            expect(enrichedTrades.length).toBe(5);
        });
    });

    describe("Exact Large Trade Handling", () => {
        it("should handle exactly 150.0 LTC large trade", async () => {
            const largeTrade = createExactTrade(89.0, 150.0, false);
            await preprocessor.handleAggTrade(largeTrade);

            const tradeEvent = enrichedTrades[0];

            // EXACT NUMBERS: Large trade
            expect(tradeEvent.quantity).toBe(150.0);
            expect(tradeEvent.depthSnapshot).toBeTruthy(); // Should have depth snapshot

            const targetZone = tradeEvent.zoneData!.zones.find(
                (z) => Math.abs(z.priceLevel - 89.0) < 0.05
            );

            expect(targetZone!.aggressiveVolume).toBe(150.0);
            expect(targetZone!.tradeCount).toBe(1);
        });
    });

    function createExactTrade(
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
            a: tradeId,
            p: price.toFixed(2),
            q: quantity.toFixed(8),
            f: tradeId - 1,
            l: tradeId + 1,
            T: timestamp,
            m: buyerIsMaker,
            M: true,
        };
    }
});
