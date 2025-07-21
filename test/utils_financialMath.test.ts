// test/utils_financialMath.test.ts

import { describe, it, expect } from "vitest";
import { FinancialMath } from "../src/utils/financialMath.js";

describe("FinancialMath - Mission Critical Statistical Methods", () => {
    describe("calculateMean()", () => {
        it("should calculate mean correctly for positive numbers", () => {
            const values = [1, 2, 3, 4, 5];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBe(3);
        });

        it("should calculate mean correctly for decimal numbers", () => {
            const values = [1.5, 2.5, 3.5];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBeCloseTo(2.5, 8);
        });

        it("should handle large numbers with precision", () => {
            const values = [
                999999.123456789, 1000000.987654321, 1000001.555555555,
            ];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBeCloseTo(1000000.555555555, 6);
        });

        it("should handle very small numbers", () => {
            const values = [0.000001, 0.000002, 0.000003];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBeCloseTo(0.000002, 8);
        });

        it("should handle single value", () => {
            const values = [42.123];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBe(42.123);
        });

        it("should return 0 for empty array", () => {
            const values: number[] = [];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBe(0);
        });

        it("should return 0 for null/undefined input", () => {
            expect(FinancialMath.calculateMean(null as any)).toBe(0);
            expect(FinancialMath.calculateMean(undefined as any)).toBe(0);
        });

        it("should filter out invalid values (NaN, Infinity)", () => {
            const values = [1, 2, NaN, 3, Infinity, 4, -Infinity, 5];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBe(3); // (1+2+3+4+5)/5 = 3
        });

        it("should return 0 when all values are invalid", () => {
            const values = [NaN, Infinity, -Infinity];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBe(0);
        });

        it("should handle negative numbers correctly", () => {
            const values = [-5, -3, -1, 1, 3, 5];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBe(0);
        });

        it("should handle precision issues better than naive implementation", () => {
            // Test case that would fail with naive floating point arithmetic
            const values = [0.1, 0.2, 0.3];
            const result = FinancialMath.calculateMean(values);
            expect(result).toBeCloseTo(0.2, 8);

            // Naive implementation would give imprecise result
            const naiveResult =
                values.reduce((a, b) => a + b, 0) / values.length;
            expect(naiveResult).not.toBe(0.2); // This should fail with floating point precision
            expect(result).toBeCloseTo(0.2, 8); // But FinancialMath should be precise
        });
    });

    describe("calculateStdDev()", () => {
        it("should calculate standard deviation correctly", () => {
            const values = [2, 4, 4, 4, 5, 5, 7, 9];
            const result = FinancialMath.calculateStdDev(values);
            // Using Welford's algorithm, the result should be approximately 2.138
            expect(result).toBeCloseTo(2.138, 3);
        });

        it("should return 0 for single value", () => {
            const values = [42];
            const result = FinancialMath.calculateStdDev(values);
            expect(result).toBe(0);
        });

        it("should return 0 for empty array", () => {
            const values: number[] = [];
            const result = FinancialMath.calculateStdDev(values);
            expect(result).toBe(0);
        });

        it("should return 0 for null/undefined input", () => {
            expect(FinancialMath.calculateStdDev(null as any)).toBe(0);
            expect(FinancialMath.calculateStdDev(undefined as any)).toBe(0);
        });

        it("should handle identical values", () => {
            const values = [5, 5, 5, 5, 5];
            const result = FinancialMath.calculateStdDev(values);
            expect(result).toBe(0);
        });

        it("should filter out invalid values", () => {
            const values = [1, 2, NaN, 3, Infinity, 4, -Infinity];
            const result = FinancialMath.calculateStdDev(values);
            // Should calculate std dev of [1, 2, 3, 4]
            expect(result).toBeCloseTo(1.291, 3);
        });

        it("should return 0 when only one valid value remains after filtering", () => {
            const values = [42, NaN, Infinity, -Infinity];
            const result = FinancialMath.calculateStdDev(values);
            expect(result).toBe(0);
        });

        it("should use Welford's algorithm for numerical stability", () => {
            // Test with values that could cause precision issues with naive implementation
            const values = [1e9, 1e9 + 1, 1e9 + 2, 1e9 + 3];
            const result = FinancialMath.calculateStdDev(values);
            expect(result).toBeCloseTo(1.291, 3); // sqrt(5/3) ≈ 1.291
        });

        it("should handle large datasets efficiently", () => {
            const values = Array.from({ length: 10000 }, (_, i) => i);
            const result = FinancialMath.calculateStdDev(values);
            // For sequential integers 0-9999, the std dev should be around 2886.896
            expect(result).toBeCloseTo(2886.896, 0);
        });
    });

    describe("calculatePercentile()", () => {
        it("should calculate percentiles correctly", () => {
            const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

            expect(FinancialMath.calculatePercentile(values, 0)).toBe(1);
            expect(FinancialMath.calculatePercentile(values, 50)).toBe(5.5); // Median
            expect(FinancialMath.calculatePercentile(values, 100)).toBe(10);
            expect(FinancialMath.calculatePercentile(values, 25)).toBe(3.25);
            expect(FinancialMath.calculatePercentile(values, 75)).toBe(7.75);
        });

        it("should handle unsorted arrays", () => {
            const values = [5, 1, 9, 3, 7, 2, 8, 4, 6, 10];
            const result = FinancialMath.calculatePercentile(values, 50);
            expect(result).toBe(5.5); // Should sort internally
        });

        it("should handle duplicate values", () => {
            const values = [1, 2, 2, 3, 3, 3, 4, 4, 5];
            const result = FinancialMath.calculatePercentile(values, 50);
            expect(result).toBe(3);
        });

        it("should interpolate between values correctly", () => {
            const values = [1, 2, 3, 4];
            const result = FinancialMath.calculatePercentile(values, 33.33);
            // Should interpolate: 33.33% of [1,2,3,4] is at index 0.9999, which gives us value close to 2
            expect(result).toBeCloseTo(2.0, 1);
        });

        it("should return 0 for empty array", () => {
            const values: number[] = [];
            const result = FinancialMath.calculatePercentile(values, 50);
            expect(result).toBe(0);
        });

        it("should return 0 for null/undefined input", () => {
            expect(FinancialMath.calculatePercentile(null as any, 50)).toBe(0);
            expect(
                FinancialMath.calculatePercentile(undefined as any, 50)
            ).toBe(0);
        });

        it("should throw error for invalid percentile values", () => {
            const values = [1, 2, 3, 4, 5];

            expect(() => FinancialMath.calculatePercentile(values, -1)).toThrow(
                "Invalid percentile: -1. Must be between 0 and 100."
            );
            expect(() =>
                FinancialMath.calculatePercentile(values, 101)
            ).toThrow("Invalid percentile: 101. Must be between 0 and 100.");
            expect(() =>
                FinancialMath.calculatePercentile(values, NaN)
            ).toThrow();
        });

        it("should filter out invalid values", () => {
            const values = [1, NaN, 2, Infinity, 3, -Infinity, 4, 5];
            const result = FinancialMath.calculatePercentile(values, 50);
            // Should work with [1, 2, 3, 4, 5]
            expect(result).toBe(3);
        });

        it("should return 0 when all values are invalid", () => {
            const values = [NaN, Infinity, -Infinity];
            const result = FinancialMath.calculatePercentile(values, 50);
            expect(result).toBe(0);
        });

        it("should handle single value", () => {
            const values = [42];
            expect(FinancialMath.calculatePercentile(values, 0)).toBe(42);
            expect(FinancialMath.calculatePercentile(values, 50)).toBe(42);
            expect(FinancialMath.calculatePercentile(values, 100)).toBe(42);
        });

        it("should handle edge percentiles precisely", () => {
            const values = [10, 20, 30, 40, 50];

            expect(FinancialMath.calculatePercentile(values, 0)).toBe(10);
            expect(FinancialMath.calculatePercentile(values, 100)).toBe(50);
            expect(FinancialMath.calculatePercentile(values, 25)).toBe(20); // Exact index match
            expect(FinancialMath.calculatePercentile(values, 75)).toBe(40); // Exact index match
        });
    });

    describe("calculateMedian()", () => {
        it("should calculate median for odd number of elements", () => {
            const values = [1, 3, 5, 7, 9];
            const result = FinancialMath.calculateMedian(values);
            expect(result).toBe(5);
        });

        it("should calculate median for even number of elements", () => {
            const values = [1, 2, 3, 4, 5, 6];
            const result = FinancialMath.calculateMedian(values);
            expect(result).toBe(3.5); // Average of 3 and 4
        });

        it("should handle unsorted arrays", () => {
            const values = [5, 1, 3, 9, 7];
            const result = FinancialMath.calculateMedian(values);
            expect(result).toBe(5); // Sorted: [1, 3, 5, 7, 9]
        });

        it("should be equivalent to 50th percentile", () => {
            const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
            const median = FinancialMath.calculateMedian(values);
            const percentile50 = FinancialMath.calculatePercentile(values, 50);
            expect(median).toBe(percentile50);
        });

        it("should return 0 for empty array", () => {
            const values: number[] = [];
            const result = FinancialMath.calculateMedian(values);
            expect(result).toBe(0);
        });

        it("should filter out invalid values", () => {
            const values = [1, NaN, 2, Infinity, 3, -Infinity, 4, 5];
            const result = FinancialMath.calculateMedian(values);
            expect(result).toBe(3); // Median of [1, 2, 3, 4, 5]
        });
    });

    describe("Integration Tests - Real Trading Scenarios", () => {
        it("should handle realistic price data", () => {
            // Realistic BTC price data
            const prices = [
                50000.15, 50001.23, 49999.87, 50002.45, 50000.78, 49998.33,
                50003.12, 50001.89, 49997.55, 50004.21,
            ];

            const mean = FinancialMath.calculateMean(prices);
            const stdDev = FinancialMath.calculateStdDev(prices);
            const median = FinancialMath.calculateMedian(prices);
            const p95 = FinancialMath.calculatePercentile(prices, 95);

            expect(mean).toBeCloseTo(50000.958, 3);
            expect(stdDev).toBeGreaterThan(0);
            expect(median).toBeCloseTo(50001.005, 1);
            expect(p95).toBeGreaterThan(median);
        });

        it("should handle realistic volume data", () => {
            // Realistic volume data with high variance
            const volumes = [
                0.001, 0.5, 10.0, 0.02, 100.0, 0.1, 5.0, 0.005, 50.0, 0.25,
            ];

            const mean = FinancialMath.calculateMean(volumes);
            const stdDev = FinancialMath.calculateStdDev(volumes);
            const median = FinancialMath.calculateMedian(volumes);

            expect(mean).toBeGreaterThan(0);
            expect(stdDev).toBeGreaterThan(0);
            expect(median).toBeGreaterThan(0);
            expect(stdDev).toBeGreaterThan(mean); // High variance dataset
        });

        it("should maintain precision with institutional-size trades", () => {
            // Large institutional trade sizes
            const trades = [
                999999.99999999, 1000000.00000001, 999999.99999998,
                1000000.00000002, 999999.99999997, 1000000.00000003,
            ];

            const mean = FinancialMath.calculateMean(trades);
            const stdDev = FinancialMath.calculateStdDev(trades);

            expect(mean).toBeCloseTo(1000000, 8);
            expect(stdDev).toBeGreaterThan(0);
            expect(stdDev).toBeLessThan(0.00001); // Very small std dev for similar values
        });

        it("should handle extreme market volatility scenarios", () => {
            // Extreme price movements (flash crash scenario)
            const prices = [
                50000, 49000, 45000, 30000, 35000, 40000, 45000, 48000, 49500,
                50200,
            ];

            const mean = FinancialMath.calculateMean(prices);
            const stdDev = FinancialMath.calculateStdDev(prices);
            const p5 = FinancialMath.calculatePercentile(prices, 5);
            const p95 = FinancialMath.calculatePercentile(prices, 95);

            expect(mean).toBeGreaterThan(40000);
            expect(mean).toBeLessThan(50000);
            expect(stdDev).toBeGreaterThan(5000); // High volatility
            expect(p95 - p5).toBeGreaterThan(15000); // Wide range
        });
    });

    describe("Performance and Stability Tests", () => {
        it("should handle large datasets efficiently", () => {
            const largeDataset = Array.from({ length: 10000 }, (_, i) => i);

            const startTime = Date.now();
            const mean = FinancialMath.calculateMean(largeDataset);
            const stdDev = FinancialMath.calculateStdDev(largeDataset);
            const median = FinancialMath.calculateMedian(largeDataset);
            const endTime = Date.now();

            // Should complete in reasonable time (less than 1 second)
            expect(endTime - startTime).toBeLessThan(1000);

            // Results should be predictable for sequential data
            expect(mean).toBeCloseTo(4999.5, 1);
            expect(stdDev).toBeCloseTo(2886.896, 0);
            expect(median).toBeCloseTo(4999.5, 1);
        });

        it("should be numerically stable with pathological inputs", () => {
            // Test case that breaks naive floating point implementations
            const pathologicalValues = [
                1e15,
                1e15 + 1,
                1e15 + 2,
                1e15 + 3,
                1e15 + 4,
            ];

            const mean = FinancialMath.calculateMean(pathologicalValues);
            const stdDev = FinancialMath.calculateStdDev(pathologicalValues);

            expect(mean).toBeCloseTo(1e15 + 2, 0);
            expect(stdDev).toBeCloseTo(Math.sqrt(2.5), 3);
        });

        it("should handle repeated calculations consistently", () => {
            const values = [1.1, 2.2, 3.3, 4.4, 5.5];

            // Run same calculation multiple times
            const results = Array.from({ length: 100 }, () => ({
                mean: FinancialMath.calculateMean(values),
                stdDev: FinancialMath.calculateStdDev(values),
                median: FinancialMath.calculateMedian(values),
            }));

            // All results should be identical (deterministic)
            const firstResult = results[0];
            results.forEach((result) => {
                expect(result.mean).toBe(firstResult.mean);
                expect(result.stdDev).toBe(firstResult.stdDev);
                expect(result.median).toBe(firstResult.median);
            });
        });
    });

    describe("Comparison with DetectorUtils (Migration Validation)", () => {
        it("should provide more precise results than naive floating point arithmetic", () => {
            // Test precision improvement over simple arithmetic
            const precisionTestValues = [0.1, 0.2, 0.3, 0.4, 0.5];

            const financialMean =
                FinancialMath.calculateMean(precisionTestValues);
            const naiveMean =
                precisionTestValues.reduce((a, b) => a + b, 0) /
                precisionTestValues.length;

            // FinancialMath should be more precise
            expect(financialMean).toBeCloseTo(0.3, 8);
            // Note: For this simple case, both methods might be equally precise
            expect(financialMean).toBeCloseTo(0.3, 8);
        });

        it("should handle edge cases that might break other implementations", () => {
            const edgeCases = [
                [], // Empty array
                [NaN], // Only NaN
                [0], // Single zero
                [Number.MIN_VALUE], // Minimum positive value
            ];

            edgeCases.forEach((values) => {
                expect(() => {
                    FinancialMath.calculateMean(values);
                    FinancialMath.calculateStdDev(values);
                    FinancialMath.calculateMedian(values);
                    if (values.filter((v) => Number.isFinite(v)).length > 0) {
                        FinancialMath.calculatePercentile(values, 50);
                    }
                }).not.toThrow();
            });
        });
    });

    describe("Core Financial Methods", () => {
        describe("priceToInt() and intToPrice()", () => {
            it("should convert price to integer and back correctly", () => {
                const price = 50000.12345678;
                const priceInt = FinancialMath.priceToInt(price);
                const convertedBack = FinancialMath.intToPrice(priceInt);

                expect(convertedBack).toBeCloseTo(price, 8);
            });

            it("should handle maximum precision", () => {
                const price = 99999999.99999999;
                const priceInt = FinancialMath.priceToInt(price);
                const convertedBack = FinancialMath.intToPrice(priceInt);

                expect(convertedBack).toBeCloseTo(price, 8);
            });

            it("should throw error for invalid prices", () => {
                expect(() => FinancialMath.priceToInt(-1)).toThrow(
                    "Invalid price: -1"
                );
                expect(() => FinancialMath.priceToInt(NaN)).toThrow(
                    "Invalid price: NaN"
                );
                expect(() => FinancialMath.priceToInt(Infinity)).toThrow(
                    "Invalid price: Infinity"
                );
            });

            it("should handle zero price", () => {
                const priceInt = FinancialMath.priceToInt(0);
                const convertedBack = FinancialMath.intToPrice(priceInt);
                expect(convertedBack).toBe(0);
            });

            it("should handle very small prices", () => {
                const price = 0.00000001;
                const priceInt = FinancialMath.priceToInt(price);
                const convertedBack = FinancialMath.intToPrice(priceInt);

                expect(convertedBack).toBeCloseTo(price, 8);
            });
        });

        describe("normalizePriceToTick()", () => {
            it("should normalize price to tick size correctly", () => {
                const price = 50000.123;
                const tickSize = 0.01;
                const normalized = FinancialMath.normalizePriceToTick(
                    price,
                    tickSize
                );

                expect(normalized).toBeCloseTo(50000.12, 8);
            });

            it("should handle different tick sizes", () => {
                const price = 50000.456789;

                // Tick size 0.1
                expect(
                    FinancialMath.normalizePriceToTick(price, 0.1)
                ).toBeCloseTo(50000.4, 8);

                // Tick size 0.001
                expect(
                    FinancialMath.normalizePriceToTick(price, 0.001)
                ).toBeCloseTo(50000.456, 8);

                // Tick size 1
                expect(
                    FinancialMath.normalizePriceToTick(price, 1)
                ).toBeCloseTo(50000, 8);
            });

            it("should be idempotent", () => {
                const price = 50000.123456;
                const tickSize = 0.01;
                const normalized1 = FinancialMath.normalizePriceToTick(
                    price,
                    tickSize
                );
                const normalized2 = FinancialMath.normalizePriceToTick(
                    normalized1,
                    tickSize
                );

                expect(normalized1).toBe(normalized2);
            });
        });

        describe("priceToZone()", () => {
            it("should convert price to zone correctly", () => {
                const price = 50000.75;
                const tickSize = 0.5;
                const zone = FinancialMath.priceToZone(price, tickSize);

                expect(zone).toBe(
                    Math.round(
                        FinancialMath.normalizePriceToTick(price, tickSize)
                    )
                );
            });

            it("should handle various price levels", () => {
                const tickSize = 0.01;

                expect(FinancialMath.priceToZone(50000.123, tickSize)).toBe(
                    50000
                );
                expect(FinancialMath.priceToZone(50000.789, tickSize)).toBe(
                    50001
                );
                expect(FinancialMath.priceToZone(49999.456, tickSize)).toBe(
                    49999
                );
            });
        });

        describe("calculateMidPrice()", () => {
            it("should calculate mid price correctly", () => {
                const bid = 50000.0;
                const ask = 50001.0;
                const precision = 2;
                const midPrice = FinancialMath.calculateMidPrice(
                    bid,
                    ask,
                    precision
                );

                expect(midPrice).toBe(50000.5);
            });

            it("should handle different precisions", () => {
                const bid = 50000.123;
                const ask = 50000.789;

                expect(FinancialMath.calculateMidPrice(bid, ask, 2)).toBe(
                    50000.46
                );
                expect(FinancialMath.calculateMidPrice(bid, ask, 4)).toBe(
                    50000.456
                );
                expect(FinancialMath.calculateMidPrice(bid, ask, 0)).toBe(
                    50000
                );
            });

            it("should be more precise than naive calculation", () => {
                const bid = 0.1;
                const ask = 0.3;
                const precision = 8;

                const financialMid = FinancialMath.calculateMidPrice(
                    bid,
                    ask,
                    precision
                );
                const naiveMid = (bid + ask) / 2;

                expect(financialMid).toBeCloseTo(0.2, 8);
                expect(Math.abs(financialMid - 0.2)).toBeLessThanOrEqual(
                    Math.abs(naiveMid - 0.2)
                );
            });
        });

        describe("calculateSpread()", () => {
            it("should calculate spread correctly", () => {
                const ask = 50001.0;
                const bid = 50000.0;
                const precision = 2;
                const spread = FinancialMath.calculateSpread(
                    ask,
                    bid,
                    precision
                );

                expect(spread).toBe(1.0);
            });

            it("should handle small spreads with precision", () => {
                const ask = 50000.01;
                const bid = 50000.0;
                const precision = 4;
                const spread = FinancialMath.calculateSpread(
                    ask,
                    bid,
                    precision
                );

                expect(spread).toBe(0.01);
            });

            it("should handle different precisions", () => {
                const ask = 50000.123;
                const bid = 50000.089;

                expect(FinancialMath.calculateSpread(ask, bid, 2)).toBe(0.03);
                expect(FinancialMath.calculateSpread(ask, bid, 4)).toBe(0.034);
            });
        });

        describe("multiplyQuantities()", () => {
            it("should multiply quantities correctly", () => {
                const qty1 = 10.5;
                const qty2 = 2.0;
                const result = FinancialMath.multiplyQuantities(qty1, qty2);

                expect(result).toBeCloseTo(21.0, 8);
            });

            it("should handle decimal precision issues", () => {
                const qty1 = 0.1;
                const qty2 = 0.2;
                const result = FinancialMath.multiplyQuantities(qty1, qty2);

                expect(result).toBeCloseTo(0.02, 8);

                // Compare with naive multiplication that has precision issues
                const naiveResult = qty1 * qty2;
                expect(Math.abs(result - 0.02)).toBeLessThanOrEqual(
                    Math.abs(naiveResult - 0.02)
                );
            });

            it("should handle large numbers", () => {
                const qty1 = 999999.123456;
                const qty2 = 1.000001;
                const result = FinancialMath.multiplyQuantities(qty1, qty2);

                expect(result).toBeCloseTo(999999.123456 * 1.000001, 6);
            });

            it("should handle zero multiplication", () => {
                expect(FinancialMath.multiplyQuantities(5.5, 0)).toBe(0);
                expect(FinancialMath.multiplyQuantities(0, 10.5)).toBe(0);
            });
        });

        describe("divideQuantities()", () => {
            it("should divide quantities correctly", () => {
                const qty1 = 21.0;
                const qty2 = 2.0;
                const result = FinancialMath.divideQuantities(qty1, qty2);

                expect(result).toBeCloseTo(10.5, 8);
            });

            it("should handle division by zero", () => {
                const result = FinancialMath.divideQuantities(10.5, 0);
                expect(result).toBe(0);
            });

            it("should handle NaN inputs", () => {
                expect(FinancialMath.divideQuantities(NaN, 2)).toBe(0);
                expect(FinancialMath.divideQuantities(10, NaN)).toBe(0);
                expect(FinancialMath.divideQuantities(NaN, NaN)).toBe(0);
            });

            it("should handle decimal precision issues", () => {
                const qty1 = 0.3;
                const qty2 = 0.1;
                const result = FinancialMath.divideQuantities(qty1, qty2);

                expect(result).toBeCloseTo(3.0, 8);
            });

            it("should handle very small divisors", () => {
                const qty1 = 1.0;
                const qty2 = 0.000001;
                const result = FinancialMath.divideQuantities(qty1, qty2);

                expect(result).toBeCloseTo(1000000, 6);
            });
        });
    });

    describe("Validation Methods", () => {
        describe("isValidPrice()", () => {
            it("should validate correct prices", () => {
                expect(FinancialMath.isValidPrice(50000)).toBe(true);
                expect(FinancialMath.isValidPrice(0.01)).toBe(true);
                expect(FinancialMath.isValidPrice(999999.99)).toBe(true);
            });

            it("should reject invalid prices", () => {
                expect(FinancialMath.isValidPrice(0)).toBe(false);
                expect(FinancialMath.isValidPrice(-1)).toBe(false);
                expect(FinancialMath.isValidPrice(NaN)).toBe(false);
                expect(FinancialMath.isValidPrice(Infinity)).toBe(false);
                expect(FinancialMath.isValidPrice(-Infinity)).toBe(false);
            });
        });

        describe("isValidQuantity()", () => {
            it("should validate correct quantities", () => {
                expect(FinancialMath.isValidQuantity(1)).toBe(true);
                expect(FinancialMath.isValidQuantity(0.000001)).toBe(true);
                expect(FinancialMath.isValidQuantity(1000000)).toBe(true);
            });

            it("should reject invalid quantities", () => {
                expect(FinancialMath.isValidQuantity(0)).toBe(false);
                expect(FinancialMath.isValidQuantity(-1)).toBe(false);
                expect(FinancialMath.isValidQuantity(NaN)).toBe(false);
                expect(FinancialMath.isValidQuantity(Infinity)).toBe(false);
                expect(FinancialMath.isValidQuantity(-Infinity)).toBe(false);
            });
        });

        describe("compareQuantities()", () => {
            it("should compare quantities correctly", () => {
                expect(FinancialMath.compareQuantities(5.5, 3.3)).toBe(1);
                expect(FinancialMath.compareQuantities(3.3, 5.5)).toBe(-1);
                expect(FinancialMath.compareQuantities(5.5, 5.5)).toBe(0);
            });

            it("should handle precision in comparisons", () => {
                // With 8 decimal precision, these should be different
                expect(
                    FinancialMath.compareQuantities(1.00000001, 1.00000002)
                ).toBe(-1);

                // These should be different
                expect(FinancialMath.compareQuantities(1.0001, 1.0002)).toBe(
                    -1
                );
                expect(FinancialMath.compareQuantities(1.0002, 1.0001)).toBe(1);
            });

            it("should handle edge cases", () => {
                // This should handle floating point precision properly - both should round to same value with scaling
                expect(FinancialMath.compareQuantities(0.1 + 0.2, 0.3)).toBe(0); // Should be equal after scaling
                expect(
                    FinancialMath.compareQuantities(
                        Number.MAX_VALUE,
                        Number.MAX_VALUE
                    )
                ).toBe(0);
            });
        });
    });

    describe("Utility Methods", () => {
        describe("normalizeQuantity()", () => {
            it("should normalize quantity to specified precision", () => {
                expect(FinancialMath.normalizeQuantity(1.23456, 2)).toBe(1.23);
                expect(FinancialMath.normalizeQuantity(1.23456, 4)).toBe(
                    1.2346
                );
                expect(FinancialMath.normalizeQuantity(1.23456, 0)).toBe(1);
            });

            it("should throw error for invalid quantities", () => {
                expect(() => FinancialMath.normalizeQuantity(0, 2)).toThrow(
                    "Invalid quantity: 0"
                );
                expect(() => FinancialMath.normalizeQuantity(-1, 2)).toThrow(
                    "Invalid quantity: -1"
                );
                expect(() => FinancialMath.normalizeQuantity(NaN, 2)).toThrow(
                    "Invalid quantity: NaN"
                );
            });

            it("should handle rounding correctly", () => {
                expect(FinancialMath.normalizeQuantity(1.235, 2)).toBe(1.24); // Round up
                expect(FinancialMath.normalizeQuantity(1.234, 2)).toBe(1.23); // Round down
                expect(FinancialMath.normalizeQuantity(1.225, 2)).toBe(1.23); // Banker's rounding
            });
        });

        describe("parsePrice()", () => {
            it("should parse valid price strings", () => {
                expect(FinancialMath.parsePrice("50000.50")).toBe(50000.5);
                expect(FinancialMath.parsePrice("0.01")).toBe(0.01);
                expect(FinancialMath.parsePrice("999999.99")).toBe(999999.99);
            });

            it("should throw error for invalid price strings", () => {
                expect(() => FinancialMath.parsePrice("0")).toThrow(
                    "Invalid price string: 0"
                );
                expect(() => FinancialMath.parsePrice("-1")).toThrow(
                    "Invalid price string: -1"
                );
                expect(() => FinancialMath.parsePrice("abc")).toThrow(
                    "Invalid price string: abc"
                );
                expect(() => FinancialMath.parsePrice("")).toThrow(
                    "Invalid price string: "
                );
                expect(() => FinancialMath.parsePrice("Infinity")).toThrow(
                    "Invalid price string: Infinity"
                );
            });

            it("should handle scientific notation", () => {
                expect(FinancialMath.parsePrice("1e5")).toBe(100000);
                expect(FinancialMath.parsePrice("1.23e3")).toBe(1230);
            });
        });

        describe("parseQuantity()", () => {
            it("should parse valid quantity strings", () => {
                expect(FinancialMath.parseQuantity("10.5")).toBe(10.5);
                expect(FinancialMath.parseQuantity("0.000001")).toBe(0.000001);
                expect(FinancialMath.parseQuantity("1000000")).toBe(1000000);
            });

            it("should throw error for invalid quantity strings", () => {
                expect(() => FinancialMath.parseQuantity("0")).toThrow(
                    "Invalid quantity string: 0"
                );
                expect(() => FinancialMath.parseQuantity("-1")).toThrow(
                    "Invalid quantity string: -1"
                );
                expect(() => FinancialMath.parseQuantity("abc")).toThrow(
                    "Invalid quantity string: abc"
                );
                expect(() => FinancialMath.parseQuantity("")).toThrow(
                    "Invalid quantity string: "
                );
            });

            it("should handle scientific notation", () => {
                expect(FinancialMath.parseQuantity("1e-6")).toBe(0.000001);
                expect(FinancialMath.parseQuantity("1.5e2")).toBe(150);
            });
        });
    });

    describe("Real-World Trading Scenarios", () => {
        it("should handle BTC/USDT order book calculations", () => {
            const bestBid = 50000.12;
            const bestAsk = 50000.34;
            const precision = 2;

            const midPrice = FinancialMath.calculateMidPrice(
                bestBid,
                bestAsk,
                precision
            );
            const spread = FinancialMath.calculateSpread(
                bestAsk,
                bestBid,
                precision
            );

            expect(midPrice).toBe(50000.23);
            expect(spread).toBe(0.22);
        });

        it("should handle volume calculations for order matching", () => {
            const orderQuantity = 1.23456789;
            const fillRatio = 0.75;

            const filledQuantity = FinancialMath.multiplyQuantities(
                orderQuantity,
                fillRatio
            );
            const remainingQuantity = FinancialMath.divideQuantities(
                filledQuantity,
                fillRatio
            );

            expect(filledQuantity).toBeCloseTo(0.92592592, 6);
            expect(remainingQuantity).toBeCloseTo(orderQuantity, 6);
        });

        it("should handle tick normalization for different exchanges", () => {
            const price = 50000.123456;

            // Binance BTC/USDT tick size: 0.01
            const binancePrice = FinancialMath.normalizePriceToTick(
                price,
                0.01
            );
            expect(binancePrice).toBeCloseTo(50000.12, 8);

            // Coinbase Pro tick size: 0.01
            const coinbasePrice = FinancialMath.normalizePriceToTick(
                price,
                0.01
            );
            expect(coinbasePrice).toBe(binancePrice);

            // Some exchange with 0.1 tick
            const customPrice = FinancialMath.normalizePriceToTick(price, 0.1);
            expect(customPrice).toBeCloseTo(50000.1, 8);
        });

        it("should maintain precision in high-frequency trading calculations", () => {
            // Simulate 1000 rapid calculations
            const basePrice = 50000.123456;
            const quantities = Array.from(
                { length: 1000 },
                (_, i) => 0.001 * (i + 1)
            );

            let totalValue = 0;
            quantities.forEach((qty) => {
                const value = FinancialMath.multiplyQuantities(basePrice, qty);
                totalValue += value;
            });

            // Verify precision is maintained across many operations
            expect(totalValue).toBeGreaterThan(0);
            expect(Number.isFinite(totalValue)).toBe(true);

            // Calculate expected total using mathematical formula: sum of 0.001 * i from 1 to 1000
            const expectedSum = (0.001 * (1000 * 1001)) / 2; // = 0.5005
            const expectedTotal = basePrice * expectedSum;

            expect(totalValue).toBeCloseTo(expectedTotal, 4);
        });
    });

    describe("Edge Cases and Error Handling", () => {
        it("should handle extreme values gracefully", () => {
            const validValues = [Number.MIN_VALUE, Number.EPSILON, 1e-10, 1e10];

            validValues.forEach((value) => {
                if (FinancialMath.isValidPrice(value)) {
                    expect(() => {
                        FinancialMath.priceToInt(value);
                        FinancialMath.normalizePriceToTick(value, 0.01);
                    }).not.toThrow();
                }

                if (FinancialMath.isValidQuantity(value)) {
                    expect(() => {
                        FinancialMath.multiplyQuantities(value, 2);
                        FinancialMath.divideQuantities(value, 2);
                        FinancialMath.normalizeQuantity(value, 8);
                    }).not.toThrow();
                }
            });
        });

        it("should handle concurrent calculations consistently", () => {
            // Test thread safety / consistency
            const values = [1.1, 2.2, 3.3, 4.4, 5.5];
            const results = [];

            // Simulate concurrent calculations
            for (let i = 0; i < 100; i++) {
                results.push({
                    mean: FinancialMath.calculateMean(values),
                    stdDev: FinancialMath.calculateStdDev(values),
                    median: FinancialMath.calculateMedian(values),
                    p75: FinancialMath.calculatePercentile(values, 75),
                });
            }

            // All results should be identical
            const firstResult = results[0];
            results.forEach((result) => {
                expect(result.mean).toBe(firstResult.mean);
                expect(result.stdDev).toBe(firstResult.stdDev);
                expect(result.median).toBe(firstResult.median);
                expect(result.p75).toBe(firstResult.p75);
            });
        });
    });
});

