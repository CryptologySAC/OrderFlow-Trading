// src/utils/objectPool.ts

/**
 * Generic object pool for reducing garbage collection pressure
 * in high-frequency trading scenarios
 */
export class ObjectPool<T> {
    private readonly pool: T[] = [];
    private readonly createFn: () => T;
    private readonly resetFn: (obj: T) => void;
    private readonly maxSize: number;

    constructor(
        createFn: () => T,
        resetFn: (obj: T) => void,
        maxSize: number = 1000
    ) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.maxSize = maxSize;
    }

    /**
     * Get an object from the pool or create a new one
     */
    public acquire(): T {
        const obj = this.pool.pop();
        return obj || this.createFn();
    }

    /**
     * Return an object to the pool after resetting it
     */
    public release(obj: T): void {
        if (this.pool.length < this.maxSize) {
            this.resetFn(obj);
            this.pool.push(obj);
        }
        // If pool is full, let GC handle the object
    }

    /**
     * Pre-warm the pool with objects
     */
    public prewarm(count: number): void {
        for (let i = 0; i < Math.min(count, this.maxSize); i++) {
            this.pool.push(this.createFn());
        }
    }

    /**
     * Get current pool size for monitoring
     */
    public size(): number {
        return this.pool.length;
    }

    /**
     * Clear the pool
     */
    public clear(): void {
        this.pool.length = 0;
    }
}

/**
 * Array pool for reusing arrays in mathematical calculations
 */
export class ArrayPool<T> {
    private readonly pools = new Map<number, T[][]>();
    private readonly releasedArrays = new WeakSet<T[]>();
    private readonly maxPoolSize: number;
    private readonly maxArraySize: number;

    constructor(maxPoolSize: number = 100, maxArraySize: number = 10000) {
        this.maxPoolSize = maxPoolSize;
        this.maxArraySize = maxArraySize;
    }

    /**
     * Get an array of specified size from the pool
     */
    public acquire(size: number): T[] {
        if (size > this.maxArraySize) {
            return new Array<T>(size);
        }

        const pool = this.pools.get(size);
        if (pool && pool.length > 0) {
            const array = pool.pop()!;
            this.releasedArrays.delete(array); // Remove from released tracking
            array.length = size; // Reset to requested size
            array.fill(undefined as T); // Clear contents
            return array;
        }

        return new Array<T>(size);
    }

    /**
     * Return an array to the pool
     */
    public release(array: T[]): void {
        const size = array.length;
        if (size > this.maxArraySize) {
            return; // Don't pool very large arrays
        }

        // Prevent duplicate releases
        if (this.releasedArrays.has(array)) {
            return;
        }

        if (!this.pools.has(size)) {
            this.pools.set(size, []);
        }

        const pool = this.pools.get(size)!;
        if (pool.length < this.maxPoolSize) {
            array.length = 0; // Clear the array
            this.releasedArrays.add(array); // Track as released
            pool.push(array);
        }
    }

    /**
     * Get memory usage statistics
     */
    public getStats(): { totalPools: number; totalArrays: number } {
        let totalArrays = 0;
        for (const pool of this.pools.values()) {
            totalArrays += pool.length;
        }
        return {
            totalPools: this.pools.size,
            totalArrays,
        };
    }

    /**
     * Clear all pools
     */
    public clear(): void {
        this.pools.clear();
    }
}

/**
 * Shared object pools for common types
 */
export class SharedPools {
    private static instance: SharedPools;

    public readonly arrays = new ArrayPool();
    public readonly zoneSamples: ObjectPool<{
        bid: number;
        ask: number;
        total: number;
        timestamp: number;
    }>;

    private constructor() {
        this.zoneSamples = new ObjectPool(
            () => ({ bid: 0, ask: 0, total: 0, timestamp: 0 }),
            (obj) => {
                obj.bid = 0;
                obj.ask = 0;
                obj.total = 0;
                obj.timestamp = 0;
            }
        );

        // Pre-warm the most commonly used pools
        this.zoneSamples.prewarm(50);
        this.arrays.acquire(100); // Pre-create some common array sizes
        this.arrays.acquire(200);
        this.arrays.acquire(500);
    }

    public static getInstance(): SharedPools {
        if (!SharedPools.instance) {
            SharedPools.instance = new SharedPools();
        }
        return SharedPools.instance;
    }

    /**
     * Get pool usage statistics for monitoring
     */
    public getStats() {
        return {
            zoneSamples: this.zoneSamples.size(),
            arrays: this.arrays.getStats(),
        };
    }
}
