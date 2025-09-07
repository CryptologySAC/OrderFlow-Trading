// src/data/individualTradesManager.ts

import type {
    AggTradeEvent,
    EnrichedTradeEvent,
} from "../types/marketEvents.js";
import type {
    HybridTradeEvent,
    IndividualTrade,
    FetchReason,
} from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IWorkerMetricsCollector } from "../multithreading/shared/workerInterfaces.js";
import { RateLimiter } from "../infrastructure/rateLimiter.js";
import { CircuitBreaker } from "../infrastructure/circuitBreaker.js";
import type { IBinanceDataFeed } from "../utils/binance.js";
import { Config } from "../core/config.js";

export interface IndividualTradesManagerConfig {
    enabled: boolean;

    // Selective fetching criteria
    criteria: {
        minOrderSizePercentile: number; // 95 (fetch orders > 95th percentile)
        keyLevelsEnabled: boolean; // Fetch at support/resistance
        anomalyPeriodsEnabled: boolean; // Fetch during anomaly detection
        highVolumePeriodsEnabled: boolean; // Fetch during high activity
    };

    // Performance tuning
    cache: {
        maxSize: number; // 10000 (max cached individual trades)
        ttlMs: number; // 300000 (5 minutes TTL)
    };

    // API limits
    rateLimit: {
        maxRequestsPerSecond: number; // 5 (respect Binance limits)
        batchSize: number; // 100 (trades per API call)
    };
}

interface CachedTrade {
    trade: IndividualTrade;
    timestamp: number;
}

// TradeRange interface removed as it's not used

interface BinanceIndividualTradeResponse {
    id: number;
    price: string;
    qty: string;
    quoteQty: string;
    time: number;
    isBuyerMaker: boolean;
    isBestMatch: boolean;
}

export class IndividualTradesManager {
    private readonly logger: ILogger;
    private readonly metricsCollector: IWorkerMetricsCollector;
    private readonly rateLimiter: RateLimiter;
    private readonly circuitBreaker: CircuitBreaker;
    private readonly config: IndividualTradesManagerConfig;
    private readonly binanceFeed: IBinanceDataFeed;

    // Caching infrastructure
    private readonly tradeCache = new Map<number, CachedTrade>();
    private readonly pendingRequests = new Map<
        string,
        Promise<IndividualTrade[]>
    >();

    // Rolling window for size percentile calculation
    private readonly recentTradeSizes: number[] = [];
    private readonly maxSizeHistory = 1000;

    // State tracking
    private isAnomalyPeriod = false;
    private isHighVolumePeriod = false;
    private lastFetchReason: FetchReason | undefined;

    constructor(
        config: IndividualTradesManagerConfig,
        logger: ILogger,
        metricsCollector: IWorkerMetricsCollector,
        binanceFeed: IBinanceDataFeed
    ) {
        this.config = config;
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.binanceFeed = binanceFeed;

        // Initialize rate limiter (respect Binance API limits)
        this.rateLimiter = new RateLimiter(
            1000, // windowMs
            config.rateLimit.maxRequestsPerSecond // maxRequests
        );

        // Initialize circuit breaker for API failures
        this.circuitBreaker = new CircuitBreaker(
            5, // threshold
            30000, // timeoutMs
            logger // logger
        );

        // Start cache cleanup timer
        this.startCacheCleanup();

        this.logger.info("[IndividualTradesManager] Initialized", {
            enabled: config.enabled,
            minOrderSizePercentile: config.criteria.minOrderSizePercentile,
            cacheMaxSize: config.cache.maxSize,
            rateLimitRps: config.rateLimit.maxRequestsPerSecond,
        });
    }

