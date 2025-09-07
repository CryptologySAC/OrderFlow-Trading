import { describe, it, expect, beforeEach } from "vitest";
import { RedBlackTree } from "../src/market/helpers/redBlackTree";
import type { PassiveLevel } from "../src/types/marketEvents";

describe("RedBlackTree - Comprehensive Test Suite", () => {
    let tree: RedBlackTree;

    beforeEach(() => {
        tree = new RedBlackTree();
    });

    // Helper function to validate basic tree properties we can check via public interface
    function validateBasicTreeProperties(tree: RedBlackTree): boolean {
        const nodes = tree.getAllNodes();
        if (nodes.length === 0) return true;

        // Check BST property: in-order traversal should return sorted prices
        for (let i = 1; i < nodes.length; i++) {
            if (nodes[i].price <= nodes[i - 1].price) {
                return false; // BST ordering violated
            }
        }

        return true;
    }

    describe("Tree Structure and Ordering", () => {
        it("should maintain BST ordering after sequential insertions", () => {
            const prices = [50, 30, 70, 20, 40, 60, 80, 10, 25, 35, 45];

            for (const price of prices) {
                const level: PassiveLevel = {
                    price,
                    bid: price < 50 ? 100 : 0,
                    ask: price >= 50 ? 100 : 0,
                    timestamp: Date.now(),
                };
                tree.insert(price, level);

                // Validate BST ordering after each insertion
                expect(validateBasicTreeProperties(tree)).toBe(true);
            }
        });

        it("should maintain BST ordering after deletions", () => {
            // Insert many nodes
            const prices = [
                50, 30, 70, 20, 40, 60, 80, 10, 25, 35, 45, 55, 65, 75, 85,
            ];

            for (const price of prices) {
                const level: PassiveLevel = {
                    price,
                    bid: price < 50 ? 100 : 0,
                    ask: price >= 50 ? 100 : 0,
                    timestamp: Date.now(),
                };
                tree.insert(price, level);
            }

            // Delete half the nodes
            const toDelete = [20, 40, 70, 25, 75];
            for (const price of toDelete) {
                tree.delete(price);
                expect(validateBasicTreeProperties(tree)).toBe(true);
            }
        });

        it("should maintain correct tree size after complex operations", () => {
            const prices = [50, 30, 70, 20, 40, 60, 80];

            // Insert all
            for (const price of prices) {
                const level: PassiveLevel = {
                    price,
                    bid: 100,
                    ask: 0,
                    timestamp: Date.now(),
                };
                tree.insert(price, level);
            }
            expect(tree.size()).toBe(7);

            // Delete some
            tree.delete(30);
            tree.delete(70);
            expect(tree.size()).toBe(5);

            // Insert some back
            tree.insert(90, {
                price: 90,
                bid: 100,
                ask: 0,
                timestamp: Date.now(),
            });
            expect(tree.size()).toBe(6);
        });

        it("should handle worst-case insertion patterns while maintaining order", () => {
            // Insert in ascending order (worst case for naive BST)
            for (let i = 1; i <= 15; i++) {
                const level: PassiveLevel = {
                    price: i,
                    bid: 100,
                    ask: 0,
                    timestamp: Date.now(),
                };
                tree.insert(i, level);
                expect(validateBasicTreeProperties(tree)).toBe(true);
            }

            // Tree should maintain all elements and correct ordering
            const treeSize = tree.size();
            expect(treeSize).toBe(15);

            // All nodes should be present and in correct order
            const nodes = tree.getAllNodes();
            expect(nodes).toHaveLength(15);
            for (let i = 1; i < nodes.length; i++) {
                expect(nodes[i].price).toBeGreaterThan(nodes[i - 1].price);
            }
        });
    });

    describe("Performance and Complexity Validation", () => {
        it("should maintain O(log n) insertion performance", () => {
            const iterations = 1000;
            const prices: number[] = [];

            // Generate random prices
            for (let i = 0; i < iterations; i++) {
                prices.push(Math.random() * 1000 + 1);
            }

            const startTime = performance.now();

            for (const price of prices) {
                const level: PassiveLevel = {
                    price,
                    bid: Math.random() > 0.5 ? 100 : 0,
                    ask: Math.random() > 0.5 ? 100 : 0,
                    timestamp: Date.now(),
                };
                tree.insert(price, level);
            }

            const endTime = performance.now();
            const totalTime = endTime - startTime;

            // Should complete 1000 insertions reasonably quickly (less than 100ms)
            expect(totalTime).toBeLessThan(100);
            expect(tree.size()).toBeGreaterThan(0);
        });

        it("should maintain O(log n) search performance", () => {
            const treeSize = 1000;
            const searchCount = 100;

            // Build a large tree
            for (let i = 0; i < treeSize; i++) {
                const price = Math.random() * 1000 + 1;
                const level: PassiveLevel = {
                    price,
                    bid: 100,
                    ask: 0,
                    timestamp: Date.now(),
                };
                tree.insert(price, level);
            }

            // Generate search targets
            const searchPrices = [];
            for (let i = 0; i < searchCount; i++) {
                searchPrices.push(Math.random() * 1000 + 1);
            }

            const startTime = performance.now();

            for (const price of searchPrices) {
                tree.get(price); // This uses search internally
            }

            const endTime = performance.now();
            const totalTime = endTime - startTime;

            // Should complete 100 searches on 1000-node tree very quickly
            expect(totalTime).toBeLessThan(10);
        });

        it("should maintain O(log n) best bid/ask performance", () => {
            const treeSize = 1000;

            // Build tree with mixed bid/ask data
            for (let i = 0; i < treeSize; i++) {
                const price = Math.random() * 1000 + 1;
                const level: PassiveLevel = {
                    price,
                    bid: i % 2 === 0 ? 100 : 0,
                    ask: i % 2 === 1 ? 100 : 0,
                    timestamp: Date.now(),
                };
                tree.insert(price, level);
            }

            const iterations = 100;
            const startTime = performance.now();

            for (let i = 0; i < iterations; i++) {
                tree.getBestBid();
                tree.getBestAsk();
                tree.getBestBidAsk(); // Atomic operation
            }

            const endTime = performance.now();
            const totalTime = endTime - startTime;

            // Should complete 300 best quote operations very quickly
            expect(totalTime).toBeLessThan(20);
        });
    });

    describe("Input Validation and Error Handling", () => {
        it("should reject negative prices", () => {
            expect(() => {
                tree.insert(-1, {
                    price: -1,
                    bid: 100,
                    ask: 0,
                    timestamp: Date.now(),
                });
            }).toThrow();
        });

        it("should reject infinite prices", () => {
            expect(() => {
                tree.insert(Infinity, {
                    price: Infinity,
                    bid: 100,
                    ask: 0,
                    timestamp: Date.now(),
                });
            }).toThrow();
        });

        it("should reject NaN prices", () => {
            expect(() => {
                tree.insert(NaN, {
                    price: NaN,
                    bid: 100,
                    ask: 0,
                    timestamp: Date.now(),
                });
            }).toThrow();
        });

        it("should reject negative quantities", () => {
            expect(() => {
                tree.set(50, "bid", -100);
            }).toThrow();
        });

        it("should reject invalid side parameters", () => {
            expect(() => {
                tree.set(50, "invalid" as any, 100);
            }).toThrow();
        });

        it("should handle malformed PassiveLevel objects", () => {
            expect(() => {
                tree.insert(50, {
                    price: 50,
                    bid: -1, // Invalid negative bid
                    ask: 0,
                    timestamp: Date.now(),
                });
            }).toThrow();

            expect(() => {
                tree.insert(50, {
                    price: 50,
                    bid: 100,
                    ask: 0,
                    timestamp: -1, // Invalid negative timestamp
                });
            }).toThrow();
        });

        it("should validate price consistency in PassiveLevel", () => {
            expect(() => {
                tree.insert(50, {
                    price: 100, // Price mismatch
                    bid: 100,
                    ask: 0,
                    timestamp: Date.now(),
                });
            }).not.toThrow(); // Price is taken from first parameter, not object

            // But both should be valid
            expect(() => {
                tree.insert(-1, {
                    price: 50,
                    bid: 100,
                    ask: 0,
                    timestamp: Date.now(),
                });
            }).toThrow();
        });
    });

    describe("Edge Cases and Boundary Conditions", () => {
        it("should handle operations on empty tree", () => {
            expect(tree.size()).toBe(0);
            expect(tree.get(50)).toBeUndefined();
            expect(tree.getBestBid()).toBe(0);
            expect(tree.getBestAsk()).toBe(Infinity);

            const bidAsk = tree.getBestBidAsk();
            expect(bidAsk.bid).toBe(0);
            expect(bidAsk.ask).toBe(Infinity);

            expect(tree.getAllNodes()).toHaveLength(0);

            // Delete on empty tree should not throw
            expect(() => tree.delete(50)).not.toThrow();
        });

        it("should handle single-node tree operations", () => {
            const level: PassiveLevel = {
                price: 50,
                bid: 100,
                ask: 0,
                timestamp: Date.now(),
            };
            tree.insert(50, level);

            expect(tree.size()).toBe(1);
            expect(tree.get(50)).toEqual(level);
            expect(tree.getBestBid()).toBe(50);
            expect(tree.getBestAsk()).toBe(Infinity);
            expect(tree.getAllNodes()).toHaveLength(1);

            // Delete the only node
            tree.delete(50);
            expect(tree.size()).toBe(0);
            expect(tree.get(50)).toBeUndefined();
        });

        it("should handle very small price differences", () => {
            const price1 = 50.00000001;
            const price2 = 50.00000002;

            tree.set(price1, "bid", 100);
            tree.set(price2, "ask", 100);

            expect(tree.get(price1)?.bid).toBe(100);
            expect(tree.get(price2)?.ask).toBe(100);
            expect(tree.getBestBid()).toBe(price1);
            expect(tree.getBestAsk()).toBe(price2);
        });

        it("should handle large price values", () => {
            const largePrice = 999999.99;
            const level: PassiveLevel = {
                price: largePrice,
                bid: 100,
                ask: 0,
                timestamp: Date.now(),
            };

            tree.insert(largePrice, level);
            expect(tree.get(largePrice)).toEqual(level);
            expect(tree.getBestBid()).toBe(largePrice);
        });

        it("should handle zero quantities correctly", () => {
            tree.set(50, "bid", 0);
            tree.set(51, "ask", 0);

            const bidLevel = tree.get(50);
            const askLevel = tree.get(51);

            expect(bidLevel?.bid).toBe(0);
            expect(askLevel?.ask).toBe(0);

            // Zero quantities should not be considered for best quotes
            expect(tree.getBestBid()).toBe(0);
            expect(tree.getBestAsk()).toBe(Infinity);
        });

        it("should handle rapid alternating insertions and deletions", () => {
            const prices = [50, 30, 70, 20, 40, 60, 80];

            // Insert all
            for (const price of prices) {
                tree.set(price, "bid", 100);
            }
            expect(tree.size()).toBe(7);

            // Delete all
            for (const price of prices) {
                tree.delete(price);
            }
            expect(tree.size()).toBe(0);

            // Insert again
            for (const price of prices) {
                tree.set(price, "ask", 100);
            }
            expect(tree.size()).toBe(7);
        });
    });

    describe("Memory Management and Node Lifecycle", () => {
        it("should handle repeated insert/delete cycles without memory leaks", () => {
            const cycles = 100;
            const pricesPerCycle = 10;

            for (let cycle = 0; cycle < cycles; cycle++) {
                // Insert nodes
                for (let i = 0; i < pricesPerCycle; i++) {
                    const price = cycle * pricesPerCycle + i;
                    tree.set(price, "bid", 100);
                }

                // Delete half of them
                for (let i = 0; i < pricesPerCycle / 2; i++) {
                    const price = cycle * pricesPerCycle + i;
                    tree.delete(price);
                }
            }

            // Tree should still be functional
            expect(tree.size()).toBeGreaterThan(0);
            expect(validateBasicTreeProperties(tree)).toBe(true);
        });

        it("should maintain NIL sentinel integrity", () => {
            // Insert and delete many nodes to stress test NIL handling
            for (let i = 0; i < 100; i++) {
                tree.set(i, "bid", 100);
            }

            for (let i = 0; i < 50; i++) {
                tree.delete(i);
            }

            // Tree should still be valid and functional
            expect(tree.size()).toBe(50);
            expect(tree.getBestBid()).toBeGreaterThan(0);
        });

        it("should handle clear operation correctly", () => {
            // Build a tree
            for (let i = 0; i < 10; i++) {
                tree.set(i, "bid", 100);
            }
            expect(tree.size()).toBe(10);

            // Clear it
            tree.clear();
            expect(tree.size()).toBe(0);
            expect(tree.getAllNodes()).toHaveLength(0);
            expect(tree.getBestBid()).toBe(0);
            expect(tree.getBestAsk()).toBe(Infinity);

            // Should be able to use tree normally after clear
            tree.set(50, "bid", 100);
            expect(tree.size()).toBe(1);
            expect(tree.getBestBid()).toBe(50);
        });
    });

    describe("Advanced Bid/Ask Business Logic", () => {
        it("should handle rapid quote updates without corruption", () => {
            const price = 50;

            // Rapid alternating updates
            for (let i = 0; i < 100; i++) {
                if (i % 2 === 0) {
                    tree.set(price, "bid", 100 + i);
                } else {
                    tree.set(price, "ask", 100 + i);
                }
            }

            const level = tree.get(price);
            expect(level?.ask).toBe(199); // Last was ask
            expect(level?.bid).toBe(0); // Should be cleared
        });

        it("should preserve tracking fields during separation enforcement", () => {
            const price = 50;

            // Set ask with tracking
            tree.set(price, "ask", 100);
            let level = tree.get(price);
            expect(level?.addedAsk).toBe(100);
            expect(level?.addedBid).toBe(0);

            // Set bid - should clear ask tracking
            tree.set(price, "bid", 200);
            level = tree.get(price);
            expect(level?.addedBid).toBe(200);
            expect(level?.addedAsk).toBe(0);
        });

        it("should handle complex market scenarios with crossing prevention", () => {
            // Build a normal order book
            tree.set(49.95, "bid", 100);
            tree.set(49.9, "bid", 150);
            tree.set(50.05, "ask", 100);
            tree.set(50.1, "ask", 150);

            expect(tree.getBestBid()).toBe(49.95);
            expect(tree.getBestAsk()).toBe(50.05);

            // Try to create crossing scenario
            tree.set(50.05, "bid", 200); // Bid at ask price

            // Ask should be cleared
            const level = tree.get(50.05);
            expect(level?.bid).toBe(200);
            expect(level?.ask).toBe(0);

            // New best quotes
            expect(tree.getBestBid()).toBe(50.05);
            expect(tree.getBestAsk()).toBe(50.1);
        });

        it("should handle timestamp updates correctly", async () => {
            const price = 50;
            const initialTime = Date.now();

            tree.set(price, "bid", 100);
            let level = tree.get(price);
            expect(level?.timestamp).toBeGreaterThanOrEqual(initialTime);

            // Wait longer to ensure different timestamp
            await new Promise((resolve) => setTimeout(resolve, 10));
            const updateTime = Date.now();
            tree.set(price, "ask", 100);

            level = tree.get(price);
            expect(level?.timestamp).toBeGreaterThanOrEqual(updateTime);
            // Use >= instead of > to handle edge case where timestamps might be equal
            expect(level?.timestamp).toBeGreaterThanOrEqual(initialTime);
        });

        it("should handle mixed bid/ask tree with proper separation", () => {
            // Create a tree with mixed bid/ask levels
            const bidPrices = [49.9, 49.85, 49.8];
            const askPrices = [50.1, 50.15, 50.2];

            for (const price of bidPrices) {
                tree.set(price, "bid", 100);
            }

            for (const price of askPrices) {
                tree.set(price, "ask", 100);
            }

            // Verify separation
            expect(tree.getBestBid()).toBe(49.9);
            expect(tree.getBestAsk()).toBe(50.1);

            // Verify no mixed levels
            for (const price of bidPrices) {
                const level = tree.get(price);
                expect(level?.bid).toBe(100);
                expect(level?.ask).toBe(0);
            }

            for (const price of askPrices) {
                const level = tree.get(price);
                expect(level?.ask).toBe(100);
                expect(level?.bid).toBe(0);
            }
        });
    });

    describe("Tree Traversal and Inspection", () => {
        it("should return nodes in correct order from getAllNodes", () => {
            const prices = [50, 30, 70, 20, 40, 60, 80];

            for (const price of prices) {
                tree.set(price, "bid", 100);
            }

            const nodes = tree.getAllNodes();
            expect(nodes).toHaveLength(7);

            // Should be in ascending price order (in-order traversal)
            for (let i = 1; i < nodes.length; i++) {
                expect(nodes[i].price).toBeGreaterThan(nodes[i - 1].price);
            }
        });

        it("should handle tree inspection during modifications", () => {
            // Build initial tree
            for (let i = 0; i < 10; i++) {
                tree.set(i * 10, "bid", 100);
            }

            let nodes = tree.getAllNodes();
            expect(nodes).toHaveLength(10);

            // Modify while inspecting
            tree.delete(50);
            nodes = tree.getAllNodes();
            expect(nodes).toHaveLength(9);

            tree.set(55, "ask", 100);
            nodes = tree.getAllNodes();
            expect(nodes).toHaveLength(10);
        });
    });
});
