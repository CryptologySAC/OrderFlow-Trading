// src/market/orderBookState.ts

import type { SpotWebsocketStreams } from "@binance/spot";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { PassiveLevel, OrderBookHealth } from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { ThreadManager } from "../multithreading/threadManager.js";
import { FinancialMath } from "../utils/financialMath.js";

type SnapShot = Map<number, PassiveLevel>;

export interface OrderBookStateOptions {
    pricePrecision: number;
    symbol: string; // Default symbol
    maxLevels?: number;
    maxPriceDistance?: number; // Percentage distance from mid price
    pruneIntervalMs?: number; // Interval for pruning distant levels
    maxErrorRate?: number; // Max errors per minute before circuit opens
    staleThresholdMs?: number; // Threshold for stale levels
    disableSequenceValidation?: boolean; // Disable sequence gap validation (for backtesting)
}

export interface IOrderBookState {
    updateDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void;
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
    shutdown(): void;
    recover(): Promise<void>;
    getHealth(): OrderBookHealth;
    onStreamConnected(): void;
    onStreamDisconnected(reason?: string): void;
}

/**
 * @deprecated This class is deprecated and will be removed in a future version.
 * Use RedBlackTreeOrderBook instead for better performance with O(log n) operations.
 *
 * Legacy Map-based OrderBook implementation. This implementation uses Map data structures
 * which provide O(n) performance for best bid/ask operations. For better performance,
 * especially with large orderbooks, use RedBlackTreeOrderBook which provides O(log n) operations.
 *
 * Migration path:
 * ```typescript
 * // Old usage:
 * const orderBook = await OrderBookState.create(options, logger, metrics, threadManager);
 *
 * // New usage:
 * const orderBook = new RedBlackTreeOrderBook(options, logger, metrics, threadManager);
 * await orderBook.recover();
 * ```
 *
 * @see RedBlackTreeOrderBook - Recommended replacement with O(log n) performance
 */
export class OrderBookState implements IOrderBookState {
    private readonly logger: ILogger;
    private readonly metricsCollector: IMetricsCollector;
    private readonly threadManager: ThreadManager;

    private isInitialized = false;
    private snapshotBuffer: SpotWebsocketStreams.DiffBookDepthResponse[] = [];
    private expectedUpdateId?: number;

    private pruneIntervalMs = 30000; // 30 seconds
    private pruneTimer?: NodeJS.Timeout;
    private lastPruneTime = 0;
    private lastUpdateTime = Date.now();

    private maxLevels: number = 1000;
    private maxPriceDistance: number = 0.1; // 10% max price distance for levels
    private readonly disableSequenceValidation: boolean;

    private book: SnapShot = new Map();
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

    // Stream connection awareness for health monitoring
    private isStreamConnected = true; // Assume connected initially
    private streamConnectionTime = Date.now();

    constructor(
        options: OrderBookStateOptions,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        threadManager: ThreadManager
    ) {
        this.pricePrecision = options.pricePrecision;
        this.tickSize = Math.pow(10, -this.pricePrecision);
        this.symbol = options.symbol;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.threadManager = threadManager;
        this.maxLevels = options.maxLevels ?? this.maxLevels;
        this.maxPriceDistance =
            options.maxPriceDistance ?? this.maxPriceDistance;
        this.pruneIntervalMs = options.pruneIntervalMs ?? this.pruneIntervalMs;
        this.maxErrorRate = options.maxErrorRate ?? this.maxErrorRate;
        this.disableSequenceValidation =
            options.disableSequenceValidation ?? false;
        this.startPruning();
        setInterval(() => this.connectionHealthCheck(), 10000);
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

    public static async create(
        options: OrderBookStateOptions,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        threadManager: ThreadManager
    ): Promise<OrderBookState> {
        const instance = new OrderBookState(
            options,
            logger,
            metricsCollector,
            threadManager
        );
        await instance.initialize();
        return instance;
    }

    private async initialize(): Promise<void> {
        try {
            // Need to fetch initial orderbook snapshot from REST API
            await this.fetchInitialOrderBook();
            this.isInitialized = true;

            // Process any buffered updates
            this.processBufferedUpdates();
        } catch (error) {
            this.logger.error("[OrderBookState] Failed to initialize", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                symbol: this.symbol,
            });
            throw error; // Re-throw to allow caller to handle initialization failure
        }
    }

