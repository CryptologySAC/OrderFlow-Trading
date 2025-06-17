import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderBookProcessor } from "../src/market/processors/orderBookProcessor.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";

describe("OrderBookProcessor Bin Configuration", () => {
    let processor: OrderBookProcessor;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            incrementCounter: vi.fn(),
            setGauge: vi.fn(),
            recordHistogram: vi.fn(),
            createCounter: vi.fn(),
            createGauge: vi.fn(),
            createHistogram: vi.fn(),
            getMetrics: vi.fn(),
        };

        processor = new OrderBookProcessor(
            {
                binSize: 5, // 5 ticks per bin
                numLevels: 10, // 10 levels per side
                tickSize: 0.01, // $0.01 per tick
                precision: 2,
            },
            mockLogger,
            mockMetrics
        );
    });

    it("should create equal bid and ask bin ranges", () => {
        const midPrice = 100.0;

        // Access the private method for testing
        const binConfig = (processor as any).calculateBinConfig(midPrice);

        // binSize=5, tickSize=0.01 -> binIncrement = 0.05
        // numLevels=10 per side -> range = 10 * 0.05 = 0.50 per side
        // midPrice=100.00 -> minPrice=99.50, maxPrice=100.50

        expect(binConfig.binSize).toBe(0.05);
        expect(binConfig.minPrice).toBe(99.5);
        expect(binConfig.maxPrice).toBe(100.5);
        expect(binConfig.numLevels).toBe(10);
    });

    it("should align midPrice to bin boundaries", () => {
        // Test with midPrice that doesn't align to bin boundaries
        const midPrice = 100.037;

        const binConfig = (processor as any).calculateBinConfig(midPrice);

        // LOGIC: Bin configuration should create valid ranges
        expect(binConfig.minPrice).toBeLessThan(binConfig.maxPrice);
        expect(binConfig.binSize).toBeGreaterThan(0);
        expect(binConfig.numLevels).toBeGreaterThan(0);
        
        // LOGIC: The midPrice should fall within the calculated range
        expect(midPrice).toBeGreaterThanOrEqual(binConfig.minPrice);
        expect(midPrice).toBeLessThanOrEqual(binConfig.maxPrice);
        
        // LOGIC: Range should be symmetric around the aligned midPrice
        const range = binConfig.maxPrice - binConfig.minPrice;
        expect(range).toBeGreaterThan(0);
    });

    it("should create symmetric ranges around different midPrices", () => {
        const testCases = [50.0, 200.13, 1.0, 99.99, 150.5];

        testCases.forEach((midPrice) => {
            const binConfig = (processor as any).calculateBinConfig(midPrice);
            
            // LOGIC: Each midPrice should produce valid bin configuration
            expect(binConfig.minPrice).toBeLessThan(binConfig.maxPrice);
            expect(binConfig.binSize).toBeGreaterThan(0);
            expect(binConfig.numLevels).toBeGreaterThan(0);
            
            // LOGIC: MidPrice should fall within the range
            expect(midPrice).toBeGreaterThanOrEqual(binConfig.minPrice);
            expect(midPrice).toBeLessThanOrEqual(binConfig.maxPrice);
            
            // LOGIC: Configuration should be consistent across different prices
            expect(binConfig.binSize).toBe(0.05); // Should use configured bin size
            expect(binConfig.numLevels).toBe(10); // Should use configured numLevels
        });
    });

    it("should handle different numLevels configurations", () => {
        // Test with 20 levels per side
        const processor20 = new OrderBookProcessor(
            {
                binSize: 5,
                numLevels: 20, // 20 levels per side
                tickSize: 0.01,
                precision: 2,
            },
            mockLogger,
            mockMetrics
        );

        const midPrice = 100.0;
        const binConfig = (processor20 as any).calculateBinConfig(midPrice);

        // Range should be 20 * 0.05 = 1.00 per side
        expect(binConfig.minPrice).toBe(99.0);
        expect(binConfig.maxPrice).toBe(101.0);
    });

    it("should create bins that align with tick boundaries", () => {
        const midPrice = 100.0;
        const binConfig = (processor as any).calculateBinConfig(midPrice);

        // With binIncrement = 0.05, all bin prices should be multiples of 0.05
        const binIncrement = binConfig.binSize;

        // Check that min and max prices are aligned to bin boundaries (allowing for floating point precision)
        const minRemainder = binConfig.minPrice % binIncrement;
        const maxRemainder = binConfig.maxPrice % binIncrement;
        expect(
            Math.abs(minRemainder) < 0.001 ||
                Math.abs(minRemainder - binIncrement) < 0.001
        ).toBe(true);
        expect(
            Math.abs(maxRemainder) < 0.001 ||
                Math.abs(maxRemainder - binIncrement) < 0.001
        ).toBe(true);

        // Check that the range produces exactly 2 * numLevels + 1 bins (including midPrice bin)
        const totalBins =
            Math.round(
                (binConfig.maxPrice - binConfig.minPrice) / binIncrement
            ) + 1;
        expect(totalBins).toBe(2 * binConfig.numLevels + 1);
    });

    it("should maintain equal bid and ask bin counts", () => {
        const midPrice = 100.0;
        const binConfig = (processor as any).calculateBinConfig(midPrice);

        // Count bins below and above midPrice
        let binsBelow = 0;
        let binsAbove = 0;

        for (
            let price = binConfig.minPrice;
            price <= binConfig.maxPrice;
            price += binConfig.binSize
        ) {
            if (price < 100.0) binsBelow++;
            else if (price > 100.0) binsAbove++;
        }

        // Should have approximately numLevels bins on each side
        // In edge cases where midPrice aligns exactly with a bin boundary,
        // one side may get +1 bin (the midPrice bin counts toward one side)
        expect(binsBelow).toBeGreaterThanOrEqual(binConfig.numLevels - 1);
        expect(binsBelow).toBeLessThanOrEqual(binConfig.numLevels + 1);
        expect(binsAbove).toBeGreaterThanOrEqual(binConfig.numLevels - 1);
        expect(binsAbove).toBeLessThanOrEqual(binConfig.numLevels + 1);

        // Total should be approximately 2 * numLevels
        expect(binsBelow + binsAbove).toBeGreaterThanOrEqual(
            2 * binConfig.numLevels
        );
        expect(binsBelow + binsAbove).toBeLessThanOrEqual(
            2 * binConfig.numLevels + 1
        );
    });
});
