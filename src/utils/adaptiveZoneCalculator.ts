import { FinancialMath } from "./financialMath.js";

/**
 * Adaptive zone size calculation (ATR-based).
 */
export class AdaptiveZoneCalculator {
    private priceWindow: number[] = [];
    private rollingATR = 0;
    private readonly atrLookback: number;

    constructor(atrLookback = 30) {
        this.atrLookback = atrLookback;
    }

    /**
     * Push latest trade price for ATR calculation.
     */
    updatePrice(price: number): void {
        this.priceWindow.push(price);
        if (this.priceWindow.length > this.atrLookback) {
            this.priceWindow.shift();
        }
        if (this.priceWindow.length > 2) {
            let sum = 0;
            for (let i = 1; i < this.priceWindow.length; i++) {
                sum += Math.abs(this.priceWindow[i] - this.priceWindow[i - 1]);
            }
            this.rollingATR = FinancialMath.safeDivide(
                sum,
                this.priceWindow.length - 1,
                0
            );
        }
    }

    /**
     * Get current adaptive zone width in ticks.
     */
    getAdaptiveZoneTicks(pricePrecision: number): number {
        const tick = 1 / Math.pow(10, pricePrecision);
        return Math.max(
            1,
            Math.min(
                10,
                Math.round(
                    FinancialMath.safeDivide(this.rollingATR, tick, 0) * 2
                )
            )
        );
    }

    getATR(): number {
        return this.rollingATR;
    }
}
