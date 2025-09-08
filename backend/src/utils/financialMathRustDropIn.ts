/**
 * DROP-IN REPLACEMENT FOR FinancialMath
 *
 * This provides a true drop-in replacement that maintains the exact same interface
 * as the original FinancialMath class while using Rust performance internally.
 *
 * Usage:
 *   Replace: import { FinancialMath } from "./financialMath.js";
 *   With:    import { FinancialMathRustDropIn as FinancialMath } from "./financialMathRustDropIn.js";
 */

import { FinancialMath } from "./financialMath.js";
import { FinancialMathRust } from "./financialMathRust.js";

export class FinancialMathRustDropIn extends FinancialMath {
    /**
     * Convert floating point price to integer representation
     */
    static override priceToInt(price: number): bigint {
        if (!FinancialMathRust.isAvailable()) {
            return super.priceToInt(price);
        }
        const result = FinancialMathRust.priceToInt(price);
        return BigInt(result);
    }

    /**
     * Convert integer price back to floating point
     */
    static override intToPrice(priceInt: bigint): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.intToPrice(priceInt);
        }
        const result = FinancialMathRust.intToPrice(priceInt.toString());
        return result;
    }

    /**
     * Normalize price to tick size using Rust precision
     */
    static override normalizePriceToTick(
        price: number,
        tickSize: number
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.normalizePriceToTick(price, tickSize);
        }
        const priceStr = FinancialMathRust.priceToInt(price);
        const tickSizeStr = FinancialMathRust.priceToInt(tickSize);
        const normalizedStr = FinancialMathRust.normalizePriceToTick(
            priceStr,
            tickSizeStr
        );
        return FinancialMathRust.intToPrice(normalizedStr);
    }

    static override priceToZone(price: number, tickSize: number): number {
        return this.normalizePriceToTick(price, tickSize);
    }

    /**
     * Calculate mid price with Rust precision
     */
    static override calculateMidPrice(
        bid: number,
        ask: number,
        precision: number
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateMidPrice(bid, ask, precision);
        }
        const bidStr = FinancialMathRust.priceToInt(bid);
        const askStr = FinancialMathRust.priceToInt(ask);
        const midStr = FinancialMathRust.calculateMidPrice(bidStr, askStr);
        const midPrice = FinancialMathRust.intToPrice(midStr);
        // Apply precision rounding
        return Number(midPrice.toFixed(precision));
    }

    /**
     * Calculate spread with Rust precision
     */
    static override calculateSpread(
        ask: number,
        bid: number,
        precision: number
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateSpread(ask, bid, precision);
        }
        const askStr = FinancialMathRust.priceToInt(ask);
        const bidStr = FinancialMathRust.priceToInt(bid);
        const spreadStr = FinancialMathRust.calculateSpread(bidStr, askStr);
        const spread = FinancialMathRust.intToPrice(spreadStr);
        return Number(spread.toFixed(precision));
    }

    /**
     * Safe quantity multiplication using Rust
     */
    static override multiplyQuantities(qty1: number, qty2: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.multiplyQuantities(qty1, qty2);
        }
        if (isNaN(qty1) || isNaN(qty2)) return NaN;
        const qty1Str = FinancialMathRust.quantityToInt(qty1);
        const qty2Str = FinancialMathRust.quantityToInt(qty2);
        const resultStr = FinancialMathRust.safeMultiply(qty1Str, qty2Str);
        return FinancialMathRust.intToQuantity(resultStr);
    }

    /**
     * Safe quantity division using Rust
     */
    static override divideQuantities(qty1: number, qty2: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.divideQuantities(qty1, qty2);
        }
        if (qty2 === 0 || isNaN(qty1) || isNaN(qty2)) {
            return 0;
        }
        const qty1Str = FinancialMathRust.quantityToInt(qty1);
        const qty2Str = FinancialMathRust.quantityToInt(qty2);
        const resultStr = FinancialMathRust.safeDivide(qty1Str, qty2Str);
        return FinancialMathRust.intToQuantity(resultStr);
    }

    /**
     * Safe price addition using Rust
     */
    static override addAmounts(
        amount1: number,
        amount2: number,
        precision: number
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.addAmounts(amount1, amount2, precision);
        }
        if (isNaN(amount1) || isNaN(amount2)) {
            throw new Error(
                `Invalid amounts for addition: ${amount1}, ${amount2}`
            );
        }
        const amt1Str = FinancialMathRust.priceToInt(amount1);
        const amt2Str = FinancialMathRust.priceToInt(amount2);
        const resultStr = FinancialMathRust.safeAdd(amt1Str, amt2Str);
        const result = FinancialMathRust.intToPrice(resultStr);
        return Number(result.toFixed(precision));
    }

    /**
     * Validate if a price value is valid for trading
     */
    static override isValidPrice(price: number | string): boolean {
        if (!FinancialMathRust.isAvailable()) {
            return super.isValidPrice(price);
        }
        try {
            const priceNum =
                typeof price === "string" ? parseFloat(price) : price;
            return !isNaN(priceNum) && isFinite(priceNum) && priceNum > 0;
        } catch {
            return false;
        }
    }

    /**
     * Validate if a quantity value is valid for trading
     */
    static override isValidQuantity(quantity: number | string): boolean {
        if (!FinancialMathRust.isAvailable()) {
            return super.isValidQuantity(quantity);
        }
        try {
            const qtyNum =
                typeof quantity === "string" ? parseFloat(quantity) : quantity;
            return !isNaN(qtyNum) && isFinite(qtyNum) && qtyNum > 0;
        } catch {
            return false;
        }
    }

    /**
     * Compare two quantities with precision handling
     */
    static override compareQuantities(qty1: number, qty2: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.compareQuantities(qty1, qty2);
        }
        const qty1Str = FinancialMathRust.quantityToInt(qty1);
        const qty2Str = FinancialMathRust.quantityToInt(qty2);
        const qty1Int = BigInt(qty1Str);
        const qty2Int = BigInt(qty2Str);
        if (qty1Int < qty2Int) return -1;
        if (qty1Int > qty2Int) return 1;
        return 0;
    }

    /**
     * Normalize quantity to precision
     */
    static override normalizeQuantity(
        quantity: number,
        precision: number
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.normalizeQuantity(quantity, precision);
        }
        if (!this.isValidQuantity(quantity)) {
            throw new Error(`Invalid quantity: ${quantity}`);
        }
        return Number(quantity.toFixed(precision));
    }

    /**
     * Safe string to number conversion for prices
     */
    static override parsePrice(priceStr: string): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.parsePrice(priceStr);
        }
        const price = parseFloat(priceStr);
        if (!this.isValidPrice(price)) {
            throw new Error(`Invalid price string: ${priceStr}`);
        }
        return price;
    }

    /**
     * Safe string to number conversion for quantities
     */
    static override parseQuantity(quantityStr: string): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.parseQuantity(quantityStr);
        }
        const quantity = parseFloat(quantityStr);
        if (!this.isValidQuantity(quantity)) {
            throw new Error(`Invalid quantity string: ${quantityStr}`);
        }
        return quantity;
    }

    /**
     * Calculate mean with Rust precision
     */
    static override calculateMean(values: number[]): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateMean(values);
        }
        if (!values || values.length === 0) {
            return 0;
        }
        const validValues = values.filter((v) => !isNaN(v) && isFinite(v));
        if (validValues.length === 0) {
            return 0;
        }
        const valueStrings = validValues.map((v) =>
            FinancialMathRust.priceToInt(v)
        );
        const meanStr = FinancialMathRust.calculateMean(valueStrings);
        return FinancialMathRust.intToPrice(meanStr);
    }

    /**
     * Calculate standard deviation with Welford's algorithm
     */
    static override calculateStdDev(values: number[]): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateStdDev(values);
        }
        if (!values || values.length < 2) {
            return 0;
        }
        const validValues = values.filter((v) => !isNaN(v) && isFinite(v));
        if (validValues.length < 2) {
            return 0;
        }

        const mean = this.calculateMean(validValues);
        const squaredDiffs = validValues.map((v) => Math.pow(v - mean, 2));
        const variance =
            squaredDiffs.reduce((acc, val) => acc + val, 0) /
            (validValues.length - 1);
        return Math.sqrt(variance);
    }

    /**
     * Calculate percentile with precise interpolation
     */
    static override calculatePercentile(
        values: number[],
        percentile: number
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculatePercentile(values, percentile);
        }
        if (!values || values.length === 0) return 0;
        if (percentile < 0 || percentile > 100)
            throw new Error("Percentile must be between 0 and 100.");

        const sorted = values
            .filter((v) => !isNaN(v) && isFinite(v))
            .sort((a, b) => a - b);

        if (sorted.length === 0) return 0;

        if (percentile === 0) return sorted[0]!;
        if (percentile === 100) return sorted[sorted.length - 1]!;

        const index = (percentile / 100) * (sorted.length - 1);
        const lowerIndex = Math.floor(index);
        const upperIndex = Math.ceil(index);

        if (lowerIndex === upperIndex) {
            return sorted[lowerIndex]!;
        }

        const weight = index - lowerIndex;
        const lowerValue = sorted[lowerIndex]!;
        const upperValue = sorted[upperIndex]!;

        return lowerValue * (1 - weight) + upperValue * weight;
    }

    /**
     * Calculate median (50th percentile)
     */
    static override calculateMedian(values: number[]): number {
        return this.calculatePercentile(values, 50);
    }

    /**
     * Safe division with zero protection and precision handling
     */
    static override safeDivide(
        numerator: number,
        denominator: number,
        defaultValue: number = 0
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.safeDivide(numerator, denominator, defaultValue);
        }
        if (denominator === 0 || isNaN(numerator) || isNaN(denominator)) {
            return defaultValue;
        }
        const numStr = FinancialMathRust.priceToInt(numerator);
        const denStr = FinancialMathRust.priceToInt(denominator);
        const resultStr = FinancialMathRust.safeDivide(numStr, denStr);
        return FinancialMathRust.intToPrice(resultStr);
    }

    /**
     * Calculate zone using precise arithmetic
     */
    static override calculateZone(
        price: number,
        zoneTicks: number,
        pricePrecision: number
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateZone(price, zoneTicks, pricePrecision);
        }
        if (price <= 0 || zoneTicks <= 0) {
            throw new Error(
                `Invalid zone calculation parameters: price=${price}, zoneTicks=${zoneTicks}`
            );
        }
        const tickSize = 1 / Math.pow(10, pricePrecision);
        return this.normalizePriceToTick(price, tickSize);
    }

    // ========================================================================
    // INSTITUTIONAL-GRADE SAFE ARITHMETIC OPERATIONS
    // ========================================================================

    static override safeAdd(a: number, b: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.safeAdd(a, b);
        }
        if (isNaN(a) || isNaN(b)) return 0;
        const aStr = FinancialMathRust.priceToInt(a);
        const bStr = FinancialMathRust.priceToInt(b);
        const resultStr = FinancialMathRust.safeAdd(aStr, bStr);
        return FinancialMathRust.intToPrice(resultStr);
    }

    static override safeSubtract(a: number, b: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.safeSubtract(a, b);
        }
        if (isNaN(a) || isNaN(b)) return 0;
        const aStr = FinancialMathRust.priceToInt(a);
        const bStr = FinancialMathRust.priceToInt(b);
        const resultStr = FinancialMathRust.safeSubtract(aStr, bStr);
        return FinancialMathRust.intToPrice(resultStr);
    }

    static override safeMultiply(a: number, b: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.safeMultiply(a, b);
        }
        if (isNaN(a) || isNaN(b)) return 0;
        const aStr = FinancialMathRust.priceToInt(a);
        const bStr = FinancialMathRust.priceToInt(b);
        const resultStr = FinancialMathRust.safeMultiply(aStr, bStr);
        return FinancialMathRust.intToPrice(resultStr);
    }

    static override safeDivideEnhanced(
        numerator: number,
        denominator: number,
        defaultValue: number = 0
    ): number {
        return this.safeDivide(numerator, denominator, defaultValue);
    }

    static override calculatePercentageChange(
        oldValue: number,
        newValue: number,
        defaultValue: number = 0
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculatePercentageChange(
                oldValue,
                newValue,
                defaultValue
            );
        }
        if (oldValue === 0 || isNaN(oldValue) || isNaN(newValue)) {
            return defaultValue;
        }
        const diff = newValue - oldValue;
        const ratio = diff / oldValue;
        return ratio * 100;
    }

    static override calculateCompoundChange(
        oldValue: number,
        newValue: number,
        defaultValue: number = 0
    ): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateCompoundChange(
                oldValue,
                newValue,
                defaultValue
            );
        }
        if (oldValue === 0 || isNaN(oldValue) || isNaN(newValue)) {
            return defaultValue;
        }
        const ratio = newValue / oldValue;
        const growth = ratio - 1;
        return growth * 100;
    }

    static override toBasisPoints(decimal: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.toBasisPoints(decimal);
        }
        if (isNaN(decimal)) return 0;
        return decimal * 10000;
    }

    static override fromBasisPoints(basisPoints: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.fromBasisPoints(basisPoints);
        }
        if (isNaN(basisPoints)) return 0;
        return basisPoints / 10000;
    }

    static override financialRound(value: number, decimals: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.financialRound(value, decimals);
        }
        if (isNaN(value)) return 0;
        return Number(value.toFixed(decimals));
    }

    static override isValidFinancialNumber(value: number | string): boolean {
        if (!FinancialMathRust.isAvailable()) {
            return super.isValidFinancialNumber(value);
        }
        try {
            const numValue =
                typeof value === "string" ? parseFloat(value) : value;
            return !isNaN(numValue) && isFinite(numValue);
        } catch {
            return false;
        }
    }

    static override calculateMin(values: number[]): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateMin(values);
        }
        if (!values || values.length === 0) return 0;
        const validValues = values.filter((v) => !isNaN(v) && isFinite(v));
        if (validValues.length === 0) return 0;
        const valueStrings = validValues.map((v) =>
            FinancialMathRust.priceToInt(v)
        );
        const minStr = FinancialMathRust.calculateMin(valueStrings);
        return FinancialMathRust.intToPrice(minStr);
    }

    static override calculateMax(values: number[]): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateMax(values);
        }
        if (!values || values.length === 0) return 0;
        const validValues = values.filter((v) => !isNaN(v) && isFinite(v));
        if (validValues.length === 0) return 0;
        const valueStrings = validValues.map((v) =>
            FinancialMathRust.priceToInt(v)
        );
        const maxStr = FinancialMathRust.calculateMax(valueStrings);
        return FinancialMathRust.intToPrice(maxStr);
    }

    static override calculateAbs(value: number): number {
        if (!FinancialMathRust.isAvailable()) {
            return super.calculateAbs(value);
        }
        if (isNaN(value)) return 0;
        return Math.abs(value);
    }
}

// Export with the original name for easy migration
export { FinancialMathRustDropIn as FinancialMath };
