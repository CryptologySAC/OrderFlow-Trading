// src/utils/financialMath.ts
import { Decimal } from "decimal.js";

// Configure Decimal.js for financial calculations
Decimal.set({
    precision: 34, // Sufficient for most financial applications
    rounding: Decimal.ROUND_HALF_EVEN, // Banker's rounding
});

export class FinancialMath {
    private static readonly PRICE_SCALE = 100000000; // 8 decimal places

    /**
     * Convert floating point price to integer representation
     */
    static priceToInt(price: number): bigint {
        return BigInt(new Decimal(price).times(this.PRICE_SCALE).toFixed());
    }

    /**
     * Convert integer price back to floating point
     */
    static intToPrice(priceInt: bigint): number {
        return new Decimal(priceInt.toString())
            .dividedBy(this.PRICE_SCALE)
            .toNumber();
    }

    /**
     * Normalize price to tick size using Decimal.js
     */
    static normalizePriceToTick(price: number, tickSize: number): number {
        const dPrice = new Decimal(price);
        const dTickSize = new Decimal(tickSize);
        if (dTickSize.isZero()) return price; // Avoid division by zero
        const normalized = dPrice.dividedBy(dTickSize).floor().times(dTickSize);
        return normalized.toNumber();
    }

    static priceToZone(price: number, tickSize: number): number {
        const normalized = this.normalizePriceToTick(price, tickSize);
        return new Decimal(normalized)
            .toDP(0, Decimal.ROUND_HALF_UP)
            .toNumber();
    }

    /**
     * Calculate mid price with perfect precision
     */
    static calculateMidPrice(
        bid: number,
        ask: number,
        precision: number
    ): number {
        const dBid = new Decimal(bid);
        const dAsk = new Decimal(ask);
        const mid = dBid.plus(dAsk).dividedBy(2);
        return mid.toDecimalPlaces(precision).toNumber();
    }

    /**
     * Calculate spread with perfect precision
     */
    static calculateSpread(
        ask: number,
        bid: number,
        precision: number
    ): number {
        const dAsk = new Decimal(ask);
        const dBid = new Decimal(bid);
        const spread = dAsk.minus(dBid);
        return spread.toDecimalPlaces(precision).toNumber();
    }

    /**
     * Safe quantity multiplication avoiding floating point errors
     */
    static multiplyQuantities(qty1: number, qty2: number): number {
        if (isNaN(qty1) || isNaN(qty2)) return NaN;
        const dQty1 = new Decimal(qty1);
        const dQty2 = new Decimal(qty2);
        return dQty1.times(dQty2).toNumber();
    }

    /**
     * Safe quantity division avoiding floating point errors
     */
    static divideQuantities(qty1: number, qty2: number): number {
        if (qty2 === 0 || isNaN(qty1) || isNaN(qty2)) {
            return 0;
        }
        return new Decimal(qty1).dividedBy(new Decimal(qty2)).toNumber();
    }

    /**
     * Safe price addition avoiding floating point errors
     */
    static addAmounts(
        amount1: number,
        amount2: number,
        precision: number
    ): number {
        if (isNaN(amount1) || isNaN(amount2)) {
            throw new Error(
                `Invalid amounts for addition: ${amount1}, ${amount2}`
            );
        }
        const dAmount1 = new Decimal(amount1);
        const dAmount2 = new Decimal(amount2);
        const result = dAmount1.plus(dAmount2);
        return result.toDecimalPlaces(precision).toNumber();
    }

    /**
     * Validate if a price value is valid for trading
     */
    static isValidPrice(price: number | string): boolean {
        try {
            const dPrice = new Decimal(price);
            return dPrice.isFinite() && dPrice.isPositive();
        } catch {
            return false;
        }
    }

    /**
     * Validate if a quantity value is valid for trading
     */
    static isValidQuantity(quantity: number | string): boolean {
        try {
            const dQuantity = new Decimal(quantity);
            return dQuantity.isFinite() && dQuantity.isPositive();
        } catch {
            return false;
        }
    }

    /**
     * Compare two quantities with precision handling
     */
    static compareQuantities(qty1: number, qty2: number): number {
        return new Decimal(qty1).comparedTo(new Decimal(qty2));
    }

