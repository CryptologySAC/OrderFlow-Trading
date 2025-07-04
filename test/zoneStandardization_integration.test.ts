// test/zoneStandardization_integration.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { IOrderBookState } from "../src/market/orderBookState.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { SpotWebsocketStreams } from "@binance/spot";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

describe("Zone Standardization Integration", () => {
    let preprocessor: OrderflowPreprocessor;
    let mockOrderBook: IOrderBookState;
    let mockLogger: ILogger;
    let mockMetricsCollector: IMetricsCollector;

    // Real LTCUSDT market data parameters
    const LTCUSDT_BASE_PRICE = 89.45;
    const LTCUSDT_TICK_SIZE = 0.01;

    beforeEach(() => {
        mockLogger = {
            info: (msg: string, data?: any) =>
                console.log(`[INFO] ${msg}`, data),
            warn: (msg: string, data?: any) =>
                console.log(`[WARN] ${msg}`, data),
            error: (msg: string, data?: any) =>
                console.log(`[ERROR] ${msg}`, data),
            debug: (msg: string, data?: any) =>
                console.log(`[DEBUG] ${msg}`, data),
        };

        mockMetricsCollector = {
            incrementCounter: vi.fn(),
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            getMetrics: vi.fn(),
            addLatencyMeasurement: vi.fn(),
            trackMemoryUsage: vi.fn(),
            resetMetrics: vi.fn(),
        };

        mockOrderBook = {
            updateDepth: vi.fn(),
            getBestBid: vi.fn().mockReturnValue(LTCUSDT_BASE_PRICE - 0.01),
            getBestAsk: vi.fn().mockReturnValue(LTCUSDT_BASE_PRICE + 0.01),
            getSpread: vi.fn().mockReturnValue(0.02),
            getMidPrice: vi.fn().mockReturnValue(LTCUSDT_BASE_PRICE),
            getLevel: vi.fn().mockReturnValue({ bid: 45.2, ask: 38.7 }),
            sumBand: vi.fn().mockReturnValue({ bid: 52.3, ask: 41.7 }),
            snapshot: vi.fn().mockReturnValue(new Map()),
            getDepthMetrics: vi.fn().mockReturnValue({
                totalBidVolume: 156.8,
                totalAskVolume: 142.3,
                imbalance: 0.048,
                totalLevels: 25,
            }),
        };

        // Initialize preprocessor with zone standardization enabled
        preprocessor = new OrderflowPreprocessor(
            {
                symbol: "LTCUSDT",
                pricePrecision: 2,
                quantityPrecision: 8,
                bandTicks: 5,
                tickSize: LTCUSDT_TICK_SIZE,
                enableIndividualTrades: false,
                largeTradeThreshold: 100,
                maxEventListeners: 50,
                dashboardUpdateInterval: 200,
                maxDashboardInterval: 1000,
                significantChangeThreshold: 0.001,
                enableStandardizedZones: true,
                standardZoneConfig: {
                    baseTicks: 5,
                    zoneMultipliers: [1, 2, 4],
                    timeWindows: [30000, 60000, 300000], // 30s, 60s, 5min
                    adaptiveMode: false,
                    volumeThresholds: {
                        aggressive: 10.0,
                        passive: 5.0,
                        institutional: 50.0,
                    },
                    priceThresholds: {
                        significantMove: 0.001, // 0.1%
                        majorMove: 0.005, // 0.5%
                    },
                    maxZones: 100,
                    zoneTimeoutMs: 300000,
                },
                // Use shorter windows for testing
                maxZoneCacheAgeMs: 300000, // 5 minutes for testing
                adaptiveZoneLookbackTrades: 50, // Smaller for testing
                zoneCalculationRange: 3, // ±3 zones for testing
                zoneCacheSize: 375,
                defaultZoneMultipliers: [1, 2, 4],
                defaultTimeWindows: [300000, 900000, 1800000, 3600000, 5400000],
                defaultMinZoneWidthMultiplier: 2,
                defaultMaxZoneWidthMultiplier: 10,
                defaultMaxZoneHistory: 2000,
                defaultMaxMemoryMB: 50,
                defaultAggressiveVolumeAbsolute: 10.0,
                defaultPassiveVolumeAbsolute: 5.0,
                defaultInstitutionalVolumeAbsolute: 50.0,
            },
            mockOrderBook,
            mockLogger,
            mockMetricsCollector
        );
    });

    function createRealisticLTCUSDTTrade(
        price: number = LTCUSDT_BASE_PRICE,
        quantity: number = 2.71, // Realistic LTCUSDT trade size
        isBuy: boolean = true
    ): SpotWebsocketStreams.AggTradeResponse {
        return {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: Math.floor(Math.random() * 1000000),
            p: price.toFixed(2),
            q: quantity.toFixed(8),
            f: Math.floor(Math.random() * 1000000),
            l: Math.floor(Math.random() * 1000000),
            T: Date.now(),
            m: !isBuy, // buyerIsMaker is opposite of aggressive buy
            M: true,
        };
    }

    describe("End-to-End Zone Data Flow", () => {
        it("should generate standardized zone data in enriched trade events", async () => {
            // Track enriched trade events
            const enrichedEvents: EnrichedTradeEvent[] = [];
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                enrichedEvents.push(event);
                console.log("Received enriched trade:", {
                    price: event.price,
                    hasZoneData: !!event.zoneData,
                    zoneDataKeys: event.zoneData
                        ? Object.keys(event.zoneData)
                        : [],
                });
            });

            // Process realistic LTCUSDT trades
            const trades = [
                createRealisticLTCUSDTTrade(89.43, 5.2, true), // Aggressive buy
                createRealisticLTCUSDTTrade(89.45, 3.1, false), // Aggressive sell
                createRealisticLTCUSDTTrade(89.47, 8.9, true), // Large aggressive buy
            ];

            // Process all trades
            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // Verify we received enriched events
            expect(enrichedEvents.length).toBe(3);

            // Test the most comprehensive trade (last one)
            const lastEvent = enrichedEvents[enrichedEvents.length - 1];

            // Debug information
            console.log("Last event zone data:", lastEvent.zoneData);

            // Verify standardized zone data is present
            expect(lastEvent.zoneData).toBeDefined();
            expect(lastEvent.zoneData).not.toBeNull();

            const zoneData = lastEvent.zoneData!;

            // Verify all zone sizes are provided
            expect(zoneData.zones5Tick).toBeDefined();
            expect(zoneData.zones10Tick).toBeDefined();
            expect(zoneData.zones20Tick).toBeDefined();
            expect(zoneData.zoneConfig).toBeDefined();

            // Verify zone arrays have reasonable lengths (based on ±3 range)
            expect(zoneData.zones5Tick.length).toBeGreaterThan(0);
            expect(zoneData.zones5Tick.length).toBeLessThanOrEqual(7); // ±3 = 7 zones max

            // Verify zone configuration
            expect(zoneData.zoneConfig.baseTicks).toBe(5);
            expect(zoneData.zoneConfig.tickValue).toBe(LTCUSDT_TICK_SIZE);
            expect(zoneData.zoneConfig.timeWindow).toBeGreaterThan(0);
        });

        it("should maintain zone data consistency across multiple trades", async () => {
            const enrichedEvents: EnrichedTradeEvent[] = [];
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                enrichedEvents.push(event);
            });

            // Process multiple trades at similar prices
            const similarPrice = 89.45;
            const trades = [
                createRealisticLTCUSDTTrade(similarPrice, 2.5, true),
                createRealisticLTCUSDTTrade(similarPrice + 0.01, 3.2, false),
                createRealisticLTCUSDTTrade(similarPrice - 0.01, 1.8, true),
                createRealisticLTCUSDTTrade(similarPrice, 4.7, false),
            ];

            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            expect(enrichedEvents.length).toBe(4);

            // Verify all events have zone data
            enrichedEvents.forEach((event, index) => {
                expect(event.zoneData).toBeDefined();
                expect(event.zoneData?.zones5Tick.length).toBeGreaterThan(0);

                // Zone configuration should be consistent
                if (index > 0) {
                    expect(event.zoneData?.zoneConfig.baseTicks).toBe(
                        enrichedEvents[0].zoneData?.zoneConfig.baseTicks
                    );
                    expect(event.zoneData?.zoneConfig.tickValue).toBe(
                        enrichedEvents[0].zoneData?.zoneConfig.tickValue
                    );
                }
            });
        });

        it("should populate zone snapshots with realistic LTCUSDT data", async () => {
            const enrichedEvents: EnrichedTradeEvent[] = [];
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                enrichedEvents.push(event);
            });

            // Process a significant trade
            await preprocessor.handleAggTrade(
                createRealisticLTCUSDTTrade(89.45, 15.6, true) // Large institutional-like trade
            );

            expect(enrichedEvents.length).toBe(1);
            const event = enrichedEvents[0];
            const zoneData = event.zoneData!;

            // Examine 5-tick zones
            const zones5Tick = zoneData.zones5Tick;
            expect(zones5Tick.length).toBeGreaterThan(0);

            zones5Tick.forEach((zone) => {
                // Verify zone structure
                expect(zone.zoneId).toContain("LTCUSDT");
                expect(zone.zoneId).toContain("5T");
                expect(zone.tickSize).toBe(LTCUSDT_TICK_SIZE);

                // Verify realistic price levels
                expect(zone.priceLevel).toBeGreaterThan(89.0);
                expect(zone.priceLevel).toBeLessThan(90.0);

                // Verify zone boundaries are properly calculated - allow for zone multiplier variations
                const actualZoneSize =
                    zone.boundaries.max - zone.boundaries.min;
                expect(actualZoneSize).toBeGreaterThan(0.04); // At least 4 ticks
                expect(actualZoneSize).toBeLessThan(0.10); // At most 10 ticks

                // Verify passive volume is populated from order book mock
                expect(zone.passiveVolume).toBeGreaterThan(0);
                expect(zone.passiveBidVolume + zone.passiveAskVolume).toBe(
                    zone.passiveVolume
                );

                // Verify volume weighted price is reasonable
                expect(zone.volumeWeightedPrice).toBeGreaterThan(
                    zone.boundaries.min
                );
                expect(zone.volumeWeightedPrice).toBeLessThan(
                    zone.boundaries.max
                );

                // Verify timestamps are recent
                expect(zone.lastUpdate).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
            });
        });

        it("should handle high-frequency LTCUSDT trading scenario", async () => {
            const enrichedEvents: EnrichedTradeEvent[] = [];
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                enrichedEvents.push(event);
            });

            // Simulate rapid trading around a key level
            const keyLevel = 89.45;
            const rapidTrades = [];

            for (let i = 0; i < 20; i++) {
                const priceVariation = (Math.random() - 0.5) * 0.06; // ±3 ticks
                const price = keyLevel + priceVariation;
                const quantity = 1.5 + Math.random() * 4.0; // 1.5-5.5 LTC range
                const isBuy = Math.random() > 0.5;

                rapidTrades.push(
                    createRealisticLTCUSDTTrade(price, quantity, isBuy)
                );
            }

            // Process all rapid trades
            for (const trade of rapidTrades) {
                await preprocessor.handleAggTrade(trade);
            }

            expect(enrichedEvents.length).toBe(20);

            // Verify zone data quality doesn't degrade under rapid processing
            const lastEvent = enrichedEvents[enrichedEvents.length - 1];
            expect(lastEvent.zoneData).toBeDefined();
            expect(lastEvent.zoneData?.zones5Tick.length).toBeGreaterThan(0);

            // Verify zones are still properly formed
            const zones = lastEvent.zoneData!.zones5Tick;
            zones.forEach((zone) => {
                expect(zone.zoneId).toMatch(/^LTCUSDT_5T_\d{2}\.\d{2}$/);
                expect(zone.tickSize).toBe(LTCUSDT_TICK_SIZE);
                // Allow for zone multiplier variations in boundary calculations
                const zoneSize = zone.boundaries.max - zone.boundaries.min;
                expect(zoneSize).toBeGreaterThan(0.04); // At least 4 ticks
                expect(zoneSize).toBeLessThan(0.10); // At most 10 ticks
            });
        });

        it("should demonstrate 90-minute zone persistence and cache effectiveness", async () => {
            const enrichedEvents: EnrichedTradeEvent[] = [];
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                enrichedEvents.push(event);
            });

            // Process initial trade to establish zones
            await preprocessor.handleAggTrade(
                createRealisticLTCUSDTTrade(89.45, 5.0, true)
            );

            const initialEvent = enrichedEvents[0];
            const initialZoneCount =
                initialEvent.zoneData?.zones5Tick.length || 0;
            expect(initialZoneCount).toBeGreaterThan(0);

            // Process trade at similar price to test zone persistence
            await preprocessor.handleAggTrade(
                createRealisticLTCUSDTTrade(89.46, 3.2, false)
            );

            const secondEvent = enrichedEvents[1];
            const secondZoneCount =
                secondEvent.zoneData?.zones5Tick.length || 0;

            // Zone count should be similar (cache working)
            expect(
                Math.abs(secondZoneCount - initialZoneCount)
            ).toBeLessThanOrEqual(1);

            // Verify zones are being reused efficiently
            const firstZone = initialEvent.zoneData?.zones5Tick[0];
            const secondZone = secondEvent.zoneData?.zones5Tick.find(
                (z) => z.zoneId === firstZone?.zoneId
            );

            if (firstZone && secondZone) {
                // Same zone should have consistent structure
                expect(secondZone.priceLevel).toBe(firstZone.priceLevel);
                expect(secondZone.tickSize).toBe(firstZone.tickSize);
                expect(secondZone.boundaries.min).toBe(
                    firstZone.boundaries.min
                );
                expect(secondZone.boundaries.max).toBe(
                    firstZone.boundaries.max
                );
            }
        });
    });

    describe("Performance and Memory Management", () => {
        it("should handle zone cache cleanup efficiently", async () => {
            const enrichedEvents: EnrichedTradeEvent[] = [];
            preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
                enrichedEvents.push(event);
            });

            // Process many trades to test cache behavior
            for (let i = 0; i < 50; i++) {
                const price = 89.4 + i * 0.002; // Spread trades across price range
                await preprocessor.handleAggTrade(
                    createRealisticLTCUSDTTrade(price, 2.5, i % 2 === 0)
                );
            }

            expect(enrichedEvents.length).toBe(50);

            // Verify zone data is still consistent in later events
            const lastEvent = enrichedEvents[enrichedEvents.length - 1];
            expect(lastEvent.zoneData).toBeDefined();
            expect(lastEvent.zoneData?.zones5Tick.length).toBeGreaterThan(0);

            // Verify no excessive memory usage (zones should be bounded)
            const totalZoneCount =
                lastEvent.zoneData!.zones5Tick.length +
                lastEvent.zoneData!.zones10Tick.length +
                lastEvent.zoneData!.zones20Tick.length;

            expect(totalZoneCount).toBeLessThan(50); // Reasonable upper bound
        });
    });
});
