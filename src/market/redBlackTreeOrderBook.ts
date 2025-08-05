// src/market/redBlackTreeOrderBook.ts

import type { SpotWebsocketStreams } from "@binance/spot";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { PassiveLevel, OrderBookHealth } from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { ThreadManager } from "../multithreading/threadManager.js";
import { RedBlackTree } from "./helpers/redBlackTree.js";
import { FinancialMath } from "../utils/financialMath.js";
import {
    type IOrderBookState,
    type OrderBookStateOptions,
} from "./orderBookState.js";

type SnapShot = Map<number, PassiveLevel>;

/**
 * RedBlackTree-based OrderBook implementation for O(log n) performance
 * Maintains 100% compatibility with existing OrderBookState interface
 */
export class RedBlackTreeOrderBook implements IOrderBookState {
    private readonly tree: RedBlackTree;
    private readonly logger: ILogger;
    private readonly metricsCollector: IMetricsCollector;
    private readonly threadManager: ThreadManager;
    private readonly pricePrecision: number;
    private readonly tickSize: number;
    private readonly symbol: string;

    // Configuration options
    private readonly maxLevels: number;
    private readonly maxPriceDistance: number;
    private readonly pruneIntervalMs: number;
    private readonly maxErrorRate: number;
    private readonly staleThresholdMs: number;

    // State management
    private isInitialized = false;
    private snapshotBuffer: SpotWebsocketStreams.DiffBookDepthResponse[] = [];
    private lastUpdateId: number = 0;
    private lastUpdateTime = Date.now();

    // Pruning and maintenance
    private pruneTimer?: NodeJS.Timeout;

    // Circuit breaker state
    private errorCount = 0;
    private errorWindow: number[] = [];
    private errorWindowMs: number = 60000;
    private circuitOpen: boolean = false;
    private circuitOpenUntil: number = 0;

    // Stream connection awareness
    private isStreamConnected = true;
    private streamConnectionTime = Date.now();

    // Performance optimization: Cache tree size to avoid O(n) size() calls
    private cachedSize = 0;

    // Backtesting support
    private readonly disableSequenceValidation: boolean;

    constructor(
        options: OrderBookStateOptions,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        threadManager: ThreadManager
    ) {
        this.tree = new RedBlackTree();
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.threadManager = threadManager;

        this.pricePrecision = options.pricePrecision;
        this.tickSize = Math.pow(10, -this.pricePrecision);
        this.symbol = options.symbol;

        // Configuration with defaults
        this.maxLevels = options.maxLevels ?? 1000;
        this.maxPriceDistance = options.maxPriceDistance ?? 0.1; // 10%
        this.pruneIntervalMs = options.pruneIntervalMs ?? 30000; // 30 seconds
        this.maxErrorRate = options.maxErrorRate ?? 10;
        this.staleThresholdMs = options.staleThresholdMs ?? 300000; // 5 minutes
        this.disableSequenceValidation =
            options.disableSequenceValidation ?? false;

        // Start pruning timer
        this.startPruneTimer();

        this.logger.info("RedBlackTreeOrderBook initialized", {
            symbol: this.symbol,
            pricePrecision: this.pricePrecision,
            maxLevels: this.maxLevels,
            component: "RedBlackTreeOrderBook",
        });
    }

