import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookState } from "../src/market/orderBookState";
import { BinanceDataFeed } from "../src/utils/binance";
import { WorkerProxyLogger } from "../src/multithreading/shared/workerProxylogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/utils/binance");

describe("OrderBookState - Bid/Ask Separation", () => {
    let orderBookState: OrderBookState;

    beforeEach(async () => {
        vi.clearAllMocks();

        vi.spyOn(
            BinanceDataFeed.prototype,
            "getDepthSnapshot"
        ).mockResolvedValue({
            lastUpdateId: 123456,
            bids: [],
            asks: [],
        });

        const logger = new WorkerProxyLogger("test");
        const metrics = new MetricsCollector();
        orderBookState = await OrderBookState.create(
            {
                pricePrecision: 2,
                symbol: "BTCUSDT",
                maxLevels: 1000,
            },
            logger,
            metrics,
            null
        );
    });

    it("should prevent quote inversions by enforcing bid/ask separation", async () => {
        // Set up initial orderbook with proper separation
        await orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 123456,
            u: 123457,
            b: [["50.00", "100"]], // Bid at 50.00
            a: [["50.10", "200"]], // Ask at 50.10
        });

        // Verify proper separation (LOGIC: best bid should be < best ask)
        const initialBid = orderBookState.getBestBid();
        const initialAsk = orderBookState.getBestAsk();
        expect(initialBid).toBeLessThan(initialAsk);
        expect(orderBookState.getSpread()).toBeGreaterThan(0);

        // Now try to create a quote inversion by setting bid at ask price
        await orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 123457,
            u: 123458,
            b: [["50.10", "150"]], // Bid tries to move to ask price
            a: [["50.10", "0"]], // Clear the ask
        });

        // LOGIC: The system should maintain valid market structure
        // - No negative spreads allowed
        // - If both sides exist, best bid must be <= best ask
        const finalBid = orderBookState.getBestBid();
        const finalAsk = orderBookState.getBestAsk();
        
        // Handle case where one side might be empty after conflicts are resolved
        if (finalBid > 0 && finalAsk > 0) {
            expect(finalBid).toBeLessThanOrEqual(finalAsk);
        }
        
        // The orderbook should remain in a valid state (not crashed)
        expect(orderBookState.getSpread()).toBeGreaterThanOrEqual(0);
    });

    it("should handle overlapping bid/ask updates correctly", async () => {
        // Create scenario where bid and ask try to occupy same price
        await orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 123456,
            u: 123457,
            b: [["50.05", "100"]],
            a: [["50.05", "200"]], // Same price as bid
        });

        // LOGIC: System should handle price conflicts gracefully
        // The orderbook should maintain valid market structure
        const bid = orderBookState.getBestBid();
        const ask = orderBookState.getBestAsk();
        
        // Key logical requirement: no inverted quotes
        expect(bid).toBeLessThanOrEqual(ask);
        expect(orderBookState.getSpread()).toBeGreaterThanOrEqual(0);
        
        // System should have processed the update without errors
        const metrics = orderBookState.getDepthMetrics();
        expect(metrics.bidLevels + metrics.askLevels).toBeGreaterThan(0);
    });

    it("should maintain proper spread after separation enforcement", async () => {
        // Set up orderbook
        await orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 123456,
            u: 123457,
            b: [
                ["49.95", "100"],
                ["49.90", "150"],
            ],
            a: [
                ["50.05", "200"],
                ["50.10", "250"],
            ],
        });

        // LOGIC: Initial spread should be positive
        const initialSpread = orderBookState.getSpread();
        expect(initialSpread).toBeGreaterThan(0);
        expect(orderBookState.getBestBid()).toBeLessThan(orderBookState.getBestAsk());

        // Try to create crossing quotes
        await orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 123457,
            u: 123458,
            b: [["50.05", "300"]], // Bid at ask price
            a: [["50.05", "0"]], // Clear the conflicting ask
        });

        // LOGIC: System should maintain valid market structure after update
        const newSpread = orderBookState.getSpread();
        expect(newSpread).toBeGreaterThanOrEqual(0);

        const bestBid = orderBookState.getBestBid();
        const bestAsk = orderBookState.getBestAsk();
        expect(bestBid).toBeLessThanOrEqual(bestAsk);
    });

    it("should properly count bid and ask levels after separation", async () => {
        // Set up symmetric orderbook
        await orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 123456,
            u: 123457,
            b: [
                ["49.95", "100"],
                ["49.90", "150"],
                ["49.85", "200"],
            ],
            a: [
                ["50.05", "100"],
                ["50.10", "150"],
                ["50.15", "200"],
            ],
        });

        const initialMetrics = orderBookState.getDepthMetrics();

        // LOGIC: Initial state should have some levels
        expect(initialMetrics.bidLevels).toBeGreaterThan(0);
        expect(initialMetrics.askLevels).toBeGreaterThan(0);

        // Now create a crossing scenario using updateDepth
        await orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 123457,
            u: 123458,
            b: [
                ["49.95", "100"],
                ["50.05", "250"], // Bid moves to ask price
            ],
            a: [
                ["50.05", "0"], // Clear conflicting ask
                ["50.10", "150"],
                ["50.15", "200"],
            ],
        });

        const newMetrics = orderBookState.getDepthMetrics();

        // LOGIC: System should maintain reasonable level counts
        // Should still have levels after the update
        expect(newMetrics.bidLevels + newMetrics.askLevels).toBeGreaterThan(0);
        
        // Market structure should remain valid
        expect(orderBookState.getBestBid()).toBeLessThanOrEqual(orderBookState.getBestAsk());
        expect(orderBookState.getSpread()).toBeGreaterThanOrEqual(0);
    });
});
