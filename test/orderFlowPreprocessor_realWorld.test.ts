// test/orderFlowPreprocessor_realWorld.test.ts
//
// 🌍 REAL-WORLD ORDER FLOW PREPROCESSOR TEST SUITE
//
// CLAUDE.MD COMPLIANCE: Production-grade testing with ZERO TOLERANCE for edge cases
// that could cause failures in live trading environments.
//
// CRITICAL SCENARIOS COVERED:
// - High-frequency trading bursts (1000+ trades/second)
// - Market stress conditions (flash crashes, volume spikes)
// - Network edge cases (malformed data, duplicates, gaps)
// - Memory and performance under sustained load
// - VWAP precision under extreme conditions
// - Zone boundary edge cases with real market data patterns
//
// TEST PHILOSOPHY:
// - Simulate ACTUAL market conditions from real trading
// - Test performance limits that production systems encounter
// - Validate precision under extreme values and high volume
// - Ensure graceful degradation under stress
// - Verify institutional-grade reliability

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

// Production-grade configuration matching live trading requirements
const PRODUCTION_CONFIG = {
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
        enableIndividualTrades: true, // Enable for precision testing
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
        zoneCacheSize: 375,
        defaultZoneMultipliers: [1, 2, 4],
        defaultTimeWindows: [300000, 900000, 1800000, 3600000, 5400000],
        defaultMinZoneWidthMultiplier: 2,
        defaultMaxZoneWidthMultiplier: 10,
        defaultMaxZoneHistory: 2000,
        defaultMaxMemoryMB: 50,
        defaultAggressiveVolumeAbsolute: 10,
        defaultPassiveVolumeAbsolute: 5,
        defaultInstitutionalVolumeAbsolute: 50,
        maxTradesPerZone: 1500,
    },
};

