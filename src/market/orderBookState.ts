// src/market/orderBookState.ts
import { Mutex } from "async-mutex";
import type { SpotWebsocketStreams } from "@binance/spot";
import { type IBinanceDataFeed } from "../utils/binance.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { PassiveLevel, OrderBookHealth } from "../types/marketEvents.js";
import { ILogger } from "../infrastructure/loggerInterface.js";
import { FinancialMath } from "../utils/financialMath.js";
import { RedBlackTree } from "./helpers/redBlackTree.js";

type SnapShot = Map<number, PassiveLevel>;

export interface OrderBookStateOptions {
    pricePrecision: number;
    symbol: string; // Default symbol
    maxLevels?: number;
    maxPriceDistance?: number; // Percentage distance from mid price
    pruneIntervalMs?: number; // Interval for pruning distant levels
    maxErrorRate?: number; // Max errors per minute before circuit opens
    staleThresholdMs?: number; // Threshold for stale levels
}

export interface IOrderBookState {
    updateDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): Promise<void>;
    getLevel(price: number): PassiveLevel | undefined;
    getBestBid(): number;
    getBestAsk(): number;
    getSpread(): number;
    getMidPrice(): number;
    sumBand(
        center: number,
        bandTicks: number,
        tickSize: number
    ): { bid: number; ask: number; levels: number };
    snapshot(): SnapShot;
    getDepthMetrics(): {
        totalLevels: number;
        bidLevels: number;
        askLevels: number;
        totalBidVolume: number;
        totalAskVolume: number;
        imbalance: number;
    };
    shutdown(): Promise<void>;
    recover(): Promise<void>;
    getHealth(): OrderBookHealth;
}

export class OrderBookState implements IOrderBookState {
    private readonly logger: ILogger;
    private readonly metricsCollector: IMetricsCollector;

    private isInitialized = false;
    private readonly binanceFeed: IBinanceDataFeed;
    private snapshotBuffer: SpotWebsocketStreams.DiffBookDepthResponse[] = [];
    private expectedUpdateId?: number;

    private pruneIntervalMs = 30000; // 30 seconds
    private pruneTimer?: NodeJS.Timeout;
    private lastPruneTime = 0;
    protected lastUpdateTime = Date.now();

    // Stream connection awareness for health monitoring
    private isStreamConnected = true; // Assume connected initially
    private streamConnectionTime = Date.now();

    private maxLevels: number = 1000;
    private maxPriceDistance: number = 0.1; // 10% max price distance for levels

    protected book: RedBlackTree = new RedBlackTree();

    // Optimized price tracking for O(1) best quote access
    private bidPrices: number[] = [];
    private askPrices: number[] = [];
    private readonly pricePrecision: number;
    private readonly tickSize: number;
    private readonly symbol: string;

    // Track best quotes for efficiency
    private _bestBid: number = 0;
    private _bestAsk: number = Infinity;
    private lastUpdateId: number = 0;

    // Circuitbreaker
    private errorCount = 0;
    private errorWindow: number[] = [];
    private maxErrorRate: number = 10; // errors per minute
    private errorWindowMs: number = 60000;
    private circuitOpen: boolean = false;
    private circuitOpenUntil: number = 0;

    // Mutex
    private readonly quoteMutex = new Mutex();
    private pendingQuoteUpdate: { bid: number; ask: number } | null = null;

    constructor(
        options: OrderBookStateOptions,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        binanceFeed: IBinanceDataFeed,
        private threadManager?: import("../multithreading/threadManager.js").ThreadManager
    ) {
        this.pricePrecision = options.pricePrecision;
        this.tickSize = Math.pow(10, -this.pricePrecision);
        this.symbol = options.symbol;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.binanceFeed = binanceFeed;
        this.maxLevels = options.maxLevels ?? this.maxLevels;
        this.maxPriceDistance =
            options.maxPriceDistance ?? this.maxPriceDistance;
        this.pruneIntervalMs = options.pruneIntervalMs ?? this.pruneIntervalMs;
        this.maxErrorRate = options.maxErrorRate ?? this.maxErrorRate;
        this.startPruning();
        setInterval(() => this.connectionHealthCheck(), 10000);

        this.logger.info(
            "[OrderBookState] Stream-aware health monitoring initialized",
            {
                symbol: this.symbol,
                initialConnectionStatus: this.isStreamConnected,
            }
        );
    }

