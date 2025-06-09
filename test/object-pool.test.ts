import { describe, it, expect, beforeEach } from "vitest";
import { ObjectPool, ArrayPool, SharedPools } from "../src/utils/objectPool";

describe("Object Pooling", () => {
    describe("ObjectPool", () => {
        let pool: ObjectPool<{ id: number; value: string }>;

        beforeEach(() => {
            pool = new ObjectPool(
                () => ({ id: 0, value: "" }),
                (obj) => {
                    obj.id = 0;
                    obj.value = "";
                }
            );
        });

        it("should create new objects when pool is empty", () => {
            const obj = pool.acquire();
            expect(obj).toEqual({ id: 0, value: "" });
        });

        it("should reuse objects from pool", () => {
            const obj1 = pool.acquire();
            obj1.id = 123;
            obj1.value = "test";

            pool.release(obj1);

            const obj2 = pool.acquire();
            expect(obj2).toBe(obj1); // Same object instance
            expect(obj2).toEqual({ id: 0, value: "" }); // But reset
        });

        it("should prewarm the pool", () => {
            pool.prewarm(5);
            expect(pool.size()).toBe(5);
        });

        it("should respect max pool size", () => {
            const smallPool = new ObjectPool(
                () => ({ value: 0 }),
                (obj) => {
                    obj.value = 0;
                },
                2 // Max size 2
            );

            const obj1 = smallPool.acquire();
            const obj2 = smallPool.acquire();
            const obj3 = smallPool.acquire();

            smallPool.release(obj1);
            smallPool.release(obj2);
            smallPool.release(obj3); // This should be discarded

            expect(smallPool.size()).toBe(2);
        });
    });

    describe("ArrayPool", () => {
        let arrayPool: ArrayPool<number>;

        beforeEach(() => {
            arrayPool = new ArrayPool<number>(10, 1000);
        });

        it("should provide arrays of requested size", () => {
            const arr = arrayPool.acquire(50);
            expect(arr).toHaveLength(50);
        });

        it("should reuse arrays from pool", () => {
            const arr1 = arrayPool.acquire(10);
            arr1[0] = 123;
            arr1[1] = 456;

            arrayPool.release(arr1);

            const arr2 = arrayPool.acquire(10);
            expect(arr2).toBe(arr1); // Same array instance
            expect(arr2).toHaveLength(10); // Reset to requested size
            expect(arr2[0]).toBe(undefined); // Contents cleared
        });

        it("should handle large arrays without pooling", () => {
            const largeArr = arrayPool.acquire(2000); // Exceeds maxArraySize
            expect(largeArr).toHaveLength(2000);

            arrayPool.release(largeArr); // Should not be pooled
            expect(arrayPool.getStats().totalArrays).toBe(0);
        });

        it("should track pool statistics", () => {
            arrayPool.acquire(10);
            arrayPool.acquire(20);
            const arr = arrayPool.acquire(10);
            arrayPool.release(arr);

            const stats = arrayPool.getStats();
            expect(stats.totalPools).toBeGreaterThan(0);
            expect(stats.totalArrays).toBeGreaterThan(0);
        });
    });

    describe("SharedPools", () => {
        it("should be a singleton", () => {
            const instance1 = SharedPools.getInstance();
            const instance2 = SharedPools.getInstance();
            expect(instance1).toBe(instance2);
        });

        it("should provide zoneSamples pool", () => {
            const pools = SharedPools.getInstance();
            const sample = pools.zoneSamples.acquire();

            expect(sample).toEqual({
                bid: 0,
                ask: 0,
                total: 0,
                timestamp: 0,
            });

            sample.bid = 100;
            sample.ask = 200;
            sample.total = 300;
            sample.timestamp = Date.now();

            pools.zoneSamples.release(sample);

            const sample2 = pools.zoneSamples.acquire();
            expect(sample2).toBe(sample); // Same object
            expect(sample2).toEqual({
                // But reset
                bid: 0,
                ask: 0,
                total: 0,
                timestamp: 0,
            });
        });

        it("should provide arrays pool", () => {
            const pools = SharedPools.getInstance();
            const arr = pools.arrays.acquire(100);

            expect(arr).toHaveLength(100);

            for (let i = 0; i < 10; i++) {
                arr[i] = i * 10;
            }

            pools.arrays.release(arr);

            const arr2 = pools.arrays.acquire(100);
            expect(arr2).toBe(arr); // Same array
            expect(arr2).toHaveLength(100); // Reset to requested size
            expect(arr2[0]).toBe(undefined); // Contents cleared
        });

        it("should provide usage statistics", () => {
            const pools = SharedPools.getInstance();
            const stats = pools.getStats();

            expect(stats).toHaveProperty("zoneSamples");
            expect(stats).toHaveProperty("arrays");
            expect(typeof stats.zoneSamples).toBe("number");
            expect(typeof stats.arrays.totalPools).toBe("number");
            expect(typeof stats.arrays.totalArrays).toBe("number");
        });
    });

    describe("Memory leak prevention", () => {
        it("should not return arrays to pool when duplicate", () => {
            const arrayPool = new ArrayPool<number>(2, 100);
            const arr = arrayPool.acquire(10);

            arrayPool.release(arr);
            expect(arrayPool.getStats().totalArrays).toBe(1);

            // Try to release the same array again
            arrayPool.release(arr);
            expect(arrayPool.getStats().totalArrays).toBe(1); // Should still be 1
        });

        it("should clear arrays before returning to pool", () => {
            const arrayPool = new ArrayPool<number>(10, 100);
            const arr = arrayPool.acquire(5);

            arr[0] = 999;
            arr[1] = 888;

            arrayPool.release(arr);

            const arr2 = arrayPool.acquire(5);
            expect(arr2).toBe(arr); // Same array instance
            expect(arr2).toHaveLength(5); // Reset to requested size
            expect(arr2[0]).toBe(undefined); // Contents cleared
            expect(arr2[1]).toBe(undefined); // Contents cleared
        });
    });
});
