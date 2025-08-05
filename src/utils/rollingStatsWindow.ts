import { FinancialMath } from "./financialMath.ts";

export class RollingStatsWindow {
    private entries: { value: number; time: number }[] = [];
    private sum = 0;
    private sumSquares = 0;

    constructor(
        private readonly windowMs: number,
        private readonly maxCount?: number
    ) {}

    push(value: number, timestamp: number): void {
        this.entries.push({ value, time: timestamp });
        this.sum += value;
        this.sumSquares += value * value;
        this.trim(timestamp);
    }

    private trim(now: number): void {
        while (
            this.entries.length &&
            now - this.entries[0].time > this.windowMs
        ) {
            const old = this.entries.shift()!;
            this.sum -= old.value;
            this.sumSquares -= old.value * old.value;
        }
        if (this.maxCount && this.entries.length > this.maxCount) {
            while (this.entries.length > this.maxCount) {
                const old = this.entries.shift()!;
                this.sum -= old.value;
                this.sumSquares -= old.value * old.value;
            }
        }
    }

    count(): number {
        return this.entries.length;
    }

    mean(): number {
        return this.entries.length === 0
            ? 0
            : FinancialMath.safeDivide(this.sum, this.entries.length, 0);
    }

    stdDev(): number {
        const n = this.entries.length;
        if (n === 0) return 0;
        const mean = FinancialMath.safeDivide(this.sum, n, 0);
        const variance =
            FinancialMath.safeDivide(this.sumSquares, n, 0) - mean * mean;
        return Math.sqrt(Math.max(variance, 0));
    }
}
