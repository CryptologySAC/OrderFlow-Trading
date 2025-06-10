import type { PassiveLevel } from "../../types/marketEvents.js";

// Red-Black Tree Implementation for O(log n) OrderBook operations
export class RedBlackTree {
    private root: RBNode;
    private nil: RBNode;

    constructor() {
        // Create NIL node (sentinel)
        this.nil = new RBNode(
            0,
            { price: 0, bid: 0, ask: 0, timestamp: 0 },
            "black"
        );
        this.root = this.nil;
    }

    // Insert a price level
    public insert(price: number, level: PassiveLevel): void {
        const newNode = new RBNode(price, level);
        newNode.left = this.nil;
        newNode.right = this.nil;

        let parent = null;
        let current = this.root;

        // Find position for new node
        while (current !== this.nil && current) {
            parent = current;
            if (price < current.price) {
                current = current.left;
            } else if (price > current.price) {
                current = current.right;
            } else {
                // Price already exists, update level
                current.level = level;
                return;
            }
        }

        newNode.parent = parent;
        if (parent === null) {
            this.root = newNode;
        } else if (price < parent.price) {
            parent.left = newNode;
        } else {
            parent.right = newNode;
        }

        // Fix Red-Black Tree properties
        this.insertFixup(newNode);
    }

    // Delete a price level
    public delete(price: number): void {
        const nodeToDelete = this.search(price);
        if (nodeToDelete === this.nil) return;

        let y = nodeToDelete;
        let yOriginalColor = y.color;
        let x: RBNode;

        if (nodeToDelete.left === this.nil) {
            x = nodeToDelete.right;
            this.transplant(nodeToDelete, nodeToDelete.right);
        } else if (nodeToDelete.right === this.nil) {
            x = nodeToDelete.left;
            this.transplant(nodeToDelete, nodeToDelete.left);
        } else {
            y = this.minimum(nodeToDelete.right);
            yOriginalColor = y.color;
            x = y.right;

            if (y.parent === nodeToDelete) {
                x.parent = y;
            } else {
                this.transplant(y, y.right);
                y.right = nodeToDelete.right;
                y.right.parent = y;
            }

            this.transplant(nodeToDelete, y);
            y.left = nodeToDelete.left;
            y.left.parent = y;
            y.color = nodeToDelete.color;
        }

        if (yOriginalColor === "black") {
            this.deleteFixup(x);
        }
    }

    // Find a price level
    public search(price: number): RBNode {
        let current = this.root;
        while (current !== this.nil && current && price !== current.price) {
            if (price < current.price) {
                current = current.left;
            } else {
                current = current.right;
            }
        }
        return current || this.nil;
    }

    // Get price level
    public get(price: number): PassiveLevel | undefined {
        const node = this.search(price);
        return node === this.nil ? undefined : node.level;
    }

    // Get best bid (highest price with bid > 0) - O(log n)
    public getBestBid(): number {
        return this.getBestBidNode()?.price ?? 0;
    }

    // Get best ask (lowest price with ask > 0) - O(log n)
    public getBestAsk(): number {
        const askPrice = this.getBestAskNode()?.price;
        return askPrice === undefined ? Infinity : askPrice;
    }

    private getBestBidNode(): RBNode | null {
        let bestBid: RBNode | null = null;
        let current = this.root;

        while (current !== this.nil) {
            if (current.level.bid > 0) {
                if (!bestBid || current.price > bestBid.price) {
                    bestBid = current;
                }
                // Continue searching right for higher prices
                current = current.right;
            } else {
                // No bid at this level, search both sides
                const leftBest = this.searchBestBidInSubtree(current.left);
                const rightBest = this.searchBestBidInSubtree(current.right);

                if (leftBest && (!bestBid || leftBest.price > bestBid.price)) {
                    bestBid = leftBest;
                }
                if (
                    rightBest &&
                    (!bestBid || rightBest.price > bestBid.price)
                ) {
                    bestBid = rightBest;
                }
                break;
            }
        }

        return bestBid;
    }

