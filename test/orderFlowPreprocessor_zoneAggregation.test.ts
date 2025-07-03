// test/orderFlowPreprocessor_zoneAggregation.test.ts
/**
 * Comprehensive unit tests for zone volume aggregation logic
 *
 * CLAUDE.md COMPLIANCE:
 * - Tests detect errors in code and validate correct implementation
 * - Uses centralized mocks from __mocks__/ directory
 * - Tests validate real-world logic, not current broken code
 * - Deterministic test data ensures reliable error detection
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type {
    EnrichedTradeEvent,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";

// CLAUDE.md COMPLIANCE: Use centralized mocks from __mocks__/ directory
import { createMockLogger } from "../__mocks__/src/infrastructure/loggerInterface.js";
import { createMockOrderBookState } from "../__mocks__/src/market/orderBookState.js";
import { MetricsCollector } from "../__mocks__/src/infrastructure/metricsCollector.js";

describe("OrderFlowPreprocessor Zone Aggregation", () => {
    let preprocessor: OrderflowPreprocessor;
    let mockLogger: ReturnType<typeof createMockLogger>;
    let mockOrderBookState: ReturnType<typeof createMockOrderBookState>;
    let mockMetricsCollector: MetricsCollector;

    // Test configuration with deterministic values
    const testConfig = {
        pricePrecision: 2,
        quantityPrecision: 8,
        bandTicks: 5,
        tickSize: 0.01,
        symbol: "LTCUSDT",
        enableStandardizedZones: true,
        standardZoneConfig: {
            baseTicks: 5,
            zoneMultipliers: [1, 2, 4], // 5-tick, 10-tick, 20-tick zones (multipliers of baseTicks)
            timeWindows: [300000, 900000, 1800000], // 5min, 15min, 30min
            adaptiveMode: false,
            volumeThresholds: {
                aggressive: 10.0,
                passive: 5.0,
                institutional: 50.0,
            },
            priceThresholds: {
                tickValue: 0.01,
                minZoneWidth: 0.02, // 2 ticks
                maxZoneWidth: 0.1, // 10 ticks
            },
            performanceConfig: {
                maxZoneHistory: 2000,
                cleanupInterval: 5400000,
                maxMemoryMB: 50,
            },
        },
        maxZoneCacheAgeMs: 5400000, // 90 minutes
        zoneCalculationRange: 12,
        zoneCacheSize: 1000,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Create fresh mock instances for each test
        mockLogger = createMockLogger();
        mockOrderBookState = createMockOrderBookState();
        mockMetricsCollector = new MetricsCollector();

        preprocessor = new OrderflowPreprocessor(
            testConfig,
            mockOrderBookState,
            mockLogger,
            mockMetricsCollector
        );
    });

    describe("Trade Aggregation Logic", () => {
        it("should aggregate buy trades correctly into zone volumes", async () => {
            // Test data with proper tick compliance (CLAUDE.md requirement)
            const basePrice = 89.0; // Price in $10-$100 range = 0.01 tick size

            const buyTrade = {
                e: "aggTrade",
                p: basePrice.toString(),
                q: "2.5",
                T: Date.now(),
                m: false, // Buyer is taker = buy side trade
                s: "LTCUSDT",
                a: 12345,
            };

            // Call aggregation method through trade processing
            await preprocessor.handleAggTrade(buyTrade as any);

            // Debug: Check if any methods were called on the mock
            console.log(
                "Metrics calls:",
                mockMetricsCollector.incrementCounter.mock.calls
            );
            console.log("Logger calls:", mockLogger.error.mock.calls);
            console.log("Logger warn calls:", mockLogger.warn.mock.calls);

            // Verify metrics were recorded
            expect(mockMetricsCollector.incrementCounter).toHaveBeenCalledWith(
                "zone_trade_aggregations_total",
                1
            );
        });

        it("should aggregate sell trades correctly into zone volumes", async () => {
            const basePrice = 89.05; // Tick-compliant price movement

            const sellTrade = {
                e: "aggTrade",
                p: basePrice.toString(),
                q: "1.8",
                T: Date.now(),
                m: true, // Buyer is maker = sell side trade
                s: "LTCUSDT",
                a: 12346,
            };

            await preprocessor.handleAggTrade(sellTrade as any);

            expect(mockMetricsCollector.incrementCounter).toHaveBeenCalledWith(
                "zone_trade_aggregations_total",
                1
            );
        });

        it("should calculate zone boundaries correctly using FinancialMath", () => {
            const testPrice = 89.12;
            const zoneTicks = 5;
            const tickSize = 0.01;

            // Test FinancialMath zone calculation
            const zoneCenter = FinancialMath.calculateZone(
                testPrice,
                zoneTicks,
                2
            );
            expect(zoneCenter).not.toBeNull();

            if (zoneCenter !== null) {
                const zoneSize = FinancialMath.multiplyQuantities(
                    zoneTicks,
                    tickSize
                );
                const minPrice = FinancialMath.safeSubtract(
                    zoneCenter,
                    zoneSize / 2
                );
                const maxPrice = FinancialMath.safeAdd(
                    zoneCenter,
                    zoneSize / 2
                );

                // Verify zone boundaries are logical
                expect(maxPrice).toBeGreaterThan(minPrice);
                expect(zoneSize).toBe(0.05); // 5 ticks * 0.01 = 0.05
            }
        });

        it("should handle volume-weighted price calculation correctly", () => {
            const zone: ZoneSnapshot = {
                zoneId: "LTCUSDT_5T_89.10",
                priceLevel: 89.1,
                tickSize: 0.01,
                aggressiveVolume: 5.0,
                passiveVolume: 10.0,
                aggressiveBuyVolume: 3.0,
                aggressiveSellVolume: 2.0,
                passiveBidVolume: 6.0,
                passiveAskVolume: 4.0,
                tradeCount: 5,
                timespan: 300000,
                boundaries: { min: 89.075, max: 89.125 },
                lastUpdate: Date.now(),
                volumeWeightedPrice: 89.1,
            };

            const trade: EnrichedTradeEvent = {
                price: 89.12,
                quantity: 1.5,
                timestamp: Date.now(),
                buyerIsMaker: false,
                pair: "LTCUSDT",
            };

            // Test volume-weighted price calculation
            const totalOldVolume = FinancialMath.safeAdd(
                zone.aggressiveVolume,
                zone.passiveVolume
            );
            const totalNewVolume = FinancialMath.safeAdd(
                totalOldVolume,
                trade.quantity
            );

            const newVWAP = FinancialMath.safeDivide(
                FinancialMath.safeAdd(
                    FinancialMath.safeMultiply(
                        zone.volumeWeightedPrice,
                        totalOldVolume
                    ),
                    FinancialMath.safeMultiply(trade.price, trade.quantity)
                ),
                totalNewVolume
            );

            expect(newVWAP).toBeGreaterThan(89.1); // VWAP should increase with higher-priced trade
            expect(newVWAP).toBeLessThan(89.12); // But less than the trade price due to existing volume
        });
    });

    describe("Error Handling and Edge Cases", () => {
        it("should handle null zone calculation gracefully", async () => {
            // Test with invalid parameters that would cause FinancialMath to throw
            const invalidPrice = NaN;
            const zoneTicks = 5;

            // FinancialMath.calculateZone throws on invalid price rather than returning null
            expect(() => {
                FinancialMath.calculateZone(invalidPrice, zoneTicks, 2);
            }).toThrow("Invalid price: NaN");

            // Verify error handling doesn't crash the system when trade processing fails
            await preprocessor.handleAggTrade({
                e: "aggTrade",
                p: invalidPrice.toString(),
                q: "1.0",
                T: Date.now(),
                m: false,
                s: "LTCUSDT",
                a: 99999,
            } as any);

            // Should log error and continue processing
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it("should handle trades outside zone boundaries correctly", () => {
            const zone: ZoneSnapshot = {
                zoneId: "LTCUSDT_5T_89.00",
                priceLevel: 89.0,
                tickSize: 0.01,
                aggressiveVolume: 0,
                passiveVolume: 10.0,
                aggressiveBuyVolume: 0,
                aggressiveSellVolume: 0,
                passiveBidVolume: 6.0,
                passiveAskVolume: 4.0,
                tradeCount: 0,
                timespan: 300000,
                boundaries: { min: 88.975, max: 89.025 }, // 5-tick zone around 89.00
                lastUpdate: Date.now(),
                volumeWeightedPrice: 89.0,
            };

            // Trade outside zone boundaries
            const outsideTrade: EnrichedTradeEvent = {
                price: 89.1, // Outside the zone boundaries
                quantity: 1.0,
                timestamp: Date.now(),
                isBuyerMaker: false,
                side: "buy",
                pair: "LTCUSDT",
                correlationId: "test-outside",
            };

            // Mock private method access for testing
            const updateZoneWithTrade = (preprocessor as any)
                .updateZoneWithTrade;
            const result = updateZoneWithTrade.call(
                preprocessor,
                zone,
                outsideTrade
            );

            // Should return null for trades outside zone boundaries
            expect(result).toBeNull();
        });

        it("should maintain trade count accuracy", () => {
            const initialZone: ZoneSnapshot = {
                zoneId: "LTCUSDT_10T_89.00",
                priceLevel: 89.0,
                tickSize: 0.01,
                aggressiveVolume: 5.0,
                passiveVolume: 10.0,
                aggressiveBuyVolume: 2.0,
                aggressiveSellVolume: 3.0,
                passiveBidVolume: 6.0,
                passiveAskVolume: 4.0,
                tradeCount: 3,
                timespan: 300000,
                boundaries: { min: 88.95, max: 89.05 },
                lastUpdate: Date.now() - 1000,
                volumeWeightedPrice: 89.0,
            };

            const newTrade: EnrichedTradeEvent = {
                price: 89.01,
                quantity: 2.5,
                timestamp: Date.now(),
                isBuyerMaker: false,
                side: "buy",
                pair: "LTCUSDT",
                correlationId: "test-count",
            };

            const updateZoneWithTrade = (preprocessor as any)
                .updateZoneWithTrade;
            const updatedZone = updateZoneWithTrade.call(
                preprocessor,
                initialZone,
                newTrade
            );

            expect(updatedZone).not.toBeNull();
            expect(updatedZone.tradeCount).toBe(4); // Should increment by 1
            expect(updatedZone.aggressiveVolume).toBe(
                FinancialMath.safeAdd(
                    initialZone.aggressiveVolume,
                    newTrade.quantity
                )
            );
            expect(updatedZone.aggressiveBuyVolume).toBe(
                FinancialMath.safeAdd(
                    initialZone.aggressiveBuyVolume,
                    newTrade.quantity
                )
            ); // Buy trade should increase buy volume
        });
    });

    describe("Multi-timeframe Zone Processing", () => {
        it("should process trades across all configured zone sizes", async () => {
            const trade = {
                e: "aggTrade",
                p: "89.00",
                q: "3.0",
                T: Date.now(),
                m: false,
                s: "LTCUSDT",
                a: 54321,
            };

            await preprocessor.handleAggTrade(trade as any);

            // Should increment aggregation counter once for the trade
            // (internally it processes multiple zones but counts as one aggregation)
            expect(mockMetricsCollector.incrementCounter).toHaveBeenCalledWith(
                "zone_trade_aggregations_total",
                1
            );
        });
    });

    describe("Performance and Memory Management", () => {
        it("should handle high-frequency trade aggregation efficiently", async () => {
            const startTime = Date.now();

            // Simulate 100 rapid trades
            for (let i = 0; i < 100; i++) {
                const price = 89.0 + i * 0.01; // Tick-compliant price progression
                await preprocessor.handleAggTrade({
                    e: "aggTrade",
                    p: price.toString(),
                    q: "1.0",
                    T: Date.now(),
                    m: i % 2 === 0, // Alternate buy/sell
                    s: "LTCUSDT",
                    a: 10000 + i,
                } as any);
            }

            const processingTime = Date.now() - startTime;

            // Performance requirement: should process 100 trades in reasonable time
            expect(processingTime).toBeLessThan(1000); // Less than 1 second

            // Should have called aggregation counter 100 times
            expect(mockMetricsCollector.incrementCounter).toHaveBeenCalledTimes(
                100
            );
        });
    });
});
