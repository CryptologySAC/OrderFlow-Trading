// --- Generic, Fast, Full-featured Rolling Window (Ring Buffer) ---

export class RollingWindow<T = number> implements Iterable<T> {
    private buffer: T[];
    private pointer = 0;
    private filled = false;
    private _sum = 0; // for numbers only, will guard below
    private readonly _capacity: number;

    constructor(
        size: number,
        private readonly isNumeric: boolean = true
    ) {
        this._capacity = size;
        this.buffer = new Array(size) as T[];
    }

    public push(value: T): void {
        if (this.isNumeric && typeof value !== "number") {
            throw new TypeError("Non-numeric value pushed into numeric window");
        }
        if (this.isNumeric) {
            // Remove old from sum, add new
            if (this.filled) this._sum -= this.buffer[this.pointer] as number;
            this._sum += value as number;
        }
        this.buffer[this.pointer] = value;
        this.pointer = (this.pointer + 1) % this._capacity;
        if (this.pointer === 0) this.filled = true;
    }

    public mean(): number {
        if (!this.isNumeric) throw new Error("mean() only for numeric buffers");
        const count = this.count();
        return count === 0 ? 0 : this._sum / count;
    }

    /**
     * Calculate the average of values in the window (alias for mean())
     */
    public average(): number {
        return this.mean();
    }

    public sum(): number {
        if (!this.isNumeric) throw new Error("sum() only for numeric buffers");
        return this._sum;
    }

    public min(): number | undefined {
        if (!this.isNumeric) throw new Error("min() only for numeric buffers");
        if (this.count() === 0) return undefined;
        return Math.min(...(this.toArray() as number[]));
    }

    public max(): number | undefined {
        if (!this.isNumeric) throw new Error("max() only for numeric buffers");
        if (this.count() === 0) return undefined;
        return Math.max(...(this.toArray() as number[]));
    }

    public stdDev(): number {
        if (!this.isNumeric)
            throw new Error("stdDev() only for numeric buffers");

        if (this.count() === 0) return 0;
        const arr = this.toArray() as number[];
        const mean = this.mean();
        return Math.sqrt(
            arr.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) /
                (arr.length || 1)
        );
    }

    public toArray(): T[] {
        const count = this.count();
        if (!this.filled) return this.buffer.slice(0, count);
        // Order oldest->newest
        return this.buffer
            .slice(this.pointer)
            .concat(this.buffer.slice(0, this.pointer));
    }

    public clear(): void {
        this.pointer = 0;
        this.filled = false;
        this._sum = 0;
        this.buffer = new Array(this._capacity) as T[];
    }

    public count(): number {
        return this.filled ? this._capacity : this.pointer;
    }

    // Iterable support
    *[Symbol.iterator](): IterableIterator<T> {
        for (const val of this.toArray()) yield val;
    }

    get size(): number {
        return this._capacity;
    }
}