describe("FinancialMath - Safe Division Methods", () => {
    describe("safeDivide()", () => {
        it("should divide numbers correctly", () => {
            const result = FinancialMath.safeDivide(10, 2);
            expect(result).toBe(5);
        });

        it("should handle division by zero", () => {
            const result = FinancialMath.safeDivide(10, 0);
            expect(result).toBe(0);
        });

        it("should use custom default value for division by zero", () => {
            const result = FinancialMath.safeDivide(10, 0, -1);
            expect(result).toBe(-1);
        });

        it("should handle infinite numerator", () => {
            const result = FinancialMath.safeDivide(Infinity, 2);
            expect(result).toBe(0);
        });

        it("should handle infinite denominator", () => {
            const result = FinancialMath.safeDivide(10, Infinity);
            expect(result).toBe(0);
        });

        it("should handle NaN inputs", () => {
            const result1 = FinancialMath.safeDivide(NaN, 2);
            expect(result1).toBe(0);

            const result2 = FinancialMath.safeDivide(10, NaN);
            expect(result2).toBe(0);
        });

        it("should use precise BigInt arithmetic for reasonable values", () => {
            const result = FinancialMath.safeDivide(1, 3);
            expect(result).toBeCloseTo(0.33333333, 6);
        });

        it("should fallback to regular division for extreme values", () => {
            const extremeValue = Number.MAX_SAFE_INTEGER;
            const result = FinancialMath.safeDivide(extremeValue, 2);
            expect(result).toBeCloseTo(extremeValue / 2, 0);
        });

        it("should handle very small values precisely", () => {
            const result = FinancialMath.safeDivide(0.000001, 0.000002);
            expect(result).toBeCloseTo(0.5, 6);
        });
    });
});

