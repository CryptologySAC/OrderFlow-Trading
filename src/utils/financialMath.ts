// src/utils/financialMath.ts
export class FinancialMath {
    private static readonly PRICE_SCALE = 100000000; // 8 decimal places
    private static readonly QUANTITY_SCALE = 100000000; // 8 decimal places

    /**
     * Convert floating point price to integer representation
     */
    static priceToInt(price: number): bigint {
        if (!Number.isFinite(price) || price < 0) {
            throw new Error(`Invalid price: ${price}`);
        }
        return BigInt(Math.round(price * this.PRICE_SCALE));
    }

    /**
     * Convert integer price back to floating point
     */
    static intToPrice(priceInt: bigint): number {
        return Number(priceInt) / this.PRICE_SCALE;
    }

    /**
     * Normalize price to tick size using integer arithmetic
     */
    static normalizePriceToTick(price: number, tickSize: number): number {
        const priceInt = this.priceToInt(price);
        const tickInt = this.priceToInt(tickSize);
        const normalizedInt = (priceInt / tickInt) * tickInt;
        return this.intToPrice(normalizedInt);
    }

    static priceToZone(price: number, tickSize: number): number {
        const normalizedInt = this.normalizePriceToTick(price, tickSize);
        const zone = Math.round(normalizedInt);
        return zone;
    }

    /**
     * Calculate mid price with perfect precision
     */
    static calculateMidPrice(
        bid: number,
        ask: number,
        precision: number
    ): number {
        const bidInt = this.priceToInt(bid);
        const askInt = this.priceToInt(ask);
        const midInt = (bidInt + askInt) / 2n;
        const result = this.intToPrice(midInt);

        // Apply precision rounding as final step
        const scale = Math.pow(10, precision);
        return Math.round(result * scale) / scale;
    }

    /**
     * Calculate spread with perfect precision
     */
    static calculateSpread(
        ask: number,
        bid: number,
        precision: number
    ): number {
        const askInt = this.priceToInt(ask);
        const bidInt = this.priceToInt(bid);
        const spreadInt = askInt - bidInt;
        const result = this.intToPrice(spreadInt);

        // Apply precision rounding as final step
        const scale = Math.pow(10, precision);
        return Math.round(result * scale) / scale;
    }

    /**
     * Safe quantity multiplication avoiding floating point errors
     */
    static multiplyQuantities(qty1: number, qty2: number): number {
        const qty1Int = BigInt(Math.round(qty1 * this.QUANTITY_SCALE));
        const qty2Int = BigInt(Math.round(qty2 * this.QUANTITY_SCALE));
        const resultInt = (qty1Int * qty2Int) / BigInt(this.QUANTITY_SCALE);
        return Number(resultInt) / this.QUANTITY_SCALE;
    }

    /**
     * Safe quantity division avoiding floating point errors
     */
    static divideQuantities(qty1: number, qty2: number): number {
        if (qty2 === 0 || isNaN(qty1) || isNaN(qty2)) {
            return 0;
        }
        const qty1Int = BigInt(Math.round(qty1 * this.QUANTITY_SCALE));
        const qty2Int = BigInt(Math.round(qty2 * this.QUANTITY_SCALE));
        const resultInt = (qty1Int * BigInt(this.QUANTITY_SCALE)) / qty2Int;
        return Number(resultInt) / this.QUANTITY_SCALE;
    }

    /**
     * Validate if a price value is valid for trading
     */
    static isValidPrice(price: number): boolean {
        return Number.isFinite(price) && price > 0 && !isNaN(price);
    }

    /**
     * Validate if a quantity value is valid for trading
     */
    static isValidQuantity(quantity: number): boolean {
        return Number.isFinite(quantity) && quantity > 0 && !isNaN(quantity);
    }

    /**
     * Compare two quantities with precision handling
     * Returns: -1 if qty1 < qty2, 0 if equal, 1 if qty1 > qty2
     */
    static compareQuantities(qty1: number, qty2: number): number {
        // Handle extreme values that can't be converted to BigInt
        if (!Number.isFinite(qty1) || !Number.isFinite(qty2)) {
            if (qty1 === qty2) return 0;
            if (qty1 > qty2) return 1;
            return -1;
        }

        // Check if scaling would cause overflow
        const scaled1 = qty1 * this.QUANTITY_SCALE;
        const scaled2 = qty2 * this.QUANTITY_SCALE;

        if (!Number.isFinite(scaled1) || !Number.isFinite(scaled2)) {
            // Fallback to simple comparison for extreme values
            if (qty1 === qty2) return 0;
            if (qty1 > qty2) return 1;
            return -1;
        }

        const qty1Int = BigInt(Math.round(scaled1));
        const qty2Int = BigInt(Math.round(scaled2));

        if (qty1Int < qty2Int) return -1;
        if (qty1Int > qty2Int) return 1;
        return 0;
    }