    public updateDepth(
        update: SpotWebsocketStreams.DiffBookDepthResponse
    ): void {
        // DEBUG: Log updateDepth call details
        this.logger.debug("[OrderBookState] updateDepth called", {
            symbol: update.s,
            isInitialized: this.isInitialized,
            bidCount: update.b?.length || 0,
            askCount: update.a?.length || 0,
            asks: update.a, // Log all asks to see if 89.05 is there
            bids: update.b,
            updateId: update.u,
        });

        if (this.circuitOpen && Date.now() < this.circuitOpenUntil) {
            this.metricsCollector.incrementMetric("orderbookCircuitRejected");
            return; // Reject updates while circuit is open
        }

        // Only validate sequence gaps if not in backtesting mode
        if (
            !this.disableSequenceValidation &&
            this.expectedUpdateId &&
            update.U
        ) {
            const gap = update.U - this.expectedUpdateId;
            if (gap > 1) {
                throw new Error(
                    `Sequence gap detected: expected ${this.expectedUpdateId}, got ${update.U}`
                );
            }
        }
        this.expectedUpdateId = update.u ? update.u + 1 : undefined;

        if (!this.isInitialized) {
            // Buffer updates until initialized
            this.logger.warn(
                "[OrderBookState] Buffering update - not initialized",
                {
                    symbol: update.s,
                    bufferSize: this.snapshotBuffer.length + 1,
                }
            );
            this.snapshotBuffer.push(update);
            return;
        }

        // Validate update sequence - ignore outdated updates
        if (update.u && this.lastUpdateId && update.u <= this.lastUpdateId) {
            // Skip duplicate/out-of-date update
            return;
        }
        this.lastUpdateId = update.u ?? this.lastUpdateId;

        const bids = (update.b as [string, string][]) || [];
        const asks = (update.a as [string, string][]) || [];

        // Track if we need to recalculate best bid/ask
        let needsBestRecalc = false;

        // Process bids and track if best bid/ask needs recalculation
        needsBestRecalc = this.processBids(bids, needsBestRecalc);

        // Process asks and accumulate recalculation flag
        needsBestRecalc =
            this.processAsks(asks, needsBestRecalc) || needsBestRecalc;

        // DEBUG: Log book state after processing
        this.logger.debug("[OrderBookState] Book state after processing", {
            bookSize: this.book.size,
            bookKeys: Array.from(this.book.keys()),
            bookEntries: Array.from(this.book.entries()).slice(0, 5), // First 5 entries
        });

        // Recalculate best bid/ask if needed
        if (needsBestRecalc) {
            this.recalculateBestQuotes();
        }

        this.lastUpdateTime = Date.now();
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
        return FinancialMath.calculateSpread(
            this._bestAsk,
            this._bestBid,
            this.pricePrecision
        );
    }

    public getMidPrice(): number {
        if (this._bestBid === 0 || this._bestAsk === Infinity) return 0;
        return FinancialMath.calculateMidPrice(
            this._bestBid,
            this._bestAsk,
            this.pricePrecision
        );
    }

    public sumBand(
        center: number,
        bandTicks: number,
        tickSize: number
    ): { bid: number; ask: number; levels: number } {
        let sumBid = 0;
        let sumAsk = 0;
        let levels = 0;

        // Use FinancialMath for precise band calculation
        const bandSize = FinancialMath.safeMultiply(bandTicks, tickSize);
        const min = FinancialMath.safeSubtract(center, bandSize);
        const max = FinancialMath.safeAdd(center, bandSize);

        // DEBUG: Log band calculation details
        this.logger.debug("[OrderBookState] sumBand calculation", {
            center,
            bandTicks,
            tickSize,
            bandSize,
            min,
            max,
            bookSize: this.book.size,
            bookPrices: Array.from(this.book.keys()).slice(0, 10), // First 10 prices
        });

        for (const [price, lvl] of this.book) {
            if (price >= min && price <= max) {
                this.logger.debug("[OrderBookState] Found level in band", {
                    price,
                    bid: lvl.bid,
                    ask: lvl.ask,
                    withinBand: true,
                });
                sumBid = FinancialMath.safeAdd(sumBid, lvl.bid);
                sumAsk = FinancialMath.safeAdd(sumAsk, lvl.ask);
                levels++;
            }
        }

        // DEBUG: Log final results
        this.logger.debug("[OrderBookState] sumBand result", {
            center,
            bandSize: `${min} to ${max}`,
            sumBid,
            sumAsk,
            levels,
            totalVolume: sumBid + sumAsk,
        });

        return { bid: sumBid, ask: sumAsk, levels };
    }