    /**
     * Update order book with depth changes
     * Core method that processes bid/ask updates using RedBlackTree
     */
    public updateDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        try {
            if (this.circuitOpen && Date.now() < this.circuitOpenUntil) {
                return; // Circuit breaker is open
            }

            if (!this.isInitialized) {
                this.snapshotBuffer.push(update);
                return;
            }

            // Validate update sequence - ignore outdated updates (skip in backtesting mode)
            if (!this.disableSequenceValidation) {
                if (
                    update.u &&
                    this.lastUpdateId &&
                    update.u <= this.lastUpdateId
                ) {
                    return; // Skip duplicate/out-of-date update
                }
                this.lastUpdateId = update.u ?? this.lastUpdateId;
            } else {
                // Backtesting mode: Accept all updates without sequence validation
                this.lastUpdateId = update.u ?? this.lastUpdateId;
            }

            const bids = (update.b as [string, string][]) || [];
            const asks = (update.a as [string, string][]) || [];

            // Process updates using RedBlackTree operations
            this.processBidsRedBlackTree(bids);
            this.processAsksRedBlackTree(asks);

            this.lastUpdateTime = Date.now();
            this.metricsCollector.incrementMetric("orderbookUpdatesProcessed");
        } catch (error) {
            this.handleError(
                error as Error,
                "RedBlackTreeOrderBook.updateDepth"
            );
        }
    }

    /**
     * Get level at specific price - O(log n) with RedBlackTree
     */
    public getLevel(price: number): PassiveLevel | undefined {
        const normalizedPrice = this.normalizePrice(price);
        return this.tree.get(normalizedPrice);
    }

    /**
     * Get best bid price - O(log n) with RedBlackTree vs O(n) with Map
     */
    public getBestBid(): number {
        return this.tree.getBestBid();
    }

    /**
     * Get best ask price - O(log n) with RedBlackTree vs O(n) with Map
     */
    public getBestAsk(): number {
        const askPrice = this.tree.getBestAsk();
        // Return 0 when no asks available (matching OrderBookState behavior)
        return askPrice === Infinity ? 0 : askPrice;
    }

    /**
     * Calculate spread using precise financial arithmetic
     */
    public getSpread(): number {
        const bestBid = this.tree.getBestBid();
        const bestAsk = this.tree.getBestAsk();

        if (bestBid === 0 || bestAsk === Infinity) return 0;

        // Use FinancialMath for exact calculation
        return FinancialMath.calculateSpread(
            bestAsk,
            bestBid,
            this.pricePrecision
        );
    }

    /**
     * Calculate mid price using precise financial arithmetic
     */
    public getMidPrice(): number {
        const quotes = this.tree.getBestBidAsk();
        const bestBid = quotes.bid;
        const bestAsk = quotes.ask;

        if (bestBid === 0 || bestAsk === Infinity) return 0;

        // Use FinancialMath for exact calculation
        return FinancialMath.calculateMidPrice(
            bestBid,
            bestAsk,
            this.pricePrecision
        );
    }

    /**
     * Sum band calculation optimized with RedBlackTree traversal
     * More efficient than iterating entire Map
     */
    public sumBand(
        center: number,
        bandTicks: number,
        tickSize: number
    ): { bid: number; ask: number; levels: number } {
        let sumBid = 0;
        let sumAsk = 0;
        let levels = 0;

        // Use integer arithmetic for financial precision
        const scale = Math.pow(10, this.pricePrecision || 8);
        const scaledCenter = Math.round(center * scale);
        const scaledTickSize = Math.round(tickSize * scale);
        const scaledBandSize = bandTicks * scaledTickSize;

        const min = (scaledCenter - scaledBandSize) / scale;
        const max = (scaledCenter + scaledBandSize) / scale;

        // Use RedBlackTree traversal for efficient range calculation
        const nodes = this.tree.getAllNodes();
        for (const node of nodes) {
            if (node.price >= min && node.price <= max) {
                sumBid += node.level.bid;
                sumAsk += node.level.ask;
                levels++;
            }
        }

        return { bid: sumBid, ask: sumAsk, levels };
    }

    /**
     * Create snapshot using RedBlackTree traversal
     */
    public snapshot(): SnapShot {
        const snap: SnapShot = new Map<number, PassiveLevel>();
        const nodes = this.tree.getAllNodes();

        for (const node of nodes) {
            snap.set(node.price, { ...node.level });
        }

        return snap;
    }

    /**
     * Get depth metrics using RedBlackTree efficiency
     */
    public getDepthMetrics(): {
        totalLevels: number;
        bidLevels: number;
        askLevels: number;
        totalBidVolume: number;
        totalAskVolume: number;
        imbalance: number;
    } {
        let bidLevels = 0;
        let askLevels = 0;
        let totalBidVolume = 0;
        let totalAskVolume = 0;

        const nodes = this.tree.getAllNodes();
        for (const node of nodes) {
            if (node.level.bid > 0) {
                bidLevels++;
                totalBidVolume += node.level.bid;
            }
            if (node.level.ask > 0) {
                askLevels++;
                totalAskVolume += node.level.ask;
            }
        }

        const totalVolume = totalBidVolume + totalAskVolume;
        const imbalance =
            totalVolume > 0
                ? (totalBidVolume - totalAskVolume) / totalVolume
                : 0;

        return {
            totalLevels: this.cachedSize,
            bidLevels,
            askLevels,
            totalBidVolume,
            totalAskVolume,
            imbalance,
        };
    }

    /**
     * Get orderbook health status
     */
    public getHealth(): OrderBookHealth {
        const bestBid = this.getBestBid();
        const bestAsk = this.getBestAsk();
        const spread = this.getSpread();
        const midPrice = this.getMidPrice();
        const metrics = this.getDepthMetrics();

        // Determine health status based on various factors
        let status: "healthy" | "degraded" | "unhealthy" = "healthy";

        if (this.circuitOpen) {
            status = "unhealthy";
        } else if (this.errorCount > this.maxErrorRate / 2) {
            status = "degraded";
        } else if (bestBid === 0 || bestAsk === 0) {
            status = "degraded";
        }

        return {
            status,
            initialized: this.isInitialized,
            lastUpdateMs: this.lastUpdateTime,
            circuitBreakerOpen: this.circuitOpen,
            errorRate: this.errorCount,
            bookSize: this.cachedSize,
            spread,
            midPrice,
            details: {
                bidLevels: metrics.bidLevels,
                askLevels: metrics.askLevels,
                totalBidVolume: metrics.totalBidVolume,
                totalAskVolume: metrics.totalAskVolume,
                staleLevels: 0, // TODO: Implement stale level tracking
                memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024,
            },
        };
    }

    /**
     * Shutdown cleanup
     */
    public shutdown(): void {
        if (this.pruneTimer) {
            clearInterval(this.pruneTimer);
            delete this.pruneTimer;
        }

        this.tree.clear();
        this.cachedSize = 0;

        this.logger.info("RedBlackTreeOrderBook shutdown complete", {
            symbol: this.symbol,
            component: "RedBlackTreeOrderBook",
        });
    }

    /**
     * Handle stream connection events
     */
    public onStreamConnected(): void {
        const wasConnected = this.isStreamConnected;
        this.isStreamConnected = true;
        this.streamConnectionTime = Date.now();

        if (!wasConnected) {
            this.logger.info(
                "RedBlackTreeOrderBook stream connection restored",
                {
                    symbol: this.symbol,
                    connectionTime: new Date(
                        this.streamConnectionTime
                    ).toISOString(),
                    component: "RedBlackTreeOrderBook",
                }
            );
        }
    }

    /**
     * Handle stream disconnection events
     */
    public onStreamDisconnected(reason?: string): void {
        const wasConnected = this.isStreamConnected;
        this.isStreamConnected = false;

        if (wasConnected) {
            this.logger.info(
                "RedBlackTreeOrderBook stream disconnected, adjusting health monitoring",
                {
                    symbol: this.symbol,
                    reason: reason || "unknown",
                    component: "RedBlackTreeOrderBook",
                }
            );
        }
    }

    /**
     * Recovery initialization
     */
    public async recover(): Promise<void> {
        try {
            this.logger.info("Starting RedBlackTreeOrderBook recovery", {
                symbol: this.symbol,
                component: "RedBlackTreeOrderBook",
                backtestingMode: this.disableSequenceValidation,
            });

            // Reset state
            this.tree.clear();
            this.cachedSize = 0;
            this.isInitialized = false;
            this.snapshotBuffer = [];

            // BACKTESTING SUPPORT: Skip live snapshot fetch when in backtesting mode
            if (this.disableSequenceValidation) {
                // Backtesting mode: Initialize empty order book that will be populated by simulated depth updates
                this.logger.info(
                    "Backtesting mode detected - initializing empty order book",
                    {
                        symbol: this.symbol,
                        component: "RedBlackTreeOrderBook",
                    }
                );
                this.isInitialized = true;
                this.lastUpdateTime = Date.now();
                this.lastUpdateId = 0; // Start from 0 for backtesting
            } else {
                // Production mode: Fetch initial snapshot from live market
                await this.fetchInitialOrderBook();

                // Process any buffered updates
                this.processBufferedUpdates();

                this.isInitialized = true;
                this.lastUpdateTime = Date.now();
            }

            this.logger.info("RedBlackTreeOrderBook recovery completed", {
                symbol: this.symbol,
                levels: this.cachedSize,
                component: "RedBlackTreeOrderBook",
                backtestingMode: this.disableSequenceValidation,
            });
        } catch (error) {
            this.handleError(error as Error, "RedBlackTreeOrderBook.recover");
            throw error;
        }
    }

    // Private helper methods

    private processBidsRedBlackTree(bids: [string, string][]): void {
        for (const [priceStr, qtyStr] of bids) {
            const price = this.normalizePrice(parseFloat(priceStr));
            const qty = parseFloat(qtyStr);

            if (qty === 0) {
                // Remove bid or clear bid side
                const existingLevel = this.tree.get(price);
                if (existingLevel) {
                    if (existingLevel.ask === 0) {
                        // Remove entire level if both sides are zero
                        this.tree.delete(price);
                        this.cachedSize--;
                    } else {
                        // Just clear bid side
                        this.tree.set(price, "bid", 0);
                    }
                }
            } else {
                // Set or update bid
                const existingLevel = this.tree.get(price);
                if (!existingLevel) {
                    this.cachedSize++;
                }
                this.tree.set(price, "bid", qty);
            }
        }
    }

    private processAsksRedBlackTree(asks: [string, string][]): void {
        for (const [priceStr, qtyStr] of asks) {
            const price = this.normalizePrice(parseFloat(priceStr));
            const qty = parseFloat(qtyStr);

            if (qty === 0) {
                // Remove ask or clear ask side
                const existingLevel = this.tree.get(price);
                if (existingLevel) {
                    if (existingLevel.bid === 0) {
                        // Remove entire level if both sides are zero
                        this.tree.delete(price);
                        this.cachedSize--;
                    } else {
                        // Just clear ask side
                        this.tree.set(price, "ask", 0);
                    }
                }
            } else {
                // Set or update ask
                const existingLevel = this.tree.get(price);
                if (!existingLevel) {
                    this.cachedSize++;
                }
                this.tree.set(price, "ask", qty);
            }
        }
    }

    private normalizePrice(price: number): number {
        // Use FinancialMath for precise tick normalization
        return FinancialMath.normalizePriceToTick(price, this.tickSize);
    }

    private startPruneTimer(): void {
        this.pruneTimer = setInterval(() => {
            this.performMaintenance();
        }, this.pruneIntervalMs);
    }

    private performMaintenance(): void {
        try {
            this.pruneStaleeLevels();
            this.pruneDistantLevels();
            this.pruneExcessLevels();
        } catch (error) {
            this.handleError(
                error as Error,
                "RedBlackTreeOrderBook.performMaintenance"
            );
        }
    }

    private pruneStaleeLevels(): void {
        const now = Date.now();
        const nodes = this.tree.getAllNodes();

        for (const node of nodes) {
            const level = node.level;
            if (
                now - level.timestamp > this.staleThresholdMs &&
                level.bid === 0 &&
                level.ask === 0
            ) {
                this.tree.delete(node.price);
                this.cachedSize--;
            }
        }
    }

    private pruneDistantLevels(): void {
        const mid = this.getMidPrice();
        if (!mid) return;

        const scale = Math.pow(10, this.pricePrecision);
        const scaledMid = Math.round(mid * scale);
        const scaledDistance = Math.round(this.maxPriceDistance * scale);

        const minPrice =
            (scaledMid * (scale - scaledDistance)) / (scale * scale);
        const maxPrice =
            (scaledMid * (scale + scaledDistance)) / (scale * scale);

        const nodes = this.tree.getAllNodes();
        for (const node of nodes) {
            if (node.price < minPrice || node.price > maxPrice) {
                this.tree.delete(node.price);
                this.cachedSize--;
            }
        }
    }

    private pruneExcessLevels(): void {
        if (this.cachedSize <= this.maxLevels) return;

        const nodes = this.tree.getAllNodes();
        const excessCount = this.cachedSize - this.maxLevels;

        // Remove levels with lowest volume first
        const sortedByVolume = nodes
            .map((node) => ({
                price: node.price,
                totalVolume: node.level.bid + node.level.ask,
            }))
            .sort((a, b) => a.totalVolume - b.totalVolume)
            .slice(0, excessCount);

        for (const { price } of sortedByVolume) {
            this.tree.delete(price);
            this.cachedSize--;
        }
    }

    private processBufferedUpdates(): void {
        if (this.snapshotBuffer.length === 0) return;

        for (const update of this.snapshotBuffer) {
            try {
                this.updateDepth(update);
            } catch (error) {
                this.handleError(
                    error as Error,
                    "RedBlackTreeOrderBook.processBufferedUpdates"
                );
            }
        }

        this.snapshotBuffer = [];
    }

    private async fetchInitialOrderBook(): Promise<void> {
        try {
            const snapshot = await this.threadManager.requestDepthSnapshot(
                this.symbol,
                1000
            );

            if (!snapshot?.lastUpdateId || !snapshot.bids || !snapshot.asks) {
                throw new Error("Failed to fetch order book snapshot");
            }

            // Initialize tree with snapshot data
            this.tree.clear();
            this.cachedSize = 0;

            // Process bids
            for (const [priceStr, qtyStr] of snapshot.bids) {
                const price = this.normalizePrice(parseFloat(priceStr));
                const qty = parseFloat(qtyStr);

                if (qty > 0) {
                    this.tree.set(price, "bid", qty);
                    this.cachedSize++;
                }
            }

            // Process asks
            for (const [priceStr, qtyStr] of snapshot.asks) {
                const price = this.normalizePrice(parseFloat(priceStr));
                const qty = parseFloat(qtyStr);

                if (qty > 0) {
                    const existingLevel = this.tree.get(price);
                    if (!existingLevel) {
                        this.cachedSize++;
                    }
                    this.tree.set(price, "ask", qty);
                }
            }

            this.lastUpdateId = snapshot.lastUpdateId;
            this.isInitialized = true;
        } catch (error) {
            throw new Error(
                `Failed to initialize order book: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private handleError(error: Error, context: string): void {
        this.errorCount++;
        this.errorWindow.push(Date.now());

        // Clean old errors from window
        const cutoff = Date.now() - this.errorWindowMs;
        this.errorWindow = this.errorWindow.filter((time) => time > cutoff);

        // Check if circuit breaker should open
        if (this.errorWindow.length > this.maxErrorRate) {
            this.circuitOpen = true;
            this.circuitOpenUntil = Date.now() + 60000; // 1 minute

            this.logger.error("Circuit breaker opened due to error rate", {
                context,
                errorCount: this.errorWindow.length,
                maxErrorRate: this.maxErrorRate,
                component: "RedBlackTreeOrderBook",
            });
        }

        this.logger.error("OrderBook error", {
            error: error.message,
            context,
            errorCount: this.errorCount,
            component: "RedBlackTreeOrderBook",
        });

        this.metricsCollector.incrementMetric("orderBookStateErrors");
    }
}
