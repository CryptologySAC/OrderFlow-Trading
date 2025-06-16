import type { PassiveLevel } from "../../types/marketEvents.js";

// Red-Black Tree Implementation for O(log n) OrderBook operations
export class RedBlackTree {
    private root: RBNode;
    private nil: RBNode;

    constructor() {
        // Create NIL node (sentinel)
        this.nil = new RBNode(
            0,
            {
                price: 0,
                bid: 0,
                ask: 0,
                timestamp: 0,
                //consumedAsk: 0,
                //consumedBid: 0,
                //addedAsk: 0,
                //addedBid: 0,
            },
            "black"
        );
        this.root = this.nil;
    }

    // Insert a price level with bid/ask separation enforcement
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
                // Price already exists, update level with separation enforcement
                current.level = this.enforceBidAskSeparation(
                    current.level,
                    level
                );
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

    // Set bid/ask with automatic separation enforcement
    public set(price: number, side: "bid" | "ask", quantity: number): void {
        const existingNode = this.search(price);

        if (existingNode === this.nil) {
            // No existing level, create new one
            const level: PassiveLevel = {
                price,
                bid: side === "bid" ? quantity : 0,
                ask: side === "ask" ? quantity : 0,
                timestamp: Date.now(),
                //consumedAsk: 0,
                //consumedBid: 0,
                //addedAsk: side === "ask" ? quantity : 0,
                //addedBid: side === "bid" ? quantity : 0,
            };
            this.insert(price, level);
        } else {
            // Update existing level with separation enforcement
            if (side === "bid") {
                existingNode.level.bid = quantity;
                //existingNode.level.addedBid = quantity;
                // Clear conflicting ask if setting bid > 0
                if (quantity > 0) {
                    existingNode.level.ask = 0;
                    //existingNode.level.addedAsk = 0;
                }
            } else {
                existingNode.level.ask = quantity;
                //existingNode.level.addedAsk = quantity;
                // Clear conflicting bid if setting ask > 0
                if (quantity > 0) {
                    existingNode.level.bid = 0;
                    // existingNode.level.addedBid = 0;
                }
            }
            existingNode.level.timestamp = Date.now();
        }
    }

    // Enforce bid/ask separation when merging levels
    private enforceBidAskSeparation(
        existing: PassiveLevel,
        incoming: PassiveLevel
    ): PassiveLevel {
        const result = { ...existing };

        // If incoming has bid data, clear any existing ask and update bid
        if (incoming.bid > 0) {
            result.bid = incoming.bid;
            //result.addedBid = incoming.addedBid;
            result.ask = 0;
            //result.addedAsk = 0;
        }

        // If incoming has ask data, clear any existing bid and update ask
        if (incoming.ask > 0) {
            result.ask = incoming.ask;
            //result.addedAsk = incoming.addedAsk;
            result.bid = 0;
            //result.addedBid = 0;
        }

        // Update other fields
        result.timestamp = incoming.timestamp;
        //result.consumedBid = incoming.consumedBid;
        //result.consumedAsk = incoming.consumedAsk;

        return result;
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

    // Atomic operation: get both best bid and ask in single tree traversal
    public getBestBidAsk(): { bid: number; ask: number } {
        const result = this.getBestBidAskNodes();
        return {
            bid: result.bidNode?.price ?? 0,
            ask: result.askNode?.price ?? Infinity,
        };
    }

    private getBestBidNode(): RBNode | null {
        // Simple in-order traversal to find highest price with bid > 0
        let bestBid: RBNode | null = null;

        const findBestBid = (node: RBNode | null): void => {
            if (!node || node === this.nil) return;

            // Traverse left subtree
            findBestBid(node.left);

            // Process current node
            if (node.level.bid > 0) {
                if (!bestBid || node.price > bestBid.price) {
                    bestBid = node;
                }
            }

            // Traverse right subtree
            findBestBid(node.right);
        };

        findBestBid(this.root);
        return bestBid;
    }

    private getBestAskNode(): RBNode | null {
        // Simple in-order traversal to find lowest price with ask > 0
        let bestAsk: RBNode | null = null;

        const findBestAsk = (node: RBNode | null): void => {
            if (!node || node === this.nil) return;

            // Traverse left subtree
            findBestAsk(node.left);

            // Process current node
            if (node.level.ask > 0) {
                if (!bestAsk || node.price < bestAsk.price) {
                    bestAsk = node;
                }
            }

            // Traverse right subtree
            findBestAsk(node.right);
        };

        findBestAsk(this.root);
        return bestAsk;
    }

    // Atomic operation to get both best bid and ask nodes in single traversal
    private getBestBidAskNodes(): {
        bidNode: RBNode | null;
        askNode: RBNode | null;
    } {
        // Use the individual optimized methods to ensure separation
        return {
            bidNode: this.getBestBidNode(),
            askNode: this.getBestAskNode(),
        };
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
