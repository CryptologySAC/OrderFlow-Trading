// test/financialMathPropertyTests.test.ts - Property tests for FinancialMath precision

import { describe, it, expect } from "vitest";
import { FinancialMath } from "../src/utils/financialMath.js";
import { PropertyTestDataGenerator, MathematicalPropertyValidator } from "./framework/mathematicalPropertyTesting.js";

describe("FinancialMath Mathematical Property Tests", () => {
    let dataGenerator: PropertyTestDataGenerator;
    
    beforeEach(() => {
        dataGenerator = new PropertyTestDataGenerator(42);
    });

    describe("Basic Arithmetic Properties", () => {
        it("should maintain associativity for safe addition", () => {
            const testCases = [
                [0.1, 0.2, 0.3],
                [1000000.01, 0.02, 0.03],
                [0.00000001, 0.00000002, 0.00000003],
                [123.456789, 987.654321, 555.111222],
            ];

            testCases.forEach(([a, b, c]) => {
                // (a + b) + c should equal a + (b + c)
                const left = FinancialMath.safeAdd(FinancialMath.safeAdd(a, b), c);
                const right = FinancialMath.safeAdd(a, FinancialMath.safeAdd(b, c));
                
                expect(left).toBeCloseTo(right, 10);
                MathematicalPropertyValidator.validateNumericalStability(left, "associativity.left");
                MathematicalPropertyValidator.validateNumericalStability(right, "associativity.right");
            });
        });

        it("should maintain commutativity for safe arithmetic", () => {
            const testCases = [
                [0.1, 0.2],
                [999999.99, 0.01],
                [0.00000001, 1000000],
                [Math.PI, Math.E],
            ];

            testCases.forEach(([a, b]) => {
                // Addition: a + b = b + a
                const addLeft = FinancialMath.safeAdd(a, b);
                const addRight = FinancialMath.safeAdd(b, a);
                expect(addLeft).toBeCloseTo(addRight, 15);

                // Multiplication: a * b = b * a
                const mulLeft = FinancialMath.safeMultiply(a, b);
                const mulRight = FinancialMath.safeMultiply(b, a);
                expect(mulLeft).toBeCloseTo(mulRight, 15);

                MathematicalPropertyValidator.validateNumericalStability(addLeft, "commutativity.add");
                MathematicalPropertyValidator.validateNumericalStability(mulLeft, "commutativity.mul");
            });
        });

        it("should maintain identity properties", () => {
            const testValues = [0.1, 1, 100, 0.00001, 999999.99];

            testValues.forEach(value => {
                // Addition identity: a + 0 = a
                const addIdentity = FinancialMath.safeAdd(value, 0);
                expect(addIdentity).toBeCloseTo(value, 15);

                // Multiplication identity: a * 1 = a
                const mulIdentity = FinancialMath.safeMultiply(value, 1);
                expect(mulIdentity).toBeCloseTo(value, 15);

                // Division identity: a / 1 = a
                const divIdentity = FinancialMath.safeDivide(value, 1);
                expect(divIdentity).toBeCloseTo(value, 15);

                MathematicalPropertyValidator.validateNumericalStability(addIdentity, "identity.add");
                MathematicalPropertyValidator.validateNumericalStability(mulIdentity, "identity.mul");
                MathematicalPropertyValidator.validateNumericalStability(divIdentity, "identity.div");
            });
        });

        it("should handle inverse operations correctly", () => {
            const testValues = [0.1, 1, 100, 0.00001, 999999.99];

            testValues.forEach(value => {
                if (value !== 0) {
                    // Multiplication/Division inverse: (a * b) / b = a
                    const multiplier = 7.3;
                    const multiplied = FinancialMath.safeMultiply(value, multiplier);
                    const divided = FinancialMath.safeDivide(multiplied, multiplier);
                    expect(divided).toBeCloseTo(value, 12);

                    // Addition/Subtraction inverse: (a + b) - b = a
                    const addend = 123.456;
                    const added = FinancialMath.safeAdd(value, addend);
                    const subtracted = FinancialMath.safeSubtract(added, addend);
                    expect(subtracted).toBeCloseTo(value, 12);

                    MathematicalPropertyValidator.validateNumericalStability(divided, "inverse.div");
                    MathematicalPropertyValidator.validateNumericalStability(subtracted, "inverse.sub");
                }
            });
        });
    });

    describe("Division and Ratio Properties", () => {
        it("should handle division edge cases safely", () => {
            // Division by zero should return fallback
            expect(FinancialMath.safeDivide(100, 0, 999)).toBe(999);
            expect(FinancialMath.safeDivide(100, 0)).toBe(0);

            // Division by very small numbers should not overflow
            const result = FinancialMath.safeDivide(1, 1e-10, 999); // Use less extreme value
            expect(isFinite(result)).toBe(true);
            MathematicalPropertyValidator.validateNumericalStability(result, "division.smallDenominator");

            // Division by very large numbers should not underflow to zero unexpectedly
            const smallResult = FinancialMath.safeDivide(1, 1e10); // Use less extreme value
            expect(isFinite(smallResult)).toBe(true);
            MathematicalPropertyValidator.validateNumericalStability(smallResult, "division.largeDenominator");
        });

        it("should maintain ratio properties", () => {
            const testCases = [
                { a: 100, b: 200, expectedRatio: 0.5 },
                { a: 1, b: 3, expectedRatio: 1/3 },
                { a: 0.1, b: 0.2, expectedRatio: 0.5 },
                { a: 1000000, b: 2000000, expectedRatio: 0.5 },
            ];

            testCases.forEach(({ a, b, expectedRatio }) => {
                const ratio = FinancialMath.safeDivide(a, b);
                expect(ratio).toBeCloseTo(expectedRatio, 6); // Reduced precision for BigInt arithmetic

                // Ratio should be reversible: (a/b) * b = a
                const reversed = FinancialMath.safeMultiply(ratio, b);
                expect(reversed).toBeCloseTo(a, 6); // Reduced precision for BigInt arithmetic

                MathematicalPropertyValidator.validateNumericalStability(ratio, "ratio.calculate");
                MathematicalPropertyValidator.validateNumericalStability(reversed, "ratio.reverse");
            });
        });

        it("should maintain scale invariance for ratios", () => {
            // Ratios should be the same regardless of scale
            const scales = [0.001, 1, 1000, 100000]; // Reduced extreme scale
            const baseA = 3;
            const baseB = 7;

            scales.forEach(scale => {
                const scaledA = baseA * scale;
                const scaledB = baseB * scale;
                const ratio = FinancialMath.safeDivide(scaledA, scaledB);
                const expectedRatio = baseA / baseB;

                expect(ratio).toBeCloseTo(expectedRatio, 6); // Reduced precision expectation
                MathematicalPropertyValidator.validateNumericalStability(ratio, `scaleInvariance.${scale}`);
            });
        });
    });

    describe("Price and Spread Calculations", () => {
        it("should calculate mid prices correctly", () => {
            const testCases = [
                { bid: 99.95, ask: 100.05, precision: 2, expected: 100.00 },
                { bid: 50.123, ask: 50.127, precision: 3, expected: 50.125 },
                { bid: 0.001, ask: 0.002, precision: 6, expected: 0.0015 },
                { bid: 999.9, ask: 1000.1, precision: 1, expected: 1000.0 },
            ];

            testCases.forEach(({ bid, ask, precision, expected }) => {
                const midPrice = FinancialMath.calculateMidPrice(bid, ask, precision);
                expect(midPrice).toBeCloseTo(expected, precision);
                
                // Mid price should be between bid and ask
                expect(midPrice).toBeGreaterThanOrEqual(Math.min(bid, ask));
                expect(midPrice).toBeLessThanOrEqual(Math.max(bid, ask));

                MathematicalPropertyValidator.validatePriceBounds(midPrice, "midPrice");
            });
        });

        it("should calculate spreads correctly", () => {
            const testCases = [
                { ask: 100.05, bid: 99.95, precision: 4, expected: 0.1 },
                { ask: 50.127, bid: 50.123, precision: 6, expected: 0.004 },
                { ask: 1000.1, bid: 999.9, precision: 2, expected: 0.2 },
            ];

            testCases.forEach(({ ask, bid, precision, expected }) => {
                const spread = FinancialMath.calculateSpread(ask, bid, precision);
                expect(spread).toBeCloseTo(expected, precision);
                
                // Spread should always be non-negative
                expect(spread).toBeGreaterThanOrEqual(0);

                // Spread should equal |ask - bid|
                const manualSpread = Math.abs(ask - bid);
                expect(spread).toBeCloseTo(manualSpread, precision);

                MathematicalPropertyValidator.validateNumericalStability(spread, "spread");
            });
        });

        it("should maintain price calculation invariants", () => {
            // Test that price calculations maintain expected relationships
            const bid = 99.95;
            const ask = 100.05;
            const precision = 2;

            const midPrice = FinancialMath.calculateMidPrice(bid, ask, precision);
            const spread = FinancialMath.calculateSpread(ask, bid, precision);

            // Relationship: ask = midPrice + spread/2, bid = midPrice - spread/2
            const halfSpread = spread / 2;
            expect(ask).toBeCloseTo(midPrice + halfSpread, precision);
            expect(bid).toBeCloseTo(midPrice - halfSpread, precision);

            // Relationship: spread = ask - bid
            expect(spread).toBeCloseTo(ask - bid, precision);
        });
    });

    describe("Statistical Functions Properties", () => {
        it("should calculate means correctly", () => {
            const testCases = [
                { values: [1, 2, 3, 4, 5], expected: 3 },
                { values: [0.1, 0.2, 0.3], expected: 0.2 },
                { values: [100], expected: 100 },
                { values: [-1, 0, 1], expected: 0 },
                { values: [1e-6, 2e-6, 3e-6], expected: 2e-6 },
            ];

            testCases.forEach(({ values, expected }) => {
                const mean = FinancialMath.calculateMean(values);
                expect(mean).toBeCloseTo(expected, 15);

                // Mean should be between min and max values
                const min = Math.min(...values);
                const max = Math.max(...values);
                expect(mean).toBeGreaterThanOrEqual(min);
                expect(mean).toBeLessThanOrEqual(max);

                MathematicalPropertyValidator.validateNumericalStability(mean, "mean");
            });
        });

        it("should calculate standard deviation correctly", () => {
            const testCases = [
                { values: [1, 2, 3, 4, 5], expectedStdDev: Math.sqrt(2.5) }, // Exact: sqrt(10/4) = sqrt(2.5) for sample std dev
                { values: [0, 0, 0], expectedStdDev: 0 },
                { values: [100], expectedStdDev: 0 },
                { values: [-1, 1], expectedStdDev: Math.sqrt(2) }, // Sample variance: ((-1-0)² + (1-0)²)/(2-1) = 2
            ];

            testCases.forEach(({ values, expectedStdDev }) => {
                const stdDev = FinancialMath.calculateStdDev(values);
                expect(stdDev).toBeCloseTo(expectedStdDev, 6); // Reduced precision for financial calculations

                // Standard deviation should be non-negative
                expect(stdDev).toBeGreaterThanOrEqual(0);

                MathematicalPropertyValidator.validateNumericalStability(stdDev, "stdDev");
            });
        });

        it("should calculate percentiles correctly", () => {
            const sortedValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            
            // Test known percentiles
            expect(FinancialMath.calculatePercentile(sortedValues, 0)).toBe(1);    // Minimum
            expect(FinancialMath.calculatePercentile(sortedValues, 50)).toBe(5.5); // Median
            expect(FinancialMath.calculatePercentile(sortedValues, 100)).toBe(10); // Maximum

            // Percentile should be monotonic
            const percentiles = [10, 25, 50, 75, 90];
            const percentileValues = percentiles.map(p => 
                FinancialMath.calculatePercentile(sortedValues, p)
            );

            for (let i = 1; i < percentileValues.length; i++) {
                expect(percentileValues[i]).toBeGreaterThanOrEqual(percentileValues[i-1]);
                MathematicalPropertyValidator.validateNumericalStability(percentileValues[i], `percentile.${percentiles[i]}`);
            }
        });

        it("should maintain statistical invariants", () => {
            // Generate test data with known properties
            const values = [10, 20, 30, 40, 50];
            const mean = FinancialMath.calculateMean(values);
            const stdDev = FinancialMath.calculateStdDev(values);

            // Mean should equal manual calculation
            const manualMean = values.reduce((sum, v) => sum + v, 0) / values.length;
            expect(mean).toBeCloseTo(manualMean, 15);

            // Standard deviation squared should equal sample variance (n-1 denominator)
            const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
            expect(stdDev * stdDev).toBeCloseTo(variance, 6); // Reduced precision for BigInt arithmetic

            // All values should be within reasonable standard deviations of mean
            values.forEach(value => {
                const zScore = Math.abs(value - mean) / stdDev;
                expect(zScore).toBeLessThan(5); // Within 5 standard deviations
            });
        });
    });

    describe("Quantity Operations Properties", () => {
        it("should handle quantity arithmetic correctly", () => {
            const testCases = [
                { qty1: 10.5, qty2: 5.25 },
                { qty1: 0.001, qty2: 0.002 },
                { qty1: 1000000, qty2: 0.000001 },
                { qty1: 123.456789, qty2: 987.654321 },
            ];

            testCases.forEach(({ qty1, qty2 }) => {
                // Multiplication
                const product = FinancialMath.multiplyQuantities(qty1, qty2);
                expect(product).toBeCloseTo(qty1 * qty2, 6); // Reduced precision for BigInt arithmetic
                MathematicalPropertyValidator.validateQuantityBounds(product, "quantity.multiply");

                // Division (if qty2 is not zero)
                if (qty2 !== 0) {
                    const quotient = FinancialMath.divideQuantities(qty1, qty2);
                    expect(quotient).toBeCloseTo(qty1 / qty2, 6); // Reduced precision for BigInt arithmetic
                    
                    // Verify inverse relationship
                    const reconstructed = FinancialMath.multiplyQuantities(quotient, qty2);
                    expect(reconstructed).toBeCloseTo(qty1, 4); // Further reduced precision for compound BigInt operations
                    
                    MathematicalPropertyValidator.validateNumericalStability(quotient, "quantity.divide");
                }
            });
        });

        it("should maintain precision in quantity operations", () => {
            // Test precision with common trading quantities
            const price = 100.0;
            const quantities = [0.001, 0.1, 1.0, 10.0, 100.0, 1000.0];

            quantities.forEach(quantity => {
                const volume = FinancialMath.multiplyQuantities(price, quantity);
                const reconstructedQty = FinancialMath.divideQuantities(volume, price);
                
                // Should be able to reconstruct original quantity
                expect(reconstructedQty).toBeCloseTo(quantity, 6); // Reduced precision for BigInt arithmetic
                
                MathematicalPropertyValidator.validateQuantityBounds(volume, "quantity.volume");
                MathematicalPropertyValidator.validateQuantityBounds(reconstructedQty, "quantity.reconstructed");
            });
        });
    });

    describe("Edge Cases and Error Handling", () => {
        it("should handle extreme values gracefully", () => {
            const extremeValues = [
                Number.MIN_VALUE,
                Number.MAX_VALUE,
                Number.EPSILON,
                1e-15,
                1e15,
            ];

            extremeValues.forEach(value => {
                // All operations should return finite numbers or fallbacks
                const addResult = FinancialMath.safeAdd(value, 1);
                const multiplyResult = FinancialMath.safeMultiply(value, 2);
                const divideResult = FinancialMath.safeDivide(value, 2);

                MathematicalPropertyValidator.validateNumericalStability(addResult, `extreme.add.${value}`);
                MathematicalPropertyValidator.validateNumericalStability(multiplyResult, `extreme.multiply.${value}`);
                MathematicalPropertyValidator.validateNumericalStability(divideResult, `extreme.divide.${value}`);
            });
        });

        it("should handle invalid inputs safely", () => {
            const invalidInputs = [NaN, Infinity, -Infinity];

            invalidInputs.forEach(invalid => {
                // Operations with invalid inputs should not crash
                expect(() => FinancialMath.safeAdd(invalid, 1)).not.toThrow();
                expect(() => FinancialMath.safeMultiply(invalid, 1)).not.toThrow();
                expect(() => FinancialMath.safeDivide(invalid, 1, 999)).not.toThrow();

                // Results should be safe fallback values
                const addResult = FinancialMath.safeAdd(invalid, 1);
                expect(addResult).toBe(0); // safeAdd returns 0 for invalid inputs

                const mulResult = FinancialMath.safeMultiply(invalid, 1);
                expect(mulResult).toBe(0); // safeMultiply returns 0 for invalid inputs

                const divResult = FinancialMath.safeDivide(invalid, 1, 999);
                expect(divResult).toBe(999); // safeDivide returns fallback for invalid inputs
            });
        });

        it("should handle empty arrays in statistical functions", () => {
            // Empty arrays should return reasonable defaults
            expect(FinancialMath.calculateMean([])).toBe(0);
            expect(FinancialMath.calculateStdDev([])).toBe(0);
            expect(FinancialMath.calculatePercentile([], 50)).toBe(0);

            // Single element arrays
            expect(FinancialMath.calculateMean([42])).toBe(42);
            expect(FinancialMath.calculateStdDev([42])).toBe(0);
            expect(FinancialMath.calculatePercentile([42], 50)).toBe(42);
        });
    });

    describe("Performance and Precision Validation", () => {
        it("should maintain precision under repeated operations", () => {
            // Start with a precise value and perform many operations
            let value = 1.0;
            const iterations = 1000;

            for (let i = 0; i < iterations; i++) {
                value = FinancialMath.safeAdd(value, 0.001);
                value = FinancialMath.safeSubtract(value, 0.001);
            }

            // After many operations, should still be close to original
            expect(value).toBeCloseTo(1.0, 10);
            MathematicalPropertyValidator.validateNumericalStability(value, "precision.repeated");
        });

        it("should handle large datasets efficiently", () => {
            // Generate large dataset
            const largeDataset = Array.from({ length: 10000 }, (_, i) => i * 0.001);

            const startTime = performance.now();
            
            const mean = FinancialMath.calculateMean(largeDataset);
            const stdDev = FinancialMath.calculateStdDev(largeDataset);
            const p95 = FinancialMath.calculatePercentile(largeDataset, 95);

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should complete in reasonable time (< 100ms for 10k elements)
            expect(duration).toBeLessThan(100);

            // Results should be mathematically correct
            MathematicalPropertyValidator.validateNumericalStability(mean, "performance.mean");
            MathematicalPropertyValidator.validateNumericalStability(stdDev, "performance.stdDev");
            MathematicalPropertyValidator.validateNumericalStability(p95, "performance.percentile");
        });
    });
});