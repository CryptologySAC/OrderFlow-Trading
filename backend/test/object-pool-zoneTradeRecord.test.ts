// test/object-pool-zoneTradeRecord.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { SharedPools } from "../src/utils/objectPool.js";
import { ZoneTradeRecord } from "../src/types/marketEvents.js";
import { CircularBuffer } from "../src/utils/circularBuffer.js";

describe("ZoneTradeRecord Object Pooling", () => {
    let pools: SharedPools;

    beforeEach(() => {
        pools = SharedPools.getInstance();
        // Clear pools to start fresh
        pools.clearAll();
        pools.prewarmAll();
    });

    it("should acquire and release ZoneTradeRecord objects from pool", () => {
        const initialPoolSize = pools.getStats().zoneTradeRecords;
        expect(initialPoolSize).toBe(100); // Pre-warmed pool

        // Acquire an object
        const record = pools.zoneTradeRecords.acquire();
        expect(record).toBeDefined();
        expect(record.price).toBe(0);
        expect(record.quantity).toBe(0);
        expect(record.tradeId).toBe("");

        // Pool should have one less object
        expect(pools.getStats().zoneTradeRecords).toBe(initialPoolSize - 1);

        // Modify the object
        record.price = 100.5;
        record.quantity = 25.0;
        record.timestamp = 1640995200000;
        record.tradeId = "test_trade_123";
        record.buyerIsMaker = true;

        // Release back to pool
        pools.zoneTradeRecords.release(record);

        // Pool should be back to original size
        expect(pools.getStats().zoneTradeRecords).toBe(initialPoolSize);

        // Acquire again - should get reset object
        const record2 = pools.zoneTradeRecords.acquire();
        expect(record2.price).toBe(0);
        expect(record2.quantity).toBe(0);
        expect(record2.tradeId).toBe("");
        expect(record2.buyerIsMaker).toBe(false);
    });

    it("should integrate with CircularBuffer cleanup callback", () => {
        const initialPoolSize = pools.getStats().zoneTradeRecords;

        // Create circular buffer with cleanup callback
        const buffer = new CircularBuffer<ZoneTradeRecord>(
            3, // Small capacity to trigger eviction
            (evicted) => pools.zoneTradeRecords.release(evicted)
        );

        // Add records to buffer
        for (let i = 0; i < 5; i++) {
            const record = pools.zoneTradeRecords.acquire();
            record.price = 100 + i;
            record.quantity = 10 + i;
            record.tradeId = `trade_${i}`;
            buffer.add(record);
        }

        // Pool should have less objects (some in buffer)
        expect(pools.getStats().zoneTradeRecords).toBeLessThan(initialPoolSize);

        // Buffer should contain only the last 3 records due to capacity
        const bufferContents = buffer.getAll();
        expect(bufferContents).toHaveLength(3);
        expect(bufferContents[0]?.tradeId).toBe("trade_2");
        expect(bufferContents[2]?.tradeId).toBe("trade_4");
    });

    it("should handle high-frequency pooling without memory leaks", () => {
        const initialPoolSize = pools.getStats().zoneTradeRecords;
        const records: ZoneTradeRecord[] = [];

        // Simulate high-frequency trading scenario
        for (let i = 0; i < 1000; i++) {
            const record = pools.zoneTradeRecords.acquire();
            record.price = 100 + Math.random() * 10;
            record.quantity = Math.random() * 50;
            record.timestamp = Date.now() + i;
            record.tradeId = `hf_trade_${i}`;
            record.buyerIsMaker = i % 2 === 0;

            records.push(record);
        }

        // Pool should be empty or very small
        expect(pools.getStats().zoneTradeRecords).toBeLessThanOrEqual(100);

        // Release all records back
        records.forEach((record) => pools.zoneTradeRecords.release(record));

        // Pool should be at maximum capacity (1000 from config)
        expect(pools.getStats().zoneTradeRecords).toBe(1000);
    });

    it("should prevent pool overflow beyond max capacity", () => {
        const maxCapacity = 1000;

        // Fill pool beyond capacity
        const records: ZoneTradeRecord[] = [];
        for (let i = 0; i < maxCapacity + 500; i++) {
            const record = pools.zoneTradeRecords.acquire();
            records.push(record);
        }

        // Release all back to pool
        records.forEach((record) => pools.zoneTradeRecords.release(record));

        // Pool should not exceed max capacity
        const finalPoolSize = pools.getStats().zoneTradeRecords;
        expect(finalPoolSize).toBeLessThanOrEqual(maxCapacity);
        expect(finalPoolSize).toBe(maxCapacity); // Should be exactly at max
    });
});
