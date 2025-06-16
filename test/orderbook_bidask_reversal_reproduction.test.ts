import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookState } from "../src/market/orderBookState.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IBinanceDataFeed } from "../utils/binance.js";
import type { SpotWebsocketStreams } from "@binance/spot";

/**
 * 🎯 REPRODUCTION TEST: Bid/Ask Reversal Issue
 *
 * This test is designed to reproduce the EXACT issue reported by the user:
 * "bids and asks are swapped where they meet"
 *
 * Based on analysis, the issue likely occurs due to timing or ordering
 * of bid/ask updates that create a specific sequence that confuses the tree logic.
 */
describe("OrderBook Bid/Ask Reversal Reproduction", () => {
    let orderBookState: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockBinanceFeed: IBinanceDataFeed;

    beforeEach(async () => {
        // Enhanced mock logger to capture all debugging information
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn(() => true),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            getMetrics: vi.fn(() => ({
                counters: {},
                gauges: {},
                histograms: {},
            })),
            createCounter: vi.fn(),
            createGauge: vi.fn(),
            createHistogram: vi.fn(),
            incrementCounter: vi.fn(),
            setGauge: vi.fn(),
            recordHistogram: vi.fn(),
        };

        // Mock binance feed for orderbook initialization
        mockBinanceFeed = {
            getDepthSnapshot: vi.fn().mockResolvedValue({
                lastUpdateId: 1000,
                bids: [["50000.00", "1.0"]],
                asks: [["50010.00", "1.0"]],
            }),
            disconnect: vi.fn().mockResolvedValue(undefined),
            tradesAggregate: vi.fn(),
            depthStream: vi.fn(),
            depthSnapshotStream: vi.fn(),
        };

        // Create OrderBookState with proper initialization
        orderBookState = await OrderBookState.create(
            {
                pricePrecision: 2,
                symbol: "BTCUSDT",
                maxLevels: 1000,
                maxPriceDistance: 0.1,
                pruneIntervalMs: 30000,
                maxErrorRate: 10,
                staleThresholdMs: 300000,
            },
            mockLogger,
            mockMetrics,
            mockBinanceFeed
        );
    });

    /**
     * 🚨 CRITICAL REPRODUCTION TEST: Sequence-dependent bid/ask reversal
     *
     * This test creates a specific sequence of updates that should trigger
     * the reversal issue through a combination of factors:
     * 1. Initial bid/ask setup with separation
     * 2. Rapid updates that cross the spread temporarily
     * 3. Purge logic that might get confused about which levels to keep
     */
    it("should reproduce bid/ask reversal through specific update sequence", async () => {
        console.log("🚨 CRITICAL: Attempting to reproduce bid/ask reversal");

        // STEP 1: Establish initial stable orderbook
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [
                ["49995.00", "1.0"],
                ["49990.00", "2.0"],
            ],
            a: [
                ["50005.00", "1.0"],
                ["50010.00", "2.0"],
            ],
        });

        console.log("📊 STEP 1 - Initial stable orderbook:");
        let bid = orderBookState.getBestBid();
        let ask = orderBookState.getBestAsk();
        console.log(`   Bid: ${bid}, Ask: ${ask}, Spread: ${ask - bid}`);

        // STEP 2: Create a crossing update where bid and ask prices reverse
        // This simulates real market conditions where liquidity is added simultaneously
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1002,
            u: 1002,
            b: [
                ["50003.00", "1.5"], // Bid crosses into ask territory
                ["50001.00", "2.0"], // Bid crosses into ask territory
            ],
            a: [
                ["49999.00", "1.8"], // Ask crosses into bid territory
                ["50002.00", "1.2"], // Ask crosses into bid territory
            ],
        });

        console.log("📊 STEP 2 - After crossing update:");
        bid = orderBookState.getBestBid();
        ask = orderBookState.getBestAsk();
        console.log(`   Bid: ${bid}, Ask: ${ask}, Spread: ${ask - bid}`);

        // STEP 3: Check if we have a reversal
        const isReversed = bid > ask && ask !== 0;
        if (isReversed) {
            console.log("🎉 SUCCESS! Reproduced bid/ask reversal:");
            console.log(`   Bid (${bid}) > Ask (${ask})`);
            console.log(`   Negative spread: ${ask - bid}`);
        }

        // STEP 4: Analyze the orderbook state in detail
        const snapshot = orderBookState.snapshot();
        const levels = Array.from(snapshot.entries())
            .sort(([a], [b]) => a - b)
            .filter(([_, level]) => level.bid > 0 || level.ask > 0);

        console.log("📸 Detailed orderbook state:");
        levels.forEach(([price, level]) => {
            const type =
                level.bid > 0 && level.ask > 0
                    ? "🚨 BOTH"
                    : level.bid > 0
                      ? "📈 BID"
                      : "📉 ASK";
            console.log(
                `   ${price}: ${type} (bid=${level.bid}, ask=${level.ask})`
            );
        });

        // STEP 5: Check for specific patterns that indicate the issue
        const bidPrices = levels
            .filter(([_, level]) => level.bid > 0)
            .map(([price]) => price);
        const askPrices = levels
            .filter(([_, level]) => level.ask > 0)
            .map(([price]) => price);

        console.log("🔍 Price analysis:");
        console.log(`   Bid prices: [${bidPrices.join(", ")}]`);
        console.log(`   Ask prices: [${askPrices.join(", ")}]`);

        if (bidPrices.length > 0 && askPrices.length > 0) {
            const highestBid = Math.max(...bidPrices);
            const lowestAsk = Math.min(...askPrices);
            console.log(
                `   Highest bid: ${highestBid}, Lowest ask: ${lowestAsk}`
            );
            console.log(`   Prices overlap: ${highestBid > lowestAsk}`);
        }

        // This test should FAIL if we successfully reproduce the issue
        if (isReversed) {
            console.log(
                "✅ REPRODUCTION SUCCESSFUL - Test will fail to demonstrate issue"
            );
            expect(false).toBe(true); // Intentionally fail to highlight the issue
        }
    });

    /**
     * 🎯 SPECIFIC PATTERN TEST: Aggressive crossing scenario
     *
     * This test simulates an extremely aggressive market condition where
     * multiple bids and asks cross each other significantly.
     */
    it("should handle aggressive crossing without reversal", async () => {
        console.log(
            "🎯 AGGRESSIVE CROSSING: Testing extreme market conditions"
        );

        // STEP 1: Set up wide spread
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [["49900.00", "5.0"]],
            a: [["50100.00", "5.0"]],
        });

        console.log("📊 Initial wide spread:");
        console.log(
            `   Bid: ${orderBookState.getBestBid()}, Ask: ${orderBookState.getBestAsk()}`
        );

        // STEP 2: Aggressively cross with large quantities
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1002,
            u: 1002,
            b: [
                ["50050.00", "10.0"], // Bid way above ask
                ["50040.00", "8.0"],
                ["50030.00", "6.0"],
                ["50020.00", "4.0"],
            ],
            a: [
                ["49950.00", "10.0"], // Ask way below bid
                ["49960.00", "8.0"],
                ["49970.00", "6.0"],
                ["49980.00", "4.0"],
            ],
        });

        console.log("📊 After aggressive crossing:");
        const bid = orderBookState.getBestBid();
        const ask = orderBookState.getBestAsk();
        console.log(`   Bid: ${bid}, Ask: ${ask}, Spread: ${ask - bid}`);

        // STEP 3: Verify no reversal occurred
        const isReversed = bid > ask && ask !== 0;
        console.log(`   Quotes reversed: ${isReversed}`);

        if (isReversed) {
            console.log("🚨 REVERSAL DETECTED in aggressive crossing!");

            // Show the problematic state
            const snapshot = orderBookState.snapshot();
            console.log("📸 Snapshot showing reversal:");
            Array.from(snapshot.entries())
                .sort(([a], [b]) => a - b)
                .forEach(([price, level]) => {
                    if (level.bid > 0 || level.ask > 0) {
                        const type =
                            level.bid > 0 && level.ask > 0
                                ? "🚨 BOTH"
                                : level.bid > 0
                                  ? "📈 BID"
                                  : "📉 ASK";
                        console.log(
                            `   ${price}: ${type} (bid=${level.bid}, ask=${level.ask})`
                        );
                    }
                });
        }

        expect(isReversed).toBe(false);
    });

    /**
     * 🔬 MICRO-SEQUENCE TEST: Reproduce exact timing issue
     *
     * This test reproduces the exact scenario where the issue might occur:
     * When updates arrive in a specific sequence that confuses the purge logic.
     */
    it("should detect timing-sensitive bid/ask reversal", async () => {
        console.log("🔬 MICRO-SEQUENCE: Testing timing-sensitive scenario");

        // STEP 1: Create initial tight spread
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [["49999.50", "1.0"]],
            a: [["50000.50", "1.0"]],
        });

        console.log("📊 Initial tight spread:");
        console.log(
            `   Bid: ${orderBookState.getBestBid()}, Ask: ${orderBookState.getBestAsk()}`
        );

        // STEP 2: Sequence that might trigger the issue
        // Update 1: Set bid slightly above current ask
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1002,
            u: 1002,
            b: [["50000.60", "1.5"]],
            a: [],
        });

        console.log("📊 After bid above ask:");
        console.log(
            `   Bid: ${orderBookState.getBestBid()}, Ask: ${orderBookState.getBestAsk()}`
        );

        // Update 2: Set ask slightly below current bid (without clearing the bid)
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1003,
            u: 1003,
            b: [],
            a: [["49999.40", "1.2"]],
        });

        console.log("📊 After ask below bid:");
        const bid = orderBookState.getBestBid();
        const ask = orderBookState.getBestAsk();
        console.log(`   Bid: ${bid}, Ask: ${ask}, Spread: ${ask - bid}`);

        // STEP 3: Check if this sequence caused reversal
        const isReversed = bid > ask && ask !== 0;

        if (isReversed) {
            console.log("🎉 TIMING ISSUE REPRODUCED!");
            console.log(`   Bid (${bid}) > Ask (${ask})`);

            // Show exact levels
            const level1 = orderBookState.getLevel(50000.6);
            const level2 = orderBookState.getLevel(49999.4);
            console.log(`   Level 50000.60: ${JSON.stringify(level1)}`);
            console.log(`   Level 49999.40: ${JSON.stringify(level2)}`);
        }

        expect(isReversed).toBe(false);
    });

    /**
     * 🧪 EDGE CASE: Test the specific getBestBidAsk tree traversal
     *
     * This test specifically targets potential issues with the RedBlackTree
     * getBestBidAsk() method when levels are crossed.
     */
    it("should detect RedBlackTree traversal issues", async () => {
        console.log("🧪 TREE TRAVERSAL: Testing RedBlackTree edge cases");

        // Create a scenario that might confuse tree traversal
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [
                ["50000.00", "1.0"],
                ["49999.00", "2.0"],
                ["49998.00", "3.0"],
            ],
            a: [
                ["50002.00", "1.0"],
                ["50003.00", "2.0"],
                ["50004.00", "3.0"],
            ],
        });

        // Force tree updates that might create inconsistency
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1002,
            u: 1002,
            b: [
                ["50001.50", "2.5"], // Insert between existing levels
            ],
            a: [
                ["49999.50", "1.5"], // Insert between existing levels (crosses)
            ],
        });

        const bid = orderBookState.getBestBid();
        const ask = orderBookState.getBestAsk();
        console.log(`📊 After tree manipulation: Bid=${bid}, Ask=${ask}`);

        // Get raw tree data to compare
        const snapshot = orderBookState.snapshot();
        const bidLevels = Array.from(snapshot.entries())
            .filter(([_, level]) => level.bid > 0)
            .map(([price]) => price)
            .sort((a, b) => b - a); // Descending for bids

        const askLevels = Array.from(snapshot.entries())
            .filter(([_, level]) => level.ask > 0)
            .map(([price]) => price)
            .sort((a, b) => a - b); // Ascending for asks

        console.log(`🔍 Manual traversal:`);
        console.log(`   Bid levels (desc): [${bidLevels.join(", ")}]`);
        console.log(`   Ask levels (asc): [${askLevels.join(", ")}]`);
        console.log(`   Manual best bid: ${bidLevels[0] || 0}`);
        console.log(`   Manual best ask: ${askLevels[0] || Infinity}`);

        const manualBestBid = bidLevels[0] || 0;
        const manualBestAsk = askLevels[0] || Infinity;

        // Check for discrepancies
        const bidMismatch = manualBestBid !== bid;
        const askMismatch = manualBestAsk !== ask && ask !== 0;

        if (bidMismatch || askMismatch) {
            console.log("🚨 TREE TRAVERSAL ISSUE DETECTED!");
            console.log(`   Tree says: Bid=${bid}, Ask=${ask}`);
            console.log(
                `   Manual says: Bid=${manualBestBid}, Ask=${manualBestAsk}`
            );
        }

        expect(bidMismatch).toBe(false);
        expect(askMismatch).toBe(false);
    });
});