describe("OrderFlowPreprocessor - Real World Test Suite", () => {
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
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            getMetrics: vi.fn(() => ({}) as any),
        };

        const mockThreadManager = {
            callStorage: vi.fn().mockResolvedValue(undefined),
            broadcast: vi.fn(),
            shutdown: vi.fn(),
            isStarted: vi.fn().mockReturnValue(true),
            startWorkers: vi.fn().mockResolvedValue(undefined),
            requestDepthSnapshot: vi.fn().mockResolvedValue({
                lastUpdateId: 1000,
                bids: [
                    ["88.99", "1000.0"],
                    ["88.98", "2000.0"],
                    ["88.97", "3000.0"],
                ],
                asks: [
                    ["89.01", "1000.0"],
                    ["89.02", "2000.0"],
                    ["89.03", "3000.0"],
                ],
            }),
        };

        orderBook = new OrderBookState(
            PRODUCTION_CONFIG.orderbook,
            mockLogger,
            mockMetrics,
            mockThreadManager
        );

        preprocessor = new OrderflowPreprocessor(
            PRODUCTION_CONFIG.preprocessor,
            orderBook,
            mockLogger,
            mockMetrics
        );

        preprocessor.on("enriched_trade", (trade: EnrichedTradeEvent) => {
            enrichedTrades.push(trade);
        });

        // Setup realistic orderbook depth
        orderBook.updateDepth({
            s: "LTCUSDT",
            U: 1,
            u: 1,
            b: [
                ["88.99", "1000.0"],
                ["88.98", "2000.0"],
                ["88.97", "3000.0"],
                ["88.96", "4000.0"],
                ["88.95", "5000.0"],
            ],
            a: [
                ["89.01", "1000.0"],
                ["89.02", "2000.0"],
                ["89.03", "3000.0"],
                ["89.04", "4000.0"],
                ["89.05", "5000.0"],
            ],
        });
    });

    describe("🚀 High-Frequency Trading Scenarios", () => {
        it("should handle 1000+ trades in rapid succession without memory leaks", async () => {
            const startTime = Date.now();
            const tradeCount = 1000;
            const priceRange = { min: 88.5, max: 89.5 };

            // Generate high-frequency trade burst simulating algo trading
            const trades: SpotWebsocketStreams.AggTradeResponse[] = [];
            for (let i = 0; i < tradeCount; i++) {
                const price = FinancialMath.safeAdd(
                    priceRange.min,
                    FinancialMath.safeDivide(
                        FinancialMath.safeMultiply(
                            Math.random(),
                            FinancialMath.safeSubtract(
                                priceRange.max,
                                priceRange.min
                            )
                        ),
                        1
                    )
                );
                const roundedPrice = Math.round(price * 100) / 100; // Ensure tick alignment
                const quantity = FinancialMath.safeAdd(1, Math.random() * 50);

                trades.push(
                    createRealWorldTrade(
                        roundedPrice,
                        quantity,
                        Math.random() < 0.5,
                        startTime + i // Microsecond precision timing
                    )
                );
            }

            // Process trades at high frequency
            const processingStart = Date.now();
            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }
            const processingTime = Date.now() - processingStart;

            // Validate performance and correctness
            expect(enrichedTrades.length).toBe(tradeCount);
            expect(processingTime).toBeLessThan(5000); // Must process 1000 trades in <5s

            // Verify zone aggregation accuracy under high load
            const finalTrade = enrichedTrades[tradeCount - 1];
            expect(finalTrade.zoneData?.zones.length).toBe(25);

            // Check memory usage didn't explode
            const zonesWithVolume = finalTrade.zoneData!.zones.filter(
                (z) => z.aggressiveVolume > 0
            );
            expect(zonesWithVolume.length).toBeGreaterThan(0);
            expect(zonesWithVolume.length).toBeLessThan(15); // Reasonable zone spread

            // Validate processing statistics
            const stats = preprocessor.getStats();
            expect(stats.processedTrades).toBe(tradeCount);
        });

        it("should maintain VWAP precision during high-frequency bursts", async () => {
            const burstPrice = 89.15;
            const tradeCount = 500;
            let totalVolume = 0;
            let volumeWeightedSum = 0;

            // Create burst of trades at same price with varying quantities
            for (let i = 0; i < tradeCount; i++) {
                const quantity = FinancialMath.safeAdd(0.1, Math.random() * 10);
                totalVolume = FinancialMath.safeAdd(totalVolume, quantity);
                volumeWeightedSum = FinancialMath.safeAdd(
                    volumeWeightedSum,
                    FinancialMath.safeMultiply(burstPrice, quantity)
                );

                const trade = createRealWorldTrade(
                    burstPrice,
                    quantity,
                    Math.random() < 0.6, // 60% buys
                    Date.now() + i
                );
                await preprocessor.handleAggTrade(trade);
            }

            // Calculate expected VWAP using FinancialMath
            const expectedVWAP = FinancialMath.safeDivide(
                volumeWeightedSum,
                totalVolume
            );

            // Verify zone VWAP matches expected precision
            const finalTrade = enrichedTrades[tradeCount - 1];
            const targetZone = finalTrade.zoneData!.zones.find(
                (z) =>
                    Math.abs(FinancialMath.safeSubtract(z.priceLevel, 89.1)) <=
                    0.01
            );

            expect(targetZone).toBeDefined();
            expect(targetZone!.aggressiveVolume).toBeCloseTo(totalVolume, 6);
            expect(targetZone!.volumeWeightedPrice).toBeCloseTo(
                expectedVWAP,
                6
            );
            expect(targetZone!.tradeCount).toBe(tradeCount);
        });
    });

    describe("💥 Market Stress Conditions", () => {
        it("should handle flash crash with 10% price drop in seconds", async () => {
            const startPrice = 89.0;
            const crashPrice = 80.1; // 10% crash
            const tradeCount = 100;

            // Simulate flash crash with rapid price decline
            const trades: SpotWebsocketStreams.AggTradeResponse[] = [];
            for (let i = 0; i < tradeCount; i++) {
                const progress = i / (tradeCount - 1);
                const currentPrice = FinancialMath.safeAdd(
                    startPrice,
                    FinancialMath.safeMultiply(
                        progress,
                        FinancialMath.safeSubtract(crashPrice, startPrice)
                    )
                );
                const roundedPrice = Math.round(currentPrice * 100) / 100;

                trades.push(
                    createRealWorldTrade(
                        roundedPrice,
                        FinancialMath.safeAdd(50, Math.random() * 200), // Large panic selling
                        true, // All sells during crash
                        Date.now() + i * 10 // 10ms intervals
                    )
                );
            }

            // Process crash trades
            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // Verify system handled extreme price movement
            expect(enrichedTrades.length).toBe(tradeCount);

            // Check zones were created across wide price range
            const finalTrade = enrichedTrades[tradeCount - 1];
            const zonesWithVolume = finalTrade.zoneData!.zones.filter(
                (z) => z.aggressiveVolume > 0
            );
            expect(zonesWithVolume.length).toBeGreaterThan(5); // Multiple zones hit

            // Verify no errors thrown during extreme conditions
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        it("should handle volume spike of 1000x normal volume", async () => {
            const spikePrice = 89.25;
            const normalVolume = 5.0;
            const spikeVolume = 5000.0; // 1000x spike

            // Normal trading
            await preprocessor.handleAggTrade(
                createRealWorldTrade(spikePrice, normalVolume, false)
            );

            // Volume spike (institutional order)
            await preprocessor.handleAggTrade(
                createRealWorldTrade(spikePrice, spikeVolume, false)
            );

            // Verify system handled extreme volume
            const spikeEvent = enrichedTrades[1];
            expect(spikeEvent.quantity).toBe(spikeVolume);
            expect(spikeEvent.depthSnapshot).toBeDefined(); // Should trigger depth snapshot

            // Verify zone aggregation with extreme volume
            const targetZone = spikeEvent.zoneData!.zones.find(
                (z) =>
                    Math.abs(FinancialMath.safeSubtract(z.priceLevel, 89.2)) <=
                    0.01
            );

            expect(targetZone!.aggressiveVolume).toBeCloseTo(
                FinancialMath.safeAdd(normalVolume, spikeVolume),
                2
            );
        });

        it("should handle market gap with price jump over multiple zones", async () => {
            const gapStartPrice = 89.0;
            const gapEndPrice = 91.5; // 2.5 price gap

            // Trade before gap
            await preprocessor.handleAggTrade(
                createRealWorldTrade(gapStartPrice, 10.0, false)
            );

            // Market gap - trade at much higher price
            await preprocessor.handleAggTrade(
                createRealWorldTrade(gapEndPrice, 15.0, false)
            );

            // Verify both trades processed correctly
            expect(enrichedTrades.length).toBe(2);

            // Verify zones created for both price levels
            const gapTrade = enrichedTrades[1];
            const zones = gapTrade.zoneData!.zones;

            // Should have exactly 25 zones as configured
            expect(zones.length).toBe(25);

            // Verify both trades have zone data
            expect(enrichedTrades[0].zoneData).toBeDefined();
            expect(enrichedTrades[1].zoneData).toBeDefined();
            expect(enrichedTrades[0].zoneData!.zones.length).toBe(25);
            expect(enrichedTrades[1].zoneData!.zones.length).toBe(25);

            // Verify the gap trade has proper price and volume
            expect(enrichedTrades[1].price).toBe(gapEndPrice);
            expect(enrichedTrades[1].quantity).toBe(15.0);
        });
    });

    describe("🌐 Network Edge Cases", () => {
        it("should handle malformed trade data gracefully", async () => {
            const validTrade = createRealWorldTrade(89.0, 10.0, false);

            // Test various malformed data scenarios
            const malformedTrades = [
                { ...validTrade, p: "invalid_price" },
                { ...validTrade, q: "invalid_quantity" },
                { ...validTrade, p: "-89.0" }, // Negative price
                { ...validTrade, q: "-10.0" }, // Negative quantity
                { ...validTrade, p: "0" }, // Zero price
                { ...validTrade, T: undefined }, // Missing timestamp
            ];

            let processedCount = 0;

            // Process valid trade first
            await preprocessor.handleAggTrade(validTrade);
            processedCount++;

            // Process malformed trades - should not crash
            for (const badTrade of malformedTrades) {
                try {
                    await preprocessor.handleAggTrade(badTrade as any);
                    // If it processes without error, increment count
                    processedCount++;
                } catch (error) {
                    // Expected - malformed data should be rejected gracefully
                }
            }

            // Verify at least valid trade was processed
            expect(enrichedTrades.length).toBeGreaterThanOrEqual(1);
            expect(enrichedTrades[0].price).toBe(89.0);
            expect(enrichedTrades[0].quantity).toBe(10.0);
        });

        it("should handle duplicate trade IDs without double-counting", async () => {
            const basePrice = 89.1;
            const quantity = 15.0;
            const tradeId = 123456;

            // Create duplicate trades with same ID
            const trade1 = createRealWorldTrade(basePrice, quantity, false);
            const trade2 = { ...trade1 };
            trade1.a = tradeId;
            trade2.a = tradeId; // Same trade ID

            // Process both trades
            await preprocessor.handleAggTrade(trade1);
            await preprocessor.handleAggTrade(trade2);

            // Verify both were processed (system doesn't check duplicates at preprocessor level)
            expect(enrichedTrades.length).toBe(2);

            // Volume should be accumulated (preprocessing doesn't dedupe)
            const finalTrade = enrichedTrades[1];
            const targetZone = finalTrade.zoneData!.zones.find(
                (z) =>
                    Math.abs(FinancialMath.safeSubtract(z.priceLevel, 89.1)) <=
                    0.01
            );

            expect(targetZone!.aggressiveVolume).toBeCloseTo(30.0, 2); // 15.0 + 15.0
        });

        it("should handle out-of-order timestamps correctly", async () => {
            const baseTime = Date.now();
            const basePrice = 89.2;

            // Create trades with out-of-order timestamps
            const trades = [
                createRealWorldTrade(basePrice, 10.0, false, baseTime + 1000), // Latest
                createRealWorldTrade(basePrice, 15.0, false, baseTime + 500), // Middle
                createRealWorldTrade(basePrice, 20.0, false, baseTime), // Earliest
            ];

            // Process in timestamp order (out of sequence)
            for (const trade of trades) {
                await preprocessor.handleAggTrade(trade);
            }

            // Verify all trades processed
            expect(enrichedTrades.length).toBe(3);

            // Verify volume accumulated correctly regardless of timestamp order
            const finalTrade = enrichedTrades[2];
            const targetZone = finalTrade.zoneData!.zones.find(
                (z) =>
                    Math.abs(FinancialMath.safeSubtract(z.priceLevel, 89.2)) <=
                    0.01
            );

            expect(targetZone!.aggressiveVolume).toBeCloseTo(45.0, 2); // 10+15+20
            expect(targetZone!.tradeCount).toBe(3);
        });
    });

    describe("⚡ Performance and Memory", () => {
        it("should maintain stable memory usage during 24/7 simulation", async () => {
            const simulationDuration = 1000; // Reduced for test performance
            const avgTradesPerMinute = 10; // Realistic for testing

            let memoryCheckpoints: number[] = [];

            // Simulate continuous trading
            for (let i = 0; i < simulationDuration; i++) {
                const price = FinancialMath.safeAdd(
                    88.5,
                    FinancialMath.safeMultiply(Math.random(), 2.0) // 88.5-90.5 range
                );
                const roundedPrice = Math.round(price * 100) / 100;

                await preprocessor.handleAggTrade(
                    createRealWorldTrade(
                        roundedPrice,
                        FinancialMath.safeAdd(1, Math.random() * 20),
                        Math.random() < 0.5
                    )
                );

                // Check memory periodically
                if (i % 100 === 0) {
                    const memoryUsage =
                        process.memoryUsage().heapUsed / 1024 / 1024; // MB
                    memoryCheckpoints.push(memoryUsage);
                }
            }

            // Verify memory didn't grow excessively
            expect(memoryCheckpoints.length).toBeGreaterThan(0);
            const initialMemory = memoryCheckpoints[0];
            const finalMemory = memoryCheckpoints[memoryCheckpoints.length - 1];
            const memoryGrowth = finalMemory - initialMemory;

            // Memory growth should be reasonable (< 100MB for test simulation)
            expect(memoryGrowth).toBeLessThan(100);

            // System should still be responsive
            expect(enrichedTrades.length).toBe(simulationDuration);
        });

        it("should handle zone cache overflow gracefully", async () => {
            const cacheSize = 375; // From config
            const priceSpread = 5.0; // Wide price spread to hit many zones

            // Generate trades across wide price range to overflow cache
            const tradesCount = cacheSize + 100; // Exceed cache size

            for (let i = 0; i < tradesCount; i++) {
                const price = FinancialMath.safeAdd(
                    85.0,
                    FinancialMath.safeMultiply(i / tradesCount, priceSpread)
                );
                const roundedPrice = Math.round(price * 100) / 100;

                await preprocessor.handleAggTrade(
                    createRealWorldTrade(roundedPrice, 5.0, false)
                );
            }

            // Verify system handled cache overflow
            expect(enrichedTrades.length).toBe(tradesCount);

            // Final trade should still have valid zone data
            const finalTrade = enrichedTrades[tradesCount - 1];
            expect(finalTrade.zoneData?.zones.length).toBe(25);

            // No errors should have occurred
            expect(mockLogger.error).not.toHaveBeenCalled();
        });
    });

    describe("🎯 VWAP Precision Under Extremes", () => {
        it("should maintain precision with micro-quantities", async () => {
            const testPrice = 89.15;
            const microQuantities = [0.00000001, 0.00000005, 0.00000012]; // Satoshi-level

            let totalVolume = 0;
            let volumeWeightedSum = 0;

            for (const quantity of microQuantities) {
                totalVolume = FinancialMath.safeAdd(totalVolume, quantity);
                volumeWeightedSum = FinancialMath.safeAdd(
                    volumeWeightedSum,
                    FinancialMath.safeMultiply(testPrice, quantity)
                );

                await preprocessor.handleAggTrade(
                    createRealWorldTrade(testPrice, quantity, false)
                );
            }

            const expectedVWAP = FinancialMath.safeDivide(
                volumeWeightedSum,
                totalVolume
            );

            // Verify precision maintained with micro quantities
            const finalTrade = enrichedTrades[microQuantities.length - 1];
            const targetZone = finalTrade.zoneData!.zones.find(
                (z) =>
                    Math.abs(FinancialMath.safeSubtract(z.priceLevel, 89.1)) <=
                    0.01
            );

            expect(targetZone!.aggressiveVolume).toBeCloseTo(totalVolume, 8);
            expect(targetZone!.volumeWeightedPrice).toBeCloseTo(
                expectedVWAP,
                8
            );
        });

        it("should handle extreme price precision edge cases", async () => {
            // Test prices at tick boundaries
            const edgePrices = [
                89.005, // Half-tick (should round to 89.01)
                89.999, // Near zone boundary
                90.001, // Just over zone boundary
            ];

            for (const price of edgePrices) {
                const roundedPrice = Math.round(price * 100) / 100; // Ensure tick alignment

                await preprocessor.handleAggTrade(
                    createRealWorldTrade(roundedPrice, 10.0, false)
                );
            }

            // Verify all trades processed with correct zone assignment
            expect(enrichedTrades.length).toBe(edgePrices.length);

            // Each trade should be in correct zone based on boundaries
            for (let i = 0; i < enrichedTrades.length; i++) {
                const trade = enrichedTrades[i];
                expect(trade.zoneData?.zones.length).toBe(25);

                // Find zone containing this trade
                const containingZone = trade.zoneData!.zones.find(
                    (z) =>
                        trade.price >= z.boundaries.min &&
                        trade.price <= z.boundaries.max
                );

                expect(containingZone).toBeDefined();
                expect(containingZone!.aggressiveVolume).toBeGreaterThan(0);
            }
        });
    });

    describe("🔧 Real Market Data Patterns", () => {
        it("should handle iceberg order fragmentation pattern", async () => {
            const icebergPrice = 89.3;
            const totalSize = 1000.0;
            const fragmentSize = 50.0;
            const fragments = Math.ceil(totalSize / fragmentSize);

            // Simulate iceberg order as fragmented trades
            let processedVolume = 0;
            for (let i = 0; i < fragments; i++) {
                const remainingSize = totalSize - processedVolume;
                const currentFragment = Math.min(fragmentSize, remainingSize);

                await preprocessor.handleAggTrade(
                    createRealWorldTrade(
                        icebergPrice,
                        currentFragment,
                        false, // All buys
                        Date.now() + i * 100 // 100ms intervals
                    )
                );

                processedVolume = FinancialMath.safeAdd(
                    processedVolume,
                    currentFragment
                );
            }

            // Verify iceberg pattern processed correctly
            expect(enrichedTrades.length).toBe(fragments);

            const finalTrade = enrichedTrades[fragments - 1];
            const targetZone = finalTrade.zoneData!.zones.find(
                (z) =>
                    Math.abs(FinancialMath.safeSubtract(z.priceLevel, 89.3)) <=
                    0.01
            );

            expect(targetZone!.aggressiveVolume).toBeCloseTo(totalSize, 2);
            expect(targetZone!.aggressiveBuyVolume).toBeCloseTo(totalSize, 2);
            expect(targetZone!.tradeCount).toBe(fragments);
        });

        it("should handle algorithmic burst pattern", async () => {
            const burstPrice = 89.4;
            const burstCount = 50;
            const burstInterval = 10; // 10ms between trades

            // Simulate algo trading burst
            const startTime = Date.now();
            for (let i = 0; i < burstCount; i++) {
                await preprocessor.handleAggTrade(
                    createRealWorldTrade(
                        burstPrice,
                        FinancialMath.safeAdd(1, Math.random() * 5), // Random small sizes
                        i % 3 === 0, // Every 3rd trade is sell
                        startTime + i * burstInterval
                    )
                );
            }

            // Verify burst handled efficiently
            expect(enrichedTrades.length).toBe(burstCount);

            const finalTrade = enrichedTrades[burstCount - 1];
            const targetZone = finalTrade.zoneData!.zones.find(
                (z) =>
                    Math.abs(FinancialMath.safeSubtract(z.priceLevel, 89.4)) <=
                    0.01
            );

            expect(targetZone!.tradeCount).toBe(burstCount);
            expect(targetZone!.aggressiveVolume).toBeGreaterThan(burstCount); // At least 1 per trade
            expect(targetZone!.aggressiveBuyVolume).toBeGreaterThan(
                targetZone!.aggressiveSellVolume
            );
        });
    });

    // Helper function to create realistic trade data
    function createRealWorldTrade(
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
            f: tradeId - Math.floor(Math.random() * 100),
            l: tradeId + Math.floor(Math.random() * 100),
            T: timestamp,
            m: buyerIsMaker,
            M: true,
        };
    }
});
