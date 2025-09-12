// Native Rust BTreeMap implementation with FFI bindings
// Drop-in replacement for JavaScript Red-Black Tree with native performance

import { createRequire } from "module";
import type { PassiveLevel } from "../../types/marketEvents.js";

// Get the current module's directory for resolving the native binding

// Import the native Rust bindings using ES6 compatible require
const require = createRequire(import.meta.url);

// Type definitions for native Rust bindings
interface NativeBindings {
    create_order_book_btree(): unknown;
    btree_insert(tree: unknown, price: number, level: PassiveLevel): void;
    btree_set(
        tree: unknown,
        price: number,
        side: "bid" | "ask",
        quantity: number
    ): void;
    btree_delete(tree: unknown, price: number): void;
    btree_search(
        tree: unknown,
        price: number
    ): { price: number; level: PassiveLevel } | undefined;
    btree_get(tree: unknown, price: number): PassiveLevel | undefined;
    btree_get_best_bid(tree: unknown): number;
    btree_get_best_ask(tree: unknown): number;
    btree_get_best_bid_ask(tree: unknown): { bid: number; ask: number };
    btree_get_all_nodes(
        tree: unknown
    ): Array<{ price: number; level: PassiveLevel }>;
    btree_size(tree: unknown): number;
    btree_clear(tree: unknown): void;
}

let nativeBindings: NativeBindings | null;
try {
    // This path is correct: DO NOT CHANGE!
    nativeBindings =
        require("../../rust/target/release/index.node") as NativeBindings;
} catch (_error) {
    void _error;
    console.error(
        "Rust financial math bindings not available, falling back to JavaScript implementation"
    );
    nativeBindings = null;
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
 * High-performance Rust BTreeMap-based OrderBook implementation
 * Native performance with exact JavaScript API compatibility
 */
class RedBlackTree {
    private nativeTree: unknown;

    constructor() {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        this.nativeTree = nativeBindings.create_order_book_btree();
    }

    /**
     * Insert a price level with bid/ask separation enforcement
     */
    public insert(price: number, level: PassiveLevel): void {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        nativeBindings.btree_insert(this.nativeTree, price, level);
    }

    /**
     * Set bid/ask with automatic separation enforcement
     */
    public set(price: number, side: "bid" | "ask", quantity: number): void {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        nativeBindings.btree_set(this.nativeTree, price, side, quantity);
    }

    /**
     * Delete a price level
     */
    public delete(price: number): void {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        nativeBindings.btree_delete(this.nativeTree, price);
    }

    /**
     * Find a price level
     */
    public search(price: number): RBNode | undefined {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        const result = nativeBindings.btree_search(this.nativeTree, price);
        if (result !== undefined) {
            return new RBNode(result.price, result.level);
        }
        return undefined;
    }

    /**
     * Get price level
     */
    public get(price: number): PassiveLevel | undefined {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        return nativeBindings.btree_get(this.nativeTree, price);
    }

    /**
     * Get best bid (highest price with bid > 0) - O(log n)
     */
    public getBestBid(): number {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        return nativeBindings.btree_get_best_bid(this.nativeTree);
    }

    /**
     * Get best ask (lowest price with ask > 0) - O(log n)
     */
    public getBestAsk(): number {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        return nativeBindings.btree_get_best_ask(this.nativeTree);
    }

    /**
     * Atomic operation: get both best bid and ask in single tree traversal
     */
    public getBestBidAsk(): { bid: number; ask: number } {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        return nativeBindings.btree_get_best_bid_ask(this.nativeTree);
    }

    /**
     * Get all nodes for iteration
     */
    public getAllNodes(): RBNode[] {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        const nodes = nativeBindings.btree_get_all_nodes(this.nativeTree);
        return nodes.map(
            (node: { price: number; level: PassiveLevel }) =>
                new RBNode(node.price, node.level)
        );
    }

    /**
     * Get tree size
     */
    public size(): number {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        return nativeBindings.btree_size(this.nativeTree);
    }

    /**
     * Clear tree
     */
    public clear(): void {
        if (!nativeBindings) {
            throw new Error("Rust bindings not available");
        }
        nativeBindings.btree_clear(this.nativeTree);
    }
}

// Export the class with the same name for drop-in replacement
export { RedBlackTree };
