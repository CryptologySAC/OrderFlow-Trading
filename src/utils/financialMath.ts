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
        const resultInt = qty1Int / qty2Int / BigInt(this.QUANTITY_SCALE);
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
        const qty1Int = BigInt(Math.round(qty1 * this.QUANTITY_SCALE));
        const qty2Int = BigInt(Math.round(qty2 * this.QUANTITY_SCALE));

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
}
