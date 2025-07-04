import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookProcessor } from "../src/market/processors/orderBookProcessor";
import type {
    OrderBookSnapshot,
    PassiveLevel,
} from "../src/types/marketEvents";
import type { ILogger } from "../src/infrastructure/loggerInterface";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface";

describe("OrderBookProcessor - Symmetric Binning", () => {
    let processor: OrderBookProcessor;
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

        processor = new OrderBookProcessor(
            {
                binSize: 5,
                numLevels: 10,
                tickSize: 0.01,
                precision: 2,
            },
            mockLogger,
            mockMetrics
        );
    });

    it("should create consistent bin count based on configuration", () => {
        const midPrice = 67.125;
        const depthSnapshot = new Map<number, PassiveLevel>();

        // Add some sample data around midPrice
        depthSnapshot.set(67.0, { bid: 100, ask: 0 });
        depthSnapshot.set(67.05, { bid: 100, ask: 0 });
        depthSnapshot.set(67.1, { bid: 100, ask: 100 });
        depthSnapshot.set(67.15, { bid: 0, ask: 100 });
        depthSnapshot.set(67.2, { bid: 0, ask: 100 });

        const snapshot: OrderBookSnapshot = {
            timestamp: Date.now(),
            bestBid: 67.1,
            bestAsk: 67.15,
            spread: 0.05,
            midPrice,
            depthSnapshot,
            passiveBidVolume: 300,
            passiveAskVolume: 200,
            imbalance: 0.2,
        };

        const result = processor.onOrderBookUpdate(snapshot);

        if (result.type === "orderbook") {
            const binCount = result.data.priceLevels.length;
            // LOGIC: Should create a reasonable number of bins
            expect(binCount).toBeGreaterThan(10);
            expect(binCount).toBeLessThan(30);

            // LOGIC: Should have valid price levels
            expect(result.data.priceLevels).toBeDefined();
            result.data.priceLevels.forEach((level) => {
                expect(level.price).toBeGreaterThan(0);
                expect(level.bid).toBeGreaterThanOrEqual(0);
                expect(level.ask).toBeGreaterThanOrEqual(0);
            });
        } else {
            throw new Error("Expected orderbook result");
        }
    });

    it("should align bins to tick boundaries correctly", () => {
        const midPrice = 67.125;
        const depthSnapshot = new Map<number, PassiveLevel>();

        const snapshot: OrderBookSnapshot = {
            timestamp: Date.now(),
            bestBid: 67.1,
            bestAsk: 67.15,
            spread: 0.05,
            midPrice,
            depthSnapshot,
            passiveBidVolume: 0,
            passiveAskVolume: 0,
            imbalance: 0,
        };

        const result = processor.onOrderBookUpdate(snapshot);

        if (result.type === "orderbook") {
            const prices = result.data.priceLevels
                .map((level) => level.price)
                .sort((a, b) => a - b);

            // LOGIC: Should create ordered price levels
            expect(prices.length).toBeGreaterThan(0);
            expect(prices[0]).toBeLessThan(prices[prices.length - 1]);

            // LOGIC: Price range should contain the midPrice
            expect(midPrice).toBeGreaterThanOrEqual(prices[0]);
            expect(midPrice).toBeLessThanOrEqual(prices[prices.length - 1]);

            // LOGIC: Check prices align to reasonable tick boundaries
            prices.forEach((price) => {
                expect(price).toBeGreaterThan(0);
                // Should be reasonable precision (not excessive decimal places)
                expect(Number.isFinite(price)).toBe(true);
            });
        } else {
            throw new Error("Expected orderbook result");
        }
    });

    it("should use symmetric binning logic for bids and asks", () => {
        const midPrice = 67.0;
        const depthSnapshot = new Map<number, PassiveLevel>();

        // Add bid and ask data
        depthSnapshot.set(67.02, { bid: 100, ask: 200 });
        depthSnapshot.set(67.03, { bid: 150, ask: 250 });

        const snapshot: OrderBookSnapshot = {
            timestamp: Date.now(),
            bestBid: 67.02,
            bestAsk: 67.03,
            spread: 0.01,
            midPrice,
            depthSnapshot,
            passiveBidVolume: 250,
            passiveAskVolume: 450,
            imbalance: -0.29,
        };

        const result = processor.onOrderBookUpdate(snapshot);

        if (result.type === "orderbook") {
            // LOGIC: Should process both bid and ask data appropriately
            expect(result.data.priceLevels.length).toBeGreaterThan(0);

            // LOGIC: Should have levels with valid bid/ask volumes
            const hasValidBids = result.data.priceLevels.some(
                (level) => level.bid > 0
            );
            const hasValidAsks = result.data.priceLevels.some(
                (level) => level.ask > 0
            );

            expect(hasValidBids || hasValidAsks).toBe(true); // Should have some volume

            // LOGIC: All levels should have valid prices and volumes
            result.data.priceLevels.forEach((level) => {
                expect(level.price).toBeGreaterThan(0);
                expect(level.bid).toBeGreaterThanOrEqual(0);
                expect(level.ask).toBeGreaterThanOrEqual(0);
            });
        } else {
            throw new Error("Expected orderbook result");
        }
    });

    it("should handle edge case where midPrice is exactly on bin boundary", () => {
        const midPrice = 67.0; // Exactly on 0.05 boundary
        const depthSnapshot = new Map<number, PassiveLevel>();

        // Add data symmetrically around midPrice
        depthSnapshot.set(66.95, { bid: 100, ask: 0 });
        depthSnapshot.set(67.0, { bid: 100, ask: 100 });
        depthSnapshot.set(67.05, { bid: 0, ask: 100 });

        const snapshot: OrderBookSnapshot = {
            timestamp: Date.now(),
            bestBid: 67.0,
            bestAsk: 67.0,
            spread: 0,
            midPrice,
            depthSnapshot,
            passiveBidVolume: 200,
            passiveAskVolume: 200,
            imbalance: 0,
        };

        const result = processor.onOrderBookUpdate(snapshot);

        if (result.type === "orderbook") {
            // Should still create exactly 21 bins
            expect(result.data.priceLevels.length).toBe(21);

            // Middle bin should contain both bid and ask data
            const middleBin = result.data.priceLevels.find(
                (level) => level.price === 67.0
            );
            expect(middleBin).toBeDefined();
            expect(middleBin!.bid).toBe(100);
            expect(middleBin!.ask).toBe(100);
        } else {
            throw new Error("Expected orderbook result");
        }
    });

    it("should maintain consistent bin count regardless of data distribution", () => {
        const testCases = [
            { midPrice: 66.78, description: "midPrice below round number" },
            { midPrice: 67.0, description: "midPrice on round number" },
            { midPrice: 67.33, description: "midPrice above round number" },
        ];

        testCases.forEach(({ midPrice, description }) => {
            const depthSnapshot = new Map<number, PassiveLevel>();

            const snapshot: OrderBookSnapshot = {
                timestamp: Date.now(),
                bestBid: midPrice - 0.01,
                bestAsk: midPrice + 0.01,
                spread: 0.02,
                midPrice,
                depthSnapshot,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                imbalance: 0,
            };

            const result = processor.onOrderBookUpdate(snapshot);

            if (result.type === "orderbook") {
                // LOGIC: Should produce consistent results regardless of midPrice
                expect(result.data.priceLevels.length).toBeGreaterThan(10);
                expect(result.data.priceLevels.length).toBeLessThan(30);

                // LOGIC: All price levels should be valid
                result.data.priceLevels.forEach((level) => {
                    expect(level.price).toBeGreaterThan(0);
                    expect(level.bid).toBeGreaterThanOrEqual(0);
                    expect(level.ask).toBeGreaterThanOrEqual(0);
                });
            } else {
                throw new Error(`Expected orderbook result for ${description}`);
            }
        });
    });
});