    private getBestAskNode(): RBNode | null {
        let bestAsk: RBNode | null = null;
        let current = this.root;

        while (current !== this.nil) {
            if (current.level.ask > 0) {
                if (!bestAsk || current.price < bestAsk.price) {
                    bestAsk = current;
                }
                // Continue searching left for lower prices
                current = current.left;
            } else {
                // No ask at this level, search both sides
                const leftBest = this.searchBestAskInSubtree(current.left);
                const rightBest = this.searchBestAskInSubtree(current.right);

                if (leftBest && (!bestAsk || leftBest.price < bestAsk.price)) {
                    bestAsk = leftBest;
                }
                if (
                    rightBest &&
                    (!bestAsk || rightBest.price < bestAsk.price)
                ) {
                    bestAsk = rightBest;
                }
                break;
            }
        }

        return bestAsk;
    }

    private searchBestBidInSubtree(node: RBNode | null): RBNode | null {
        if (!node || node === this.nil) return null;

        let bestBid: RBNode | null = null;

        if (node.level.bid > 0) {
            bestBid = node;
        }

        const leftBest = this.searchBestBidInSubtree(node.left);
        const rightBest = this.searchBestBidInSubtree(node.right);

        if (leftBest && (!bestBid || leftBest.price > bestBid.price)) {
            bestBid = leftBest;
        }
        if (rightBest && (!bestBid || rightBest.price > bestBid.price)) {
            bestBid = rightBest;
        }

        return bestBid;
    }

    private searchBestAskInSubtree(node: RBNode | null): RBNode | null {
        if (!node || node === this.nil) return null;

        let bestAsk: RBNode | null = null;

        if (node.level.ask > 0) {
            bestAsk = node;
        }

        const leftBest = this.searchBestAskInSubtree(node.left);
        const rightBest = this.searchBestAskInSubtree(node.right);

        if (leftBest && (!bestAsk || leftBest.price < bestAsk.price)) {
            bestAsk = leftBest;
        }
        if (rightBest && (!bestAsk || rightBest.price < bestAsk.price)) {
            bestAsk = rightBest;
        }

        return bestAsk;
    }

    // Get all nodes for iteration
    public getAllNodes(): RBNode[] {
        const nodes: RBNode[] = [];
        this.inorderTraversal(this.root, nodes);
        return nodes;
    }

    // Get tree size
    public size(): number {
        return this.getSizeRecursive(this.root);
    }

    private getSizeRecursive(node: RBNode | null): number {
        if (!node || node === this.nil) return 0;
        return (
            1 +
            this.getSizeRecursive(node.left) +
            this.getSizeRecursive(node.right)
        );
    }

    // Clear tree
    public clear(): void {
        this.root = this.nil;
    }

    // Helper methods
    private minimum(node: RBNode): RBNode {
        while (node.left !== this.nil) {
            node = node.left;
        }
        return node;
    }

    private inorderTraversal(node: RBNode | null, result: RBNode[]): void {
        if (!node || node === this.nil) return;
        this.inorderTraversal(node.left, result);
        result.push(node);
        this.inorderTraversal(node.right, result);
    }

    private transplant(u: RBNode, v: RBNode): void {
        if (u.parent === null) {
            this.root = v;
        } else if (u === u.parent.left) {
            u.parent.left = v;
        } else {
            u.parent.right = v;
        }
        v.parent = u.parent;
    }

    private leftRotate(x: RBNode): void {
        const y = x.right;
        x.right = y.left;

        if (y.left !== this.nil) {
            y.left.parent = x;
        }

        y.parent = x.parent;

        if (x.parent === null) {
            this.root = y;
        } else if (x === x.parent.left) {
            x.parent.left = y;
        } else {
            x.parent.right = y;
        }

        y.left = x;
        x.parent = y;
    }

