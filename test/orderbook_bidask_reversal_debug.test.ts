import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookState } from "../src/market/orderBookState.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IBinanceDataFeed } from "../utils/binance.js";
import type { SpotWebsocketStreams } from "@binance/spot";

/**
 * 🔍 COMPREHENSIVE BID/ASK REVERSAL DEBUG TEST
 *
 * This test is designed to systematically reproduce the exact issue where
 * "bids and asks are swapped where they meet" as reported by the user.
 *
 * The goal is to create a FAILING test that captures the reversal behavior
 * so we can fix it systematically instead of guessing.
 */
describe("OrderBook Bid/Ask Reversal Debug", () => {
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
            isDebugEnabled: vi.fn(() => true), // Enable debug logging
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
                bids: [
                    ["50000.00", "1.0"], // Initial bid at 50000
                    ["49990.00", "2.0"], // Lower bid
                ],
                asks: [
                    ["50010.00", "1.5"], // Initial ask at 50010
                    ["50020.00", "2.5"], // Higher ask
                ],
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
     * 🎯 CRITICAL TEST: Reproduce the exact reversal scenario
     *
     * This test creates a scenario where bids and asks "meet" at the same price
     * and demonstrates the reversal issue that users are experiencing.
     */
    it("should detect and debug bid/ask reversal where they meet", async () => {
        console.log("🔍 DEBUG: Starting bid/ask reversal reproduction test");

        // STEP 1: Verify initial orderbook state is correct
        const initialBid = orderBookState.getBestBid();
        const initialAsk = orderBookState.getBestAsk();

        console.log(
            `📊 Initial State: Bid=${initialBid}, Ask=${initialAsk}, Spread=${initialAsk - initialBid}`
        );

        expect(initialBid).toBeLessThan(initialAsk);
        expect(initialAsk - initialBid).toBeGreaterThan(0);

        // STEP 2: Create a scenario where bids and asks "meet"
        // This simulates real market conditions where the spread tightens
        const meetingPrice = 50005.0; // Price where they will "meet"

        const meetingUpdate: SpotWebsocketStreams.DiffBookDepthResponse = {
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [
                ["50005.00", "2.0"], // Bid moves up to meeting price
                ["50000.00", "1.0"], // Keep original bid
            ],
            a: [
                ["50005.00", "1.8"], // Ask moves down to same meeting price
                ["50010.00", "1.5"], // Keep original ask
            ],
        };

        console.log(`🎯 Applying meeting update at price: ${meetingPrice}`);
        console.log("📥 Update contains:");
        console.log(`   Bids: ${JSON.stringify(meetingUpdate.b)}`);
        console.log(`   Asks: ${JSON.stringify(meetingUpdate.a)}`);

        // STEP 3: Apply the update and capture the problematic state
        await orderBookState.updateDepth(meetingUpdate);

        // STEP 4: Analyze the resulting state
        const afterBid = orderBookState.getBestBid();
        const afterAsk = orderBookState.getBestAsk();
        const spread = afterAsk - afterBid;

        console.log(
            `📊 After Meeting Update: Bid=${afterBid}, Ask=${afterAsk}, Spread=${spread}`
        );

        // STEP 5: Get detailed level information at the meeting price
        const meetingLevel = orderBookState.getLevel(meetingPrice);
        console.log(
            `🔍 Level at meeting price (${meetingPrice}):`,
            meetingLevel
        );

        // STEP 6: Capture the full orderbook snapshot for analysis
        const snapshot = orderBookState.snapshot();
        console.log("📸 Full orderbook snapshot:");

        const sortedLevels = Array.from(snapshot.entries())
            .sort(([a], [b]) => a - b)
            .map(([price, level]) => ({
                price,
                bid: level.bid,
                ask: level.ask,
                isBidLevel: level.bid > 0,
                isAskLevel: level.ask > 0,
                hasBoth: level.bid > 0 && level.ask > 0, // This should NEVER be true
            }));

        sortedLevels.forEach((level) => {
            const type =
                level.isBidLevel && level.isAskLevel
                    ? "🚨 BOTH!"
                    : level.isBidLevel
                      ? "📈 BID"
                      : level.isAskLevel
                        ? "📉 ASK"
                        : "❌ EMPTY";
            console.log(
                `   ${level.price}: ${type} (bid=${level.bid}, ask=${level.ask})`
            );
        });

        // STEP 7: Check for the specific reversal conditions
        const levelsWithBoth = sortedLevels.filter((l) => l.hasBoth);
        const bidLevels = sortedLevels.filter(
            (l) => l.isBidLevel && !l.isAskLevel
        );
        const askLevels = sortedLevels.filter(
            (l) => l.isAskLevel && !l.isBidLevel
        );

        console.log(`🔍 Analysis Results:`);
        console.log(
            `   Levels with both bid and ask: ${levelsWithBoth.length} (should be 0)`
        );
        console.log(`   Pure bid levels: ${bidLevels.length}`);
        console.log(`   Pure ask levels: ${askLevels.length}`);

        if (levelsWithBoth.length > 0) {
            console.log("🚨 VIOLATION: Found levels with both bid and ask!");
            levelsWithBoth.forEach((level) => {
                console.log(
                    `   Price ${level.price}: bid=${level.bid}, ask=${level.ask}`
                );
            });
        }

        // STEP 8: Check for bid/ask reversal (the main issue)
        const highestBid = Math.max(...bidLevels.map((l) => l.price));
        const lowestAsk = Math.min(...askLevels.map((l) => l.price));

        console.log(`🎯 Quote Analysis:`);
        console.log(`   Highest Bid Level: ${highestBid}`);
        console.log(`   Lowest Ask Level: ${lowestAsk}`);
        console.log(`   Best Bid (from getBestBid): ${afterBid}`);
        console.log(`   Best Ask (from getBestAsk): ${afterAsk}`);

        // STEP 9: Detect the reversal pattern
        const isReversed = afterBid > afterAsk && afterAsk !== 0;
        const hasInvalidSpread = spread < 0;
        const hasSeparationViolation = levelsWithBoth.length > 0;

        console.log(`🚨 Issue Detection:`);
        console.log(`   Quotes Reversed (bid > ask): ${isReversed}`);
        console.log(`   Invalid Spread (< 0): ${hasInvalidSpread}`);
        console.log(`   Separation Violation: ${hasSeparationViolation}`);

        // STEP 10: Create specific assertions to capture the issue

        // This assertion should PASS (no levels should have both bid and ask)
        expect(levelsWithBoth.length).toBe(0);

        // This assertion should PASS (spread should not be negative)
        expect(spread).toBeGreaterThanOrEqual(0);

        // This assertion should PASS (best bid should not exceed best ask)
        if (afterAsk !== 0) {
            expect(afterBid).toBeLessThanOrEqual(afterAsk);
        }

        // If any of these fail, we've reproduced the issue!
        if (isReversed || hasInvalidSpread || hasSeparationViolation) {
            console.log("🎉 SUCCESS: Reproduced the bid/ask reversal issue!");
            console.log("📋 Debug Information Captured:");
            console.log(
                `   - Error logs: ${(mockLogger.error as any).mock.calls.length}`
            );
            console.log(
                `   - Warning logs: ${(mockLogger.warn as any).mock.calls.length}`
            );

            // Print all error logs for debugging
            if ((mockLogger.error as any).mock.calls.length > 0) {
                console.log("🚨 Error Logs:");
                (mockLogger.error as any).mock.calls.forEach(
                    (call: any, i: number) => {
                        console.log(`   ${i + 1}. ${call[0]}`);
                        if (call[1])
                            console.log(
                                `      Data: ${JSON.stringify(call[1], null, 2)}`
                            );
                    }
                );
            }
        }
    });

    /**
     * 🔄 TEST: Rapid alternating bid/ask updates at same price
     *
     * This test simulates rapid market movements where bid and ask
     * alternate at the same price level, which might trigger the reversal.
     */
    it("should handle rapid alternating bid/ask updates at same price", async () => {
        console.log("🔄 DEBUG: Testing rapid alternating updates");

        const targetPrice = 50005.0;

        // Rapid sequence of updates at the same price
        const updates = [
            // Update 1: Set bid at target price
            {
                s: "BTCUSDT",
                U: 1001,
                u: 1001,
                b: [["50005.00", "1.0"]],
                a: [],
            },
            // Update 2: Set ask at same price (should clear bid)
            {
                s: "BTCUSDT",
                U: 1002,
                u: 1002,
                b: [],
                a: [["50005.00", "1.5"]],
            },
            // Update 3: Set bid again at same price (should clear ask)
            {
                s: "BTCUSDT",
                U: 1003,
                u: 1003,
                b: [["50005.00", "2.0"]],
                a: [],
            },
            // Update 4: Set both bid and ask at same price simultaneously
            {
                s: "BTCUSDT",
                U: 1004,
                u: 1004,
                b: [["50005.00", "1.8"]],
                a: [["50005.00", "1.2"]],
            },
        ];

        for (let i = 0; i < updates.length; i++) {
            console.log(`📤 Applying update ${i + 1}/${updates.length}`);
            await orderBookState.updateDepth(
                updates[i] as SpotWebsocketStreams.DiffBookDepthResponse
            );

            const level = orderBookState.getLevel(targetPrice);
            const bid = orderBookState.getBestBid();
            const ask = orderBookState.getBestAsk();

            console.log(
                `   After update ${i + 1}: Level(${targetPrice})=${JSON.stringify(level)}, Bid=${bid}, Ask=${ask}`
            );

            // Check for violations after each update
            if (level && level.bid > 0 && level.ask > 0) {
                console.log(
                    `🚨 VIOLATION: Level has both bid and ask after update ${i + 1}`
                );
            }

            if (bid > ask && ask !== 0) {
                console.log(
                    `🚨 REVERSAL: Bid > Ask after update ${i + 1} (${bid} > ${ask})`
                );
            }
        }

        // Final state should be valid
        const finalLevel = orderBookState.getLevel(targetPrice);
        if (finalLevel) {
            expect(finalLevel.bid === 0 || finalLevel.ask === 0).toBe(true);
        }
    });

    /**
     * 🎲 TEST: Random overlapping price levels
     *
     * Creates multiple overlapping bid/ask levels to stress test
     * the separation enforcement logic.
     */
    it("should handle multiple overlapping bid/ask price levels", async () => {
        console.log("🎲 DEBUG: Testing multiple overlapping levels");

        // Create overlapping levels where bids and asks intersect
        const overlappingUpdate: SpotWebsocketStreams.DiffBookDepthResponse = {
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [
                ["50002.00", "1.0"], // Bid
                ["50004.00", "1.5"], // Bid overlaps with ask
                ["50006.00", "2.0"], // Bid overlaps with ask
                ["50008.00", "1.2"], // Bid
            ],
            a: [
                ["50003.00", "1.8"], // Ask
                ["50005.00", "2.2"], // Ask overlaps with bid
                ["50007.00", "1.9"], // Ask overlaps with bid
                ["50009.00", "1.1"], // Ask
            ],
        };

        console.log("📥 Applying overlapping update:");
        console.log(`   Bids: ${JSON.stringify(overlappingUpdate.b)}`);
        console.log(`   Asks: ${JSON.stringify(overlappingUpdate.a)}`);

        await orderBookState.updateDepth(overlappingUpdate);

        // Analyze the result
        const snapshot = orderBookState.snapshot();
        const sortedLevels = Array.from(snapshot.entries())
            .sort(([a], [b]) => a - b)
            .filter(([_, level]) => level.bid > 0 || level.ask > 0);

        console.log("📊 Final state after overlapping update:");
        sortedLevels.forEach(([price, level]) => {
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

        // Verify no level has both bid and ask
        const violatingLevels = sortedLevels.filter(
            ([_, level]) => level.bid > 0 && level.ask > 0
        );

        if (violatingLevels.length > 0) {
            console.log("🚨 SEPARATION VIOLATIONS FOUND:");
            violatingLevels.forEach(([price, level]) => {
                console.log(
                    `   Price ${price}: bid=${level.bid}, ask=${level.ask}`
                );
            });
        }

        expect(violatingLevels.length).toBe(0);

        // Verify proper bid/ask ordering
        const bidPrices = sortedLevels
            .filter(([_, level]) => level.bid > 0)
            .map(([price]) => price);
        const askPrices = sortedLevels
            .filter(([_, level]) => level.ask > 0)
            .map(([price]) => price);

        if (bidPrices.length > 0 && askPrices.length > 0) {
            const highestBid = Math.max(...bidPrices);
            const lowestAsk = Math.min(...askPrices);

            console.log(
                `🎯 Final quote analysis: Highest Bid=${highestBid}, Lowest Ask=${lowestAsk}`
            );

            expect(highestBid).toBeLessThanOrEqual(lowestAsk);
        }
    });

    /**
     * 🔄 TEST: Reproduce the specific "meeting point" scenario
     *
     * This test creates the exact scenario where bids and asks converge
     * to the same price level and checks if reversal occurs.
     */
    it("should detect reversal at the exact meeting point", async () => {
        console.log("🔄 DEBUG: Testing exact meeting point scenario");

        // Create a tight spread scenario
        const convergencePrice = 50005.0;

        // Step 1: Create tight spread approaching convergence
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [["50004.50", "2.0"]], // Bid just below
            a: [["50005.50", "2.0"]], // Ask just above
        });

        console.log("📊 Before convergence:");
        console.log(
            `   Bid: ${orderBookState.getBestBid()}, Ask: ${orderBookState.getBestAsk()}`
        );

        // Step 2: Force convergence at the exact same price
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1002,
            u: 1002,
            b: [["50005.00", "1.5"]], // Bid moves to convergence price
            a: [["50005.00", "1.8"]], // Ask moves to same price
        });

        console.log("📊 At convergence point:");
        const convergenceLevel = orderBookState.getLevel(convergencePrice);
        console.log(`   Level at ${convergencePrice}:`, convergenceLevel);
        console.log(`   Best Bid: ${orderBookState.getBestBid()}`);
        console.log(`   Best Ask: ${orderBookState.getBestAsk()}`);

        // Step 3: Detect if quotes are reversed
        const bid = orderBookState.getBestBid();
        const ask = orderBookState.getBestAsk();
        const isReversed = bid > ask && ask !== 0;

        if (isReversed) {
            console.log("🚨 REVERSAL DETECTED at convergence point!");
            console.log(`   Bid (${bid}) > Ask (${ask})`);

            // Print debug information
            const snapshot = orderBookState.snapshot();
            console.log("📸 Snapshot at reversal:");
            Array.from(snapshot.entries())
                .sort(([a], [b]) => a - b)
                .forEach(([price, level]) => {
                    if (level.bid > 0 || level.ask > 0) {
                        console.log(
                            `   ${price}: bid=${level.bid}, ask=${level.ask}`
                        );
                    }
                });
        }

        // Assertions to capture the issue
        if (convergenceLevel) {
            // At convergence price, only one side should be non-zero
            expect(
                convergenceLevel.bid === 0 || convergenceLevel.ask === 0
            ).toBe(true);
        }

        // Quotes should not be reversed
        if (ask !== 0) {
            expect(bid).toBeLessThanOrEqual(ask);
        }
    });

    /**
     * 🎯 CRITICAL TEST: Reproduce the specific "crossed level purge" scenario
     *
     * This test creates a scenario where the purgeCrossedLevels() function
     * might be causing the reversal by incorrectly purging levels.
     */
    it("should detect reversal caused by crossed level purge logic", async () => {
        console.log("🎯 DEBUG: Testing crossed level purge logic");

        // Step 1: Create a complex orderbook with multiple levels
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [
                ["50002.00", "1.0"],
                ["50001.00", "2.0"],
                ["50000.00", "3.0"],
            ],
            a: [
                ["50008.00", "1.0"],
                ["50009.00", "2.0"],
                ["50010.00", "3.0"],
            ],
        });

        console.log("📊 Initial complex state:");
        console.log(
            `   Best Bid: ${orderBookState.getBestBid()}, Best Ask: ${orderBookState.getBestAsk()}`
        );

        // Step 2: Create a scenario that might trigger incorrect purging
        // Set a bid at a high price and an ask at a low price simultaneously
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1002,
            u: 1002,
            b: [
                ["50007.00", "1.5"], // High bid that might confuse purge logic
                ["50005.00", "2.0"], // Medium bid
            ],
            a: [
                ["50004.00", "1.8"], // Low ask that might confuse purge logic
                ["50006.00", "2.2"], // Medium ask
            ],
        });

        console.log("📊 After crossing update:");
        const bid = orderBookState.getBestBid();
        const ask = orderBookState.getBestAsk();
        console.log(
            `   Best Bid: ${bid}, Best Ask: ${ask}, Spread: ${ask - bid}`
        );

        // Step 3: Analyze the orderbook state for purge-related issues
        const snapshot = orderBookState.snapshot();
        const sortedLevels = Array.from(snapshot.entries())
            .sort(([a], [b]) => a - b)
            .filter(([_, level]) => level.bid > 0 || level.ask > 0);

        console.log("📸 Orderbook after potential purge issues:");
        let bidPrices: number[] = [];
        let askPrices: number[] = [];

        sortedLevels.forEach(([price, level]) => {
            const type =
                level.bid > 0 && level.ask > 0
                    ? "🚨 BOTH"
                    : level.bid > 0
                      ? "📈 BID"
                      : "📉 ASK";
            console.log(
                `   ${price}: ${type} (bid=${level.bid}, ask=${level.ask})`
            );

            if (level.bid > 0) bidPrices.push(price);
            if (level.ask > 0) askPrices.push(price);
        });

        // Step 4: Check for specific purge-related issues
        const highestBid = Math.max(...bidPrices);
        const lowestAsk = Math.min(...askPrices);
        const hasOverlap = highestBid > lowestAsk;
        const isReversed = bid > ask && ask !== 0;

        console.log("🎯 Purge Analysis:");
        console.log(`   Highest Bid Price: ${highestBid}`);
        console.log(`   Lowest Ask Price: ${lowestAsk}`);
        console.log(`   Best Bid (method): ${bid}`);
        console.log(`   Best Ask (method): ${ask}`);
        console.log(`   Has Price Overlap: ${hasOverlap}`);
        console.log(`   Quotes Reversed: ${isReversed}`);

        // Step 5: Test the purge logic directly by calling recalculation
        console.log("🔄 Forcing quote recalculation...");

        // Access the private method through any casting (for debugging)
        const orderBookAny = orderBookState as any;
        if (orderBookAny.recalculateBestQuotes) {
            orderBookAny.recalculateBestQuotes();
        }

        const postPurgeBid = orderBookState.getBestBid();
        const postPurgeAsk = orderBookState.getBestAsk();
        console.log(
            `   After forced recalc: Bid=${postPurgeBid}, Ask=${postPurgeAsk}`
        );

        // Assertions
        expect(hasOverlap).toBe(false); // Should not have overlapping levels
        expect(isReversed).toBe(false); // Should not be reversed
        if (ask !== 0) {
            expect(bid).toBeLessThanOrEqual(ask); // Proper ordering
        }
    });

    /**
     * 🚨 STRESS TEST: High-frequency competing updates
     *
     * This test simulates high-frequency trading conditions where
     * bid and ask updates compete for the same price levels rapidly.
     */
    it("should handle high-frequency competing bid/ask updates", async () => {
        console.log("🚨 DEBUG: Testing high-frequency competing updates");

        const competingPrice = 50005.0;
        let updateId = 1001;

        // Rapid-fire sequence of competing updates
        for (let i = 0; i < 10; i++) {
            const isBidUpdate = i % 2 === 0;

            if (isBidUpdate) {
                await orderBookState.updateDepth({
                    s: "BTCUSDT",
                    U: updateId,
                    u: updateId,
                    b: [
                        [competingPrice.toString(), (1.0 + i * 0.1).toString()],
                    ],
                    a: [],
                });
                console.log(
                    `   Update ${i}: Set BID at ${competingPrice} = ${1.0 + i * 0.1}`
                );
            } else {
                await orderBookState.updateDepth({
                    s: "BTCUSDT",
                    U: updateId,
                    u: updateId,
                    b: [],
                    a: [
                        [competingPrice.toString(), (1.0 + i * 0.1).toString()],
                    ],
                });
                console.log(
                    `   Update ${i}: Set ASK at ${competingPrice} = ${1.0 + i * 0.1}`
                );
            }

            updateId++;

            // Check state after each update
            const level = orderBookState.getLevel(competingPrice);
            const bid = orderBookState.getBestBid();
            const ask = orderBookState.getBestAsk();

            console.log(
                `     State: Level(${competingPrice})={bid:${level?.bid}, ask:${level?.ask}}, Best={${bid}, ${ask}}`
            );

            // Critical checks
            if (level && level.bid > 0 && level.ask > 0) {
                console.log(
                    `🚨 VIOLATION: Level has both bid and ask after update ${i}`
                );
                expect(false).toBe(true); // Force failure with debug info
            }

            if (bid > ask && ask !== 0) {
                console.log(
                    `🚨 REVERSAL: Quotes reversed after update ${i} (${bid} > ${ask})`
                );
                expect(false).toBe(true); // Force failure with debug info
            }
        }

        // Final verification
        const finalLevel = orderBookState.getLevel(competingPrice);
        if (finalLevel) {
            expect(finalLevel.bid === 0 || finalLevel.ask === 0).toBe(true);
        }
    });

    /**
     * 🎯 TARGETED TEST: Reproduce specific tree corruption scenario
     *
     * This test specifically targets the scenario where the RedBlackTree
     * might have inconsistent state that leads to incorrect getBestBidAsk() results.
     */
    it("should detect tree corruption leading to quote reversal", async () => {
        console.log("🎯 DEBUG: Testing tree corruption scenario");

        // Step 1: Build a complex orderbook with many levels
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [
                ["49995.00", "1.0"],
                ["49990.00", "2.0"],
                ["49985.00", "3.0"],
                ["49980.00", "4.0"],
            ],
            a: [
                ["50015.00", "1.0"],
                ["50020.00", "2.0"],
                ["50025.00", "3.0"],
                ["50030.00", "4.0"],
            ],
        });

        console.log("📊 Initial complex orderbook:");
        const initialBid = orderBookState.getBestBid();
        const initialAsk = orderBookState.getBestAsk();
        console.log(`   Best Bid: ${initialBid}, Best Ask: ${initialAsk}`);

        // Step 2: Create a scenario that might corrupt the tree state
        // Update multiple levels simultaneously with crossing patterns
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1002,
            u: 1002,
            b: [
                ["50010.00", "2.5"], // Bid above many asks
                ["50005.00", "3.0"], // Bid above many asks
                ["50000.00", "1.5"], // Bid at middle
                ["49995.00", "0"], // Clear existing bid
            ],
            a: [
                ["49997.00", "2.0"], // Ask below many bids
                ["50002.00", "1.8"], // Ask below many bids
                ["50012.00", "2.2"], // Ask at middle
                ["50015.00", "0"], // Clear existing ask
            ],
        });

        console.log("📊 After complex crossing update:");
        const afterBid = orderBookState.getBestBid();
        const afterAsk = orderBookState.getBestAsk();
        console.log(
            `   Best Bid: ${afterBid}, Best Ask: ${afterAsk}, Spread: ${afterAsk - afterBid}`
        );

        // Step 3: Manually check tree state vs getBestBidAsk results
        const snapshot = orderBookState.snapshot();
        const allLevels = Array.from(snapshot.entries())
            .sort(([a], [b]) => a - b)
            .filter(([_, level]) => level.bid > 0 || level.ask > 0);

        console.log("📸 All levels in tree:");
        const bidLevels: Array<{ price: number; qty: number }> = [];
        const askLevels: Array<{ price: number; qty: number }> = [];

        allLevels.forEach(([price, level]) => {
            const type =
                level.bid > 0 && level.ask > 0
                    ? "🚨 BOTH"
                    : level.bid > 0
                      ? "📈 BID"
                      : "📉 ASK";
            console.log(
                `   ${price}: ${type} (bid=${level.bid}, ask=${level.ask})`
            );

            if (level.bid > 0) bidLevels.push({ price, qty: level.bid });
            if (level.ask > 0) askLevels.push({ price, qty: level.ask });
        });

        // Step 4: Compare manual calculation vs tree method
        const manualHighestBid =
            bidLevels.length > 0
                ? Math.max(...bidLevels.map((l) => l.price))
                : 0;
        const manualLowestAsk =
            askLevels.length > 0
                ? Math.min(...askLevels.map((l) => l.price))
                : Infinity;

        console.log("🎯 Manual vs Tree comparison:");
        console.log(`   Manual Highest Bid: ${manualHighestBid}`);
        console.log(`   Manual Lowest Ask: ${manualLowestAsk}`);
        console.log(`   Tree Best Bid: ${afterBid}`);
        console.log(`   Tree Best Ask: ${afterAsk}`);

        // Step 5: Check for discrepancies
        const bidDiscrepancy = manualHighestBid !== afterBid;
        const askDiscrepancy = manualLowestAsk !== afterAsk && afterAsk !== 0;
        const hasTreeCorruption = bidDiscrepancy || askDiscrepancy;

        if (hasTreeCorruption) {
            console.log("🚨 TREE CORRUPTION DETECTED!");
            console.log(
                `   Bid discrepancy: manual=${manualHighestBid}, tree=${afterBid}`
            );
            console.log(
                `   Ask discrepancy: manual=${manualLowestAsk}, tree=${afterAsk}`
            );
        }

        // Step 6: Check for the core reversal issue
        const manualReversed =
            manualHighestBid > manualLowestAsk && manualLowestAsk !== Infinity;
        const treeReversed = afterBid > afterAsk && afterAsk !== 0;

        console.log("🚨 Reversal Analysis:");
        console.log(`   Manual calculation reversed: ${manualReversed}`);
        console.log(`   Tree calculation reversed: ${treeReversed}`);

        if (manualReversed) {
            console.log(
                "🎉 REPRODUCED: Manual calculation shows quote reversal!"
            );
            console.log(
                `   This indicates levels in tree are crossed: ${manualHighestBid} > ${manualLowestAsk}`
            );
        }

        if (treeReversed) {
            console.log(
                "🎉 REPRODUCED: Tree getBestBidAsk shows quote reversal!"
            );
            console.log(
                `   This indicates getBestBidAsk() is returning invalid quotes: ${afterBid} > ${afterAsk}`
            );
        }

        // Assertions to capture various corruption scenarios
        expect(hasTreeCorruption).toBe(false); // Tree should be consistent
        expect(manualReversed).toBe(false); // Levels should not be crossed
        expect(treeReversed).toBe(false); // Tree method should not return reversed quotes

        // Check for separation violations
        const separationViolations = allLevels.filter(
            ([_, level]) => level.bid > 0 && level.ask > 0
        );
        expect(separationViolations.length).toBe(0);
    });

    /**
     * 🔍 EDGE CASE TEST: Zero quantity updates in crossed scenarios
     *
     * This test specifically targets the scenario where zero quantity updates
     * during crossed conditions might leave the tree in an inconsistent state.
     */
    it("should handle zero quantity updates during crossed conditions", async () => {
        console.log(
            "🔍 DEBUG: Testing zero quantity updates in crossed scenarios"
        );

        // Step 1: Set up a normal orderbook
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1001,
            u: 1001,
            b: [["49998.00", "1.0"]],
            a: [["50002.00", "1.0"]],
        });

        console.log("📊 Initial normal state:");
        console.log(
            `   Bid: ${orderBookState.getBestBid()}, Ask: ${orderBookState.getBestAsk()}`
        );

        // Step 2: Create crossing scenario with zero quantity "deletions"
        await orderBookState.updateDepth({
            s: "BTCUSDT",
            U: 1002,
            u: 1002,
            b: [
                ["50001.00", "2.0"], // New bid above ask
                ["49998.00", "0"], // Delete original bid
            ],
            a: [
                ["49999.00", "1.5"], // New ask below bid
                ["50002.00", "0"], // Delete original ask
            ],
        });

        console.log("📊 After crossing with zero quantities:");
        const bid = orderBookState.getBestBid();
        const ask = orderBookState.getBestAsk();
        console.log(`   Bid: ${bid}, Ask: ${ask}, Spread: ${ask - bid}`);

        // Step 3: Check the specific levels that were set/deleted
        const level50001 = orderBookState.getLevel(50001.0);
        const level49999 = orderBookState.getLevel(49999.0);
        const level49998 = orderBookState.getLevel(49998.0);
        const level50002 = orderBookState.getLevel(50002.0);

        console.log("🔍 Specific level analysis:");
        console.log(`   Level 50001 (bid): ${JSON.stringify(level50001)}`);
        console.log(`   Level 49999 (ask): ${JSON.stringify(level49999)}`);
        console.log(
            `   Level 49998 (deleted bid): ${level49998 ? JSON.stringify(level49998) : "undefined"}`
        );
        console.log(
            `   Level 50002 (deleted ask): ${level50002 ? JSON.stringify(level50002) : "undefined"}`
        );

        // Step 4: Check for the reversal that occurs due to zero qty handling
        const isReversed = bid > ask && ask !== 0;

        if (isReversed) {
            console.log("🚨 REVERSAL DETECTED in zero quantity scenario!");
            console.log(`   Bid (${bid}) > Ask (${ask})`);

            // Get full snapshot to debug
            const snapshot = orderBookState.snapshot();
            console.log("📸 Full snapshot after zero qty updates:");
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

        // Assertions
        expect(isReversed).toBe(false);

        // Check separation at specific levels
        if (level50001) {
            expect(level50001.bid === 0 || level50001.ask === 0).toBe(true);
        }
        if (level49999) {
            expect(level49999.bid === 0 || level49999.ask === 0).toBe(true);
        }
    });
});
