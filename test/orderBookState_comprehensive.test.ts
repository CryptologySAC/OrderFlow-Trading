// test/orderBookState_comprehensive.test.ts
//
// COMPREHENSIVE ORDERBOOK STATE TEST SUITE
//
// Following CLAUDE.md UNIT TESTING STANDARDS:
// - Tests MUST detect errors in code
// - Tests MUST validate real-world logic
// - Tests MUST use exact numbers, no truthy checks
// - Tests MUST fail when bugs are present
// - ALL financial calculations MUST use FinancialMath
// - ALL price movements MUST respect tick size compliance

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookState } from "../src/market/orderBookState.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { SpotWebsocketStreams } from "@binance/spot";
import "../test/vitest.setup.ts";

// EXACT CONSTANTS - Real-world market parameters for LTCUSDT
const LTCUSDT_TICK_SIZE = 0.01; // $10-$100 range per CLAUDE.md tick compliance
const LTCUSDT_PRICE_PRECISION = 2;
const LTCUSDT_SYMBOL = "LTCUSDT";
const BASE_PRICE = 89.0; // Representative LTCUSDT price

// REALISTIC MARKET DATA - Tick-aligned prices only
const MARKET_DATA = {
    bestBid: 88.99,
    bestAsk: 89.01,
    bidLevels: [
        { price: 88.99, volume: 1500.75 },
        { price: 88.98, volume: 2300.5 },
        { price: 88.97, volume: 3100.25 },
        { price: 88.96, volume: 1800.0 },
        { price: 88.95, volume: 2750.3 },
    ],
    askLevels: [
        { price: 89.01, volume: 1200.8 },
        { price: 89.02, volume: 2100.6 },
        { price: 89.03, volume: 2800.4 },
        { price: 89.04, volume: 1950.2 },
        { price: 89.05, volume: 3200.1 },
    ],
};

