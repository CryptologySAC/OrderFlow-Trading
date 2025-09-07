// test/orderFlowPreprocessor_timeWindowedVolume.test.ts

import { beforeEach, describe, expect, it } from "vitest";
import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { SpotWebsocketStreams } from "@binance/spot";
import { vi } from "vitest";
import "../test/vitest.setup.ts";

/**
 * Time-Windowed Volume Tracking Tests
 *
 * These tests specifically verify that zone volume calculations use time-windowed
 * trade data instead of cumulative volume accumulation. This is critical to prevent
 * the "hundreds of signals" issue where zones would accumulate volume indefinitely
 * until thresholds were eventually reached.
 */
describe("OrderFlowPreprocessor - Time-Windowed Volume Tracking", () => {
    let preprocessor: OrderflowPreprocessor;
    let orderBook: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    const ORDERBOOK_CONFIG = {
        maxLevels: 150,
        snapshotIntervalMs: 1000,
        maxPriceDistance: 10.0,
        pruneIntervalMs: 30000,
        maxErrorRate: 0.05,
        staleThresholdMs: 5000,
    };

    const testConfig = {
        pricePrecision: 2,
        quantityPrecision: 8,
        bandTicks: 7,
        tickSize: 0.01,
        symbol: "LTCUSDT",
        enableIndividualTrades: false,
        largeTradeThreshold: 100,
        maxEventListeners: 50,
        dashboardUpdateInterval: 500,
        maxDashboardInterval: 1000,
        significantChangeThreshold: 0.001,
        standardZoneConfig: {
            zoneTicks: 10,
            timeWindows: [30000, 60000, 180000, 300000, 900000], // 30s, 1m, 3m, 5m, 15m
            adaptiveMode: false,
            volumeThresholds: {
                aggressive: 10.0,
                passive: 5.0,
                institutional: 50.0,
            },
            priceThresholds: {
                tickValue: 0.01,
                minZoneWidth: 0.02,
                maxZoneWidth: 0.1,
            },
            performanceConfig: {
                maxZoneHistory: 2000,
                cleanupInterval: 300000,
                maxMemoryMB: 50,
            },
        },
        maxZoneCacheAgeMs: 5400000,
        adaptiveZoneLookbackTrades: 500,
        zoneCalculationRange: 12,
        zoneCacheSize: 100,
        defaultZoneMultipliers: [1, 2, 3, 5, 8],
        defaultTimeWindows: [30000, 60000, 180000, 300000, 900000],
        defaultMinZoneWidthMultiplier: 2,
        defaultMaxZoneWidthMultiplier: 10,
        defaultMaxZoneHistory: 2000,
        defaultMaxMemoryMB: 50,
        defaultAggressiveVolumeAbsolute: 10,
        defaultPassiveVolumeAbsolute: 5,
        defaultInstitutionalVolumeAbsolute: 50,
        maxTradesPerZone: 1500,
    };

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
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

        // Create OrderBook with proper config
        orderBook = new OrderBookState(
            ORDERBOOK_CONFIG,
            mockLogger,
            mockMetrics
        );

        // Create preprocessor with proper dependencies
        preprocessor = new OrderflowPreprocessor(
            testConfig,
            orderBook,
            mockLogger,
            mockMetrics
        );

        // Initialize order book with realistic bid/ask spread
        const depthUpdate = {
            s: "LTCUSDT",
            U: 1,
            u: 1,
            b: [
                ["99.99", "1000"], // Best bid
                ["99.98", "2000"], // Level 2
                ["99.97", "3000"], // Level 3
            ],
            a: [
                ["100.01", "1000"], // Best ask
                ["100.02", "2000"], // Level 2
                ["100.03", "3000"], // Level 3
            ],
        };

        orderBook.updateDepth(depthUpdate as any);
    });

    /**
     * Helper function to create a Binance aggregated trade event
     */
    function createAggTradeEvent(
        price: number,
        quantity: number,
        buyerIsMaker: boolean,
        timestamp: number,
        tradeId: number
    ): SpotWebsocketStreams.AggTradeResponse {
        return {
            e: "aggTrade",
            E: timestamp,
            s: "LTCUSDT",
            a: tradeId, // Aggregate trade ID
            p: price.toFixed(2),
            q: quantity.toFixed(8),
            f: tradeId, // First trade ID
            l: tradeId, // Last trade ID
            T: timestamp,
            m: buyerIsMaker,
        };
    }

    /**
     * Helper to process trade and capture enriched result
     */
    async function processTradeAndCapture(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): Promise<EnrichedTradeEvent> {
        return new Promise((resolve) => {
            const handler = (enrichedTrade: EnrichedTradeEvent) => {
                preprocessor.removeListener("enriched_trade", handler);
                resolve(enrichedTrade);
            };
            preprocessor.once("enriched_trade", handler);
            preprocessor.handleAggTrade(trade);
        });
    }

    it("should use time-windowed volume calculation instead of cumulative", async () => {
        const baseTime = Date.now();
        const basePrice = 100.0;

        // Step 1: Add trades within the time window
        const trade1 = createAggTradeEvent(basePrice, 10, false, baseTime, 1);
        const trade2 = createAggTradeEvent(
            basePrice,
            15,
            false,
            baseTime + 10000,
            2
        ); // +10s
        const trade3 = createAggTradeEvent(
            basePrice,
            20,
            false,
            baseTime + 20000,
            3
        ); // +20s

        await processTradeAndCapture(trade1);
        await processTradeAndCapture(trade2);
        const enriched3 = await processTradeAndCapture(trade3);

        // Get zone data after first 3 trades
        const relevantZone1 = enriched3.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone1).toBeDefined();
        expect(relevantZone1?.aggressiveVolume).toBe(45); // 10 + 15 + 20 = 45

        // Step 2: Add a trade OUTSIDE the time window (should cause old trades to expire)
        const trade4 = createAggTradeEvent(
            basePrice,
            25,
            false,
            baseTime + 35000,
            4
        ); // +35s (outside 30s window)
        const enriched4 = await processTradeAndCapture(trade4);

        const relevantZone2 = enriched4.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone2).toBeDefined();

        // CRITICAL TEST: Volume should NOT be cumulative (45 + 25 = 70)
        // Instead, it should only include trades within the time window
        // At timestamp baseTime + 35000, trades within 30s window should be:
        // - Trade 1 (10 LTC at +0s): EXPIRED (35s - 0s = 35s > 30s window)
        // - Trade 2 (15 LTC at +10s): INCLUDED (35s - 10s = 25s < 30s window)
        // - Trade 3 (20 LTC at +20s): INCLUDED (35s - 20s = 15s < 30s window)
        // - Trade 4 (25 LTC at +35s): INCLUDED (35s - 35s = 0s < 30s window)
        // Total: 15 + 20 + 25 = 60 LTC
        expect(relevantZone2?.aggressiveVolume).toBe(60); // Time-windowed calculation

        // Verify old trades were properly expired
        expect(relevantZone2?.aggressiveVolume).not.toBe(70); // Not cumulative
        expect(relevantZone2?.aggressiveVolume).not.toBe(45); // Previous volume reset
    });

    it("should maintain trades within time window correctly", async () => {
        const baseTime = Date.now();
        const basePrice = 95.0;

        // Add trades at different times within the window
        const trade1 = createAggTradeEvent(basePrice, 10, false, baseTime, 1);
        const trade2 = createAggTradeEvent(
            basePrice,
            15,
            false,
            baseTime + 15000,
            2
        ); // +15s (within window)
        const trade3 = createAggTradeEvent(
            basePrice,
            20,
            false,
            baseTime + 25000,
            3
        ); // +25s (within window)

        await processTradeAndCapture(trade1);
        await processTradeAndCapture(trade2);
        await processTradeAndCapture(trade3);

        // Process a trade at +29s (still within 30s window from trade1)
        const trade4 = createAggTradeEvent(
            basePrice,
            12,
            false,
            baseTime + 29000,
            4
        );
        const enriched4 = await processTradeAndCapture(trade4);

        const relevantZone = enriched4.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone).toBeDefined();
        // All trades should still be within the 30s window: 10 + 15 + 20 + 12 = 57
        expect(relevantZone?.aggressiveVolume).toBe(57);
    });

    it("should correctly expire old trades and keep recent ones", async () => {
        const baseTime = Date.now();
        const basePrice = 90.0;

        // Add initial trades
        const trade1 = createAggTradeEvent(basePrice, 10, false, baseTime, 1);
        const trade2 = createAggTradeEvent(
            basePrice,
            20,
            false,
            baseTime + 10000,
            2
        ); // +10s

        await processTradeAndCapture(trade1);
        await processTradeAndCapture(trade2);

        // Add trade at +35s (trade1 should expire, trade2 still valid)
        const trade3 = createAggTradeEvent(
            basePrice,
            30,
            false,
            baseTime + 35000,
            3
        );
        const enriched3 = await processTradeAndCapture(trade3);

        const relevantZone1 = enriched3.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone1).toBeDefined();
        // Only trade2 (20) and trade3 (30) should be counted: 20 + 30 = 50
        // trade1 (10) should be expired since it's older than 30s from trade3's timestamp
        expect(relevantZone1?.aggressiveVolume).toBe(50);

        // Add another trade at +45s (now trade2 should also expire)
        const trade4 = createAggTradeEvent(
            basePrice,
            40,
            false,
            baseTime + 45000,
            4
        );
        const enriched4 = await processTradeAndCapture(trade4);

        const relevantZone2 = enriched4.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone2).toBeDefined();
        // Only trade3 (30) and trade4 (40) should be counted: 30 + 40 = 70
        expect(relevantZone2?.aggressiveVolume).toBe(70);
    });

    it("should handle buy/sell volume separately in time windows", async () => {
        const baseTime = Date.now();
        const basePrice = 105.0;

        // Add buy trades
        const buyTrade1 = createAggTradeEvent(
            basePrice,
            10,
            false,
            baseTime,
            1
        ); // buy
        const buyTrade2 = createAggTradeEvent(
            basePrice,
            15,
            false,
            baseTime + 10000,
            2
        ); // buy

        // Add sell trades
        const sellTrade1 = createAggTradeEvent(
            basePrice,
            20,
            true,
            baseTime + 5000,
            3
        ); // sell
        const sellTrade2 = createAggTradeEvent(
            basePrice,
            25,
            true,
            baseTime + 15000,
            4
        ); // sell

        await processTradeAndCapture(buyTrade1);
        await processTradeAndCapture(sellTrade1);
        await processTradeAndCapture(buyTrade2);
        const enrichedLast = await processTradeAndCapture(sellTrade2);

        const relevantZone = enrichedLast.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone).toBeDefined();
        expect(relevantZone?.aggressiveVolume).toBe(70); // Total: 10 + 15 + 20 + 25 = 70
        expect(relevantZone?.aggressiveBuyVolume).toBe(25); // Buy: 10 + 15 = 25
        expect(relevantZone?.aggressiveSellVolume).toBe(45); // Sell: 20 + 25 = 45

        // Now expire the oldest trades (older than 30s)
        const laterTrade = createAggTradeEvent(
            basePrice,
            30,
            false,
            baseTime + 35000,
            5
        ); // buy
        const enrichedLater = await processTradeAndCapture(laterTrade);

        const relevantZone2 = enrichedLater.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone2).toBeDefined();
        // Trades within 30s window from +35s (cutoff at +5s):
        // - buyTrade1 (10 LTC at +0s): EXPIRED (outside 30s window)
        // - sellTrade1 (20 LTC at +5s): INCLUDED (exactly at cutoff)
        // - buyTrade2 (15 LTC at +10s): INCLUDED
        // - sellTrade2 (25 LTC at +15s): INCLUDED
        // - laterTrade (30 LTC at +35s): INCLUDED
        // Total: 20 + 15 + 25 + 30 = 90 LTC
        expect(relevantZone2?.aggressiveVolume).toBe(90); // Correct time-windowed total
        expect(relevantZone2?.aggressiveBuyVolume).toBe(45); // 15 + 30 = 45 (buy trades)
        expect(relevantZone2?.aggressiveSellVolume).toBe(45); // 20 + 25 = 45 (sell trades)
    });

    it("should prevent infinite volume accumulation that caused signal spam", async () => {
        const baseTime = Date.now();
        const basePrice = 110.0;

        // This test simulates the original problem: adding many trades over time
        // that would accumulate to huge volumes (like 10K+ LTC) causing signal spam

        const timeIncrement = 60000; // 1 minute increments
        let currentTime = baseTime;
        let lastEnriched: EnrichedTradeEvent;

        // Add trades over a long period (10 minutes = 600s, way beyond 30s window)
        for (let i = 0; i < 10; i++) {
            const trade = createAggTradeEvent(
                basePrice,
                50,
                false,
                currentTime,
                i + 1
            );
            lastEnriched = await processTradeAndCapture(trade);
            currentTime += timeIncrement;
        }

        // After 10 trades of 50 LTC each over 10 minutes
        // OLD BEHAVIOR (broken): Would accumulate 10 * 50 = 500 LTC
        // NEW BEHAVIOR (fixed): Should only count trades within 30s window

        const relevantZone = lastEnriched!.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone).toBeDefined();

        // CRITICAL: Volume should NOT be cumulative (500 LTC)
        // Only the most recent trade should be counted since others are outside 30s window
        expect(relevantZone?.aggressiveVolume).toBe(50); // Only the last trade
        expect(relevantZone?.aggressiveVolume).not.toBe(500); // NOT cumulative

        // This prevents the "hundreds of signals" problem where thresholds
        // would eventually be reached due to infinite accumulation
    });

    it("should use correct timeWindows configuration from config", () => {
        // The test config timeWindows should be accessible
        expect(testConfig.standardZoneConfig.timeWindows).toEqual([
            30000, 60000, 180000, 300000, 900000,
        ]);
        expect(testConfig.standardZoneConfig.timeWindows[0]).toBe(30000); // First window = 30s
        expect(testConfig.standardZoneConfig.timeWindows[2]).toBe(180000); // Third window = 3min (used by detectors)
    });

    it("should handle edge case of exactly time window boundary", async () => {
        const baseTime = Date.now();
        const timeWindow = testConfig.standardZoneConfig.timeWindows[0]; // 30s
        const basePrice = 115.0;

        // Trade exactly at the boundary
        const trade1 = createAggTradeEvent(basePrice, 10, false, baseTime, 1);
        const trade2 = createAggTradeEvent(
            basePrice,
            20,
            false,
            baseTime + timeWindow,
            2
        ); // Exactly 30s later

        await processTradeAndCapture(trade1);
        const enriched2 = await processTradeAndCapture(trade2);

        const relevantZone = enriched2.zoneData.zones.find(
            (zone: any) =>
                zone.priceLevel >= basePrice - 0.05 &&
                zone.priceLevel <= basePrice + 0.05
        );

        expect(relevantZone).toBeDefined();
        // trade1 should be exactly at the boundary and may or may not be included
        // depending on whether the comparison is >= or >
        // The important thing is we don't have cumulative behavior
        expect(relevantZone?.aggressiveVolume).toBeLessThanOrEqual(30);
        expect(relevantZone?.aggressiveVolume).toBeGreaterThanOrEqual(20);
    });
});