    public snapshot(): SnapShot {
        // Deep clone for thread safety
        const snap: SnapShot = new Map<number, PassiveLevel>();
        for (const [price, level] of this.book) {
            snap.set(price, { ...level });
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

        for (const level of this.book.values()) {
            if (level.bid > 0) {
                bidLevels++;
                totalBidVolume = FinancialMath.safeAdd(
                    totalBidVolume,
                    level.bid
                );
            }
            if (level.ask > 0) {
                askLevels++;
                totalAskVolume = FinancialMath.safeAdd(
                    totalAskVolume,
                    level.ask
                );
            }
        }

        const totalVolume = FinancialMath.safeAdd(
            totalBidVolume,
            totalAskVolume
        );
        const imbalance =
            totalVolume > 0
                ? FinancialMath.safeDivide(
                      FinancialMath.safeSubtract(
                          totalBidVolume,
                          totalAskVolume
                      ),
                      totalVolume
                  )
                : 0;

        return {
            totalLevels: this.book.size,
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
            const beforeSize = this.book.size;
            this.pruneDistantLevels();
            const afterSize = this.book.size;

            // Prune stale levels
            this.pruneStaleeLevels();

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
        } catch (error) {
            this.handleError(
                error as Error,
                "OrderBookState.performMaintenance"
            );
        }
    }

    private enforceMaxLevels(): void {
        if (this.book.size <= this.maxLevels) return;

        const mid = this.getMidPrice();
        if (!mid) return;

        // Sort levels by distance from mid
        const levels = Array.from(this.book.entries())
            .map(([price, level]) => ({
                price,
                level,
                distance: Math.abs(price - mid),
            }))
            .sort((a, b) => b.distance - a.distance);

        // Remove furthest levels
        const toRemove = levels.slice(this.maxLevels);
        for (const { price } of toRemove) {
            this.book.delete(price);
        }
    }

    private pruneStaleeLevels(): void {
        const now = Date.now();
        const staleThreshold = 300000; // 5 minutes

        for (const [price, level] of this.book) {
            if (
                now - level.timestamp > staleThreshold &&
                level.bid === 0 &&
                level.ask === 0
            ) {
                this.book.delete(price);
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
                needsBestRecalc = this.processBids(bids, needsBestRecalc);

                // Process asks and accumulate
                needsBestRecalc =
                    this.processAsks(asks, needsBestRecalc) || needsBestRecalc;

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

    private processBids(
        bids: [string, string][],
        needsBestRecalc: boolean
    ): boolean {
        const now = Date.now();
        for (const [priceStr, qtyStr] of bids) {
            const price = this.normalizePrice(parseFloat(priceStr));
            const qty = parseFloat(qtyStr);

            if (qty === 0) {
                // Only delete if both sides would be zero
                const level = this.book.get(price);
                if (level && level.ask === 0) {
                    this.book.delete(price);
                } else if (level) {
                    level.bid = 0;
                    level.timestamp = now;
                }
                if (price === this._bestBid) needsBestRecalc = true;
            } else {
                const level = this.book.get(price) || {
                    price,
                    bid: 0,
                    ask: 0,
                    timestamp: now,
                };
                level.bid = qty;
                level.timestamp = now;
                this.book.set(price, level);

                // Update best bid if necessary
                if (price > this._bestBid) {
                    this._bestBid = price;
                } else if (price === this._bestBid) {
                    needsBestRecalc = true;
                }
            }
        }
        return needsBestRecalc;
    }

    private processAsks(
        asks: [string, string][],
        needsBestRecalc: boolean
    ): boolean {
        const now = Date.now();
        for (const [priceStr, qtyStr] of asks) {
            const price = this.normalizePrice(parseFloat(priceStr));
            const qty = parseFloat(qtyStr);

            // DEBUG: Log ask processing
            this.logger.debug("[OrderBookState] Processing ask", {
                originalPrice: priceStr,
                normalizedPrice: price,
                quantity: qty,
                isZeroQty: qty === 0,
            });

            if (qty === 0) {
                const level = this.book.get(price);
                if (level && level.bid === 0) {
                    this.book.delete(price);
                    this.logger.debug("[OrderBookState] Deleted empty level", {
                        price,
                    });
                } else if (level) {
                    level.ask = 0;
                    level.timestamp = now;
                    this.logger.debug("[OrderBookState] Zeroed ask volume", {
                        price,
                    });
                }
                if (price === this._bestAsk) needsBestRecalc = true;
            } else {
                const level = this.book.get(price) || {
                    price,
                    bid: 0,
                    ask: 0,
                    timestamp: now,
                };
                level.ask = qty;
                level.timestamp = now;
                this.book.set(price, level);

                // DEBUG: Log stored level
                this.logger.debug("[OrderBookState] Stored ask level", {
                    price,
                    askVolume: qty,
                    bidVolume: level.bid,
                    isNewLevel: !this.book.has(price),
                });

                // Update best ask if necessary
                if (price < this._bestAsk) {
                    this._bestAsk = price;
                } else if (price === this._bestAsk) {
                    needsBestRecalc = true;
                }
            }
        }
        return needsBestRecalc;
    }

    private normalizePrice(price: number): number {
        // Use FinancialMath for consistent precision
        const normalized = FinancialMath.financialRound(
            price,
            this.pricePrecision
        );

        // DEBUG: Always log price normalization for debugging
        this.logger.debug("[OrderBookState] Price normalization", {
            original: price,
            normalized,
            precision: this.pricePrecision,
            isNull: normalized === null,
            isNaN: isNaN(normalized),
            typeofOriginal: typeof price,
            typeofNormalized: typeof normalized,
        });

        return normalized;
    }

    private recalculateBestQuotes(): void {
        this._bestBid = 0;
        this._bestAsk = Infinity;

        for (const [price, level] of this.book) {
            if (level.bid > 0 && price > this._bestBid) {
                this._bestBid = price;
            }
            if (level.ask > 0 && price < this._bestAsk) {
                this._bestAsk = price;
            }
        }
    }

    private pruneDistantLevels(): void {
        const mid = this.getMidPrice();
        if (!mid) return;

        // Use FinancialMath for precise distance calculation
        const distanceAmount = FinancialMath.safeMultiply(
            mid,
            this.maxPriceDistance
        );
        const minPrice = FinancialMath.safeSubtract(mid, distanceAmount);
        const maxPrice = FinancialMath.safeAdd(mid, distanceAmount);

        for (const [price, level] of this.book) {
            void level; // Ensure level is defined
            if (price < minPrice || price > maxPrice) {
                this.book.delete(price);
            }
        }
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

            const bids = snapshot.bids || [];
            const asks = snapshot.asks || [];

            // Track if we need to recalculate best bid/ask
            let needsBestRecalc = false;

            this.lastUpdateId = snapshot.lastUpdateId ?? this.lastUpdateId;

            // Process bids and track recalculation
            needsBestRecalc = this.processBids(bids, needsBestRecalc);

            // Process asks and accumulate
            needsBestRecalc =
                this.processAsks(asks, needsBestRecalc) || needsBestRecalc;

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

    // Add these methods
    public shutdown(): void {
        this.logger.info("[OrderBookState] Shutting down");

        // Stop timers
        if (this.pruneTimer) {
            clearInterval(this.pruneTimer);
            this.pruneTimer = undefined;
        }

        // Save state
        //TODO await this.saveState();

        // Note: BinanceWorker handles connection lifecycle, no disconnect needed here

        // Clear book
        this.book.clear();
        this._bestBid = 0;
        this._bestAsk = Infinity;
        this.isInitialized = false;

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
        for (const level of this.book.values()) {
            if (now - level.timestamp > 300000) staleLevels++;
        }

        // Determine status
        let status: "healthy" | "degraded" | "unhealthy" = "healthy";
        if (!this.isInitialized || this.circuitOpen || lastUpdateAge > 10000) {
            status = "unhealthy";
        } else if (
            this.errorWindow.length > this.maxErrorRate / 2 ||
            lastUpdateAge > 5000 ||
            staleLevels > this.book.size * 0.1
        ) {
            status = "degraded";
        }

        return {
            status,
            initialized: this.isInitialized,
            lastUpdateMs: lastUpdateAge,
            circuitBreakerOpen: this.circuitOpen,
            errorRate: this.errorWindow.length,
            bookSize: this.book.size,
            spread: this.getSpread(),
            midPrice: this.getMidPrice(),
            details: {
                ...metrics,
                staleLevels,
                memoryUsageMB: this.estimateMemoryUsage() / 1024 / 1024,
            },
        };
    }

    private estimateMemoryUsage(): number {
        // Rough estimate: each level ~200 bytes
        return this.book.size * 200;
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

        if (timeSinceLastUpdate > 30000 && this.isInitialized) {
            this.logger.error(
                "[OrderBookState] No updates for 30s, triggering recovery"
            );
            this.recover().catch((error) => {
                this.logger.error("[OrderBookState] Recovery failed", {
                    error,
                });
            });
        }
    }
}
