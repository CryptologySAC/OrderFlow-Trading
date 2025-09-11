// Type definitions for Rust BTreeMap native addon
// This provides type safety for the Rust module exports

export interface RustBTreeMapAddon {
    createTree(treeId: string): void;
    insert(treeId: string, price: number, levelJson: string): void;
    set(
        treeId: string,
        price: number,
        side: "bid" | "ask",
        quantity: number
    ): void;
    delete(treeId: string, price: number): void;
    search(treeId: string, price: number): RustTreeNode | null;
    get(treeId: string, price: number): RustPassiveLevel | null;
    getBestBid(treeId: string): number;
    getBestAsk(treeId: string): number;
    getAllNodes(treeId: string): RustTreeNode[];
    size(treeId: string): number;
    clear(treeId: string): void;
}

export interface RustTreeNode {
    price: number;
    level: RustPassiveLevel;
}

export interface RustPassiveLevel {
    price: number;
    bid: number;
    ask: number;
    timestamp: string;
    consumed_ask: number | null;
    consumed_bid: number | null;
    added_ask: number | null;
    added_bid: number | null;
}

// Magic number constants
export const TREE_ID_RANDOM_SUFFIX_LENGTH = 9;
export const TREE_ID_TIMESTAMP_MULTIPLIER = 1000;
