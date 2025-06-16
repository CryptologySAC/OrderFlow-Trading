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
        bids: [], // Start with empty orderbook for consistent testing
        asks: [],
    }),
} as any;

describe("RedBlackTree vs Map OrderBook - Cross-Implementation Comparison", () => {
    let rbtOrderBook: RedBlackTreeOrderBook;
    let mapOrderBook: OrderBookState;
    
    const options: OrderBookStateOptions = {
        pricePrecision: 2,
        symbol: "BTCUSDT",
        maxLevels: 1000,
        maxPriceDistance: 0.1,
        pruneIntervalMs: 30000,
        maxErrorRate: 10,
        staleThresholdMs: 300000,
    };

    beforeEach(async () => {
        // Reset mocks
        vi.clearAllMocks();
        
        // Create fresh instances
        rbtOrderBook = new RedBlackTreeOrderBook(options, mockLogger, mockMetrics, mockThreadManager);
        mapOrderBook = new OrderBookState(options, mockLogger, mockMetrics, mockThreadManager);
        
        // Initialize both implementations with same data
        await rbtOrderBook.recover();
        await mapOrderBook.recover();
    });

    /**
     * Helper function to apply identical updates to both implementations
     */
    function applyUpdatesToBoth(updates: SpotWebsocketStreams.DiffBookDepthResponse[]): void {
        updates.forEach(update => {
            // Apply exact same update to both implementations
            rbtOrderBook.updateDepth(update);
            mapOrderBook.updateDepth(update);
        });
    }

    /**
     * Helper function to compare all key metrics between implementations
     */
    function compareImplementations(testName: string): void {
        // Compare best quotes
        const rbtBestBid = rbtOrderBook.getBestBid();
        const mapBestBid = mapOrderBook.getBestBid();
        expect(rbtBestBid).toBe(mapBestBid);

        const rbtBestAsk = rbtOrderBook.getBestAsk();
        const mapBestAsk = mapOrderBook.getBestAsk();
        expect(rbtBestAsk).toBe(mapBestAsk);

        // Compare derived calculations
        const rbtSpread = rbtOrderBook.getSpread();
        const mapSpread = mapOrderBook.getSpread();
        expect(rbtSpread).toBeCloseTo(mapSpread, 6);

        const rbtMidPrice = rbtOrderBook.getMidPrice();
        const mapMidPrice = mapOrderBook.getMidPrice();
        expect(rbtMidPrice).toBeCloseTo(mapMidPrice, 6);

        // Compare depth metrics
        const rbtMetrics = rbtOrderBook.getDepthMetrics();
        const mapMetrics = mapOrderBook.getDepthMetrics();
        
        expect(rbtMetrics.bidLevels).toBe(mapMetrics.bidLevels);
        expect(rbtMetrics.askLevels).toBe(mapMetrics.askLevels);
        expect(rbtMetrics.totalBidVolume).toBeCloseTo(mapMetrics.totalBidVolume, 6);
        expect(rbtMetrics.totalAskVolume).toBeCloseTo(mapMetrics.totalAskVolume, 6);
        expect(rbtMetrics.imbalance).toBeCloseTo(mapMetrics.imbalance, 6);
    }

    describe("Identical Behavior Validation", () => {
        it("should produce identical results for basic bid/ask updates", () => {
            const updates: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                    b: [["49.0", "100"], ["48.5", "200"]],
                    a: [["51.0", "150"], ["51.5", "250"]]
                }
            ];

            applyUpdatesToBoth(updates);
            compareImplementations("basic bid/ask updates");
        });

        it("should produce identical results for zero quantity removals", () => {
            // First add some levels
            const initialUpdates: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                    b: [["49.0", "100"], ["48.5", "200"], ["48.0", "300"]],
                    a: [["51.0", "150"], ["51.5", "250"], ["52.0", "350"]]
                }
            ];

            applyUpdatesToBoth(initialUpdates);

            // Then remove some levels with zero quantities
            const removalUpdates: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1002, u: 1002,
                    b: [["48.5", "0"]], // Remove middle bid
                    a: [["51.5", "0"]] // Remove middle ask
                }
            ];

            applyUpdatesToBoth(removalUpdates);
            compareImplementations("zero quantity removals");
        });

        it("should produce identical results for complex update sequences", () => {
            const complexUpdates: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                // Initial setup
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                    b: [["49.0", "100"], ["48.5", "200"]],
                    a: [["51.0", "150"], ["51.5", "250"]]
                },
                // Add more levels
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1002, u: 1002,
                    b: [["49.5", "300"], ["47.5", "400"]],
                    a: [["50.5", "350"], ["52.5", "450"]]
                },
                // Update existing levels
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1003, u: 1003,
                    b: [["49.0", "150"]], // Update existing bid
                    a: [["51.0", "200"]] // Update existing ask
                },
                // Remove some levels
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1004, u: 1004,
                    b: [["47.5", "0"]], // Remove lowest bid
                    a: [["52.5", "0"]] // Remove highest ask
                },
            ];

            applyUpdatesToBoth(complexUpdates);
            compareImplementations("complex update sequences");
        });

        it("should produce identical results for price level queries", () => {
            const updates: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                    b: [["49.0", "100"], ["48.5", "200"], ["48.0", "300"]],
                    a: [["51.0", "150"], ["51.5", "250"], ["52.0", "350"]]
                }
            ];

            applyUpdatesToBoth(updates);

            // Test getLevel for each price
            const testPrices = [48.0, 48.5, 49.0, 51.0, 51.5, 52.0, 50.0]; // Include non-existent price

            testPrices.forEach(price => {
                const rbtLevel = rbtOrderBook.getLevel(price);
                const mapLevel = mapOrderBook.getLevel(price);

                if (rbtLevel && mapLevel) {
                    expect(rbtLevel.price).toBe(mapLevel.price);
                    expect(rbtLevel.bid).toBe(mapLevel.bid);
                    expect(rbtLevel.ask).toBe(mapLevel.ask);
                } else {
                    expect(rbtLevel).toBe(mapLevel); // Both should be undefined
                }
            });
        });

        it("should produce identical results for sumBand calculations", () => {
            const updates: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                    b: [
                        ["48.0", "100"], ["48.5", "200"], ["49.0", "300"], 
                        ["49.5", "400"], ["50.0", "500"]
                    ],
                    a: [
                        ["50.5", "150"], ["51.0", "250"], ["51.5", "350"], 
                        ["52.0", "450"], ["52.5", "550"]
                    ]
                }
            ];

            applyUpdatesToBoth(updates);

            // Test various band configurations
            const bandTests = [
                { center: 50.0, bandTicks: 1, tickSize: 0.5 },
                { center: 49.5, bandTicks: 2, tickSize: 0.25 },
                { center: 51.0, bandTicks: 3, tickSize: 0.5 },
                { center: 50.25, bandTicks: 4, tickSize: 0.25 },
            ];

            bandTests.forEach(({ center, bandTicks, tickSize }) => {
                const rbtBand = rbtOrderBook.sumBand(center, bandTicks, tickSize);
                const mapBand = mapOrderBook.sumBand(center, bandTicks, tickSize);

                expect(rbtBand.bid).toBeCloseTo(mapBand.bid, 6);
                expect(rbtBand.ask).toBeCloseTo(mapBand.ask, 6);
                expect(rbtBand.levels).toBe(mapBand.levels);
            });
        });

        it("should produce identical snapshots", () => {
            const updates: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                    b: [["49.0", "100"], ["48.5", "200"]],
                    a: [["51.0", "150"], ["51.5", "250"]]
                }
            ];

            applyUpdatesToBoth(updates);

            const rbtSnapshot = rbtOrderBook.snapshot();
            const mapSnapshot = mapOrderBook.snapshot();

            // Compare snapshot sizes
            expect(rbtSnapshot.size).toBe(mapSnapshot.size);

            // Compare each level in snapshots
            for (const [price, rbtLevel] of rbtSnapshot) {
                const mapLevel = mapSnapshot.get(price);
                expect(mapLevel).toBeDefined();
                
                if (mapLevel) {
                    expect(rbtLevel.price).toBe(mapLevel.price);
                    expect(rbtLevel.bid).toBe(mapLevel.bid);
                    expect(rbtLevel.ask).toBe(mapLevel.ask);
                    // Note: timestamps might differ slightly, so we don't compare them
                }
            }

            // Ensure no extra levels in map snapshot
            for (const price of mapSnapshot.keys()) {
                expect(rbtSnapshot.has(price)).toBe(true);
            }
        });
    });

    describe("Property-Based Testing with Random Updates", () => {
        /**
         * Generate random orderbook updates for property-based testing
         */
        function generateRandomUpdates(count: number): SpotWebsocketStreams.DiffBookDepthResponse[] {
            const updates: SpotWebsocketStreams.DiffBookDepthResponse[] = [];
            let updateId = 1001;

            for (let i = 0; i < count; i++) {
                const bidCount = Math.floor(Math.random() * 5); // 0-4 bid updates
                const askCount = Math.floor(Math.random() * 5); // 0-4 ask updates

                const bids: [string, string][] = [];
                const asks: [string, string][] = [];

                // Generate random bids
                for (let j = 0; j < bidCount; j++) {
                    const price = (45 + Math.random() * 5).toFixed(2); // 45-50 range
                    const quantity = Math.random() < 0.1 ? "0" : (Math.random() * 1000).toFixed(0); // 10% chance of removal
                    bids.push([price, quantity]);
                }

                // Generate random asks
                for (let j = 0; j < askCount; j++) {
                    const price = (50 + Math.random() * 5).toFixed(2); // 50-55 range
                    const quantity = Math.random() < 0.1 ? "0" : (Math.random() * 1000).toFixed(0); // 10% chance of removal
                    asks.push([price, quantity]);
                }

                updates.push({
                    e: "depthUpdate",
                    E: Date.now(),
                    s: "BTCUSDT",
                    U: updateId,
                    u: updateId,
                    b: bids,
                    a: asks
                });

                updateId++;
            }

            return updates;
        }

        it("should produce identical results for random update sequences", () => {
            // Generate multiple random test cases
            for (let testCase = 0; testCase < 10; testCase++) {
                // Reset both implementations
                rbtOrderBook.shutdown();
                mapOrderBook.shutdown();
                
                rbtOrderBook = new RedBlackTreeOrderBook(options, mockLogger, mockMetrics, mockThreadManager);
                mapOrderBook = new OrderBookState(options, mockLogger, mockMetrics, mockThreadManager);

                // Generate random updates for this test case
                const randomUpdates = generateRandomUpdates(20);
                
                try {
                    applyUpdatesToBoth(randomUpdates);
                    compareImplementations(`random test case ${testCase}`);
                } catch (error) {
                    console.error(`Random test case ${testCase} failed with updates:`, randomUpdates);
                    throw error;
                }
            }
        });

        it("should handle edge cases identically", () => {
            const edgeCases: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                // Empty update
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                    b: [], a: []
                },
                // Very small quantities
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1002, u: 1002,
                    b: [["49.0", "0.00001"]], a: [["51.0", "0.00001"]]
                },
                // Very large quantities
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1003, u: 1003,
                    b: [["48.5", "999999999"]], a: [["51.5", "999999999"]]
                },
                // Precision edge cases - use properly rounded values for comparison
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1004, u: 1004,
                    b: [["49.99", "100"]], a: [["50.01", "100"]] // Use properly rounded values
                },
            ];

            applyUpdatesToBoth(edgeCases);
            compareImplementations("edge cases");
        });
    });

    describe("Performance Comparison Validation", () => {
        it("should produce identical results under high-frequency updates", () => {
            // Generate a high number of updates to test performance and consistency
            const highFrequencyUpdates: SpotWebsocketStreams.DiffBookDepthResponse[] = [];
            
            for (let i = 0; i < 1000; i++) {
                highFrequencyUpdates.push({
                    e: "depthUpdate",
                    E: Date.now(),
                    s: "BTCUSDT",
                    U: 1001 + i,
                    u: 1001 + i,
                    b: [[(49 + Math.random()).toFixed(2), (Math.random() * 1000).toFixed(0)]],
                    a: [[(51 + Math.random()).toFixed(2), (Math.random() * 1000).toFixed(0)]]
                });
            }

            // Apply all updates to both implementations
            applyUpdatesToBoth(highFrequencyUpdates);
            
            // Verify they still produce identical results
            compareImplementations("high-frequency updates");
        });

        it("should maintain consistency after many operations", () => {
            // Perform many different types of operations
            const operationSequence: SpotWebsocketStreams.DiffBookDepthResponse[] = [];
            
            // Build up orderbook
            for (let i = 0; i < 100; i++) {
                operationSequence.push({
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001 + i, u: 1001 + i,
                    b: [[(49 - i * 0.01).toFixed(2), "100"]],
                    a: [[(51 + i * 0.01).toFixed(2), "100"]]
                });
            }

            // Modify levels
            for (let i = 0; i < 50; i++) {
                operationSequence.push({
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1101 + i, u: 1101 + i,
                    b: [[(49 - i * 0.01).toFixed(2), (200 + i).toString()]],
                    a: [[(51 + i * 0.01).toFixed(2), (200 + i).toString()]]
                });
            }

            // Remove some levels
            for (let i = 0; i < 25; i++) {
                operationSequence.push({
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1151 + i, u: 1151 + i,
                    b: [[(49 - i * 0.02).toFixed(2), "0"]],
                    a: [[(51 + i * 0.02).toFixed(2), "0"]]
                });
            }

            applyUpdatesToBoth(operationSequence);
            compareImplementations("many operations sequence");
        });
    });
});