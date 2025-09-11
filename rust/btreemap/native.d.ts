// Type declarations for the Rust BTreeMap native addon

export interface PassiveLevel {
    price: number;
    bid: number;
    ask: number;
    timestamp: number;
    consumed_ask?: number;
    consumed_bid?: number;
    added_ask?: number;
    added_bid?: number;
}

export interface RBNode {
    price: number;
    level: PassiveLevel;
}

export interface BTreeMapAddon {
    createTree(id: string): string;
    insert(id: string, price: number, levelJson: string): void;
    set(id: string, price: number, side: string, quantity: number): void;
    delete(id: string, price: number): void;
    search(id: string, price: number): RBNode | null;
    get(id: string, price: number): PassiveLevel | null;
    getBestBid(id: string): number;
    getBestAsk(id: string): number;
    getAllNodes(id: string): RBNode[];
    size(id: string): number;
    clear(id: string): void;
}

declare const addon: BTreeMapAddon;
export default addon;