    /**
     * Decide when to fetch individual trades based on selective criteria
     */
    public shouldFetchIndividualTrades(
        trade: AggTradeEvent | EnrichedTradeEvent
    ): boolean {
        if (!this.config.enabled) {
            return false;
        }

        // Check if circuit breaker is open
        if (this.circuitBreaker.isTripped()) {
            return false;
        }

        // Update rolling trade size history
        this.updateTradeSizeHistory(trade.quantity);

        // Criterion 1: Large orders (above percentile threshold)
        if (this.isLargeOrder(trade)) {
            this.lastFetchReason = "large_order";
            return true;
        }

        // Criterion 2: Key price levels (if enabled)
        if (
            this.config.criteria.keyLevelsEnabled &&
            this.isAtKeyLevel(trade.price)
        ) {
            this.lastFetchReason = "key_level";
            return true;
        }

        // Criterion 3: Anomaly periods (if enabled)
        if (
            this.config.criteria.anomalyPeriodsEnabled &&
            this.isAnomalyPeriod
        ) {
            this.lastFetchReason = "anomaly_period";
            return true;
        }

        // Criterion 4: High volume periods (if enabled)
        if (
            this.config.criteria.highVolumePeriodsEnabled &&
            this.isHighVolumePeriod
        ) {
            this.lastFetchReason = "high_volume_period";
            return true;
        }

        return false;
    }

    /**
     * Fetch individual trades for an aggregated trade
     */
    public async fetchIndividualTrades(
        firstTradeId: number,
        lastTradeId: number
    ): Promise<IndividualTrade[]> {
        const rangeKey = `${firstTradeId}-${lastTradeId}`;

        try {
            // Check if request is already pending
            if (this.pendingRequests.has(rangeKey)) {
                return await this.pendingRequests.get(rangeKey)!;
            }

            // Check cache first
            const cachedTrades = this.getCachedTrades(
                firstTradeId,
                lastTradeId
            );
            if (cachedTrades.length > 0) {
                this.metricsCollector.incrementMetric(
                    "individualTrades.cacheHits"
                );
                return cachedTrades;
            }

            // Create and store pending request
            const fetchPromise = this.performFetch(firstTradeId, lastTradeId);
            this.pendingRequests.set(rangeKey, fetchPromise);

            const trades = await fetchPromise;

            // Cache the fetched trades
            this.cacheTrades(trades);

            this.metricsCollector.incrementMetric(
                "individualTrades.fetchSuccess"
            );
            this.metricsCollector.updateMetric(
                "individualTrades.lastFetchSize",
                trades.length
            );

            return trades;
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            this.logger.error("[IndividualTradesManager] Fetch failed", {
                firstTradeId,
                lastTradeId,
                error: errorMessage,
            });

            this.metricsCollector.incrementMetric(
                "individualTrades.fetchErrors"
            );
            this.circuitBreaker.recordError();

            // Return empty array on failure (graceful degradation)
            return [];
        } finally {
            // Clean up pending request
            this.pendingRequests.delete(rangeKey);
        }
    }

    /**
     * Get cached trades for a range
     */
    public getCachedTrades(
        firstTradeId: number,
        lastTradeId: number
    ): IndividualTrade[] {
        const trades: IndividualTrade[] = [];
        const now = Date.now();

        for (let id = firstTradeId; id <= lastTradeId; id++) {
            const cached = this.tradeCache.get(id);
            if (cached && now - cached.timestamp < this.config.cache.ttlMs) {
                trades.push(cached.trade);
            }
        }

        // Only return if we have the complete range
        return trades.length === lastTradeId - firstTradeId + 1 ? trades : [];
    }

    /**
     * Enhance aggregated trade with individual trades data
     */
    public async enhanceAggTradeWithIndividuals(
        enrichedTrade: EnrichedTradeEvent
    ): Promise<HybridTradeEvent> {
        if (!this.shouldFetchIndividualTrades(enrichedTrade)) {
            return {
                ...enrichedTrade,
                hasIndividualData: false,
                tradeComplexity: "simple",
            };
        }

        const individualTrades = await this.fetchIndividualTrades(
            enrichedTrade.originalTrade.f ?? NaN, // firstTradeId
            enrichedTrade.originalTrade.l ?? NaN // lastTradeId
        );

        if (individualTrades.length === 0) {
            return {
                ...enrichedTrade,
                hasIndividualData: false,
                tradeComplexity: "simple",
            };
        }

        return {
            ...enrichedTrade,
            individualTrades,
            hasIndividualData: true,
            tradeComplexity: this.classifyComplexity(individualTrades),
            fetchReason: this.lastFetchReason ?? "none",
        };
    }

    /**
     * Update system state indicators
     */
    public setAnomalyPeriod(isAnomaly: boolean): void {
        this.isAnomalyPeriod = isAnomaly;
    }

    public setHighVolumePeriod(isHighVolume: boolean): void {
        this.isHighVolumePeriod = isHighVolume;
    }

