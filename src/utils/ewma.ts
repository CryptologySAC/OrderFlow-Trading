/** utils/ewma.ts ---------------------------------------------------------- */
export class EWMA {
    private value = 0;
    private readonly α: number;
    private lastT = Date.now();

    constructor(lookbackMs: number) {
        // α = 2 / (N + 1);  N = lookback / mean(dt)
        this.α = 2 / (lookbackMs / 1_000 + 1);
    }

    push(x: number) {
        const now = Date.now();
        const dt = now - this.lastT || 1; // avoid ÷0
        const w = 1 - Math.exp((-this.α * dt) / 1_000);
        this.value = w * x + (1 - w) * this.value;
        this.lastT = now;
    }
    get(): number {
        return this.value;
    }
}
