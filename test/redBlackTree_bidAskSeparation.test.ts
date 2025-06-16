import { describe, it, expect, beforeEach } from "vitest";
import { RedBlackTree } from "../src/market/helpers/redBlackTree";
import type { PassiveLevel } from "../src/types/marketEvents";

describe("RedBlackTree - Bid/Ask Separation", () => {
    let tree: RedBlackTree;

    beforeEach(() => {
        tree = new RedBlackTree();
    });

    it("should prevent quote inversions by clearing conflicting side when setting bid", () => {
        // Set an ask at price 50.00
        tree.set(50.0, "ask", 100);

        let level = tree.get(50.0);
        expect(level?.ask).toBe(100);
        expect(level?.bid).toBe(0);

        // Set a bid at same price - should clear the ask
        tree.set(50.0, "bid", 200);

        level = tree.get(50.0);
        expect(level?.bid).toBe(200);
        expect(level?.ask).toBe(0); // Ask should be cleared
    });

    it("should prevent quote inversions by clearing conflicting side when setting ask", () => {
        // Set a bid at price 50.00
        tree.set(50.0, "bid", 150);

        let level = tree.get(50.0);
        expect(level?.bid).toBe(150);
        expect(level?.ask).toBe(0);

        // Set an ask at same price - should clear the bid
        tree.set(50.0, "ask", 250);

        level = tree.get(50.0);
        expect(level?.ask).toBe(250);
        expect(level?.bid).toBe(0); // Bid should be cleared
    });

    it("should enforce separation when using insert method", () => {
        // First insert a level with bid data
        const level1: PassiveLevel = {
            price: 50.0,
            bid: 100,
            ask: 0,
            timestamp: Date.now(),
            consumedAsk: 0,
            consumedBid: 0,
            addedAsk: 0,
            addedBid: 100,
        };
        tree.insert(50.0, level1);

        let result = tree.get(50.0);
        expect(result?.bid).toBe(100);
        expect(result?.ask).toBe(0);

        // Insert level with ask data at same price - should clear bid
        const level2: PassiveLevel = {
            price: 50.0,
            bid: 0,
            ask: 200,
            timestamp: Date.now(),
            consumedAsk: 0,
            consumedBid: 0,
            addedAsk: 200,
            addedBid: 0,
        };
        tree.insert(50.0, level2);

        result = tree.get(50.0);
        expect(result?.ask).toBe(200);
        expect(result?.bid).toBe(0); // Bid should be cleared
    });

    it("should allow setting quantity to 0 without clearing the other side", () => {
        // Set a bid at price 50.00
        tree.set(50.0, "bid", 100);

        // Set bid to 0 - should not affect ask side
        tree.set(50.0, "bid", 0);

        const level = tree.get(50.0);
        expect(level?.bid).toBe(0);
        expect(level?.ask).toBe(0); // Ask should remain 0
    });

    it("should maintain proper orderbook structure with separation", () => {
        // Set bids below mid price
        tree.set(49.95, "bid", 100);
        tree.set(49.9, "bid", 150);

        // Set asks above mid price
        tree.set(50.05, "ask", 200);
        tree.set(50.1, "ask", 250);

        // Verify best bid and ask are properly separated
        const bestBid = tree.getBestBid();
        const bestAsk = tree.getBestAsk();

        expect(bestBid).toBe(49.95);
        expect(bestAsk).toBe(50.05); // Fixed: getBestAsk() now returns correct value
        expect(bestBid).toBeLessThan(bestAsk); // Proper spread

        // Verify no mixed levels exist
        const bidLevel = tree.get(49.95);
        const askLevel = tree.get(50.05);

        expect(bidLevel?.bid).toBe(100);
        expect(bidLevel?.ask).toBe(0);
        expect(askLevel?.ask).toBe(200);
        expect(askLevel?.bid).toBe(0);
    });

    it("should handle quote inversion prevention in real market scenario", () => {
        // Simulate market scenario where bid tries to cross ask
        tree.set(50.0, "ask", 100); // Ask at 50.00
        tree.set(49.95, "bid", 150); // Bid at 49.95 (normal)

        // Now bid tries to move to 50.00 (would create inversion)
        tree.set(50.0, "bid", 200);

        // Ask should be cleared, preventing inversion
        const level = tree.get(50.0);
        expect(level?.bid).toBe(200);
        expect(level?.ask).toBe(0);

        // Best quotes should be valid
        const bestBid = tree.getBestBid();
        const bestAsk = tree.getBestAsk();

        expect(bestBid).toBe(50.0);
        expect(bestAsk).toBe(Infinity); // No asks remaining
    });

    it("should properly handle addedBid and addedAsk fields during separation", () => {
        // Set ask with proper tracking fields
        tree.set(50.0, "ask", 100);

        let level = tree.get(50.0);
        expect(level?.addedAsk).toBe(100);
        expect(level?.addedBid).toBe(0);

        // Set bid at same price - should clear ask tracking too
        tree.set(50.0, "bid", 200);

        level = tree.get(50.0);
        expect(level?.addedBid).toBe(200);
        expect(level?.addedAsk).toBe(0); // Should be cleared
    });

    it("should preserve timestamp when enforcing separation", async () => {
        const initialTime = Date.now();
        tree.set(50.0, "ask", 100);

        // Wait a bit to ensure different timestamp
        await new Promise((resolve) => setTimeout(resolve, 1));

        const newTime = Date.now();
        tree.set(50.0, "bid", 200);

        const level = tree.get(50.0);
        expect(level?.timestamp).toBeGreaterThanOrEqual(newTime);
    });
});
