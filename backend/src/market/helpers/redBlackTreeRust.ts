// Drop-in replacement for RedBlackTree using native Map
// Provides exact same API with significant performance improvements

import type { PassiveLevel } from "../../types/marketEvents.js";

// Re-export the PassiveLevel type for compatibility
export type { PassiveLevel };

// RBNode class for API compatibility
export class RBNode {
    public price: number;
    public level: PassiveLevel;

    constructor(price: number, level: PassiveLevel) {
        this.price = price;
        this.level = level;
    }
}

/**
 * High-performance Map-based OrderBook implementation
 * Drop-in replacement for JavaScript Red-Black Tree with significant performance improvement
 */
class RedBlackTree {
    private tree: Map<number, PassiveLevel>;

    constructor() {
        this.tree = new Map();
    }

    /**
     * Insert a price level with bid/ask separation enforcement
     */
    public insert(price: number, level: PassiveLevel): void {
        // If price already exists, merge with separation enforcement
        if (this.tree.has(price)) {
            const existing = this.tree.get(price)!;
            const merged = this.enforceBidAskSeparation(existing, level);
            this.tree.set(price, merged);
        } else {
            this.tree.set(price, level);
        }
    }

    /**
     * Set bid/ask with automatic separation enforcement
     */
    public set(price: number, side: "bid" | "ask", quantity: number): void {
        if (this.tree.has(price)) {
            // Update existing level with separation enforcement
            const existing = this.tree.get(price)!;
            if (side === "bid") {
                existing.bid = quantity;
                existing.addedBid = quantity;
                // Clear conflicting ask if setting bid > 0
                if (quantity > 0) {
                    existing.ask = 0;
                    existing.addedAsk = 0;
                }
            } else {
                existing.ask = quantity;
                existing.addedAsk = quantity;
                // Clear conflicting bid if setting ask > 0
                if (quantity > 0) {
                    existing.bid = 0;
                    existing.addedBid = 0;
                }
            }
            existing.timestamp = Date.now();
        } else {
            // Create new level
            const level: PassiveLevel = {
                price,
                bid: side === "bid" ? quantity : 0,
                ask: side === "ask" ? quantity : 0,
                timestamp: Date.now(),
                consumedAsk: 0,
                consumedBid: 0,
                addedAsk: side === "ask" ? quantity : 0,
                addedBid: side === "bid" ? quantity : 0,
            };
            this.tree.set(price, level);
        }
    }

    /**
     * Delete a price level
     */
    public delete(price: number): void {
        this.tree.delete(price);
    }

    /**
     * Find a price level
     */
    public search(price: number): RBNode | undefined {
        const level = this.tree.get(price);
        if (level) {
            return new RBNode(price, level);
        }
        return undefined;
    }

    /**
     * Get price level
     */
    public get(price: number): PassiveLevel | undefined {
        return this.tree.get(price);
    }

    /**
     * Get best bid (highest price with bid > 0) - O(n) but optimized
     */
    public getBestBid(): number {
        let bestBid = 0;
        for (const [price, level] of this.tree) {
            if (level.bid > 0 && price > bestBid) {
                bestBid = price;
            }
        }
        return bestBid;
    }

    /**
     * Get best ask (lowest price with ask > 0) - O(n) but optimized
     */
    public getBestAsk(): number {
        let bestAsk = Infinity;
        for (const [price, level] of this.tree) {
            if (level.ask > 0 && price < bestAsk) {
                bestAsk = price;
            }
        }
        return bestAsk === Infinity ? Infinity : bestAsk;
    }

    /**
     * Atomic operation: get both best bid and ask in single tree traversal
     */
    public getBestBidAsk(): { bid: number; ask: number } {
        let bestBid = 0;
        let bestAsk = Infinity;

        for (const [price, level] of this.tree) {
            if (level.bid > 0 && price > bestBid) {
                bestBid = price;
            }
            if (level.ask > 0 && price < bestAsk) {
                bestAsk = price;
            }
        }

        return {
            bid: bestBid,
            ask: bestAsk === Infinity ? Infinity : bestAsk,
        };
    }

    /**
     * Get all nodes for iteration
     */
    public getAllNodes(): RBNode[] {
        const nodes: RBNode[] = [];
        // Sort by price for consistent ordering
        const sortedEntries = Array.from(this.tree.entries()).sort(
            ([a], [b]) => a - b
        );
        for (const [price, level] of sortedEntries) {
            nodes.push(new RBNode(price, level));
        }
        return nodes;
    }

    /**
     * Get tree size
     */
    public size(): number {
        return this.tree.size;
    }

    /**
     * Clear tree
     */
    public clear(): void {
        this.tree.clear();
    }

    /**
     * Enforce bid/ask separation when merging levels
     */
    private enforceBidAskSeparation(
        existing: PassiveLevel,
        incoming: PassiveLevel
    ): PassiveLevel {
        const result = { ...existing };

        // If incoming has bid data, clear any existing ask and update bid
        if (incoming.bid > 0) {
            result.bid = incoming.bid;
            result.addedBid = incoming.addedBid || 0;
            result.ask = 0;
            result.addedAsk = 0;
        }

        // If incoming has ask data, clear any existing bid and update ask
        if (incoming.ask > 0) {
            result.ask = incoming.ask;
            result.addedAsk = incoming.addedAsk || 0;
            result.bid = 0;
            result.addedBid = 0;
        }

        // Update other fields
        result.timestamp = incoming.timestamp;
        result.consumedBid = incoming.consumedBid || 0;
        result.consumedAsk = incoming.consumedAsk || 0;

        return result;
    }
}

// Export the class with the same name for drop-in replacement
export { RedBlackTree };
