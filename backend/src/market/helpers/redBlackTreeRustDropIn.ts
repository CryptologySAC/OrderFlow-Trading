// Drop-in replacement for redBlackTreeRust.ts using native Rust red-black tree
// This maintains the exact same API while providing massive performance improvements
import type { PassiveLevel } from "../../types/marketEvents.js";

// Synchronous ES module import - professional standard like README
// If addon is not available, this will throw at import time (correct behavior)
import addon from "../../../../rust/btreemap";

// Type definitions for the Rust BTreeMap native addon
interface RustPassiveLevel {
    price: number;
    bid: number;
    ask: number;
    timestamp: number;
    consumed_ask?: number;
    consumed_bid?: number;
    added_ask?: number;
    added_bid?: number;
}

interface RustRBNode {
    price: number;
    level: RustPassiveLevel;
}

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
        const RANDOM_SUFFIX_LENGTH = 9;
        const BASE36_RADIX = 36;
        this.treeId = `tree_${Date.now()}_${Math.random().toString(BASE36_RADIX).substring(2, RANDOM_SUFFIX_LENGTH)}`;
        if (addon !== null) {
            addon.createTree(this.treeId);
        }
    }

    /**
     * Insert a price level with bid/ask separation enforcement
     */
    public insert(price: number, level: PassiveLevel): void {
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
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
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
        addon.set(this.treeId, price, side, quantity);
    }

    /**
     * Delete a price level
     */
    public delete(price: number): void {
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
        addon.delete(this.treeId, price);
    }

    /**
     * Find a price level
     */
    public search(price: number): RBNode | undefined {
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
        const result = addon.search(this.treeId, price);
        if (result) {
            const level = {
                price: result.level.price,
                bid: result.level.bid,
                ask: result.level.ask,
                timestamp: result.level.timestamp,
                ...(result.level.consumed_ask
                    ? { consumedAsk: result.level.consumed_ask }
                    : {}),
                ...(result.level.consumed_bid
                    ? { consumedBid: result.level.consumed_bid }
                    : {}),
                ...(result.level.added_ask
                    ? { addedAsk: result.level.added_ask }
                    : {}),
                ...(result.level.added_bid
                    ? { addedBid: result.level.added_bid }
                    : {}),
            } as PassiveLevel;
            return new RBNode(result.price, level);
        }
        return undefined;
    }

    /**
     * Get price level
     */
    public get(price: number): PassiveLevel | undefined {
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
        const result = addon.get(this.treeId, price);
        if (result) {
            return {
                price: result.price,
                bid: result.bid,
                ask: result.ask,
                timestamp: result.timestamp,
                ...(result.consumed_ask
                    ? { consumedAsk: result.consumed_ask }
                    : {}),
                ...(result.consumed_bid
                    ? { consumedBid: result.consumed_bid }
                    : {}),
                ...(result.added_ask ? { addedAsk: result.added_ask } : {}),
                ...(result.added_bid ? { addedBid: result.added_bid } : {}),
            } as PassiveLevel;
        }
        return undefined;
    }

    /**
     * Get best bid (highest price with bid > 0) - O(log n) with Rust BTreeMap
     */
    public getBestBid(): number {
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
        return addon.getBestBid(this.treeId);
    }

    /**
     * Get best ask (lowest price with ask > 0) - O(log n) with Rust BTreeMap
     */
    public getBestAsk(): number {
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
        const askPrice = addon.getBestAsk(this.treeId);
        // Return 0 when no asks available (matching original behavior)
        return askPrice === Infinity ? 0 : askPrice;
    }

    /**
     * Get all nodes for iteration
     */
    public getAllNodes(): RBNode[] {
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
        const nodes = addon.getAllNodes(this.treeId);
        return nodes.map(
            (node: RustRBNode) =>
                new RBNode(node.price, {
                    price: node.level.price,
                    bid: node.level.bid,
                    ask: node.level.ask,
                    timestamp: node.level.timestamp,
                    ...(node.level.consumed_ask
                        ? { consumedAsk: node.level.consumed_ask }
                        : {}),
                    ...(node.level.consumed_bid
                        ? { consumedBid: node.level.consumed_bid }
                        : {}),
                    ...(node.level.added_ask
                        ? { addedAsk: node.level.added_ask }
                        : {}),
                    ...(node.level.added_bid
                        ? { addedBid: node.level.added_bid }
                        : {}),
                } as PassiveLevel)
        );
    }

    /**
     * Clear tree
     */
    public clear(): void {
        if (addon === null) {
            throw new Error("Rust BTreeMap bindings not available");
        }
        addon.clear(this.treeId);
    }
}

// Export the class with the same name for drop-in replacement
export { RedBlackTreeImpl as RedBlackTree };
