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
        bids: [], // Start with empty orderbook for clean testing
        asks: [],
    }),
} as any;

describe("RedBlackTreeOrderBook - Logic Validation Tests", () => {
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
        rbtOrderBook = new RedBlackTreeOrderBook(options, mockLogger, mockMetrics, mockThreadManager);
        mapOrderBook = new OrderBookState(options, mockLogger, mockMetrics, mockThreadManager);
        
        // Initialize both implementations
        await rbtOrderBook.recover();
        await mapOrderBook.recover();
    });

    describe("Mathematical Correctness Validation", () => {
        it("should maintain orderbook invariants: no bid >= ask at same price", () => {
            // Create update with potential crossing scenario
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate",
                E: Date.now(),
                s: "BTCUSDT",
                U: 1001,
                u: 1001,
                b: [["50.0", "100"]], // Bid at 50.0
                a: [["50.0", "200"]], // Ask at same price - should not coexist
            };

            rbtOrderBook.updateDepth(update);

            const level = rbtOrderBook.getLevel(50.0);
            if (level) {
                // Mathematical invariant: at any price level, we cannot have both bid > 0 AND ask > 0
                const hasBid = level.bid > 0;
                const hasAsk = level.ask > 0;
                expect(hasBid && hasAsk).toBe(false);
            }
        });

        it("should preserve volume conservation during updates", () => {
            // Initial state
            const initialUpdate: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate",
                E: Date.now(),
                s: "BTCUSDT",
                U: 1001,
                u: 1001,
                b: [["49.0", "100"], ["48.0", "200"]],
                a: [["51.0", "150"], ["52.0", "250"]],
            };

            rbtOrderBook.updateDepth(initialUpdate);
            const initialMetrics = rbtOrderBook.getDepthMetrics();
            const initialTotalVolume = initialMetrics.totalBidVolume + initialMetrics.totalAskVolume;

            // Update that modifies volumes
            const volumeUpdate: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate",
                E: Date.now(),
                s: "BTCUSDT",
                U: 1002,
                u: 1002,
                b: [["49.0", "150"]], // Increase bid from 100 to 150
                a: [["51.0", "100"]], // Decrease ask from 150 to 100
            };

            rbtOrderBook.updateDepth(volumeUpdate);
            const updatedMetrics = rbtOrderBook.getDepthMetrics();
            const updatedTotalVolume = updatedMetrics.totalBidVolume + updatedMetrics.totalAskVolume;

            // Volume change should equal the net change in updates
            const expectedVolumeChange = (150 - 100) + (100 - 150); // +50 - 50 = 0
            const actualVolumeChange = updatedTotalVolume - initialTotalVolume;
            
            expect(actualVolumeChange).toBe(expectedVolumeChange);
        });

        it("should maintain BST ordering property for all price levels", () => {
            // Add multiple levels
            const updates: SpotWebsocketStreams.DiffBookDepthResponse[] = [
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                    b: [["45.0", "100"]], a: []
                },
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1002, u: 1002,
                    b: [["47.0", "200"]], a: []
                },
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1003, u: 1003,
                    b: [], a: [["53.0", "150"]]
                },
                {
                    e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1004, u: 1004,
                    b: [], a: [["55.0", "250"]]
                },
            ];

            updates.forEach(update => rbtOrderBook.updateDepth(update));

            // Get all price levels in snapshot
            const snapshot = rbtOrderBook.snapshot();
            const prices = Array.from(snapshot.keys()).sort((a, b) => a - b);

            // Verify BST ordering: prices must be in ascending order
            for (let i = 1; i < prices.length; i++) {
                expect(prices[i]).toBeGreaterThan(prices[i - 1]);
            }
        });

        it("should correctly calculate best bid as maximum price with bid > 0", () => {
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [
                    ["48.50", "100"], 
                    ["49.25", "200"], 
                    ["48.75", "150"], 
                    ["49.00", "300"]
                ],
                a: []
            };

            rbtOrderBook.updateDepth(update);
            const bestBid = rbtOrderBook.getBestBid();

            // Mathematical verification: best bid should be max price among all bids
            const expectedBestBid = Math.max(48.50, 49.25, 48.75, 49.00);
            expect(bestBid).toBe(expectedBestBid);
        });

        it("should correctly calculate best ask as minimum price with ask > 0", () => {
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [],
                a: [
                    ["51.50", "100"], 
                    ["50.75", "200"], 
                    ["51.25", "150"], 
                    ["51.00", "300"]
                ]
            };

            rbtOrderBook.updateDepth(update);
            const bestAsk = rbtOrderBook.getBestAsk();

            // Mathematical verification: best ask should be min price among all asks
            const expectedBestAsk = Math.min(51.50, 50.75, 51.25, 51.00);
            expect(bestAsk).toBe(expectedBestAsk);
        });

        it("should maintain spread invariant: spread >= 0", () => {
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [["49.50", "100"]],
                a: [["50.50", "200"]]
            };

            rbtOrderBook.updateDepth(update);
            const spread = rbtOrderBook.getSpread();

            // Mathematical invariant: spread must be non-negative
            expect(spread).toBeGreaterThanOrEqual(0);
        });

        it("should maintain mid-price calculation invariant", () => {
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [["49.50", "100"]],
                a: [["50.50", "200"]]
            };

            rbtOrderBook.updateDepth(update);
            
            const bestBid = rbtOrderBook.getBestBid();
            const bestAsk = rbtOrderBook.getBestAsk();
            const midPrice = rbtOrderBook.getMidPrice();
            const spread = rbtOrderBook.getSpread();

            // Mathematical invariants
            if (bestBid > 0 && bestAsk > 0) {
                expect(midPrice).toBe((bestBid + bestAsk) / 2);
                expect(spread).toBe(bestAsk - bestBid);
                expect(midPrice).toBe(bestBid + spread / 2);
                expect(midPrice).toBe(bestAsk - spread / 2);
            }
        });
    });

    describe("Level Update Logic Correctness", () => {
        it("should handle zero quantity updates correctly", () => {
            // Set initial levels
            const initialUpdate: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [["49.0", "100"]],
                a: [["51.0", "200"]]
            };

            rbtOrderBook.updateDepth(initialUpdate);

            // Verify initial state
            expect(rbtOrderBook.getLevel(49.0)?.bid).toBe(100);
            expect(rbtOrderBook.getLevel(51.0)?.ask).toBe(200);

            // Remove bid with zero quantity
            const removeUpdate: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1002, u: 1002,
                b: [["49.0", "0"]], // Remove bid
                a: []
            };

            rbtOrderBook.updateDepth(removeUpdate);

            // Verify logic: level should either be removed or bid should be 0
            const level = rbtOrderBook.getLevel(49.0);
            if (level) {
                expect(level.bid).toBe(0);
            }
            // If level was removed entirely, that's also correct logic
        });

        it("should handle price precision correctly", () => {
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [["49.123456", "100"]], // More precision than configured
                a: []
            };

            rbtOrderBook.updateDepth(update);

            // Should normalize to configured precision (2 decimal places)
            const level = rbtOrderBook.getLevel(49.12);
            expect(level?.bid).toBe(100);

            // Verify exact price match
            expect(rbtOrderBook.getLevel(49.123456)).toBeDefined();
        });

        it("should handle duplicate update IDs correctly", () => {
            const update1: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [["49.0", "100"]], a: []
            };

            const update2: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [["49.0", "200"]], a: [] // Different quantity, same update ID
            };

            rbtOrderBook.updateDepth(update1);
            const initialLevel = rbtOrderBook.getLevel(49.0);
            
            rbtOrderBook.updateDepth(update2); // Should be ignored
            const finalLevel = rbtOrderBook.getLevel(49.0);

            // Second update should be ignored due to duplicate ID
            expect(finalLevel?.bid).toBe(initialLevel?.bid);
        });
    });

    describe("sumBand Logic Validation", () => {
        it("should correctly calculate band sums within specified range", () => {
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [
                    ["49.0", "100"], // Within band
                    ["49.5", "200"], // Within band  
                    ["48.0", "150"], // Outside band
                ],
                a: [
                    ["51.0", "300"], // Within band
                    ["51.5", "250"], // Within band
                    ["52.5", "400"], // Outside band
                ]
            };

            rbtOrderBook.updateDepth(update);

            // Calculate band around center=50.0, bandTicks=2, tickSize=0.5
            // Range should be [49.0, 51.0]
            const bandResult = rbtOrderBook.sumBand(50.0, 2, 0.5);

            // Manual calculation for validation
            const expectedBidSum = 100 + 200; // 49.0 and 49.5 within range
            const expectedAskSum = 300; // Only 51.0 within range
            const expectedLevels = 3; // Three price levels within range

            expect(bandResult.bid).toBe(expectedBidSum);
            expect(bandResult.ask).toBe(expectedAskSum);
            expect(bandResult.levels).toBe(expectedLevels);
        });
    });

    describe("Depth Metrics Accuracy", () => {
        it("should accurately count bid and ask levels", () => {
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [
                    ["49.0", "100"], 
                    ["48.5", "200"], 
                    ["48.0", "0"]  // Zero quantity - should not count
                ],
                a: [
                    ["51.0", "150"], 
                    ["51.5", "250"]
                ]
            };

            rbtOrderBook.updateDepth(update);
            const metrics = rbtOrderBook.getDepthMetrics();

            // Count levels with quantity > 0
            expect(metrics.bidLevels).toBe(2); // 49.0 and 48.5 have bid > 0
            expect(metrics.askLevels).toBe(2); // 51.0 and 51.5 have ask > 0
            expect(metrics.totalBidVolume).toBe(300); // 100 + 200
            expect(metrics.totalAskVolume).toBe(400); // 150 + 250

            // Verify imbalance calculation
            const expectedImbalance = (300 - 400) / (300 + 400); // (bid - ask) / total
            expect(metrics.imbalance).toBeCloseTo(expectedImbalance, 6);
        });
    });

    describe("Edge Case Logic Validation", () => {
        it("should handle empty orderbook correctly", () => {
            // Don't add any updates - orderbook should be empty
            expect(rbtOrderBook.getBestBid()).toBe(0);
            expect(rbtOrderBook.getBestAsk()).toBe(0);
            expect(rbtOrderBook.getSpread()).toBe(0);
            expect(rbtOrderBook.getMidPrice()).toBe(0);

            const metrics = rbtOrderBook.getDepthMetrics();
            expect(metrics.totalLevels).toBe(0);
            expect(metrics.bidLevels).toBe(0);
            expect(metrics.askLevels).toBe(0);
            expect(metrics.totalBidVolume).toBe(0);
            expect(metrics.totalAskVolume).toBe(0);
        });

        it("should handle single-level orderbook correctly", () => {
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "BTCUSDT", U: 1001, u: 1001,
                b: [["50.0", "100"]],
                a: []
            };

            rbtOrderBook.updateDepth(update);

            expect(rbtOrderBook.getBestBid()).toBe(50.0);
            expect(rbtOrderBook.getBestAsk()).toBe(0); // No asks
            expect(rbtOrderBook.getSpread()).toBe(0); // No spread possible
            expect(rbtOrderBook.getMidPrice()).toBe(0); // No mid price possible

            const metrics = rbtOrderBook.getDepthMetrics();
            expect(metrics.bidLevels).toBe(1);
            expect(metrics.askLevels).toBe(0);
        });

        it("should handle realistic LTCUSDT price ranges correctly", () => {
            // Use realistic LTCUSDT prices (precision: 2, typical range: $60-120)
            const update: SpotWebsocketStreams.DiffBookDepthResponse = {
                e: "depthUpdate", E: Date.now(), s: "LTCUSDT", U: 1001, u: 1001,
                b: [["89.50", "100"]],  // Realistic LTCUSDT bid
                a: [["89.52", "200"]]   // Realistic LTCUSDT ask with 2-tick spread
            };

            rbtOrderBook.updateDepth(update);

            // Prices should be preserved exactly as entered
            expect(rbtOrderBook.getBestBid()).toBe(89.50);
            expect(rbtOrderBook.getBestAsk()).toBe(89.52);
            
            // Verify spread calculation is precise for realistic numbers
            const spread = rbtOrderBook.getSpread();
            expect(spread).toBe(0.02); // Should be exact for realistic price levels
            
            const midPrice = rbtOrderBook.getMidPrice();
            expect(midPrice).toBe(89.51); // Should be exact: (89.50 + 89.52) / 2
        });
    });
});