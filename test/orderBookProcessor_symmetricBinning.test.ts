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

    it("should create exactly 2*numLevels+1 bins", () => {
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
            // Should be exactly 2*10+1 = 21 bins
            expect(binCount).toBe(21);
        } else {
            throw new Error("Expected orderbook result");
        }
    });

    it("should align bins to tick boundaries correctly", () => {
        const midPrice = 67.125; // Will align to 67.10 (binSize=5, so 67.10 is nearest 0.05 boundary)
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

            // Should start 10 bins below aligned midPrice and end 10 bins above
            // Aligned midPrice = 67.15 (67.125 rounds to 67.15), binIncrement = 0.05
            // Expected range: 66.65 to 67.65 (21 bins)
            expect(prices[0]).toBe(66.65); // minPrice = 67.15 - 10*0.05
            expect(prices[prices.length - 1]).toBe(67.65); // maxPrice = 67.15 + 10*0.05

            // Check all prices align to 0.05 boundaries (account for floating point precision)
            prices.forEach((price) => {
                const remainder = Math.abs(price % 0.05);
                const isAligned =
                    remainder < 0.001 || Math.abs(remainder - 0.05) < 0.001;
                expect(isAligned).toBe(true);
            });
        } else {
            throw new Error("Expected orderbook result");
        }
    });

    it("should use symmetric binning logic for bids and asks", () => {
        const midPrice = 67.0;
        const depthSnapshot = new Map<number, PassiveLevel>();

        // Add bid and ask at same price level - both will map to 67.00 bin
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
            // 67.02 rounds to 67.00, 67.03 rounds to 67.05 with binIncrement=0.05
            const bin67_00 = result.data.priceLevels.find(
                (level) => level.price === 67.0
            );
            const bin67_05 = result.data.priceLevels.find(
                (level) => level.price === 67.05
            );

            expect(bin67_00).toBeDefined();
            expect(bin67_05).toBeDefined();
            expect(bin67_00!.bid).toBe(100); // 67.02 maps here
            expect(bin67_00!.ask).toBe(200); // 67.02 maps here
            expect(bin67_05!.bid).toBe(150); // 67.03 maps here
            expect(bin67_05!.ask).toBe(250); // 67.03 maps here
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
                expect(result.data.priceLevels.length).toBe(21);
            } else {
                throw new Error(`Expected orderbook result for ${description}`);
            }
        });
    });
});