    /**
     * Normalize quantity to precision
     */
    static normalizeQuantity(quantity: number, precision: number): number {
        if (!this.isValidQuantity(quantity)) {
            throw new Error(`Invalid quantity: ${quantity}`);
        }
        return new Decimal(quantity).toDecimalPlaces(precision).toNumber();
    }

    /**
     * Safe string to number conversion for prices
     */
    static parsePrice(priceStr: string): number {
        const price = new Decimal(priceStr);
        if (!this.isValidPrice(price.toNumber())) {
            throw new Error(`Invalid price string: ${priceStr}`);
        }
        return price.toNumber();
    }

    /**
     * Safe string to number conversion for quantities
     */
    static parseQuantity(quantityStr: string): number {
        const quantity = new Decimal(quantityStr);
        if (!this.isValidQuantity(quantity.toNumber())) {
            throw new Error(`Invalid quantity string: ${quantityStr}`);
        }
        return quantity.toNumber();
    }

    /**
     * MISSION CRITICAL: Calculate mean with precision handling
     */
    static calculateMean(values: number[]): number {
        if (!values || values.length === 0) {
            return 0;
        }
        const validValues = values.filter((v) => !isNaN(v) && isFinite(v));
        if (validValues.length === 0) {
            return 0;
        }
        const sum = validValues.reduce(
            (acc, val) => acc.plus(new Decimal(val)),
            new Decimal(0)
        );
        return sum.dividedBy(validValues.length).toNumber();
    }

    /**
     * MISSION CRITICAL: Calculate standard deviation with Welford's algorithm
     */
    static calculateStdDev(values: number[]): number {
        if (!values || values.length < 2) {
            return 0;
        }
        const validValues = values.filter((v) => !isNaN(v) && isFinite(v));
        if (validValues.length < 2) {
            return 0;
        }

        const mean = new Decimal(this.calculateMean(validValues));
        const variance = validValues
            .reduce((acc, val) => {
                const diff = new Decimal(val).minus(mean);
                return acc.plus(diff.pow(2));
            }, new Decimal(0))
            .dividedBy(validValues.length - 1);

        return variance.sqrt().toNumber();
    }

    /**
     * MISSION CRITICAL: Calculate percentile with precise interpolation
     */
    static calculatePercentile(values: number[], percentile: number): number {
        if (!values || values.length === 0) return 0;
        if (percentile < 0 || percentile > 100)
            throw new Error("Percentile must be between 0 and 100.");

        const sorted = values
            .map((v) => new Decimal(v))
            .sort((a, b) => a.comparedTo(b));

        if (sorted.length === 0) return 0;

        if (percentile === 0) return sorted[0]?.toNumber() ?? 0;
        if (percentile === 100)
            return sorted[sorted.length - 1]?.toNumber() ?? 0;

        const index = new Decimal(percentile)
            .dividedBy(100)
            .times(sorted.length - 1);
        const lowerIndex = index.floor().toNumber();
        const upperIndex = index.ceil().toNumber();

        if (lowerIndex === upperIndex) {
            return sorted[lowerIndex]?.toNumber() ?? 0;
        }

        const weight = index.minus(lowerIndex);
        const lowerValue = sorted[lowerIndex];
        const upperValue = sorted[upperIndex];

        if (!lowerValue || !upperValue) {
            return 0; // Should not happen with the checks above, but good for safety
        }

        const interpolated = lowerValue
            .times(new Decimal(1).minus(weight))
            .plus(upperValue.times(weight));
        return interpolated.toNumber();
    }

    /**
     * MISSION CRITICAL: Calculate median (50th percentile)
     */
    static calculateMedian(values: number[]): number {
        return this.calculatePercentile(values, 50);
    }

    /**
     * MISSION CRITICAL: Safe division with zero protection and precision handling
     */
    static safeDivide(
        numerator: number,
        denominator: number,
        defaultValue: number = 0
    ): number {
        if (denominator === 0 || isNaN(numerator) || isNaN(denominator)) {
            return defaultValue;
        }
        return new Decimal(numerator)
            .dividedBy(new Decimal(denominator))
            .toNumber();
    }