    public static async create(
        options: OrderBookStateOptions,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        binanceFeed: IBinanceDataFeed,
        threadManager?: import("../multithreading/threadManager.js").ThreadManager
    ): Promise<OrderBookState> {
        const instance = new OrderBookState(
            options,
            logger,
            metricsCollector,
            binanceFeed,
            threadManager
        );
        await instance.initialize();
        return instance;
    }

    private async initialize(): Promise<void> {
        // Need to fetch initial orderbook snapshot from REST API
        await this.fetchInitialOrderBook();
        this.isInitialized = true;

        // Process any buffered updates
        this.processBufferedUpdates();
    }

    public async updateDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): Promise<void> {
        if (this.circuitOpen && Date.now() < this.circuitOpenUntil) {
            this.metricsCollector.incrementMetric("orderbookCircuitRejected");
            return;
        }

        if (this.expectedUpdateId && update.U) {
            const gap = update.U - this.expectedUpdateId;
            if (gap > 1) {
                throw new Error(
                    `Sequence gap detected: expected ${this.expectedUpdateId}, got ${update.U}`
                );
            }
        }
        this.expectedUpdateId = update.u ? update.u + 1 : undefined;

        if (!this.isInitialized) {
            this.snapshotBuffer.push(update);
            return;
        }

        if (update.u && this.lastUpdateId && update.u <= this.lastUpdateId) {
            return;
        }
        this.lastUpdateId = update.u ?? this.lastUpdateId;

        const bids = (update.b as [string, string][]) || [];
        const asks = (update.a as [string, string][]) || [];

        // 🔒 ATOMIC UPDATE: Process all changes and update quotes atomically
        await this.processUpdateAtomic(bids, asks);

        this.lastUpdateTime = Date.now();
    }

    private async processUpdateAtomic(
        bids: [string, string][],
        asks: [string, string][]
    ): Promise<void> {
        const release = await this.quoteMutex.acquire();

        try {
            // Track if best quotes might have changed
            let needsBestRecalc = false;

            // Process bids
            needsBestRecalc = this.processBidsSync(bids, needsBestRecalc);

            // Process asks
            needsBestRecalc =
                this.processAsksSync(asks, needsBestRecalc) || needsBestRecalc;

            // Recalculate best quotes if needed
            if (needsBestRecalc) {
                this.recalculateBestQuotes();
            }

            /* ── Consistency check AFTER the recalculation ───────────── */
            if (this._bestBid > this._bestAsk && this._bestAsk !== Infinity) {
                this.logger.warn(
                    "[OrderBookState] Quote inversion detected **after** recalc",
                    { bestBid: this._bestBid, bestAsk: this._bestAsk }
                );
                // One more full scan just in case something slipped through
                this.recalculateBestQuotes();
            }
        } finally {
            release();
        }
    }

    // Updated orderBookState.ts methods
    protected normalizePrice(price: number): number {
        return FinancialMath.normalizePriceToTick(price, this.tickSize);
    }

    public getLevel(price: number): PassiveLevel | undefined {
        return this.book.get(this.normalizePrice(price));
    }

    public getBestBid(): number {
        return this._bestBid;
    }

    public getBestAsk(): number {
        return this._bestAsk === Infinity ? 0 : this._bestAsk;
    }

    public getSpread(): number {
        if (this._bestBid === 0 || this._bestAsk === Infinity) return 0;
        return this._bestAsk - this._bestBid;
    }

    public getMidPrice(): number {
        if (this._bestBid === 0 || this._bestAsk === Infinity) return 0;
        return FinancialMath.calculateMidPrice(
            this._bestBid,
            this._bestAsk,
            this.pricePrecision
        );
    }

    public getBestQuotesAtomic(): {
        bid: number;
        ask: number;
        timestamp: number;
    } {
        // Thread-safe access to both quotes
        return {
            bid: this._bestBid,
            ask: this._bestAsk === Infinity ? 0 : this._bestAsk,
            timestamp: this.lastUpdateTime,
        };
    }

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

        // Iterate through Red-Black Tree nodes
        const nodes = this.book.getAllNodes();
        for (const node of nodes) {
            const price = node.price;
            const lvl = node.level;
            if (price >= min && price <= max) {
                sumBid += lvl.bid;
                sumAsk += lvl.ask;
                levels++;
            }
        }

        return { bid: sumBid, ask: sumAsk, levels };
    }

    public snapshot(): SnapShot {
        // Deep clone for thread safety
        const snap: SnapShot = new Map<number, PassiveLevel>();
        const nodes = this.book.getAllNodes();
        for (const node of nodes) {
            snap.set(node.price, { ...node.level });
        }
        return snap;
    }

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

        const nodes = this.book.getAllNodes();
        for (const node of nodes) {
            const level = node.level;
            if (level.bid > 0) {
                bidLevels++;
                totalBidVolume += level.bid;
            }
            if (level.ask > 0) {
                askLevels++;
                totalAskVolume += level.ask;
            }
        }

        const totalVolume = totalBidVolume + totalAskVolume;
        const imbalance =
            totalVolume > 0
                ? (totalBidVolume - totalAskVolume) / totalVolume
                : 0;

        return {
            totalLevels: this.book.size(),
            bidLevels,
            askLevels,
            totalBidVolume,
            totalAskVolume,
            imbalance,
        };
    }

    private startPruning(): void {
        this.pruneTimer = setInterval(() => {
            this.performMaintenance();
        }, this.pruneIntervalMs);
    }

    private performMaintenance(): void {
        const startTime = Date.now();

        try {
            // Prune distant levels
            const beforeSize = this.book.size();
            this.pruneDistantLevels();
            const afterSize = this.book.size();

            // Prune stale levels
            this.pruneStaleLevels();

            // Enforce max levels
            this.enforceMaxLevels();

            const duration = Date.now() - startTime;
            this.lastPruneTime = Date.now();

            this.metricsCollector.updateMetric(
                "orderbookPruneDuration",
                duration
            );
            this.metricsCollector.updateMetric(
                "orderbookPruneRemoved",
                beforeSize - afterSize
            );

            if (afterSize > this.maxLevels * 0.8) {
                this.logger.warn(
                    "[OrderBookState] Book size approaching limit",
                    {
                        size: afterSize,
                        maxLevels: this.maxLevels,
                    }
                );
            }

            for (const node of this.book.getAllNodes()) {
                const lvl = node.level;
                lvl.consumedBid = lvl.consumedAsk = 0;
                lvl.addedBid = lvl.addedAsk = 0;
            }
        } catch (error) {
            this.handleError(
                error as Error,
                "OrderBookState.performMaintenance"
            );
        }
    }

    private enforceMaxLevels(): void {
        if (this.book.size() <= this.maxLevels) return;

        const mid = this.getMidPrice();
        if (!mid) return;

        // Sort levels by distance from mid
        const nodes = this.book.getAllNodes();
        const levels = nodes
            .map((node) => ({
                price: node.price,
                level: node.level,
                distance: Math.abs(node.price - mid),
            }))
            .sort((a, b) => b.distance - a.distance);

        // Remove furthest levels
        const toRemove = levels.slice(this.maxLevels);
        for (const { price } of toRemove) {
            this.book.delete(price);
        }
    }

    private pruneStaleLevels(): void {
        const now = Date.now();
        const staleThreshold = 300000; // 5 minutes

        const nodes = this.book.getAllNodes();
        for (const node of nodes) {
            const level = node.level;
            if (
                now - level.timestamp > staleThreshold &&
                level.bid === 0 &&
                level.ask === 0
            ) {
                this.book.delete(node.price);
            }
        }
    }

    private processBufferedUpdates(): void {
        if (this.snapshotBuffer.length === 0) return;

        for (const update of this.snapshotBuffer) {
            try {
                if (
                    update.u &&
                    this.lastUpdateId &&
                    update.u <= this.lastUpdateId
                ) {
                    // Skip duplicate/out-of-date update
                    continue;
                }
                this.lastUpdateId = update.u ?? this.lastUpdateId;

                const bids = (update.b as [string, string][]) || [];
                const asks = (update.a as [string, string][]) || [];

                // Track if we need to recalculate best bid/ask
                let needsBestRecalc = false;

                // Process bids and track recalculation flag
                needsBestRecalc = this.processBidsSync(bids, needsBestRecalc);

                // Process asks and accumulate
                needsBestRecalc =
                    this.processAsksSync(asks, needsBestRecalc) ||
                    needsBestRecalc;

                // Recalculate best bid/ask if needed
                if (needsBestRecalc) {
                    this.recalculateBestQuotes();
                }
            } catch (error) {
                this.handleError(
                    error as Error,
                    "OrderBookState.processBufferedUpdates"
                );
            }
        }
        this.snapshotBuffer = []; // Clear buffer after processing
    }

    private processBidsSync(
        bids: [string, string][],
        needsBestRecalc: boolean
    ): boolean {
        const now = Date.now();

        for (const [priceStr, qtyStr] of bids) {
            const price = this.normalizePrice(parseFloat(priceStr));
            const qty = parseFloat(qtyStr);

            if (qty === 0) {
                const level = this.book.get(price);
                if (level) {
                    level.bid = 0;
                    level.timestamp = now;

                    /* NEW — when bid goes to 0, also wipe the ask *flag* at that price */
                    if (level.bid === 0 && level.ask === 0) {
                        this.book.delete(price);
                    } else {
                        this.book.insert(price, level);
                    }
                }
                if (price === this._bestBid) needsBestRecalc = true;
            } else {
                const level = this.book.get(price) || {
                    price,
                    bid: 0,
                    ask: 0,
                    timestamp: now,
                    consumedAsk: 0,
                    consumedBid: 0,
                    addedAsk: 0,
                    addedBid: 0,
                };
                level.bid = qty;
                level.timestamp = now;
                this.book.insert(price, level);

                const delta = qty - level.bid;
                if (delta > 0) {
                    level.addedBid = (level.addedBid ?? 0) + delta; // accumulation
                }

                // Update best bid only if better
                if (price > this._bestBid) {
                    this._bestBid = price;
                }
            }
        }
        return needsBestRecalc;
    }

    private processAsksSync(
        asks: [string, string][],
        needsBestRecalc: boolean
    ): boolean {
        const now = Date.now();

        for (const [priceStr, qtyStr] of asks) {
            const price = this.normalizePrice(parseFloat(priceStr));
            const qty = parseFloat(qtyStr);

            if (qty === 0) {
                const level = this.book.get(price);
                if (level) {
                    level.ask = 0;
                    level.timestamp = now;

                    /* NEW — when ask goes to 0, also wipe the bid *flag* at that price */
                    if (level.bid === 0 && level.ask === 0) {
                        this.book.delete(price);
                    } else {
                        this.book.insert(price, level);
                    }
                }
                if (price === this._bestAsk) needsBestRecalc = true;
            } else {
                const level = this.book.get(price) || {
                    price,
                    bid: 0,
                    ask: 0,
                    timestamp: now,
                    consumedAsk: 0,
                    consumedBid: 0,
                    addedAsk: 0,
                    addedBid: 0,
                };
                level.ask = qty;
                level.timestamp = now;
                this.book.insert(price, level);

                const delta = qty - level.bid;
                if (delta > 0) {
                    level.addedAsk = (level.addedAsk ?? 0) + delta; // accumulation
                }

                // Update best ask only if better
                if (price < this._bestAsk) {
                    this._bestAsk = price;
                }
            }
        }
        return needsBestRecalc;
    }

    private recalculateBestQuotes(): void {
        // Use Red-Black Tree optimized lookups - O(log n)
        this._bestBid = this.book.getBestBid();
        this._bestAsk = this.book.getBestAsk();

        this.purgeCrossedLevels();
    }

    public registerTradeImpact(
        price: number,
        qty: number,
        side: "buy" | "sell"
    ): void {
        const level = this.book.get(price);
        if (!level) return;

        if (side === "buy") {
            // buy = hits the ASK
            level.ask = Math.max(0, level.ask - qty);
            level.consumedAsk = (level.consumedAsk ?? 0) + qty;
        } else {
            // sell = hits the BID
            level.bid = Math.max(0, level.bid - qty);
            level.consumedBid = (level.consumedBid ?? 0) + qty;
        }
        this.book.insert(price, level);
    }

    private purgeCrossedLevels(): void {
        const nodes = this.book.getAllNodes();

        for (const n of nodes) {
            // 1️⃣ asks that sit at or below bestBid
            if (n.level.ask > 0 && n.price <= this._bestBid) {
                if (n.level.bid === 0) this.book.delete(n.price);
                else {
                    n.level.ask = 0;
                    this.book.insert(n.price, n.level);
                }
            }
            // 2️⃣ bids that sit at or above bestAsk
            if (n.level.bid > 0 && n.price >= this._bestAsk) {
                if (n.level.ask === 0) this.book.delete(n.price);
                else {
                    n.level.bid = 0;
                    this.book.insert(n.price, n.level);
                }
            }
        }
    }

    private pruneDistantLevels(): void {
        const mid = this.getMidPrice();
        if (!mid) return;

        // Use integer arithmetic for financial precision
        const scale = Math.pow(10, this.pricePrecision);
        const scaledMid = Math.round(mid * scale);
        const scaledDistance = Math.round(this.maxPriceDistance * scale);

        const minPrice =
            (scaledMid * (scale - scaledDistance)) / (scale * scale);
        const maxPrice =
            (scaledMid * (scale + scaledDistance)) / (scale * scale);

        const nodes = this.book.getAllNodes();
        for (const node of nodes) {
            const price = node.price;
            if (price < minPrice || price > maxPrice) {
                this.book.delete(price);
            }
        }
    }

    private async fetchInitialOrderBook(): Promise<void> {
        try {
            const snapshot = await this.binanceFeed.getDepthSnapshot(
                this.symbol,
                1000
            );

            if (
                !snapshot ||
                !snapshot.lastUpdateId ||
                !snapshot.bids ||
                !snapshot.asks
            ) {
                throw new Error("Failed to fetch order book snapshot");
            }

            const bids = (snapshot.bids as [string, string][]) || [];
            const asks = (snapshot.asks as [string, string][]) || [];

            // Track if we need to recalculate best bid/ask
            let needsBestRecalc = false;

            this.lastUpdateId = snapshot.lastUpdateId ?? this.lastUpdateId;

            // Process bids and track recalculation
            needsBestRecalc = this.processBidsSync(bids, needsBestRecalc);

            // Process asks and accumulate
            needsBestRecalc =
                this.processAsksSync(asks, needsBestRecalc) || needsBestRecalc;

            // Recalculate best bid/ask if needed
            if (needsBestRecalc) {
                this.recalculateBestQuotes();
            }

            this.logger.info(
                `[OrderBookState] Initial order book for ${this.symbol} loaded: ${this.lastUpdateId}`
            );
        } catch (error) {
            this.handleError(error as Error, "OrderBookState");
        }
    }

    private checkCircuit(): void {
        const now = Date.now();

        // Clean old errors
        this.errorWindow = this.errorWindow.filter(
            (t) => now - t < this.errorWindowMs
        );

        // Check if circuit should open
        if (this.errorWindow.length >= this.maxErrorRate) {
            this.circuitOpen = true;
            this.circuitOpenUntil = now + 30000; // 30 second cooldown

            this.logger.error("[OrderBookState] Circuit breaker opened", {
                errorCount: this.errorWindow.length,
                duration: 30000,
            });

            // Schedule circuit close
            setTimeout(() => {
                this.circuitOpen = false;
                this.errorWindow = [];
                this.logger.info("[OrderBookState] Circuit breaker closed");
            }, 30000);
        }
    }

    protected handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        // Track error for circuit breaker
        this.errorWindow.push(Date.now());
        this.checkCircuit();

        this.metricsCollector.incrementMetric("orderBookStateErrors");
        this.logger.error(
            `[${context}] ${error.message}`,
            {
                context,
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                correlationId,
            },
            correlationId
        );
    }

    public async shutdown(): Promise<void> {
        this.logger.info("[OrderBookState] Shutting down");

        // Stop timers
        if (this.pruneTimer) {
            clearInterval(this.pruneTimer);
            this.pruneTimer = undefined;
        }

        // Wait for any pending quote updates to complete
        const release = await this.quoteMutex.acquire();
        try {
            // Disconnect feed
            await this.binanceFeed.disconnect();

            // Clear book
            this.book.clear();
            this._bestBid = 0;
            this._bestAsk = Infinity;
            this.isInitialized = false;
        } finally {
            release();
        }

        this.logger.info("[OrderBookState] Shutdown complete");
    }

    // TODO create storage for saveState
    /* 
    private async saveState(): Promise<void> {
        try {
            const state = {
                symbol: this.symbol,
                lastUpdateId: this.lastUpdateId,
                bestBid: this._bestBid,
                bestAsk: this._bestAsk,
                levels: Array.from(this.book.entries()),
                timestamp: Date.now(),
            };

            // Save to Redis/file/S3 based on your infrastructure
            // Example: await redis.set(`orderbook:${this.symbol}`, JSON.stringify(state));

            this.logger.info("[OrderBookState] State saved", {
                levels: state.levels.length,
            });
        } catch (error) {
            this.handleError(error as Error, "OrderBookState.saveState");
        }
    }
    */

    public getHealth(): OrderBookHealth {
        const now = Date.now();
        const metrics = this.getDepthMetrics();
        const lastUpdateAge = now - this.lastUpdateTime;

        // Count stale levels
        let staleLevels = 0;
        const nodes = this.book.getAllNodes();
        for (const node of nodes) {
            if (now - node.level.timestamp > 300000) staleLevels++;
        }

        // Determine status
        let status: "healthy" | "degraded" | "unhealthy" = "healthy";
        if (!this.isInitialized || this.circuitOpen || lastUpdateAge > 10000) {
            status = "unhealthy";
        } else if (
            this.errorWindow.length > this.maxErrorRate / 2 ||
            lastUpdateAge > 5000 ||
            staleLevels > this.book.size() * 0.1
        ) {
            status = "degraded";
        }

        return {
            status,
            initialized: this.isInitialized,
            lastUpdateMs: lastUpdateAge,
            circuitBreakerOpen: this.circuitOpen,
            errorRate: this.errorWindow.length,
            bookSize: this.book.size(),
            spread: this.getSpread(),
            midPrice: this.getMidPrice(),
            details: {
                ...metrics,
                staleLevels,
                memoryUsageMB: this.estimateMemoryUsage() / 1024 / 1024,
                // Stream connection status
                isStreamConnected: this.isStreamConnected,
                streamConnectionTime: this.streamConnectionTime,
                timeoutThreshold: this.isStreamConnected ? 30000 : 300000,
            },
        };
    }

    private estimateMemoryUsage(): number {
        // Rough estimate: each RB node ~250 bytes (vs 200 for Map entry)
        return this.book.size() * 250;
    }

    /**
     * Handle stream connection events
     */
    public onStreamConnected(): void {
        const wasConnected = this.isStreamConnected;
        this.isStreamConnected = true;
        this.streamConnectionTime = Date.now();

        if (!wasConnected) {
            this.logger.info("[OrderBookState] Stream connection restored", {
                symbol: this.symbol,
                connectionTime: new Date(
                    this.streamConnectionTime
                ).toISOString(),
            });
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
                "[OrderBookState] Stream disconnected, adjusting health monitoring",
                {
                    symbol: this.symbol,
                    reason: reason || "unknown",
                    lastUpdateAge: Date.now() - this.lastUpdateTime,
                }
            );
        }
    }

    public async recover(): Promise<void> {
        this.logger.info("[OrderBookState] Starting recovery");

        try {
            // Reset state
            this.book.clear();
            this._bestBid = 0;
            this._bestAsk = Infinity;
            this.isInitialized = false;
            this.snapshotBuffer = [];
            this.lastUpdateId = 0;

            // Re-initialize
            await this.initialize();

            this.logger.info("[OrderBookState] Recovery complete");
        } catch (error) {
            this.handleError(error as Error, "OrderBookState.recover");
            throw error;
        }
    }

    private connectionHealthCheck(): void {
        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastUpdateTime;

        // Enhanced connection status checking
        this.verifyConnectionStatus();

        // Stream-aware timeout thresholds (similar to TradesProcessor)
        const connectedTimeout = 30000; // 30 seconds when stream is connected
        const disconnectedTimeout = 300000; // 5 minutes when stream is disconnected
        const currentTimeout = this.isStreamConnected
            ? connectedTimeout
            : disconnectedTimeout;

        if (timeSinceLastUpdate > currentTimeout && this.isInitialized) {
            const timeoutDescription = this.isStreamConnected
                ? "30s (stream connected)"
                : "5m (stream disconnected)";

            this.logger.error(
                "[OrderBookState] No updates for " +
                    timeoutDescription +
                    ", triggering recovery",
                {
                    symbol: this.symbol,
                    timeSinceLastUpdate,
                    isStreamConnected: this.isStreamConnected,
                    lastUpdateTime: new Date(this.lastUpdateTime).toISOString(),
                    streamConnectionTime: new Date(
                        this.streamConnectionTime
                    ).toISOString(),
                }
            );

            this.recover().catch((error) => {
                this.logger.error("[OrderBookState] Recovery failed", {
                    error,
                    symbol: this.symbol,
                    isStreamConnected: this.isStreamConnected,
                });
            });
        } else if (
            timeSinceLastUpdate > currentTimeout * 0.6 &&
            this.isInitialized
        ) {
            // Early warning at 60% of timeout threshold
            const timeoutDescription = this.isStreamConnected
                ? "18s (stream connected)"
                : "3m (stream disconnected)";

            this.logger.warn(
                "[OrderBookState] Approaching update timeout (" +
                    timeoutDescription +
                    ")",
                {
                    symbol: this.symbol,
                    timeSinceLastUpdate,
                    isStreamConnected: this.isStreamConnected,
                    timeoutThreshold: currentTimeout,
                }
            );
        }
    }

    /**
     * Enhanced connection status verification using ThreadManager
     */
    private verifyConnectionStatus(): void {
        if (!this.threadManager) return;

        try {
            // Use cached status for fast checks
            const cachedStatus = this.threadManager.getCachedConnectionStatus();
            const cacheAgeLimit = 30000; // 30 seconds

            // If cache is recent, use it to update our status
            if (cachedStatus.cacheAge < cacheAgeLimit) {
                const actuallyConnected = cachedStatus.isConnected;

                // Detect status discrepancies
                if (this.isStreamConnected !== actuallyConnected) {
                    this.logger.warn(
                        "[OrderBookState] Connection status mismatch detected",
                        {
                            symbol: this.symbol,
                            orderBookThinks: this.isStreamConnected,
                            actualStatus: actuallyConnected,
                            connectionState: cachedStatus.connectionState,
                            cacheAge: cachedStatus.cacheAge,
                        }
                    );

                    // Update our status to match reality
                    this.isStreamConnected = actuallyConnected;
                    this.streamConnectionTime = Date.now();
                }
            }
            // If cache is old, trigger an async fresh status check
            else if (cachedStatus.cacheAge > cacheAgeLimit * 2) {
                void this.requestFreshConnectionStatus();
            }
        } catch (error) {
            this.logger.debug(
                "[OrderBookState] Error verifying connection status",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Request fresh connection status from BinanceWorker
     */
    private async requestFreshConnectionStatus(): Promise<void> {
        if (!this.threadManager) return;

        try {
            const freshStatus =
                await this.threadManager.getConnectionStatus(3000);
            const actuallyConnected = freshStatus.isConnected;

            if (this.isStreamConnected !== actuallyConnected) {
                this.logger.info(
                    "[OrderBookState] Updated connection status from fresh query",
                    {
                        symbol: this.symbol,
                        previousStatus: this.isStreamConnected,
                        actualStatus: actuallyConnected,
                        connectionState: freshStatus.connectionState,
                        reconnectAttempts: freshStatus.reconnectAttempts,
                    }
                );

                this.isStreamConnected = actuallyConnected;
                this.streamConnectionTime = Date.now();
            }
        } catch (error) {
            this.logger.warn(
                "[OrderBookState] Failed to get fresh connection status",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    symbol: this.symbol,
                }
            );
        }
    }

    /**
     * Get enhanced connection status information
     */
    public getConnectionDiagnostics(): {
        orderBookStatus: {
            isStreamConnected: boolean;
            streamConnectionTime: number;
        };
        cachedWorkerStatus?: {
            isConnected: boolean;
            connectionState: string;
            cacheAge: number;
            streamHealth: {
                isHealthy: boolean;
                lastTradeMessage: number;
                lastDepthMessage: number;
            };
        };
        statusMismatch: boolean;
    } {
        const orderBookStatus = {
            isStreamConnected: this.isStreamConnected,
            streamConnectionTime: this.streamConnectionTime,
        };

        let cachedWorkerStatus;
        let statusMismatch = false;

        if (this.threadManager) {
            try {
                cachedWorkerStatus =
                    this.threadManager.getCachedConnectionStatus();
                statusMismatch =
                    this.isStreamConnected !== cachedWorkerStatus.isConnected;
            } catch {
                // Ignore errors when getting cached status
            }
        }

        return {
            orderBookStatus,
            cachedWorkerStatus,
            statusMismatch,
        };
    }
}
