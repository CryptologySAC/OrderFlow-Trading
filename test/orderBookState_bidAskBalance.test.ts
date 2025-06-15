// test/orderBookState_bidAskBalance.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookState } from "../src/market/orderBookState";
import { WorkerProxyLogger } from "../src/multithreading/shared/workerProxylogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { BinanceDataFeed } from "../src/utils/binance";

vi.mock("../src/infrastructure/logger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/utils/binance");

describe("OrderBookState Bid/Ask Balance", () => {
    let orderBook: OrderBookState;

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
        orderBook = await OrderBookState.create(
            {
                pricePrecision: 2,
                symbol: "TESTUSDT",
                maxLevels: 1000,
            },
            logger,
            metrics,
            null
        );
    });

    it("should maintain equal bid and ask levels with symmetric updates", async () => {
        // Simulate symmetric depth update with equal number of bids and asks
        await orderBook.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "TESTUSDT",
            U: 123456,
            u: 123457,
            b: [
                ["100.10", "10.0"],
                ["100.05", "15.0"],
                ["100.00", "20.0"],
            ],
            a: [
                ["100.15", "12.0"],
                ["100.20", "18.0"],
                ["100.25", "25.0"],
            ],
        });

        const metrics = orderBook.getDepthMetrics();

        expect(metrics.bidLevels).toBe(3);
        expect(metrics.askLevels).toBe(3);
        expect(metrics.bidLevels).toBe(metrics.askLevels);
        expect(metrics.totalBidVolume).toBe(45.0); // 10 + 15 + 20
        expect(metrics.totalAskVolume).toBe(55.0); // 12 + 18 + 25
    });

    it("should correctly calculate delta changes for bid updates", async () => {
        // Initial update
        await orderBook.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "TESTUSDT",
            U: 123456,
            u: 123457,
            b: [["100.10", "10.0"]],
            a: [["100.15", "12.0"]],
        });

        let metrics = orderBook.getDepthMetrics();
        expect(metrics.bidLevels).toBe(1);
        expect(metrics.askLevels).toBe(1);
        expect(metrics.totalBidVolume).toBe(10.0);

        // Update same price level with increased volume
        await orderBook.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "TESTUSDT",
            U: 123457,
            u: 123458,
            b: [["100.10", "20.0"]], // Increased from 10 to 20
            a: [],
        });

        metrics = orderBook.getDepthMetrics();
        expect(metrics.bidLevels).toBe(1);
        expect(metrics.askLevels).toBe(1);
        expect(metrics.totalBidVolume).toBe(20.0);
    });

    it("should correctly calculate delta changes for ask updates", async () => {
        // Initial update
        await orderBook.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "TESTUSDT",
            U: 123456,
            u: 123457,
            b: [["100.10", "10.0"]],
            a: [["100.15", "12.0"]],
        });

        let metrics = orderBook.getDepthMetrics();
        expect(metrics.askLevels).toBe(1);
        expect(metrics.totalAskVolume).toBe(12.0);

        // Update same price level with increased volume
        await orderBook.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "TESTUSDT",
            U: 123457,
            u: 123458,
            b: [],
            a: [["100.15", "25.0"]], // Increased from 12 to 25
        });

        metrics = orderBook.getDepthMetrics();
        expect(metrics.bidLevels).toBe(1);
        expect(metrics.askLevels).toBe(1);
        expect(metrics.totalAskVolume).toBe(25.0);
    });

    it("should handle zero quantity updates correctly", async () => {
        // Initial update
        await orderBook.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "TESTUSDT",
            U: 123456,
            u: 123457,
            b: [
                ["100.10", "10.0"],
                ["100.05", "15.0"],
            ],
            a: [
                ["100.15", "12.0"],
                ["100.20", "18.0"],
            ],
        });

        let metrics = orderBook.getDepthMetrics();
        expect(metrics.bidLevels).toBe(2);
        expect(metrics.askLevels).toBe(2);

        // Remove one bid and one ask level
        await orderBook.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "TESTUSDT",
            U: 123457,
            u: 123458,
            b: [["100.10", "0"]], // Remove bid level
            a: [["100.15", "0"]], // Remove ask level
        });

        metrics = orderBook.getDepthMetrics();
        expect(metrics.bidLevels).toBe(1);
        expect(metrics.askLevels).toBe(1);
        expect(metrics.bidLevels).toBe(metrics.askLevels);
    });

    it("should maintain correct best bid and ask quotes", async () => {
        await orderBook.updateDepth({
            e: "depthUpdate",
            E: Date.now(),
            s: "TESTUSDT",
            U: 123456,
            u: 123457,
            b: [
                ["100.10", "10.0"], // Best bid
                ["100.05", "15.0"],
                ["100.00", "20.0"],
            ],
            a: [
                ["100.15", "12.0"], // Best ask
                ["100.20", "18.0"],
                ["100.25", "25.0"],
            ],
        });

        expect(orderBook.getBestBid()).toBe(100.1);
        expect(orderBook.getBestAsk()).toBe(100.15);
        expect(orderBook.getSpread()).toBeCloseTo(0.05, 2);
        expect(orderBook.getMidPrice()).toBeCloseTo(100.125, 2);
    });
});