    /**
     * MISSION CRITICAL: Calculate zone using precise arithmetic
     */
    static calculateZone(
        price: number,
        zoneTicks: number,
        pricePrecision: number // Note: pricePrecision is not directly needed with Decimal.js but kept for API compatibility
    ): number {
        if (price <= 0 || zoneTicks <= 0) {
            throw new Error(
                `Invalid zone calculation parameters: price=${price}, zoneTicks=${zoneTicks}`
            );
        }
        const tickSize = new Decimal(1).dividedBy(
            new Decimal(10).pow(pricePrecision)
        );
        const dPrice = new Decimal(price);
        const dZoneSize = new Decimal(zoneTicks).times(tickSize);

        if (dZoneSize.isZero()) return price;

        const zone = dPrice.dividedBy(dZoneSize).floor().times(dZoneSize);
        return zone.toNumber();
    }

    // ========================================================================
    // INSTITUTIONAL-GRADE SAFE ARITHMETIC OPERATIONS
    // ========================================================================

    static safeAdd(a: number, b: number): number {
        if (isNaN(a) || isNaN(b)) return 0;
        return new Decimal(a).plus(new Decimal(b)).toNumber();
    }

    static safeSubtract(a: number, b: number): number {
        if (isNaN(a) || isNaN(b)) return 0;
        return new Decimal(a).minus(new Decimal(b)).toNumber();
    }

    static safeMultiply(a: number, b: number): number {
        if (isNaN(a) || isNaN(b)) return 0;
        return new Decimal(a).times(new Decimal(b)).toNumber();
    }

    static safeDivideEnhanced(
        numerator: number,
        denominator: number,
        defaultValue: number = 0
    ): number {
        return this.safeDivide(numerator, denominator, defaultValue);
    }

    static calculatePercentageChange(
        oldValue: number,
        newValue: number,
        defaultValue: number = 0
    ): number {
        if (oldValue === 0 || isNaN(oldValue) || isNaN(newValue)) {
            return defaultValue;
        }
        const dOld = new Decimal(oldValue);
        const dNew = new Decimal(newValue);
        const diff = dNew.minus(dOld);
        const ratio = diff.dividedBy(dOld);
        return ratio.times(100).toNumber();
    }

    static calculateCompoundChange(
        oldValue: number,
        newValue: number,
        defaultValue: number = 0
    ): number {
        if (oldValue === 0 || isNaN(oldValue) || isNaN(newValue)) {
            return defaultValue;
        }
        const dOld = new Decimal(oldValue);
        const dNew = new Decimal(newValue);
        const ratio = dNew.dividedBy(dOld);
        const growth = ratio.minus(1);
        return growth.times(100).toNumber();
    }

    static toBasisPoints(decimal: number): number {
        if (isNaN(decimal)) return 0;
        return new Decimal(decimal).times(10000).toNumber();
    }

    static fromBasisPoints(basisPoints: number): number {
        if (isNaN(basisPoints)) return 0;
        return new Decimal(basisPoints).dividedBy(10000).toNumber();
    }

    static financialRound(value: number, decimals: number): number {
        if (isNaN(value)) return 0;
        return new Decimal(value)
            .toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN)
            .toNumber();
    }

    static isValidFinancialNumber(value: number | string): boolean {
        try {
            const dValue = new Decimal(value);
            return dValue.isFinite();
        } catch {
            return false;
        }
    }

    static calculateMin(values: number[]): number {
        if (!values || values.length === 0) return 0;
        const validValues = values.filter((v) => !isNaN(v) && isFinite(v));
        if (validValues.length === 0) return 0;
        return Decimal.min(...validValues).toNumber();
    }

    static calculateMax(values: number[]): number {
        if (!values || values.length === 0) return 0;
        const validValues = values.filter((v) => !isNaN(v) && isFinite(v));
        if (validValues.length === 0) return 0;
        return Decimal.max(...validValues).toNumber();
    }

    static calculateAbs(value: number): number {
        if (isNaN(value)) return 0;
        return new Decimal(value).abs().toNumber();
    }
}