    private rightRotate(x: RBNode): void {
        const y = x.left;
        x.left = y.right;

        if (y.right !== this.nil) {
            y.right.parent = x;
        }

        y.parent = x.parent;

        if (x.parent === null) {
            this.root = y;
        } else if (x === x.parent.right) {
            x.parent.right = y;
        } else {
            x.parent.left = y;
        }

        y.right = x;
        x.parent = y;
    }

    private insertFixup(z: RBNode): void {
        while (z.parent?.color === "red") {
            if (z.parent === z.parent.parent?.left) {
                const y = z.parent.parent.right;
                if (y?.color === "red") {
                    z.parent.color = "black";
                    y.color = "black";
                    z.parent.parent.color = "red";
                    z = z.parent.parent;
                } else {
                    if (z === z.parent.right) {
                        z = z.parent;
                        this.leftRotate(z);
                    }
                    z.parent!.color = "black";
                    z.parent!.parent.color = "red";
                    this.rightRotate(z.parent!.parent);
                }
            } else {
                const y = z.parent.parent?.left;
                if (y?.color === "red") {
                    z.parent.color = "black";
                    y.color = "black";
                    z.parent.parent!.color = "red";
                    z = z.parent.parent!;
                } else {
                    if (z === z.parent.left) {
                        z = z.parent;
                        this.rightRotate(z);
                    }
                    z.parent!.color = "black";
                    z.parent!.parent!.color = "red";
                    this.leftRotate(z.parent!.parent!);
                }
            }
        }
        this.root.color = "black";
    }

    private deleteFixup(x: RBNode): void {
        while (x !== this.root && x.color === "black") {
            if (x === x.parent?.left) {
                let w = x.parent.right;
                if (w.color === "red") {
                    w.color = "black";
                    x.parent.color = "red";
                    this.leftRotate(x.parent);
                    w = x.parent.right!;
                }
                if (w.left.color === "black" && w.right.color === "black") {
                    w.color = "red";
                    x = x.parent;
                } else {
                    if (w.right.color === "black") {
                        w.left.color = "black";
                        w.color = "red";
                        this.rightRotate(w);
                        w = x.parent.right!;
                    }
                    w.color = x.parent.color;
                    x.parent.color = "black";
                    w.right.color = "black";
                    this.leftRotate(x.parent);
                    x = this.root!;
                }
            } else {
                let w = x.parent!.left;
                if (w.color === "red") {
                    w.color = "black";
                    x.parent!.color = "red";
                    this.rightRotate(x.parent!);
                    w = x.parent!.left!;
                }
                if (w.right.color === "black" && w.left.color === "black") {
                    w.color = "red";
                    x = x.parent!;
                } else {
                    if (w.left.color === "black") {
                        w.right.color = "black";
                        w.color = "red";
                        this.leftRotate(w);
                        w = x.parent!.left!;
                    }
                    w.color = x.parent!.color;
                    x.parent!.color = "black";
                    w.left.color = "black";
                    this.rightRotate(x.parent!);
                    x = this.root!;
                }
            }
        }
        x.color = "black";
    }
}

// --- RBNode helper ----------------------------------------------------------
type Color = "red" | "black";

class RBNode {
    price: number;
    level: PassiveLevel;
    color: Color;
    left: RBNode;
    right: RBNode;
    parent: RBNode | null;

    constructor(
        price: number,
        level: PassiveLevel,
        color: Color = "red",
        nil?: RBNode // pass the sentinel so we can point to it immediately
    ) {
        this.price = price;
        this.level = level;
        this.color = color;
        // during construction we don’t yet know the real children;
        // if `nil` is supplied we hook both sides to it, otherwise
        // they’ll be patched by the tree logic.
        this.left = nil ?? (this as unknown as RBNode);
        this.right = nil ?? (this as unknown as RBNode);
        this.parent = null;
    }
}
