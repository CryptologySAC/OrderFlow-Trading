import { describe, it, expect, beforeEach, vi } from "vitest";
import { RedBlackTreeOrderBook } from "../src/market/redBlackTreeOrderBook";
import { OrderBookState } from "../src/market/orderBookState";
import type { OrderBookStateOptions } from "../src/market/orderBookState";
import type { SpotWebsocketStreams } from "@binance/spot";
import type { ILogger } from "../src/infrastructure/loggerInterface";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface";
import type { ThreadManager } from "../src/multithreading/threadManager";

// Mock dependencies
const mockLogger: ILogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    setCorrelationId: vi.fn(),
    getCorrelationId: vi.fn().mockReturnValue("test-correlation-id"),
};

const mockMetrics: IMetricsCollector = {
    updateMetric: vi.fn(),
    incrementMetric: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
    getHealthSummary: vi.fn().mockReturnValue("healthy"),
};

const mockThreadManager: ThreadManager = {
    requestDepthSnapshot: vi.fn().mockResolvedValue({
        lastUpdateId: 1000,
        bids: [],
        asks: [],
    }),
} as any;

describe("RedBlackTree vs Map OrderBook - Performance Validation", () => {
    let rbtOrderBook: RedBlackTreeOrderBook;
    let mapOrderBook: OrderBookState;

    const options: OrderBookStateOptions = {
        pricePrecision: 2,
        symbol: "BTCUSDT",
        maxLevels: 10000, // Allow large orderbooks for performance testing
        maxPriceDistance: 1.0, // Allow wide spread for testing
        pruneIntervalMs: 300000, // Disable pruning during tests
        maxErrorRate: 100,
        staleThresholdMs: 3600000,
    };

    beforeEach(async () => {
        // Create fresh instances with performance-optimized settings
        rbtOrderBook = new RedBlackTreeOrderBook(
            options,
            mockLogger,
            mockMetrics,
            mockThreadManager
        );
        mapOrderBook = new OrderBookState(
            options,
            mockLogger,
            mockMetrics,
            mockThreadManager
        );

        await rbtOrderBook.recover();
        await mapOrderBook.recover();
    });

    /**
     * Helper function to build orderbook with specified number of levels
     */
    function buildOrderBook(
        rbtBook: RedBlackTreeOrderBook,
        mapBook: OrderBookState,
        levels: number
    ): void {
        const updates: SpotWebsocketStreams.DiffBookDepthResponse[] = [];

        // Create bid levels from 49.99 down to (50 - levels*0.01)
        const bidUpdates: [string, string][] = [];
        for (let i = 0; i < levels; i++) {
            const price = (49.99 - i * 0.01).toFixed(2);
            const quantity = (100 + Math.random() * 900).toFixed(0);
            bidUpdates.push([price, quantity]);
        }

        // Create ask levels from 50.01 up to (50 + levels*0.01)
        const askUpdates: [string, string][] = [];
        for (let i = 0; i < levels; i++) {
            const price = (50.01 + i * 0.01).toFixed(2);
            const quantity = (100 + Math.random() * 900).toFixed(0);
            askUpdates.push([price, quantity]);
        }

        const update: SpotWebsocketStreams.DiffBookDepthResponse = {
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: bidUpdates,
            a: askUpdates,
        };

        rbtBook.updateDepth(update);
        mapBook.updateDepth(update);
    }

    /**
     * Measure execution time of a function
     */
    function measureExecutionTime<T>(fn: () => T): {
        result: T;
        timeMs: number;
    } {
        const start = performance.now();
        const result = fn();
        const end = performance.now();
        return { result, timeMs: end - start };
    }

    describe("O(log n) vs O(n) Performance Validation", () => {
        it("should demonstrate O(log n) getBestBid performance vs O(n) Map implementation", () => {
            const testSizes = [100, 500, 1000, 2000, 5000];
            const rbtTimes: number[] = [];
            const mapTimes: number[] = [];

            testSizes.forEach((size) => {
                // Reset and build orderbooks
                rbtOrderBook.shutdown();
                mapOrderBook.shutdown();

                rbtOrderBook = new RedBlackTreeOrderBook(
                    options,
                    mockLogger,
                    mockMetrics,
                    mockThreadManager
                );
                mapOrderBook = new OrderBookState(
                    options,
                    mockLogger,
                    mockMetrics,
                    mockThreadManager
                );

                buildOrderBook(rbtOrderBook, mapOrderBook, size);

                // Measure RedBlackTree getBestBid performance
                const rbtMeasurement = measureExecutionTime(() => {
                    let result = 0;
                    for (let i = 0; i < 1000; i++) {
                        result += rbtOrderBook.getBestBid();
                    }
                    return result;
                });

                // Measure Map getBestBid performance
                const mapMeasurement = measureExecutionTime(() => {
                    let result = 0;
                    for (let i = 0; i < 1000; i++) {
                        result += mapOrderBook.getBestBid();
                    }
                    return result;
                });

                rbtTimes.push(rbtMeasurement.timeMs);
                mapTimes.push(mapMeasurement.timeMs);

                // Verify results are identical
                expect(rbtMeasurement.result).toBe(mapMeasurement.result);

                console.log(
                    `Size ${size}: RBT=${rbtMeasurement.timeMs.toFixed(2)}ms, Map=${mapMeasurement.timeMs.toFixed(2)}ms, Improvement=${(mapMeasurement.timeMs / rbtMeasurement.timeMs).toFixed(1)}x`
                );
            });

            // Analyze performance scaling
            for (let i = 1; i < testSizes.length; i++) {
                const sizeRatio = testSizes[i] / testSizes[i - 1];
                const rbtTimeRatio = rbtTimes[i] / rbtTimes[i - 1];
                const mapTimeRatio = mapTimes[i] / mapTimes[i - 1];

                // RedBlackTree should scale logarithmically (slower than linear)
                // Map should scale linearly (proportional to size increase)
                expect(rbtTimeRatio).toBeLessThan(sizeRatio); // O(log n) behavior
                expect(mapTimeRatio).toBeGreaterThan(sizeRatio * 0.8); // O(n) behavior
            }

            // Overall performance improvement should be significant for large sizes
            const largestSizeIndex = testSizes.length - 1;
            const finalImprovement =
                mapTimes[largestSizeIndex] / rbtTimes[largestSizeIndex];
            expect(finalImprovement).toBeGreaterThan(10); // At least 10x improvement
        });

        it("should demonstrate O(log n) getBestAsk performance vs O(n) Map implementation", () => {
            const testSizes = [100, 500, 1000, 2000];
            const performanceResults: {
                size: number;
                rbtTime: number;
                mapTime: number;
                improvement: number;
            }[] = [];

            testSizes.forEach((size) => {
                // Reset and build orderbooks
                rbtOrderBook.shutdown();
                mapOrderBook.shutdown();

                rbtOrderBook = new RedBlackTreeOrderBook(
                    options,
                    mockLogger,
                    mockMetrics,
                    mockThreadManager
                );
                mapOrderBook = new OrderBookState(
                    options,
                    mockLogger,
                    mockMetrics,
                    mockThreadManager
                );

                buildOrderBook(rbtOrderBook, mapOrderBook, size);

                // Measure RedBlackTree getBestAsk performance
                const rbtMeasurement = measureExecutionTime(() => {
                    let result = 0;
                    for (let i = 0; i < 1000; i++) {
                        result += rbtOrderBook.getBestAsk();
                    }
                    return result;
                });

                // Measure Map getBestAsk performance
                const mapMeasurement = measureExecutionTime(() => {
                    let result = 0;
                    for (let i = 0; i < 1000; i++) {
                        result += mapOrderBook.getBestAsk();
                    }
                    return result;
                });

                const improvement =
                    mapMeasurement.timeMs / rbtMeasurement.timeMs;
                performanceResults.push({
                    size,
                    rbtTime: rbtMeasurement.timeMs,
                    mapTime: mapMeasurement.timeMs,
                    improvement,
                });

                // Verify results are identical
                expect(rbtMeasurement.result).toBe(mapMeasurement.result);
            });

            // Verify performance improvements increase with size
            for (let i = 1; i < performanceResults.length; i++) {
                const current = performanceResults[i];
                const previous = performanceResults[i - 1];

                // Improvement should generally increase with size
                expect(current.improvement).toBeGreaterThan(
                    previous.improvement * 0.8
                );
            }

            // Final improvement should be substantial
            const finalResult =
                performanceResults[performanceResults.length - 1];
            expect(finalResult.improvement).toBeGreaterThan(5);
        });

        it("should demonstrate combined getBestBidAsk atomic operation performance", () => {
            const size = 2000;
            buildOrderBook(rbtOrderBook, mapOrderBook, size);

            // Measure RedBlackTree atomic getBestBidAsk operation
            const rbtMeasurement = measureExecutionTime(() => {
                let bidSum = 0,
                    askSum = 0;
                for (let i = 0; i < 1000; i++) {
                    // Use public interface methods instead of accessing private tree
                    bidSum += rbtOrderBook.getBestBid();
                    askSum += rbtOrderBook.getBestAsk();
                }
                return { bidSum, askSum };
            });

            // Measure Map separate getBest operations
            const mapMeasurement = measureExecutionTime(() => {
                let bidSum = 0,
                    askSum = 0;
                for (let i = 0; i < 1000; i++) {
                    bidSum += mapOrderBook.getBestBid();
                    askSum += mapOrderBook.getBestAsk();
                }
                return { bidSum, askSum };
            });

            // Verify results are identical
            expect(rbtMeasurement.result.bidSum).toBe(
                mapMeasurement.result.bidSum
            );
            expect(rbtMeasurement.result.askSum).toBe(
                mapMeasurement.result.askSum
            );

            // RedBlackTree atomic operation should be faster
            const improvement = mapMeasurement.timeMs / rbtMeasurement.timeMs;
            expect(improvement).toBeGreaterThan(1.5); // At least 50% improvement

            console.log(
                `Atomic getBestBidAsk improvement: ${improvement.toFixed(1)}x`
            );
        });
    });

    describe("Scalability Testing", () => {
        it("should maintain sub-linear scaling for large orderbooks", () => {
            const largeSizes = [1000, 3000, 5000, 10000];
            const measurements: { size: number; timeMs: number }[] = [];

            largeSizes.forEach((size) => {
                rbtOrderBook.shutdown();
                rbtOrderBook = new RedBlackTreeOrderBook(
                    options,
                    mockLogger,
                    mockMetrics,
                    mockThreadManager
                );

                // Build large orderbook
                buildOrderBook(rbtOrderBook, mapOrderBook, size);

                // Measure mixed operations performance
                const measurement = measureExecutionTime(() => {
                    for (let i = 0; i < 100; i++) {
                        rbtOrderBook.getBestBid();
                        rbtOrderBook.getBestAsk();
                        rbtOrderBook.getSpread();
                        rbtOrderBook.getMidPrice();
                    }
                });

                measurements.push({ size, timeMs: measurement.timeMs });
                console.log(
                    `Size ${size}: ${measurement.timeMs.toFixed(2)}ms for 400 operations`
                );
            });

            // Verify sub-linear scaling (O(log n) behavior)
            for (let i = 1; i < measurements.length; i++) {
                const sizeRatio =
                    measurements[i].size / measurements[i - 1].size;
                const timeRatio =
                    measurements[i].timeMs / measurements[i - 1].timeMs;

                // Time ratio should be much less than size ratio for O(log n)
                expect(timeRatio).toBeLessThan(sizeRatio * 0.7);
            }
        });

        it("should handle high-frequency updates efficiently", () => {
            const size = 1000;
            buildOrderBook(rbtOrderBook, mapOrderBook, size);

            // Generate high-frequency update sequence
            const updates: SpotWebsocketStreams.DiffBookDepthResponse[] = [];
            for (let i = 0; i < 10000; i++) {
                updates.push({
                    e: "depthUpdate",
                    E: Date.now(),
                    s: "BTCUSDT",
                    U: 2000 + i,
                    u: 2000 + i,
                    b: [
                        [
                            (49 + Math.random()).toFixed(2),
                            (Math.random() * 1000).toFixed(0),
                        ],
                    ],
                    a: [
                        [
                            (51 + Math.random()).toFixed(2),
                            (Math.random() * 1000).toFixed(0),
                        ],
                    ],
                });
            }

            // Measure RedBlackTree update performance
            const rbtMeasurement = measureExecutionTime(() => {
                updates.forEach((update) => rbtOrderBook.updateDepth(update));
            });

            // Measure Map update performance
            const mapMeasurement = measureExecutionTime(() => {
                updates.forEach((update) => mapOrderBook.updateDepth(update));
            });

            console.log(
                `High-frequency updates: RBT=${rbtMeasurement.timeMs.toFixed(2)}ms, Map=${mapMeasurement.timeMs.toFixed(2)}ms`
            );

            // Both should complete in reasonable time
            expect(rbtMeasurement.timeMs).toBeLessThan(1000); // Less than 1 second for 10k updates
            expect(mapMeasurement.timeMs).toBeLessThan(5000); // Map might be slower but should still be reasonable
        });
    });

    describe("Memory Usage Validation", () => {
        it("should have reasonable memory overhead compared to Map implementation", () => {
            const size = 5000;

            // Measure baseline memory
            const baselineMemory = process.memoryUsage().heapUsed;

            // Build large orderbooks
            buildOrderBook(rbtOrderBook, mapOrderBook, size);

            // Measure memory after building orderbooks
            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - baselineMemory;

            console.log(
                `Memory increase for ${size * 2} levels: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`
            );

            // Memory usage should be reasonable (less than 100MB for 10k levels)
            expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024); // 100MB limit
        });
    });

    describe("Real-World Performance Simulation", () => {
        it("should outperform Map implementation in realistic trading scenarios", () => {
            const size = 1000; // Typical orderbook depth
            buildOrderBook(rbtOrderBook, mapOrderBook, size);

            // Simulate real trading pattern: frequent best quote checks with occasional updates
            const tradingSimulation = (orderbook: any) => {
                let totalValue = 0;

                // Simulate 1000 trading cycles
                for (let cycle = 0; cycle < 1000; cycle++) {
                    // Multiple best quote checks per cycle (realistic pattern)
                    for (let i = 0; i < 10; i++) {
                        totalValue += orderbook.getBestBid();
                        totalValue += orderbook.getBestAsk();
                        totalValue += orderbook.getSpread();
                    }

                    // Occasional update (every 10th cycle)
                    if (cycle % 10 === 0) {
                        const update: SpotWebsocketStreams.DiffBookDepthResponse =
                            {
                                e: "depthUpdate",
                                E: Date.now(),
                                s: "BTCUSDT",
                                U: 3000 + cycle,
                                u: 3000 + cycle,
                                b: [
                                    [
                                        (49 + Math.random()).toFixed(2),
                                        (Math.random() * 500).toFixed(0),
                                    ],
                                ],
                                a: [
                                    [
                                        (51 + Math.random()).toFixed(2),
                                        (Math.random() * 500).toFixed(0),
                                    ],
                                ],
                            };
                        orderbook.updateDepth(update);
                    }
                }

                return totalValue;
            };

            // Measure RedBlackTree performance in trading simulation
            const rbtMeasurement = measureExecutionTime(() =>
                tradingSimulation(rbtOrderBook)
            );

            // Measure Map performance in trading simulation
            const mapMeasurement = measureExecutionTime(() =>
                tradingSimulation(mapOrderBook)
            );

            // Verify identical results
            expect(rbtMeasurement.result).toBeCloseTo(mapMeasurement.result, 2);

            // RedBlackTree should significantly outperform Map
            const improvement = mapMeasurement.timeMs / rbtMeasurement.timeMs;
            expect(improvement).toBeGreaterThan(3); // At least 3x improvement

            console.log(
                `Trading simulation improvement: ${improvement.toFixed(1)}x (RBT: ${rbtMeasurement.timeMs.toFixed(2)}ms, Map: ${mapMeasurement.timeMs.toFixed(2)}ms)`
            );
        });
    });

    describe("Latency Distribution Analysis", () => {
        it("should have consistent low-latency performance characteristics", () => {
            const size = 2000;
            buildOrderBook(rbtOrderBook, mapOrderBook, size);

            // Measure many individual operations to analyze latency distribution
            const rbtLatencies: number[] = [];
            const mapLatencies: number[] = [];

            for (let i = 0; i < 1000; i++) {
                // Measure individual RedBlackTree operation
                const rbtStart = performance.now();
                const rbtBid = rbtOrderBook.getBestBid();
                const rbtEnd = performance.now();
                rbtLatencies.push(rbtEnd - rbtStart);

                // Measure individual Map operation
                const mapStart = performance.now();
                const mapBid = mapOrderBook.getBestBid();
                const mapEnd = performance.now();
                mapLatencies.push(mapEnd - mapStart);

                expect(rbtBid).toBe(mapBid); // Verify consistency
            }

            // Calculate latency statistics
            const rbtAvg =
                rbtLatencies.reduce((a, b) => a + b) / rbtLatencies.length;
            const mapAvg =
                mapLatencies.reduce((a, b) => a + b) / mapLatencies.length;

            const rbtP95 = rbtLatencies.sort((a, b) => a - b)[
                Math.floor(rbtLatencies.length * 0.95)
            ];
            const mapP95 = mapLatencies.sort((a, b) => a - b)[
                Math.floor(mapLatencies.length * 0.95)
            ];

            console.log(
                `Latency comparison - RBT avg: ${rbtAvg.toFixed(4)}ms, Map avg: ${mapAvg.toFixed(4)}ms`
            );
            console.log(
                `P95 latency - RBT: ${rbtP95.toFixed(4)}ms, Map: ${mapP95.toFixed(4)}ms`
            );

            // RedBlackTree should have better average and P95 latency
            expect(rbtAvg).toBeLessThan(mapAvg);
            expect(rbtP95).toBeLessThan(mapP95);
        });
    });
});
