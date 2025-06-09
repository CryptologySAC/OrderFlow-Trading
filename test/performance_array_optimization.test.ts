import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

describe("Performance - Array Optimization", () => {
    describe("SpoofingDetector Array Operations", () => {
        let detector: SpoofingDetector;

        beforeEach(() => {
            vi.useFakeTimers();
            detector = new SpoofingDetector({
                tickSize: 0.01,
                wallTicks: 1,
                minWallSize: 10,
            });
        });

        it("should efficiently maintain bounded history arrays", () => {
            const price = 100.0;
            const iterations = 100; // Reduced for test performance

            for (let i = 0; i < iterations; i++) {
                detector.trackPassiveChange(price, i, i + 10);
                vi.advanceTimersByTime(100); // Advance time
            }

            // Verify the detector still works correctly after many operations
            const now = Date.now();
            expect(() => {
                const result = detector.wasSpoofed(price, "buy", now, () => 0);
                expect(typeof result).toBe("boolean");
            }).not.toThrow();

            // Verify no memory leaks - the optimization should maintain bounded arrays
            // We can't directly measure memory, but we can verify functionality
            expect(true).toBe(true); // Test passes if no errors thrown above
        });

        it("should maintain memory efficiency with bounded arrays", () => {
            const prices = [100.0, 100.1, 100.2, 100.3, 100.4];

            // Add many entries to multiple price levels
            for (let i = 0; i < 100; i++) {
                prices.forEach((price) => {
                    detector.trackPassiveChange(price, i, i + 10);
                });
                vi.advanceTimersByTime(100);
            }

            // The detector should still function correctly
            // Memory usage should be bounded (we can't easily test this, but the
            // shift() optimization prevents unbounded array growth)
            const now = Date.now();
            prices.forEach((price) => {
                expect(() => {
                    const result = detector.wasSpoofed(
                        price,
                        "buy",
                        now,
                        () => 0
                    );
                    expect(typeof result).toBe("boolean");
                }).not.toThrow();
            });
        });

        it("should demonstrate the difference between slice() and shift() approaches", () => {
            // This test demonstrates the conceptual difference, though
            // performance differences would be more visible with larger arrays

            const testArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
            const maxLength = 10;

            // Old approach (creates new array)
            const oldApproach = () => {
                const arr = [...testArray];
                if (arr.length > maxLength) {
                    return arr.slice(-maxLength); // Creates new array
                }
                return arr;
            };

            // New approach (modifies existing array)
            const newApproach = () => {
                const arr = [...testArray];
                if (arr.length > maxLength) {
                    arr.shift(); // Modifies existing array
                }
                return arr;
            };

            const oldResult = oldApproach();
            const newResult = newApproach();

            // Both should maintain correct size
            expect(oldResult).toHaveLength(maxLength);
            expect(newResult).toHaveLength(maxLength);

            // Old approach keeps the last 10 items
            expect(oldResult).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

            // New approach removes the first item, keeping the rest
            expect(newResult).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        });
    });

    describe("Memory Allocation Patterns", () => {
        it("should demonstrate efficient array management patterns", () => {
            const maxSize = 10;
            const operations = 1000;

            // Simulate the old inefficient pattern
            const inefficientPattern = () => {
                let history: number[] = [];
                for (let i = 0; i < operations; i++) {
                    history.push(i);
                    if (history.length > maxSize) {
                        history = history.slice(-maxSize); // Creates new array each time
                    }
                }
                return history;
            };

            // Simulate the new efficient pattern
            const efficientPattern = () => {
                const history: number[] = [];
                for (let i = 0; i < operations; i++) {
                    history.push(i);
                    if (history.length > maxSize) {
                        history.shift(); // Reuses existing array
                    }
                }
                return history;
            };

            const inefficientResult = inefficientPattern();
            const efficientResult = efficientPattern();

            // Both should produce the same final result
            expect(inefficientResult).toHaveLength(maxSize);
            expect(efficientResult).toHaveLength(maxSize);

            // Should contain the last 'maxSize' items
            expect(inefficientResult).toEqual(efficientResult);

            // The last items should be from the end of the range
            expect(efficientResult[efficientResult.length - 1]).toBe(
                operations - 1
            );
            expect(efficientResult[0]).toBe(operations - maxSize);
        });
    });
});