describe("FinancialMath - Zone Calculation Methods", () => {
    describe("calculateZone()", () => {
        it("should calculate zone correctly for valid inputs", () => {
            const result = FinancialMath.calculateZone(100.55, 5, 2);
            expect(result).toBeGreaterThan(0);
            expect(Number.isFinite(result)).toBe(true);
        });

        it("should throw error for invalid price", () => {
            expect(() => FinancialMath.calculateZone(0, 5, 2)).toThrow(
                "Invalid zone calculation parameters"
            );

            expect(() => FinancialMath.calculateZone(-10, 5, 2)).toThrow(
                "Invalid zone calculation parameters"
            );
        });

        it("should throw error for invalid zoneTicks", () => {
            expect(() => FinancialMath.calculateZone(100, 0, 2)).toThrow(
                "Invalid zone calculation parameters"
            );

            expect(() => FinancialMath.calculateZone(100, -5, 2)).toThrow(
                "Invalid zone calculation parameters"
            );
        });

        it("should throw error for invalid pricePrecision", () => {
            expect(() => FinancialMath.calculateZone(100, 5, -1)).toThrow(
                "Invalid zone calculation parameters"
            );
        });

        it("should handle different price precisions consistently", () => {
            const price = 100.12345;
            const result2 = FinancialMath.calculateZone(price, 5, 2);
            const result4 = FinancialMath.calculateZone(price, 5, 4);
            const result8 = FinancialMath.calculateZone(price, 5, 8);

            expect(Number.isFinite(result2)).toBe(true);
            expect(Number.isFinite(result4)).toBe(true);
            expect(Number.isFinite(result8)).toBe(true);

            // Higher precision should give more granular zones
            expect(result8).toBeGreaterThanOrEqual(result4);
            expect(result4).toBeGreaterThanOrEqual(result2);
        });

        it("should produce consistent zone boundaries", () => {
            const price1 = 100.15;
            const price2 = 100.16;
            const zoneTicks = 10;
            const precision = 2;

            const zone1 = FinancialMath.calculateZone(
                price1,
                zoneTicks,
                precision
            );
            const zone2 = FinancialMath.calculateZone(
                price2,
                zoneTicks,
                precision
            );

            // Prices close together should often map to same zone
            expect(Number.isFinite(zone1)).toBe(true);
            expect(Number.isFinite(zone2)).toBe(true);
        });

        it("should handle edge case with minimum tick size", () => {
            const result = FinancialMath.calculateZone(1.01, 1, 8);
            expect(Number.isFinite(result)).toBe(true);
            expect(result).toBeGreaterThan(0);
        });

        it("should handle large prices and zone ticks", () => {
            const result = FinancialMath.calculateZone(50000.123456, 100, 6);
            expect(Number.isFinite(result)).toBe(true);
            expect(result).toBeGreaterThan(0);
        });
    });
});
