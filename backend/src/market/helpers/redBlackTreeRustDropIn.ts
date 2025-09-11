// Drop-in replacement for redBlackTreeRust.ts using native Rust red-black tree
// This maintains the exact same API while providing massive performance improvements

import type { PassiveLevel } from "../../types/marketEvents.js";

// Import the consolidated Rust BTreeMap native addon
const addon = require("../../../rust/btreemap/native");

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
 * High-performance Rust-based Red-Black Tree implementation
 * Drop-in replacement for JavaScript Red-Black Tree with O(log n) performance
 */
class RedBlackTreeImpl {
    private treeId: string;

    constructor() {
        // Create unique ID for this tree instance
        this.treeId = `tree_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        addon.createTree(this.treeId);
    }

    /**
     * Insert a price level with bid/ask separation enforcement
     */
    public insert(price: number, level: PassiveLevel): void {
        const levelJson = JSON.stringify({
            price: level.price,
            bid: level.bid,
            ask: level.ask,
            timestamp: level.timestamp,
            consumed_ask: level.consumedAsk ?? null,
            consumed_bid: level.consumedBid ?? null,
            added_ask: level.addedAsk ?? null,
            added_bid: level.addedBid ?? null,
        });
        addon.insert(this.treeId, price, levelJson);
    }

    /**
     * Set bid/ask with automatic separation enforcement
     */
    public set(price: number, side: "bid" | "ask", quantity: number): void {
        addon.set(this.treeId, price, side, quantity);
    }

    /**
     * Delete a price level
     */
    public delete(price: number): void {
        addon.delete(this.treeId, price);
    }

    /**
     * Find a price level
     */
    public search(price: number): RBNode | undefined {
        const result = addon.search(this.treeId, price);
        if (result) {
            return new RBNode(result.price, {
                price: result.level.price,
                bid: result.level.bid,
                ask: result.level.ask,
                timestamp: result.level.timestamp,
                consumedAsk: result.level.consumed_ask ?? undefined,
                consumedBid: result.level.consumed_bid ?? undefined,
                addedAsk: result.level.added_ask ?? undefined,
                addedBid: result.level.added_bid ?? undefined,
            });
        }
        return undefined;
    }

    /**
     * Get price level
     */
    public get(price: number): PassiveLevel | undefined {
        const result = addon.get(this.treeId, price);
        if (result) {
            return {
                price: result.price,
                bid: result.bid,
                ask: result.ask,
                timestamp: result.timestamp,
                consumedAsk: result.consumed_ask ?? undefined,
                consumedBid: result.consumed_bid ?? undefined,
                addedAsk: result.added_ask ?? undefined,
                addedBid: result.added_bid ?? undefined,
            };
        }
        return undefined;
    }

    /**
     * Get best bid (highest price with bid > 0) - O(log n) with Rust BTreeMap
     */
    public getBestBid(): number {
        return addon.getBestBid(this.treeId);
    }

    /**
     * Get best ask (lowest price with ask > 0) - O(log n) with Rust BTreeMap
     */
    public getBestAsk(): number {
        const askPrice = addon.getBestAsk(this.treeId);
        // Return 0 when no asks available (matching original behavior)
        return askPrice === Infinity ? 0 : askPrice;
    }

    /**
     * Get all nodes for iteration
     */
    public getAllNodes(): RBNode[] {
        const nodes = addon.getAllNodes(this.treeId);
        return nodes.map(
            (node: any) =>
                new RBNode(node.price, {
                    price: node.level.price,
                    bid: node.level.bid,
                    ask: node.level.ask,
                    timestamp: node.level.timestamp,
                    consumedAsk: node.level.consumed_ask ?? undefined,
                    consumedBid: node.level.consumed_bid ?? undefined,
                    addedAsk: node.level.added_ask ?? undefined,
                    addedBid: node.level.added_bid ?? undefined,
                })
        );
    }

    /**
     * Get tree size
     */
    public size(): number {
        return addon.size(this.treeId);
    }

    /**
     * Clear tree
     */
    public clear(): void {
        addon.clear(this.treeId);
    }
}

// Export the class with the same name for drop-in replacement
export { RedBlackTreeImpl as RedBlackTree };
