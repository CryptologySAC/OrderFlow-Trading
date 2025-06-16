import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookState } from "../src/market/orderBookState";
import type { ILogger } from "../src/infrastructure/loggerInterface";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface";

describe("OrderBookState - Bid/Ask Separation", () => {
    let orderBookState: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: vi.fn(() => false),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            getMetrics: vi.fn(),
            createCounter: vi.fn(),
            createGauge: vi.fn(),
            createHistogram: vi.fn(),
            incrementCounter: vi.fn(),
            setGauge: vi.fn(),
            recordHistogram: vi.fn(),
        };

        orderBookState = new OrderBookState(
            {
                pricePrecision: 2,
                symbol: "BTCUSDT",
                maxLevels: 1000,
                maxPriceDistance: 0.1,
                pruneIntervalMs: 30000,
                maxErrorRate: 5,
                staleThresholdMs: 300000,
            },
            mockLogger,
            mockMetrics,
            {} as any // mock ThreadManager
        );
    });

    it("should prevent quote inversions by enforcing bid/ask separation", () => {
        // Set up initial orderbook with proper separation
        orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 1,
            u: 1,
            b: [["50.00", "100"]], // Bid at 50.00
            a: [["50.10", "200"]]  // Ask at 50.10
        });

        // Verify proper separation
        expect(orderBookState.getBestBid()).toBe(50.0);
        expect(orderBookState.getBestAsk()).toBe(50.1);

        // Now try to create a quote inversion by setting bid at ask price
        orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 2,
            u: 2,
            b: [["50.10", "150"]], // Bid tries to move to ask price
            a: [["50.10", "0"]]    // Clear the ask
        });

        // The bid should be set at 50.10, and ask should be automatically cleared
        expect(orderBookState.getBestBid()).toBe(50.1);
        expect(orderBookState.getBestAsk()).toBeGreaterThan(50.1); // Next ask level
    });

    it("should handle overlapping bid/ask updates correctly", () => {
        // Create scenario where bid and ask try to occupy same price
        orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 1,
            u: 1,
            b: [["50.05", "100"]],
            a: [["50.05", "200"]] // Same price as bid
        });

        // Only one side should exist at that price level
        const snapshot = orderBookState.snapshot();
        const level5005 = snapshot.get(50.05);

        expect(level5005).toBeDefined();
        // Either bid or ask should be 0, but not both > 0
        expect(level5005!.bid === 0 || level5005!.ask === 0).toBe(true);
        expect(level5005!.bid > 0 && level5005!.ask > 0).toBe(false);
    });

    it("should maintain proper spread after separation enforcement", () => {
        // Set up orderbook
        orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 1,
            u: 1,
            b: [
                ["49.95", "100"],
                ["49.90", "150"],
            ],
            a: [
                ["50.05", "200"],
                ["50.10", "250"],
            ]
        });

        const initialSpread = orderBookState.getSpread();
        expect(initialSpread).toBe(0.1); // 50.05 - 49.95

        // Try to create crossing quotes
        orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 2,
            u: 2,
            b: [["50.05", "300"]], // Bid at ask price
            a: [["50.05", "0"]]    // Clear the conflicting ask
        });

        // Should maintain valid spread (no negative spreads)
        const newSpread = orderBookState.getSpread();
        expect(newSpread).toBeGreaterThanOrEqual(0);

        const bestBid = orderBookState.getBestBid();
        const bestAsk = orderBookState.getBestAsk();
        expect(bestBid).toBeLessThanOrEqual(bestAsk);
    });

    it("should properly count bid and ask levels after separation", () => {
        // Set up symmetric orderbook
        orderBookState.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "BTCUSDT",
            U: 1,
            u: 1,
            b: [
                ["49.95", "100"],
                ["49.90", "150"],
                ["49.85", "200"],
            ],
            a: [
                ["50.05", "100"],
                ["50.10", "150"],
                ["50.15", "200"],
            ]
        });

        const metrics = orderBookState.getDepthMetrics();

        // Should have equal numbers of bid and ask levels
        expect(metrics.bidLevels).toBe(3);
        expect(metrics.askLevels).toBe(3);

        // Now create a crossing scenario
        const crossingUpdate = [
            ["49.95", "100"],
            ["50.05", "250"], // Bid moves to ask price
        ];
        const askUpdate = [
            ["50.05", "0"], // Clear conflicting ask
            ["50.10", "150"],
            ["50.15", "200"],
        ];

        orderBookState.update(crossingUpdate, askUpdate);

        const newMetrics = orderBookState.getDepthMetrics();

        // Should not have phantom double-counted levels
        expect(newMetrics.bidLevels + newMetrics.askLevels).toBeLessThanOrEqual(
            5
        );
    });
});
