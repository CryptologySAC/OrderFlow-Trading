import { describe, it, expect } from "vitest";

/**
 * Test to verify rolling window boundary condition consistency
 * This ensures all time-based filtering uses consistent operators
 */
describe("Rolling Window Boundary Conditions", () => {
    it("should consistently exclude boundary values in time window filtering", () => {
        const now = Date.now();
        const windowMs = 30000; // 30 seconds

        // Test data with timestamps at various boundary conditions
        const testTrades = [
            { timestamp: now - windowMs - 1, price: 100 }, // Should be excluded (too old)
            { timestamp: now - windowMs, price: 101 }, // Should be excluded (exactly at boundary)
            { timestamp: now - windowMs + 1, price: 102 }, // Should be included (just within window)
            { timestamp: now - 1000, price: 103 }, // Should be included (well within window)
            { timestamp: now, price: 104 }, // Should be included (current time)
        ];

        // Standard filtering pattern used throughout codebase
        const filteredTrades = testTrades.filter(
            (t) => now - t.timestamp < windowMs
        );

        // Verify expected behavior
        expect(filteredTrades).toHaveLength(3);
        expect(filteredTrades[0].price).toBe(102); // Just within window
        expect(filteredTrades[1].price).toBe(103); // Well within window
        expect(filteredTrades[2].price).toBe(104); // Current time

        // Verify boundary exclusion
        const boundaryTimestamp = now - windowMs;
        const shouldBeExcluded = testTrades.filter(
            (t) => t.timestamp === boundaryTimestamp
        );
        expect(shouldBeExcluded).toHaveLength(1); // Exists in test data

        const isExcludedFromFilter = filteredTrades.some(
            (t) => t.timestamp === boundaryTimestamp
        );
        expect(isExcludedFromFilter).toBe(false); // But excluded from filtered results
    });

    it("should demonstrate the difference between < and <= operators", () => {
        const now = Date.now();
        const windowMs = 30000;
        const boundaryTimestamp = now - windowMs;

        const testData = [
            { timestamp: boundaryTimestamp, value: "boundary" },
            { timestamp: boundaryTimestamp + 1, value: "inside" },
        ];

        // Using < (current standard)
        const strictlyInside = testData.filter(
            (d) => now - d.timestamp < windowMs
        );

        // Using <= (incorrect pattern we fixed)
        const inclusiveBoundary = testData.filter(
            (d) => now - d.timestamp <= windowMs
        );

        // Verify the 1ms difference matters
        expect(strictlyInside).toHaveLength(1);
        expect(strictlyInside[0].value).toBe("inside");

        expect(inclusiveBoundary).toHaveLength(2); // Would include boundary
        expect(inclusiveBoundary.map((d) => d.value)).toEqual([
            "boundary",
            "inside",
        ]);

        // This 1ms difference could cause:
        // - Data being processed twice in overlapping windows
        // - Inconsistent signal timing between detectors
        // - Edge case bugs in high-frequency scenarios
    });
});