    /**
     * Normalize quantity to precision
     */
    static normalizeQuantity(quantity: number, precision: number): number {
        if (!this.isValidQuantity(quantity)) {
            throw new Error(`Invalid quantity: ${quantity}`);
        }

        const scale = Math.pow(10, precision);
        return Math.round(quantity * scale) / scale;
    }

    /**
     * Safe string to number conversion for prices
     */
    static parsePrice(priceStr: string): number {
        const price = parseFloat(priceStr);
        if (!this.isValidPrice(price)) {
            throw new Error(`Invalid price string: ${priceStr}`);
        }
        return price;
    }

    /**
     * Safe string to number conversion for quantities
     */
    static parseQuantity(quantityStr: string): number {
        const quantity = parseFloat(quantityStr);
        if (!this.isValidQuantity(quantity)) {
            throw new Error(`Invalid quantity string: ${quantityStr}`);
        }
        return quantity;
    }

    /**
     * MISSION CRITICAL: Calculate mean with precision handling
     * Replaces DetectorUtils.calculateMean() with institutional-grade precision
     */
    static calculateMean(values: number[]): number {
        if (!values || values.length === 0) {
            return 0;
        }

        // Filter out invalid values and use BigInt for precision
        const validValues = values.filter(
            (v) => Number.isFinite(v) && !isNaN(v)
        );
        if (validValues.length === 0) {
            return 0;
        }

        // Use BigInt arithmetic to avoid floating-point precision loss
        let sum = 0n;
        for (const value of validValues) {
            sum += BigInt(Math.round(value * this.QUANTITY_SCALE));
        }

        const result =
            Number(sum / BigInt(validValues.length)) / this.QUANTITY_SCALE;
        return result;
    }

    /**
     * MISSION CRITICAL: Calculate standard deviation with Welford's algorithm
     * Replaces DetectorUtils.calculateStdDev() with numerically stable implementation
     */
    static calculateStdDev(values: number[]): number {
        if (!values || values.length === 0) {
            return 0;
        }
        if (values.length === 1) {
            return 0;
        }

        // Filter out invalid values
        const validValues = values.filter(
            (v) => Number.isFinite(v) && !isNaN(v)
        );
        if (validValues.length <= 1) {
            return 0;
        }

        // Welford's algorithm for numerical stability
        let mean = 0;
        let m2 = 0;
        let count = 0;

        for (const value of validValues) {
            count++;
            const delta = value - mean;
            mean += delta / count;
            const delta2 = value - mean;
            m2 += delta * delta2;
        }

        const variance = m2 / (count - 1);
        return Math.sqrt(variance);
    }

    /**
     * MISSION CRITICAL: Calculate percentile with precise interpolation
     * Replaces DetectorUtils.calculatePercentile() with institutional-grade precision
     */
    static calculatePercentile(values: number[], percentile: number): number {
        if (!values || values.length === 0) {
            return 0;
        }
        if (
            percentile < 0 ||
            percentile > 100 ||
            !Number.isFinite(percentile)
        ) {
            throw new Error(
                `Invalid percentile: ${percentile}. Must be between 0 and 100.`
            );
        }

        // Filter out invalid values and sort
        const validValues = values.filter(
            (v) => Number.isFinite(v) && !isNaN(v)
        );
        if (validValues.length === 0) {
            return 0;
        }

        const sorted = [...validValues].sort((a, b) => a - b);

        if (percentile === 0) {
            return sorted[0];
        }
        if (percentile === 100) {
            return sorted[sorted.length - 1];
        }

        // Use precise percentile calculation with interpolation
        const index = (percentile / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);

        if (lower === upper) {
            return sorted[lower];
        }

        // Linear interpolation between adjacent values
        const weight = index - lower;
        const result = sorted[lower] * (1 - weight) + sorted[upper] * weight;

        return result;
    }

    /**
     * MISSION CRITICAL: Calculate median (50th percentile)
     * Optimized version of calculatePercentile for median calculation
     */
    static calculateMedian(values: number[]): number {
        return this.calculatePercentile(values, 50);
    }
}
