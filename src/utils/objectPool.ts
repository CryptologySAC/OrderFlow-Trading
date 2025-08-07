// src/utils/objectPool.ts

// Import interfaces from proper location
import type {
    AbsorptionConditions,
    ExhaustionConditions,
    AccumulationConditions,
    VolumeCalculationResult,
    ImbalanceResult,
} from "../indicators/interfaces/detectorInterfaces.js";
import { AggressiveTrade, ZoneTradeRecord } from "../types/marketEvents.js";

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
 * High-performance array pool for reusing arrays in mathematical calculations
 * Optimized for hot path performance with size-based pooling
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
     * Optimized for hot path performance
     */
    public acquire(size: number): T[] {
        if (size > this.maxArraySize) {
            return new Array<T>(size);
        }

        // Round up to nearest power of 2 for better pooling efficiency
        const poolSize =
            size <= 16 ? size : Math.pow(2, Math.ceil(Math.log2(size)));

        const pool = this.pools.get(poolSize);
        if (pool && pool.length > 0) {
            const array = pool.pop()!;
            this.releasedArrays.delete(array); // Remove from released tracking
            array.length = size; // Reset to requested size
            // Don't fill with undefined for performance - caller should handle initialization
            return array;
        }

        return new Array<T>(size);
    }

    /**
     * Return an array to the pool
     * Optimized for hot path performance
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

        // Round up to nearest power of 2 for consistency with acquire
        const poolSize =
            size <= 16 ? size : Math.pow(2, Math.ceil(Math.log2(size)));

        if (!this.pools.has(poolSize)) {
            this.pools.set(poolSize, []);
        }

        const pool = this.pools.get(poolSize)!;
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
 * Enhanced shared object pools for hot path performance optimization
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

    // Enhanced pools for hot path objects
    public readonly absorptionConditions: ObjectPool<AbsorptionConditions>;
    public readonly exhaustionConditions: ObjectPool<ExhaustionConditions>;
    public readonly accumulationConditions: ObjectPool<AccumulationConditions>;
    public readonly volumeResults: ObjectPool<VolumeCalculationResult>;
    public readonly imbalanceResults: ObjectPool<ImbalanceResult>;
    public readonly numberArrays: ObjectPool<number[]>;
    public readonly tradeArrays: ObjectPool<AggressiveTrade[]>;

    // HIGH PERFORMANCE: ZoneTradeRecord pool for hot path optimization
    public readonly zoneTradeRecords: ObjectPool<ZoneTradeRecord>;

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

        this.absorptionConditions = new ObjectPool<AbsorptionConditions>(
            () => ({
                absorptionRatio: 0,
                passiveStrength: 0,
                hasRefill: false,
                icebergSignal: 0,
                liquidityGradient: 0,
                absorptionVelocity: 0,
                currentPassive: 0,
                avgPassive: 0,
                maxPassive: 0,
                minPassive: 0,
                aggressiveVolume: 0,
                imbalance: 0,
                sampleCount: 0,
                dominantSide: "neutral",
                consistency: 0,
                velocityIncrease: 0,
                spread: 0,
            }),
            (obj) => {
                obj.absorptionRatio = 0;
                obj.passiveStrength = 0;
                obj.hasRefill = false;
                obj.icebergSignal = 0;
                obj.liquidityGradient = 0;
                obj.absorptionVelocity = 0;
                obj.currentPassive = 0;
                obj.avgPassive = 0;
                obj.maxPassive = 0;
                obj.minPassive = 0;
                obj.aggressiveVolume = 0;
                obj.imbalance = 0;
                obj.sampleCount = 0;
                obj.dominantSide = "neutral";
                obj.consistency = 0;
                obj.velocityIncrease = 0;
                obj.spread = 0;
            },
            500
        );

        this.exhaustionConditions = new ObjectPool<ExhaustionConditions>(
            () => ({
                aggressiveVolume: 0,
                currentPassive: 0,
                avgPassive: 0,
                minPassive: 0,
                avgLiquidity: 0,
                passiveRatio: 0,
                depletionRatio: 0,
                refillGap: 0,
                imbalance: 0,
                spread: 0,
                passiveVelocity: 0,
                sampleCount: 0,
            }),
            (obj) => {
                obj.aggressiveVolume = 0;
                obj.currentPassive = 0;
                obj.avgPassive = 0;
                obj.minPassive = 0;
                obj.avgLiquidity = 0;
                obj.passiveRatio = 0;
                obj.depletionRatio = 0;
                obj.refillGap = 0;
                obj.imbalance = 0;
                obj.spread = 0;
                obj.passiveVelocity = 0;
                obj.sampleCount = 0;
            },
            300
        );

        this.accumulationConditions = new ObjectPool<AccumulationConditions>(
            () => ({
                ratio: 0,
                duration: 0,
                aggressiveVolume: 0,
                relevantPassive: 0,
                totalPassive: 0,
                strength: 0,
                velocity: 0,
                dominantSide: "buy",
                recentActivity: 0,
                tradeCount: 0,
                meetsMinDuration: false,
                meetsMinRatio: false,
                isRecentlyActive: false,
            }),
            (obj) => {
                obj.ratio = 0;
                obj.duration = 0;
                obj.aggressiveVolume = 0;
                obj.relevantPassive = 0;
                obj.totalPassive = 0;
                obj.strength = 0;
                obj.velocity = 0;
                obj.dominantSide = "buy";
                obj.recentActivity = 0;
                obj.tradeCount = 0;
                obj.meetsMinDuration = false;
                obj.meetsMinRatio = false;
                obj.isRecentlyActive = false;
            },
            300
        );

        this.volumeResults = new ObjectPool<VolumeCalculationResult>(
            () => ({ aggressive: 0, passive: 0, trades: [] }),
            (obj) => {
                obj.aggressive = 0;
                obj.passive = 0;
                obj.trades.length = 0;
            },
            200
        );

        this.imbalanceResults = new ObjectPool<ImbalanceResult>(
            () => ({ imbalance: 0, dominantSide: "neutral" }),
            (obj) => {
                obj.imbalance = 0;
                obj.dominantSide = "neutral";
            },
            200
        );

        this.numberArrays = new ObjectPool<number[]>(
            () => [],
            (arr) => {
                arr.length = 0;
            },
            100
        );

        this.tradeArrays = new ObjectPool<AggressiveTrade[]>(
            () => [],
            (arr) => {
                arr.length = 0;
            },
            100
        );

        // HIGH PERFORMANCE: ZoneTradeRecord pool for hot path (orderFlowPreprocessor.aggregateTradeIntoZones)
        this.zoneTradeRecords = new ObjectPool<ZoneTradeRecord>(
            () => ({
                price: 0,
                quantity: 0,
                timestamp: 0,
                tradeId: "",
                buyerIsMaker: false,
            }),
            (record) => {
                record.price = 0;
                record.quantity = 0;
                record.timestamp = 0;
                record.tradeId = "";
                record.buyerIsMaker = false;
            },
            1000 // Large pool size for high-frequency zone processing
        );

        // Pre-warm the most commonly used pools
        this.zoneSamples.prewarm(50);
        this.absorptionConditions.prewarm(30);
        this.exhaustionConditions.prewarm(20);
        this.accumulationConditions.prewarm(20);
        this.volumeResults.prewarm(25);
        this.imbalanceResults.prewarm(25);
        this.numberArrays.prewarm(20);
        this.tradeArrays.prewarm(20);
        this.zoneTradeRecords.prewarm(100); // Heavy pre-warming for hot path optimization
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
            absorptionConditions: this.absorptionConditions.size(),
            exhaustionConditions: this.exhaustionConditions.size(),
            accumulationConditions: this.accumulationConditions.size(),
            volumeResults: this.volumeResults.size(),
            imbalanceResults: this.imbalanceResults.size(),
            numberArrays: this.numberArrays.size(),
            tradeArrays: this.tradeArrays.size(),
            zoneTradeRecords: this.zoneTradeRecords.size(),
        };
    }

    /**
     * Clear all pools and release memory
     */
    public clearAll(): void {
        this.zoneSamples.clear();
        this.arrays.clear();
        this.absorptionConditions.clear();
        this.exhaustionConditions.clear();
        this.accumulationConditions.clear();
        this.volumeResults.clear();
        this.imbalanceResults.clear();
        this.numberArrays.clear();
        this.tradeArrays.clear();
        this.zoneTradeRecords.clear();
    }

    /**
     * Pre-warm all pools for optimal performance
     */
    public prewarmAll(): void {
        this.zoneSamples.prewarm(50);
        this.absorptionConditions.prewarm(30);
        this.exhaustionConditions.prewarm(20);
        this.accumulationConditions.prewarm(20);
        this.volumeResults.prewarm(25);
        this.imbalanceResults.prewarm(25);
        this.numberArrays.prewarm(20);
        this.tradeArrays.prewarm(20);
        this.zoneTradeRecords.prewarm(100);
    }
}
