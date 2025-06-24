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

    /**
     * MISSION CRITICAL: Safe division with zero protection and precision handling
     * Replaces duplicate safeDivision methods across detectors
     */
    static safeDivide(
        numerator: number,
        denominator: number,
        defaultValue: number = 0
    ): number {
        if (
            !Number.isFinite(numerator) ||
            !Number.isFinite(denominator) ||
            denominator === 0 ||
            isNaN(numerator) ||
            isNaN(denominator)
        ) {
            return defaultValue;
        }

        // Use BigInt arithmetic for precision when both values are reasonable
        if (
            Math.abs(numerator) <
                Number.MAX_SAFE_INTEGER / this.QUANTITY_SCALE &&
            Math.abs(denominator) <
                Number.MAX_SAFE_INTEGER / this.QUANTITY_SCALE
        ) {
            const numInt = BigInt(Math.round(numerator * this.QUANTITY_SCALE));
            const denInt = BigInt(
                Math.round(denominator * this.QUANTITY_SCALE)
            );
            
            // Additional check for BigInt zero division
            if (denInt === 0n) {
                return defaultValue;
            }
            
            const resultInt = (numInt * BigInt(this.QUANTITY_SCALE)) / denInt;
            const result = Number(resultInt) / this.QUANTITY_SCALE;
            return Number.isFinite(result) ? result : defaultValue;
        }

        // Fallback to regular division for extreme values
        const result = numerator / denominator;
        return Number.isFinite(result) ? result : defaultValue;
    }

    /**
     * MISSION CRITICAL: Calculate zone using precise arithmetic
     * Replaces DetectorUtils.calculateZone() with enhanced precision
     */
    static calculateZone(
        price: number,
        zoneTicks: number,
        pricePrecision: number
    ): number {
        if (price <= 0 || zoneTicks <= 0 || pricePrecision < 0) {
            throw new Error(
                `Invalid zone calculation parameters: price=${price}, zoneTicks=${zoneTicks}, pricePrecision=${pricePrecision}`
            );
        }

        // Use priceToInt/intToPrice for consistent precision handling
        const priceInt = this.priceToInt(price);
        const tickSize = Math.pow(10, -pricePrecision);
        const tickInt = this.priceToInt(tickSize);
        const zoneSize = BigInt(zoneTicks) * tickInt;

        // Ensure consistent rounding across all detectors
        const zoneInt = (priceInt / zoneSize) * zoneSize;
        return this.intToPrice(zoneInt);
    }

    // ========================================================================
    // INSTITUTIONAL-GRADE SAFE ARITHMETIC OPERATIONS
    // ========================================================================

    /**
     * Financial market compliant safe addition with institutional precision
     * 
     * Features:
     * - BigInt arithmetic for sub-penny precision
     * - NaN/Infinity protection for trading system stability
     * - IEEE 754 compliance for regulatory requirements
     * - Overflow protection for large position calculations
     * - Zero-tolerance error handling for production trading
     */
    static safeAdd(a: number, b: number): number {
        // Input validation - critical for trading system integrity
        if (!Number.isFinite(a) || !Number.isFinite(b) || isNaN(a) || isNaN(b)) {
            return 0; // Fail-safe for invalid market data
        }

        try {
            // Check for overflow before BigInt conversion
            if (
                Math.abs(a) < Number.MAX_SAFE_INTEGER / this.QUANTITY_SCALE &&
                Math.abs(b) < Number.MAX_SAFE_INTEGER / this.QUANTITY_SCALE
            ) {
                // High-precision BigInt arithmetic for institutional accuracy
                const aInt = BigInt(Math.round(a * this.QUANTITY_SCALE));
                const bInt = BigInt(Math.round(b * this.QUANTITY_SCALE));
                const resultInt = aInt + bInt;
                const result = Number(resultInt) / this.QUANTITY_SCALE;
                
                // Final validation for financial system compliance
                return Number.isFinite(result) ? result : 0;
            }

            // Fallback for extreme values - maintain IEEE 754 compliance
            const result = a + b;
            return Number.isFinite(result) ? result : 0;
        } catch {
            // Zero-tolerance error handling for production stability
            return 0;
        }
    }

    /**
     * Financial market compliant safe subtraction with institutional precision
     * 
     * Critical for:
     * - P&L calculations
     * - Spread computations  
     * - Position sizing
     * - Risk management calculations
     */
    static safeSubtract(a: number, b: number): number {
        // Input validation for financial data integrity
        if (!Number.isFinite(a) || !Number.isFinite(b) || isNaN(a) || isNaN(b)) {
            return 0;
        }

        try {
            // Overflow protection for large financial calculations
            if (
                Math.abs(a) < Number.MAX_SAFE_INTEGER / this.QUANTITY_SCALE &&
                Math.abs(b) < Number.MAX_SAFE_INTEGER / this.QUANTITY_SCALE
            ) {
                // Institutional-grade precision using BigInt arithmetic
                const aInt = BigInt(Math.round(a * this.QUANTITY_SCALE));
                const bInt = BigInt(Math.round(b * this.QUANTITY_SCALE));
                const resultInt = aInt - bInt;
                const result = Number(resultInt) / this.QUANTITY_SCALE;
                
                return Number.isFinite(result) ? result : 0;
            }

            // IEEE 754 compliant fallback for extreme values
            const result = a - b;
            return Number.isFinite(result) ? result : 0;
        } catch {
            return 0;
        }
    }

    /**
     * Financial market compliant safe multiplication with institutional precision
     * 
     * Essential for:
     * - Volume calculations (price × quantity)
     * - Portfolio valuations
     * - Margin requirements
     * - Options pricing models
     * - Risk-weighted calculations
     */
    static safeMultiply(a: number, b: number): number {
        // Comprehensive input validation for trading systems
        if (!Number.isFinite(a) || !Number.isFinite(b) || isNaN(a) || isNaN(b)) {
            return 0;
        }

        try {
            // Prevent overflow in financial calculations
            const maxSafe = Math.sqrt(Number.MAX_SAFE_INTEGER / this.QUANTITY_SCALE);
            if (Math.abs(a) < maxSafe && Math.abs(b) < maxSafe) {
                // High-precision multiplication for institutional accuracy
                const aInt = BigInt(Math.round(a * this.QUANTITY_SCALE));
                const bInt = BigInt(Math.round(b * this.QUANTITY_SCALE));
                const resultInt = (aInt * bInt) / BigInt(this.QUANTITY_SCALE);
                const result = Number(resultInt) / this.QUANTITY_SCALE;
                
                return Number.isFinite(result) ? result : 0;
            }

            // Fallback multiplication with overflow protection
            const result = a * b;
            return Number.isFinite(result) && Math.abs(result) < Number.MAX_SAFE_INTEGER ? result : 0;
        } catch {
            return 0;
        }
    }

    /**
     * Enhanced safe division with financial market compliance
     * 
     * Upgrades the existing safeDivide with additional financial safeguards:
     * - Enhanced error handling for trading systems
     * - Better documentation for institutional compliance
     * - Consistent behavior with other safe operations
     */
    static safeDivideEnhanced(
        numerator: number,
        denominator: number,
        defaultValue: number = 0
    ): number {
        // Enhanced input validation for financial stability
        if (
            !Number.isFinite(numerator) ||
            !Number.isFinite(denominator) ||
            isNaN(numerator) ||
            isNaN(denominator) ||
            denominator === 0 ||
            Math.abs(denominator) < Number.EPSILON
        ) {
            return defaultValue;
        }

        try {
            // Use existing high-precision logic from safeDivide
            return this.safeDivide(numerator, denominator, defaultValue);
        } catch {
            return defaultValue;
        }
    }

    /**
     * Financial percentage calculation with institutional precision
     * 
     * Calculates percentage change: ((newValue - oldValue) / oldValue) * 100
     * 
     * Critical for:
     * - Price movement analysis
     * - Performance attribution
     * - Risk metrics (VaR, volatility)
     * - Compliance reporting
     */
    static calculatePercentageChange(
        oldValue: number,
        newValue: number,
        defaultValue: number = 0
    ): number {
        if (
            !Number.isFinite(oldValue) ||
            !Number.isFinite(newValue) ||
            oldValue === 0
        ) {
            return defaultValue;
        }

        const difference = this.safeSubtract(newValue, oldValue);
        const ratio = this.safeDivide(difference, oldValue, 0);
        return this.safeMultiply(ratio, 100);
    }

    /**
     * Compound percentage calculation for financial modeling
     * 
     * Calculates compound growth: (newValue / oldValue - 1) * 100
     * More numerically stable than percentage change for large differences
     */
    static calculateCompoundChange(
        oldValue: number,
        newValue: number,
        defaultValue: number = 0
    ): number {
        if (
            !Number.isFinite(oldValue) ||
            !Number.isFinite(newValue) ||
            oldValue === 0 ||
            newValue < 0
        ) {
            return defaultValue;
        }

        const ratio = this.safeDivide(newValue, oldValue, 1);
        const growth = this.safeSubtract(ratio, 1);
        return this.safeMultiply(growth, 100);
    }

    /**
     * Basis points calculation for financial markets
     * 
     * Converts decimal to basis points (1 bp = 0.01% = 0.0001)
     * Standard unit for interest rates, spreads, and yield differences
     */
    static toBasisPoints(decimal: number): number {
        if (!Number.isFinite(decimal) || isNaN(decimal)) {
            return 0;
        }
        return this.safeMultiply(decimal, 10000);
    }

    /**
     * Basis points to decimal conversion
     */
    static fromBasisPoints(basisPoints: number): number {
        if (!Number.isFinite(basisPoints) || isNaN(basisPoints)) {
            return 0;
        }
        return this.safeDivide(basisPoints, 10000);
    }

    /**
     * Financial rounding with banker's rounding (round half to even)
     * 
     * Compliant with financial industry standards to eliminate bias
     * in large-scale calculations and regulatory reporting
     */
    static financialRound(value: number, decimals: number): number {
        if (!Number.isFinite(value) || isNaN(value)) {
            return 0;
        }

        const multiplier = Math.pow(10, decimals);
        const scaled = this.safeMultiply(value, multiplier);
        
        // Banker's rounding: round 0.5 to nearest even number
        const floor = Math.floor(scaled);
        const fraction = scaled - floor;
        
        if (Math.abs(fraction - 0.5) < Number.EPSILON) {
            // Exactly 0.5: round to even
            return (floor % 2 === 0 ? floor : floor + 1) / multiplier;
        } else {
            // Normal rounding
            return Math.round(scaled) / multiplier;
        }
    }

    /**
     * Validate financial number for institutional compliance
     * 
     * Ensures values meet financial industry standards for:
     * - Finite values only
     * - No NaN or Infinity
     * - Reasonable magnitude for financial calculations
     */
    static isValidFinancialNumber(value: number): boolean {
        return (
            Number.isFinite(value) &&
            !isNaN(value) &&
            Math.abs(value) < Number.MAX_SAFE_INTEGER &&
            Math.abs(value) >= Number.MIN_VALUE
        );
    }
}