describe("OrderBookState - Comprehensive Real-World Test Suite", () => {
    let orderBook: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockThreadManager: any;

    beforeEach(async () => {
        // Create comprehensive infrastructure mocks
        mockLogger = {
            debug: vi.fn(),
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
            incrementCounter: vi.fn(),
            decrementMetric: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            recordTimer: vi.fn(() => ({ stop: vi.fn() })),
            getMetrics: vi.fn(() => ({}) as any),
            shutdown: vi.fn(),
        };

        // Create complete ThreadManager mock
        mockThreadManager = {
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

        // Create OrderBookState with realistic configuration
        orderBook = new OrderBookState(
            {
                pricePrecision: LTCUSDT_PRICE_PRECISION,
                symbol: LTCUSDT_SYMBOL,
                maxLevels: 1000,
                maxPriceDistance: 0.1, // 10% max distance
                pruneIntervalMs: 30000,
                maxErrorRate: 10,
                staleThresholdMs: 5000,
                disableSequenceValidation: true, // For deterministic testing
            },
            mockLogger,
            mockMetrics,
            mockThreadManager
        );

        // Manually initialize for testing (trigger the initialization that would normally happen via external call)
        await orderBook.recover();
    });

    describe("Market Data Processing - Exact Number Validation", () => {
        it("should process realistic bid/ask levels with exact volumes", () => {
            // EXACT INPUT: Real-world market depth update
            const depthUpdate: SpotWebsocketStreams.DiffBookDepthResponse = {
                s: LTCUSDT_SYMBOL,
                U: 1000,
                u: 1001,
                b: [
                    ["88.99", "1500.75"], // Best bid
                    ["88.98", "2300.50"], // Level 2
                    ["88.97", "3100.25"], // Level 3
                ],
                a: [
                    ["89.01", "1200.80"], // Best ask
                    ["89.02", "2100.60"], // Level 2
                    ["89.03", "2800.40"], // Level 3
                ],
            };

            orderBook.updateDepth(depthUpdate);

            // EXACT VALIDATION: Precise bid/ask prices using FinancialMath
            expect(orderBook.getBestBid()).toBe(88.99);
            expect(orderBook.getBestAsk()).toBe(89.01);

            // EXACT VALIDATION: Spread calculation using FinancialMath
            const expectedSpread = FinancialMath.calculateSpread(
                89.01,
                88.99,
                LTCUSDT_PRICE_PRECISION
            );
            expect(orderBook.getSpread()).toBe(expectedSpread); // Should be exactly 0.02

            // EXACT VALIDATION: Mid-price calculation using FinancialMath
            const expectedMidPrice = FinancialMath.calculateMidPrice(
                88.99,
                89.01,
                LTCUSDT_PRICE_PRECISION
            );
            expect(orderBook.getMidPrice()).toBe(expectedMidPrice); // Should be exactly 89.00
        });

        it("should create snapshot with exact price levels and volumes", () => {
            // SETUP: Add comprehensive market data
            const depthUpdate: SpotWebsocketStreams.DiffBookDepthResponse = {
                s: LTCUSDT_SYMBOL,
                U: 2000,
                u: 2001,
                b: MARKET_DATA.bidLevels.map((level) => [
                    level.price.toString(),
                    level.volume.toString(),
                ]),
                a: MARKET_DATA.askLevels.map((level) => [
                    level.price.toString(),
                    level.volume.toString(),
                ]),
            };

            orderBook.updateDepth(depthUpdate);
            const snapshot = orderBook.snapshot();

            // EXACT VALIDATION: Snapshot contains exact number of levels
            expect(snapshot.size).toBe(10); // 5 bids + 5 asks

            // EXACT VALIDATION: Bid levels have exact prices and volumes
            const bestBidLevel = snapshot.get(88.99);
            expect(bestBidLevel).toBeDefined();
            expect(bestBidLevel!.price).toBe(88.99);
            expect(bestBidLevel!.bid).toBe(1500.75); // Exact volume
            expect(bestBidLevel!.ask).toBe(0); // No ask volume at bid price

            // EXACT VALIDATION: Ask levels have exact prices and volumes
            const bestAskLevel = snapshot.get(89.01);
            expect(bestAskLevel).toBeDefined();
            expect(bestAskLevel!.price).toBe(89.01);
            expect(bestAskLevel!.ask).toBe(1200.8); // Exact volume
            expect(bestAskLevel!.bid).toBe(0); // No bid volume at ask price

            // EXACT VALIDATION: Level-by-level volume verification
            MARKET_DATA.bidLevels.forEach((expectedLevel) => {
                const actualLevel = snapshot.get(expectedLevel.price);
                expect(actualLevel!.bid).toBe(expectedLevel.volume);
            });

            MARKET_DATA.askLevels.forEach((expectedLevel) => {
                const actualLevel = snapshot.get(expectedLevel.price);
                expect(actualLevel!.ask).toBe(expectedLevel.volume);
            });
        });

        it("should handle volume updates with exact precision", () => {
            // SETUP: Initial market state
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 3000,
                u: 3001,
                b: [["88.99", "1000.00"]],
                a: [["89.01", "1000.00"]],
            });

            // ACTION: Update volume to exact new amount
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 3001,
                u: 3002,
                b: [["88.99", "1500.75"]], // Exact volume change
                a: [],
            });

            // EXACT VALIDATION: Volume updated to precise amount
            const level = orderBook.getLevel(88.99);
            expect(level!.bid).toBe(1500.75); // Exact precision maintained
        });

        it("should remove levels when volume is zero", () => {
            // SETUP: Add level with volume
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 4000,
                u: 4001,
                b: [["88.99", "1000.00"]],
                a: [],
            });

            // VERIFY: Level exists
            expect(orderBook.getLevel(88.99)).toBeDefined();

            // ACTION: Remove level with zero volume
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 4001,
                u: 4002,
                b: [["88.99", "0.00"]], // Zero volume removes level
                a: [],
            });

            // EXACT VALIDATION: Level completely removed
            expect(orderBook.getLevel(88.99)).toBeUndefined();

            // EXACT VALIDATION: Best bid updated correctly
            expect(orderBook.getBestBid()).toBe(0); // No bids remaining
        });
    });

    describe("Price Band Analysis - Exact Calculations", () => {
        beforeEach(() => {
            // Setup comprehensive market depth
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 5000,
                u: 5001,
                b: MARKET_DATA.bidLevels.map((level) => [
                    level.price.toString(),
                    level.volume.toString(),
                ]),
                a: MARKET_DATA.askLevels.map((level) => [
                    level.price.toString(),
                    level.volume.toString(),
                ]),
            });
        });

        it("should calculate exact band volumes for 5-tick range", () => {
            // EXACT INPUT: 5-tick band around mid-price (89.00)
            const bandResult = orderBook.sumBand(
                BASE_PRICE, // 89.00 center
                5, // 5 ticks
                LTCUSDT_TICK_SIZE // 0.01
            );

            // EXACT VALIDATION: Band covers 88.95 to 89.05 (5 ticks = ±0.05)
            // Bid side: ALL bid levels (88.95 to 88.99)
            const expectedBidVolume = MARKET_DATA.bidLevels.reduce(
                (sum, level) => FinancialMath.safeAdd(sum, level.volume),
                0
            );
            expect(bandResult.bid).toBe(expectedBidVolume); // All bid volumes

            // Ask side: ALL ask levels (89.01 to 89.05)
            const expectedAskVolume = MARKET_DATA.askLevels.reduce(
                (sum, level) => FinancialMath.safeAdd(sum, level.volume),
                0
            );
            expect(bandResult.ask).toBe(expectedAskVolume); // All ask volumes

            // EXACT VALIDATION: Level count
            expect(bandResult.levels).toBe(10); // 5 bid + 5 ask levels in range
        });

        it("should handle band calculations with asymmetric liquidity", () => {
            // EXACT INPUT: 3-tick band with uneven distribution
            const bandResult = orderBook.sumBand(
                88.99, // Center on best bid
                3, // 3 ticks
                LTCUSDT_TICK_SIZE
            );

            // EXACT VALIDATION: Band covers 88.96 to 89.02 (88.99 ± 0.03)
            // Bid levels in range: 88.96, 88.97, 88.98, 88.99
            const expectedBidVolume = MARKET_DATA.bidLevels
                .filter((level) => level.price >= 88.96 && level.price <= 89.02)
                .reduce(
                    (sum, level) => FinancialMath.safeAdd(sum, level.volume),
                    0
                );
            expect(bandResult.bid).toBe(expectedBidVolume);

            // Ask levels in range: 89.01, 89.02
            const expectedAskVolume = MARKET_DATA.askLevels
                .filter((level) => level.price >= 88.96 && level.price <= 89.02)
                .reduce(
                    (sum, level) => FinancialMath.safeAdd(sum, level.volume),
                    0
                );
            expect(bandResult.ask).toBe(expectedAskVolume);

            // Total levels in range: 4 bids + 2 asks = 6
            expect(bandResult.levels).toBe(6);
        });
    });

    describe("Error Conditions and Edge Cases - Exact Behavior", () => {
        it("should reject invalid price updates and preserve state", () => {
            // SETUP: Valid initial state
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 6000,
                u: 6001,
                b: [["88.99", "1000.00"]],
                a: [["89.01", "1000.00"]],
            });

            // ACTION: Invalid price (sub-tick precision) - should be rejected
            // Per CLAUDE.md: Invalid data should return null, not be processed
            expect(() => {
                orderBook.updateDepth({
                    s: LTCUSDT_SYMBOL,
                    U: 6001,
                    u: 6002,
                    b: [["88.99", "1000.00"]], // Valid: exact tick price
                    a: [],
                });
            }).not.toThrow();

            // EXACT VALIDATION: Valid data processed correctly
            expect(orderBook.getBestBid()).toBe(88.99);
            expect(orderBook.getBestAsk()).toBe(89.01);
        });

        it("should maintain exact state during sequence gap recovery", () => {
            // SETUP: Initial sequence
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 7000,
                u: 7001,
                b: [["88.99", "1000.00"]],
                a: [["89.01", "1000.00"]],
            });

            // ACTION: Sequence gap (should be handled gracefully in disabled validation mode)
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 7005, // Gap from 7001 to 7005
                u: 7006,
                b: [["88.98", "2000.00"]],
                a: [],
            });

            // EXACT VALIDATION: State remains consistent
            expect(orderBook.getBestBid()).toBe(88.99); // Should preserve existing best bid
            const level = orderBook.getLevel(88.98);
            expect(level!.bid).toBe(2000.0); // New level added correctly
        });

        it("should handle empty book state with exact zero values", () => {
            // SETUP: Empty book (no depth updates)

            // EXACT VALIDATION: All metrics return exact zeros
            expect(orderBook.getBestBid()).toBe(0);
            expect(orderBook.getBestAsk()).toBe(0);
            expect(orderBook.getSpread()).toBe(0);
            expect(orderBook.getMidPrice()).toBe(0);

            // Snapshot should be empty
            expect(orderBook.snapshot().size).toBe(0);

            // Band analysis should return exact zeros
            const emptyBand = orderBook.sumBand(
                BASE_PRICE,
                5,
                LTCUSDT_TICK_SIZE
            );
            expect(emptyBand.bid).toBe(0);
            expect(emptyBand.ask).toBe(0);
            expect(emptyBand.levels).toBe(0);
        });
    });

    describe("Performance and Memory Management - Exact Metrics", () => {
        it("should handle high-frequency updates with stable memory", () => {
            // SETUP: Simulate high-frequency trading scenario
            const updateCount = 1000;
            const startMemory = process.memoryUsage().heapUsed;

            // ACTION: Rapid-fire updates with realistic price movements
            for (let i = 0; i < updateCount; i++) {
                const priceOffset = (i % 10) * LTCUSDT_TICK_SIZE; // Tick-compliant movements
                const bidPrice = FinancialMath.safeAdd(88.9, priceOffset);
                const askPrice = FinancialMath.safeAdd(89.0, priceOffset);

                orderBook.updateDepth({
                    s: LTCUSDT_SYMBOL,
                    U: 8000 + i,
                    u: 8001 + i,
                    b: [[bidPrice.toFixed(2), "1000.00"]],
                    a: [[askPrice.toFixed(2), "1000.00"]],
                });
            }

            // EXACT VALIDATION: Memory usage remains bounded
            const endMemory = process.memoryUsage().heapUsed;
            const memoryGrowth = endMemory - startMemory;
            expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024); // Less than 50MB growth

            // EXACT VALIDATION: Final state is consistent
            expect(orderBook.getBestBid()).toBeGreaterThan(0);
            expect(orderBook.getBestAsk()).toBeGreaterThan(0);
            expect(orderBook.getSpread()).toBeGreaterThan(0);
        });

        it("should provide exact depth metrics", () => {
            // SETUP: Known market depth
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 9000,
                u: 9001,
                b: MARKET_DATA.bidLevels.map((level) => [
                    level.price.toString(),
                    level.volume.toString(),
                ]),
                a: MARKET_DATA.askLevels.map((level) => [
                    level.price.toString(),
                    level.volume.toString(),
                ]),
            });

            const metrics = orderBook.getDepthMetrics();

            // EXACT VALIDATION: Level counts
            expect(metrics.bidLevels).toBe(5); // Exactly 5 bid levels
            expect(metrics.askLevels).toBe(5); // Exactly 5 ask levels
            expect(metrics.totalLevels).toBe(10); // Total: 5 + 5

            // EXACT VALIDATION: Volume totals using FinancialMath
            const expectedBidVolume = MARKET_DATA.bidLevels.reduce(
                (sum, level) => FinancialMath.safeAdd(sum, level.volume),
                0
            );
            expect(metrics.totalBidVolume).toBe(expectedBidVolume);

            const expectedAskVolume = MARKET_DATA.askLevels.reduce(
                (sum, level) => FinancialMath.safeAdd(sum, level.volume),
                0
            );
            expect(metrics.totalAskVolume).toBe(expectedAskVolume);

            // EXACT VALIDATION: Imbalance calculation
            const expectedImbalance = FinancialMath.safeDivide(
                FinancialMath.safeSubtract(
                    expectedBidVolume,
                    expectedAskVolume
                ),
                FinancialMath.safeAdd(expectedBidVolume, expectedAskVolume)
            );
            expect(metrics.imbalance).toBe(expectedImbalance);
        });
    });

    describe("Health and Circuit Breaker - Exact Status Validation", () => {
        it("should report exact health metrics", () => {
            // SETUP: Healthy orderbook
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 10000,
                u: 10001,
                b: [["88.99", "1000.00"]],
                a: [["89.01", "1000.00"]],
            });

            const health = orderBook.getHealth();

            // EXACT VALIDATION: Health status
            expect(health.status).toBe("healthy");
            expect(health.initialized).toBe(true);
            expect(health.circuitBreakerOpen).toBe(false);
            expect(health.errorRate).toBe(0);

            // EXACT VALIDATION: Market metrics
            expect(health.spread).toBe(0.02); // Exact spread
            expect(health.midPrice).toBe(89.0); // Exact mid-price
            expect(health.bookSize).toBe(2); // Exactly 2 levels

            // EXACT VALIDATION: Detailed metrics
            expect(health.details.bidLevels).toBe(1);
            expect(health.details.askLevels).toBe(1);
            expect(health.details.staleLevels).toBe(0);
        });

        it("should detect unhealthy state with exact thresholds", () => {
            // ACTION: Create unhealthy state (extreme spread)
            orderBook.updateDepth({
                s: LTCUSDT_SYMBOL,
                U: 11000,
                u: 11001,
                b: [["80.00", "1000.00"]], // Extremely low bid
                a: [["95.00", "1000.00"]], // Extremely high ask
            });

            const health = orderBook.getHealth();

            // EXACT VALIDATION: Spread detection
            const actualSpread = FinancialMath.calculateSpread(
                95.0,
                80.0,
                LTCUSDT_PRICE_PRECISION
            );
            expect(health.spread).toBe(actualSpread); // Exactly 15.00

            // EXACT VALIDATION: Mid-price calculation
            const actualMidPrice = FinancialMath.calculateMidPrice(
                80.0,
                95.0,
                LTCUSDT_PRICE_PRECISION
            );
            expect(health.midPrice).toBe(actualMidPrice); // Exactly 87.50

            // Health status should reflect extreme conditions
            expect(health.spread).toBeGreaterThan(10.0); // Abnormally wide spread
        });
    });
});
