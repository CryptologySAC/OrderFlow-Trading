/**
 * Test for FinancialMathRustDropIn drop-in replacement
 */
import { describe, it, expect } from "vitest";
import { FinancialMathRustDropIn } from "../src/utils/financialMathRustDropIn.js";

describe("FinancialMathRustDropIn - Drop-in Replacement", () => {
    it("should have all the same methods as original FinancialMath", () => {
        // Test basic arithmetic operations
        const result1 = FinancialMathRustDropIn.safeAdd(1.5, 2.3);
        expect(typeof result1).toBe("number");
        expect(result1).toBe(3.8);

        const result2 = FinancialMathRustDropIn.safeSubtract(5, 2);
        expect(typeof result2).toBe("number");
        expect(result2).toBe(3);

        const result3 = FinancialMathRustDropIn.safeMultiply(3, 4);
        expect(typeof result3).toBe("number");
        expect(result3).toBe(12);

        const result4 = FinancialMathRustDropIn.safeDivide(10, 2);
        expect(typeof result4).toBe("number");
        expect(result4).toBe(5);
    });

    it("should handle statistical operations", () => {
        const values = [1, 2, 3, 4, 5];

        const mean = FinancialMathRustDropIn.calculateMean(values);
        expect(typeof mean).toBe("number");
        expect(mean).toBe(3);

        const min = FinancialMathRustDropIn.calculateMin(values);
        expect(typeof min).toBe("number");
        expect(min).toBe(1);

        const max = FinancialMathRustDropIn.calculateMax(values);
        expect(typeof max).toBe("number");
        expect(max).toBe(5);
    });

    it("should handle validation operations", () => {
        const validPrice = FinancialMathRustDropIn.isValidPrice(100.5);
        expect(typeof validPrice).toBe("boolean");
        expect(validPrice).toBe(true);

        const invalidPrice = FinancialMathRustDropIn.isValidPrice(-10);
        expect(typeof invalidPrice).toBe("boolean");
        expect(invalidPrice).toBe(false);
    });

    it("should handle quantity operations", () => {
        const result = FinancialMathRustDropIn.multiplyQuantities(10, 0.5);
        expect(typeof result).toBe("number");
        expect(result).toBe(5);
    });

    it("should handle percentage calculations", () => {
        const change = FinancialMathRustDropIn.calculatePercentageChange(
            100,
            110
        );
        expect(typeof change).toBe("number");
        expect(change).toBe(10);
    });
});