    public getLastFetchReason(): FetchReason | undefined {
        return this.lastFetchReason;
    }

    /**
     * Get performance metrics
     */
    public getMetrics() {
        return {
            cacheSize: this.tradeCache.size,
            pendingRequests: this.pendingRequests.size,
            isAnomalyPeriod: this.isAnomalyPeriod,
            isHighVolumePeriod: this.isHighVolumePeriod,
            circuitBreakerOpen: this.circuitBreaker.isTripped(),
            tradeSizeHistorySize: this.recentTradeSizes.length,
        };
    }

    // Private methods

    private async performFetch(
        firstTradeId: number,
        lastTradeId: number
    ): Promise<IndividualTrade[]> {
        // Check rate limit
        if (!this.rateLimiter.isAllowed("individual-trades-api")) {
            throw new Error("Rate limit exceeded for individual trades API");
        }

        const response = await this.callBinanceAPI(firstTradeId, lastTradeId);
        return response.map((trade) => ({
            id: trade.id,
            price: parseFloat(trade.price),
            quantity: parseFloat(trade.qty),
            timestamp: trade.time,
            isBuyerMaker: trade.isBuyerMaker,
            quoteQuantity: parseFloat(trade.quoteQty),
        }));
    }

    private async callBinanceAPI(
        firstTradeId: number,
        lastTradeId: number
    ): Promise<BinanceIndividualTradeResponse[]> {
        const limit = lastTradeId - firstTradeId + 1;
        const trades = await this.binanceFeed.getTrades(
            Config.SYMBOL,
            firstTradeId,
            limit
        );
        return trades.map((t) => ({
            id: t.id ?? 0,
            price: t.price ?? "0",
            qty: t.qty ?? "0",
            quoteQty: t.quoteQty ?? "0",
            time: t.time ?? Date.now(),
            isBuyerMaker: t.isBuyerMaker ?? false,
            isBestMatch: t.isBestMatch ?? true,
        }));
    }

    private updateTradeSizeHistory(size: number): void {
        this.recentTradeSizes.push(size);

        // Keep only recent trades
        if (this.recentTradeSizes.length > this.maxSizeHistory) {
            this.recentTradeSizes.shift();
        }
    }

    private isLargeOrder(trade: AggTradeEvent | EnrichedTradeEvent): boolean {
        if (this.recentTradeSizes.length < 500) {
            return false; // Need sufficient history
        }

        // Calculate percentile
        const sorted = [...this.recentTradeSizes].sort((a, b) => a - b);
        const percentileIndex = Math.floor(
            (this.config.criteria.minOrderSizePercentile / 100) * sorted.length
        );
        const threshold = sorted[percentileIndex]!;

        return trade.quantity >= threshold;
    }

    private isAtKeyLevel(price: number): boolean {
        const levels = [10, 50, 100, 500];
        for (const lvl of levels) {
            const mod = price % lvl;
            if (mod <= Config.TICK_SIZE || mod >= lvl - Config.TICK_SIZE) {
                return true;
            }
        }
        return false;
    }

    private cacheTrades(trades: IndividualTrade[]): void {
        const now = Date.now();

        for (const trade of trades) {
            // Check cache size limit
            if (this.tradeCache.size >= this.config.cache.maxSize) {
                this.cleanOldestCacheEntries(100); // Remove 100 oldest entries
            }

            this.tradeCache.set(trade.id, {
                trade,
                timestamp: now,
            });
        }
    }

    private classifyComplexity(
        trades: IndividualTrade[]
    ): "simple" | "complex" | "highly_fragmented" {
        if (trades.length <= 1) return "simple";
        if (trades.length <= 5) return "complex";
        return "highly_fragmented";
    }

    private startCacheCleanup(): void {
        // Clean cache every minute
        setInterval(() => {
            this.cleanExpiredCacheEntries();
        }, 60000);
    }

    private cleanExpiredCacheEntries(): void {
        const now = Date.now();
        const cutoff = now - this.config.cache.ttlMs;

        for (const [id, cached] of this.tradeCache) {
            if (cached.timestamp < cutoff) {
                this.tradeCache.delete(id);
            }
        }
    }

    private cleanOldestCacheEntries(count: number): void {
        const entries = Array.from(this.tradeCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, count);

        for (const [id] of entries) {
            this.tradeCache.delete(id);
        }
    }
}
