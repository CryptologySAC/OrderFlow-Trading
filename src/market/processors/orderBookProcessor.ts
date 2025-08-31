// src/clients/orderBookProcessor.ts
import type {
    OrderBookSnapshot,
    PassiveLevel,
} from "../../types/marketEvents.js";
import type { WebSocketMessage } from "../../utils/interfaces.js";
import type { ILogger } from "../../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../../infrastructure/metricsCollectorInterface.js";
import { CircularBuffer } from "../../utils/circularBuffer.js";

export interface IOrderBookProcessor {
    onOrderBookUpdate(event: OrderBookSnapshot): WebSocketMessage;
    getHealth(): ProcessorHealth;
    getStats(): ProcessorStats;
}

interface OrderBookData {
    priceLevels: PriceLevel[];
    bestBid: number;
    bestAsk: number;
    spread: number;
    midPrice: number;
    totalBidVolume: number;
    totalAskVolume: number;
    imbalance: number;
    timestamp: number;
}

interface PriceLevel {
    price: number;
    bid: number;
    ask: number;
    bidCount?: number; // Number of orders in this bin
    askCount?: number; // Number of orders in this bin
    // Depletion tracking fields
    depletionRatio?: number; // 0-1, how much of original volume is depleted
    depletionVelocity?: number; // LTC/sec depletion rate
    originalBidVolume?: number; // Original bid volume before depletion
    originalAskVolume?: number; // Original ask volume before depletion
}

interface BinConfig {
    minPrice: number;
    maxPrice: number;
    binSize: number;
    numLevels: number;
}

interface DepletionMeasurement {
    volume: number;
    timestamp: number;
}

interface DepletionMetrics {
    depletionRatio: number; // 0-1
    depletionVelocity: number; // units/sec
    originalVolume: number;
    currentVolume: number;
    lastUpdate: number;
}

export interface ProcessorHealth {
    status: "healthy" | "degraded" | "unhealthy";
    lastUpdateMs: number;
    bufferedUpdates: number;
    errorRate: number;
    processingLatencyMs: number;
}

export interface ProcessorStats {
    processedUpdates: number;
    avgProcessingTimeMs: number;
    p99ProcessingTimeMs: number;
    errorCount: string; // BigInt converted to string for JSON serialization
    lastError?: string;
}

export interface OrderBookProcessorOptions {
    binSize?: number; // Number of price levels per bin
    numLevels?: number; // Total number of bins to maintain
    maxBufferSize?: number; // Max size of the recent snapshots buffer
    tickSize?: number; // Minimum price increment
    precision?: number; // Decimal precision for prices
}

export class OrderBookProcessor implements IOrderBookProcessor {
    private readonly logger: ILogger;
    private readonly metricsCollector: IMetricsCollector;

    // Configuration
    private readonly binSize: number;
    private readonly numLevels: number;
    private readonly tickSize: number;
    private readonly precision: number;
    private readonly maxBufferSize: number;

    // State management
    private readonly recentSnapshots: CircularBuffer<OrderBookSnapshot>;
    private lastProcessedTime = Date.now();
    private processedCount = 0n;
    private errorCount = 0n;
    private lastError?: string;

    // Performance tracking
    private readonly processingTimes: CircularBuffer<number>;
    private readonly errorWindow: number[] = [];
    private readonly maxErrorRate = 10; // per minute

    // Depletion tracking state
    private readonly volumeHistory = new Map<
        number,
        CircularBuffer<DepletionMeasurement>
    >();
    private readonly depletionCache = new Map<number, DepletionMetrics>();
    private readonly maxHistorySize = 50; // Keep last 50 measurements per price level
    private readonly depletionThreshold = 0.05; // Minimum volume change to track

    constructor(
        config: OrderBookProcessorOptions = {},
        logger: ILogger,
        metricsCollector: IMetricsCollector
    ) {
        this.binSize = config.binSize ?? 10;
        this.numLevels = config.numLevels ?? 10;
        this.maxBufferSize = config.maxBufferSize ?? 1000;
        this.tickSize = config.tickSize ?? 0.01;
        this.precision = config.precision ?? 2;

        this.logger = logger;
        this.metricsCollector = metricsCollector;

        this.recentSnapshots = new CircularBuffer<OrderBookSnapshot>(
            this.maxBufferSize,
            (snapshot) => {
                // Clean up Map to help GC with complex objects
                if (snapshot.depthSnapshot) {
                    snapshot.depthSnapshot.clear();
                }
            }
        );
        this.processingTimes = new CircularBuffer<number>(1000);

        // Add cleanup interval for stale depletion data
        setInterval(() => {
            this.cleanupStaleDepletionData();
        }, 300000); // 5-minute cleanup interval

        this.logger.info("[OrderBookProcessor] Initialized", {
            binSize: this.binSize,
            numLevels: this.numLevels,
            tickSize: this.tickSize,
        });
    }

    /**
     * Main processing method - receives enriched orderbook snapshots
     */
    public onOrderBookUpdate(event: OrderBookSnapshot): WebSocketMessage {
        const startTime = Date.now();

        try {
            // Validate input
            if (!this.validateSnapshot(event)) {
                throw new Error("Invalid orderbook snapshot");
            }

            // Store snapshot
            this.recentSnapshots.add(event);

            // Process and bin the orderbook
            const orderBookData = this.processOrderBook(event);

            // Track metrics
            const processingTime = Date.now() - startTime;
            this.processingTimes.add(processingTime);
            this.lastProcessedTime = Date.now();
            this.processedCount++;
            // Reset if approaching safe limits for serialization
            if (this.processedCount > 9007199254740991n) {
                this.processedCount = 0n;
            }

            this.metricsCollector.updateMetric(
                "orderbookProcessingTime",
                processingTime
            );
            this.metricsCollector.incrementMetric("orderbookUpdatesProcessed");

            return {
                type: "orderbook",
                now: Date.now(),
                data: orderBookData,
            };
        } catch (error) {
            this.handleError(error as Error, event);

            return {
                type: "error",
                data: {
                    message: (error as Error).message,
                    code: "ORDERBOOK_PROCESSING_ERROR",
                },
                now: Date.now(),
            };
        }
    }

    /**
     * Process orderbook snapshot and group into bins
     */
    private processOrderBook(snapshot: OrderBookSnapshot): OrderBookData {
        // Calculate price range for binning
        const binConfig = this.calculateBinConfig(snapshot.midPrice);

        // Group levels into bins
        const binnedLevels = this.binOrderBook(
            snapshot.depthSnapshot,
            binConfig
        );

        // Convert to array and sort
        const priceLevels = Array.from(binnedLevels.values()).sort(
            (a, b) => a.price - b.price
        );

        // Track depletion for each price level
        const timestamp = snapshot.timestamp;
        this.updateDepletionCache(priceLevels, timestamp);

        // Add depletion data to price levels with validation
        const priceLevelsWithDepletion = priceLevels.map((level) => {
            const bidDepletion = this.getDepletionData(level.price, false);
            const askDepletion = this.getDepletionData(level.price, true);

            // Validate depletion data is current and relevant
            const isValidDepletionData = this.validateDepletionData(
                bidDepletion,
                askDepletion,
                level,
                snapshot.midPrice
            );

            if (!isValidDepletionData) {
                // Return level without depletion data if validation fails
                return {
                    ...level,
                    depletionRatio: 0,
                    depletionVelocity: 0,
                    originalBidVolume: level.bid,
                    originalAskVolume: level.ask,
                };
            }

            return {
                ...level,
                depletionRatio:
                    bidDepletion?.depletionRatio ||
                    askDepletion?.depletionRatio ||
                    0,
                depletionVelocity:
                    bidDepletion?.depletionVelocity ||
                    askDepletion?.depletionVelocity ||
                    0,
                originalBidVolume: bidDepletion?.originalVolume || level.bid,
                originalAskVolume: askDepletion?.originalVolume || level.ask,
            };
        });

        // Periodic cleanup of old depletion data
        if (this.processedCount % 1000n === 0n) {
            // Every 1000 updates
            this.cleanupDepletionData();
        }

        return {
            priceLevels: priceLevelsWithDepletion,
            bestBid: snapshot.bestBid,
            bestAsk: snapshot.bestAsk,
            spread: snapshot.spread,
            midPrice: snapshot.midPrice,
            totalBidVolume: snapshot.passiveBidVolume,
            totalAskVolume: snapshot.passiveAskVolume,
            imbalance: snapshot.imbalance,
            timestamp: snapshot.timestamp,
        };
    }

    /**
     * Calculate bin configuration based on current price
     */
    private calculateBinConfig(midPrice: number): BinConfig {
        const binIncrement = this.tickSize * this.binSize;

        // Calculate raw price boundaries
        const halfRange = this.numLevels * binIncrement;
        const rawMinPrice = midPrice - halfRange;
        const rawMaxPrice = midPrice + halfRange;

        // Align to bin boundaries
        const minPrice = Math.floor(rawMinPrice / binIncrement) * binIncrement;
        const maxPrice = Math.ceil(rawMaxPrice / binIncrement) * binIncrement;

        return {
            minPrice: this.roundToTick(minPrice),
            maxPrice: this.roundToTick(maxPrice),
            binSize: binIncrement,
            numLevels: this.numLevels,
        };
    }

    /**
     * Group orderbook levels into price bins
     */
    private binOrderBook(
        depthSnapshot: Map<number, PassiveLevel>,
        config: BinConfig
    ): Map<number, PriceLevel> {
        const bins = new Map<number, PriceLevel>();
        const binIncrement = config.binSize;

        // When binSize is 1 (1-tick), show actual order book levels without creating empty bins
        if (this.binSize === 1) {
            // Just convert the actual depth snapshot to price levels
            for (const [price, level] of depthSnapshot) {
                // Skip levels outside our range
                if (price < config.minPrice || price > config.maxPrice)
                    continue;

                // Only add levels that have actual liquidity
                if (level.bid > 0 || level.ask > 0) {
                    const roundedPrice = this.roundToTick(price);
                    bins.set(roundedPrice, {
                        price: roundedPrice,
                        bid: level.bid || 0,
                        ask: level.ask || 0,
                        bidCount: level.bid > 0 ? 1 : 0,
                        askCount: level.ask > 0 ? 1 : 0,
                    });
                }
            }
        } else {
            // For larger bin sizes, create bins and aggregate
            // Initialize bins
            for (
                let price = config.minPrice;
                price <= config.maxPrice;
                price += binIncrement
            ) {
                const binPrice = this.roundToTick(price);
                bins.set(binPrice, {
                    price: binPrice,
                    bid: 0,
                    ask: 0,
                    bidCount: 0,
                    askCount: 0,
                });
            }

            // Aggregate levels into bins
            for (const [price, level] of depthSnapshot) {
                // Skip levels outside our range
                if (price < config.minPrice || price > config.maxPrice)
                    continue;

                // Bids
                if (level.bid > 0) {
                    const bidBinPrice = this.roundToTick(
                        Math.floor(price / binIncrement) * binIncrement
                    );
                    const bin = bins.get(bidBinPrice);
                    if (bin) {
                        bin.bid += level.bid;
                        bin.bidCount!++;
                    }
                }
                // Asks
                if (level.ask > 0) {
                    const askBinPrice = this.roundToTick(
                        Math.ceil(price / binIncrement) * binIncrement
                    );
                    const bin = bins.get(askBinPrice);
                    if (bin) {
                        bin.ask += level.ask;
                        bin.askCount!++;
                    }
                }
            }
        }

        return bins;
    }

    /**
     * Validate incoming snapshot
     */
    private validateSnapshot(snapshot: OrderBookSnapshot): boolean {
        if (!snapshot || typeof snapshot !== "object") {
            this.logger.warn(
                "[OrderBookProcessor] Invalid snapshot: not an object"
            );
            return false;
        }

        if (
            !snapshot.depthSnapshot ||
            !(snapshot.depthSnapshot instanceof Map)
        ) {
            this.logger.warn(
                "[OrderBookProcessor] Invalid snapshot: missing depthSnapshot"
            );
            return false;
        }

        if (typeof snapshot.midPrice !== "number" || snapshot.midPrice <= 0) {
            this.logger.warn(
                "[OrderBookProcessor] Invalid snapshot: invalid midPrice"
            );
            return false;
        }

        return true;
    }

    /**
     * Round price to tick precision
     */
    private roundToTick(price: number): number {
        return parseFloat(
            (Math.round(price / this.tickSize) * this.tickSize).toFixed(
                this.precision
            )
        );
    }

    /**
     * Handle processing errors
     */
    private handleError(
        error: Error,
        snapshot?: Partial<OrderBookSnapshot>
    ): void {
        this.errorCount++;
        // Reset if approaching safe limits for serialization
        if (this.errorCount > 9007199254740991n) {
            this.errorCount = 0n;
        }
        this.lastError = error.message;
        this.errorWindow.push(Date.now());

        // Clean old errors
        const cutoff = Date.now() - 60000;
        const firstRecent = this.errorWindow.findIndex((t) => t > cutoff);
        if (firstRecent > 0) {
            this.errorWindow.splice(0, firstRecent);
        }

        this.logger.error("[OrderBookProcessor] Processing error", {
            error: error.message,
            midPrice: snapshot?.midPrice,
            depthSize:
                snapshot?.depthSnapshot instanceof Map
                    ? snapshot.depthSnapshot.size
                    : undefined,
            errorCount: this.errorCount.toString(),
        });

        this.metricsCollector.incrementMetric("orderbookProcessingErrors");
    }

    /**
     * Get processor health status
     */
    public getHealth(): ProcessorHealth {
        const now = Date.now();
        const lastUpdateAge = now - this.lastProcessedTime;
        const avgProcessingTime = this.getAverageProcessingTime();

        let status: "healthy" | "degraded" | "unhealthy" = "healthy";

        if (
            lastUpdateAge > 10000 ||
            this.errorWindow.length > this.maxErrorRate
        ) {
            status = "unhealthy";
        } else if (lastUpdateAge > 5000 || avgProcessingTime > 100) {
            status = "degraded";
        }

        return {
            status,
            lastUpdateMs: lastUpdateAge,
            bufferedUpdates: this.recentSnapshots.length,
            errorRate: this.errorWindow.length,
            processingLatencyMs: avgProcessingTime,
        };
    }

    /**
     * Get processor statistics
     */
    public getStats(): ProcessorStats {
        const times = this.processingTimes.getAll();
        const avgTime =
            times.length > 0
                ? times.reduce((a, b) => a + b, 0) / times.length
                : 0;

        const p99Time =
            times.length > 0
                ? times.sort((a, b) => a - b)[Math.floor(times.length * 0.99)]!
                : 0;

        return {
            processedUpdates: Number(this.processedCount), // Convert BigInt to number for compatibility
            avgProcessingTimeMs: avgTime,
            p99ProcessingTimeMs: p99Time,
            errorCount: this.errorCount.toString(), // Convert BigInt to string for JSON serialization
            lastError: this.lastError ?? "",
        };
    }

    /**
     * Get average processing time
     */
    private getAverageProcessingTime(): number {
        const times = this.processingTimes.getAll();
        return times.length > 0
            ? times.reduce((a, b) => a + b, 0) / times.length
            : 0;
    }

    /**
     * Track volume changes for depletion calculation
     */
    private trackVolumeChange(
        price: number,
        currentVolume: number,
        timestamp: number
    ): void {
        // Get or create history buffer for this price level
        let history = this.volumeHistory.get(price);
        if (!history) {
            history = new CircularBuffer<DepletionMeasurement>(
                this.maxHistorySize
            );
            this.volumeHistory.set(price, history);
        }

        // Only track significant volume changes
        const lastMeasurement = history.at(history.length - 1);
        if (lastMeasurement) {
            const volumeChange = Math.abs(
                currentVolume - lastMeasurement.volume
            );
            const changeRatio = volumeChange / lastMeasurement.volume;

            if (changeRatio < this.depletionThreshold) {
                return; // Change too small to track
            }
        }

        // Add new measurement
        history.add({
            volume: currentVolume,
            timestamp: timestamp,
        });
    }

    /**
     * Get binning configuration (for monitoring/debugging)
     */
    public getBinConfig(): {
        binSize: number;
        numLevels: number;
        tickSize: number;
        precision: number;
        binIncrement: number;
    } {
        return {
            binSize: this.binSize,
            numLevels: this.numLevels,
            tickSize: this.tickSize,
            precision: this.precision,
            binIncrement: this.tickSize * this.binSize,
        };
    }

    /**
     * Calculate depletion metrics for a price level
     */
    private calculateDepletionMetrics(
        price: number,
        currentVolume: number,
        timestamp: number
    ): DepletionMetrics | null {
        const history = this.volumeHistory.get(price);
        if (!history || history.length < 2) {
            // Not enough history to calculate depletion
            return null;
        }

        const measurements = history.getAll();
        if (measurements.length === 0) {
            return null;
        }

        const firstMeasurement = measurements[0];
        if (!firstMeasurement) {
            return null;
        }

        const originalVolume = firstMeasurement.volume;
        const timeSpan = timestamp - firstMeasurement.timestamp;

        if (timeSpan === 0 || originalVolume === 0) {
            return null;
        }

        // Calculate depletion ratio (0-1, where 1 = fully depleted)
        const depletionRatio = Math.max(
            0,
            Math.min(1, 1 - currentVolume / originalVolume)
        );

        // Calculate depletion velocity (units per second)
        const depletionVelocity =
            (originalVolume - currentVolume) / (timeSpan / 1000);

        return {
            depletionRatio,
            depletionVelocity,
            originalVolume,
            currentVolume,
            lastUpdate: timestamp,
        };
    }

    /**
     * Update depletion cache for all price levels
     */
    private updateDepletionCache(
        priceLevels: PriceLevel[],
        timestamp: number
    ): void {
        for (const level of priceLevels) {
            // Track bid volume changes
            if (level.bid > 0) {
                this.trackVolumeChange(level.price, level.bid, timestamp);
                const bidMetrics = this.calculateDepletionMetrics(
                    level.price,
                    level.bid,
                    timestamp
                );
                if (bidMetrics) {
                    this.depletionCache.set(level.price, bidMetrics);
                }
            }

            // Track ask volume changes
            if (level.ask > 0) {
                const askPrice = level.price + this.tickSize; // Use actual tick size for ask prices
                this.trackVolumeChange(askPrice, level.ask, timestamp);
                const askMetrics = this.calculateDepletionMetrics(
                    askPrice,
                    level.ask,
                    timestamp
                );
                if (askMetrics) {
                    this.depletionCache.set(askPrice, askMetrics);
                }
            }
        }
    }

    /**
     * Get depletion data for a specific price level with proximity matching
     * CLAUDE.md COMPLIANCE: Returns null when data cannot be retrieved
     */
    private getDepletionData(
        price: number,
        isAsk: boolean = false
    ): DepletionMetrics | null {
        const lookupPrice = isAsk ? price + this.tickSize : price;

        // First try exact match
        const exactMatch = this.depletionCache.get(lookupPrice);
        if (exactMatch) {
            return exactMatch;
        }

        // If no exact match, find closest active price level within tick range
        // This handles cases where price levels shift slightly due to market movement
        const maxDistance = this.tickSize * 2; // Within 2 ticks
        let closestPrice: number | null = null;
        let minDistance = Infinity;

        for (const [cachedPrice] of this.depletionCache) {
            const distance = Math.abs(cachedPrice - lookupPrice);
            if (distance <= maxDistance && distance < minDistance) {
                minDistance = distance;
                closestPrice = cachedPrice;
            }
        }

        return closestPrice
            ? this.depletionCache.get(closestPrice) || null
            : null;
    }

    /**
     * Validate depletion data for current market conditions
     * CLAUDE.md COMPLIANCE: Data validation and error handling
     */
    private validateDepletionData(
        bidDepletion: DepletionMetrics | null,
        askDepletion: DepletionMetrics | null,
        level: PriceLevel,
        midPrice: number
    ): boolean {
        // Check if we have any depletion data
        if (!bidDepletion && !askDepletion) {
            return false; // No depletion data available
        }

        // Check price proximity to current market (within 1% of mid price)
        const priceDeviation = Math.abs(level.price - midPrice) / midPrice;
        if (priceDeviation > 0.01) {
            // More than 1% deviation
            return false; // Price level too far from current market
        }

        // Check data freshness (within last 10 minutes)
        const maxAge = 10 * 60 * 1000; // 10 minutes
        const now = Date.now();

        if (bidDepletion && now - bidDepletion.lastUpdate > maxAge) {
            return false; // Bid data too old
        }

        if (askDepletion && now - askDepletion.lastUpdate > maxAge) {
            return false; // Ask data too old
        }

        // Check data consistency (both sides should have reasonable volumes)
        const hasBidData = bidDepletion && bidDepletion.originalVolume > 0;
        const hasAskData = askDepletion && askDepletion.originalVolume > 0;

        // At least one side should have valid data
        if (!hasBidData && !hasAskData) {
            return false;
        }

        return true;
    }

    /**
     * Clean up old depletion data periodically
     * CLAUDE.md COMPLIANCE: Memory management and performance optimization
     */
    private cleanupDepletionData(): void {
        const cutoffTime = Date.now() - 5 * 60 * 1000; // 5 minutes ago
        const pricesToRemove: number[] = [];

        // Find expired entries based on time
        for (const [price, metrics] of this.depletionCache) {
            if (metrics.lastUpdate < cutoffTime) {
                pricesToRemove.push(price);
            }
        }

        // Remove expired entries
        for (const price of pricesToRemove) {
            this.depletionCache.delete(price);
            this.volumeHistory.delete(price);
        }

        // Additional cleanup: Remove entries with very low volume (likely stale)
        const lowVolumeThreshold = 1.0; // LTC units
        const additionalRemovals: number[] = [];

        for (const [price, metrics] of this.depletionCache) {
            if (metrics.currentVolume < lowVolumeThreshold) {
                additionalRemovals.push(price);
            }
        }

        for (const price of additionalRemovals) {
            this.depletionCache.delete(price);
            this.volumeHistory.delete(price);
            pricesToRemove.push(price);
        }

        if (pricesToRemove.length > 0) {
            this.logger.debug(
                `[OrderBookProcessor] Cleaned up ${pricesToRemove.length} stale depletion entries`
            );
        }
    }

    /**
     * Clean up stale depletion data - called by interval timer
     * CLAUDE.md COMPLIANCE: Memory management and performance optimization
     */
    private cleanupStaleDepletionData(): void {
        const cutoffTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago (more aggressive cleanup)
        const pricesToRemove: number[] = [];

        // Find stale entries based on extended time window
        for (const [price, metrics] of this.depletionCache) {
            if (metrics.lastUpdate < cutoffTime) {
                pricesToRemove.push(price);
            }
        }

        // Also clean up volume history for stale entries
        for (const [price, history] of this.volumeHistory) {
            if (history.length > 0) {
                const lastMeasurement = history.at(history.length - 1);
                if (lastMeasurement && lastMeasurement.timestamp < cutoffTime) {
                    pricesToRemove.push(price);
                }
            }
        }

        // Remove stale entries
        for (const price of pricesToRemove) {
            this.depletionCache.delete(price);
            this.volumeHistory.delete(price);
        }

        // Clean up empty history buffers
        const emptyHistories: number[] = [];
        for (const [price, history] of this.volumeHistory) {
            if (history.length === 0) {
                emptyHistories.push(price);
            }
        }

        for (const price of emptyHistories) {
            this.volumeHistory.delete(price);
        }

        const totalCleaned = pricesToRemove.length + emptyHistories.length;
        if (totalCleaned > 0) {
            this.logger.info(
                `[OrderBookProcessor] Aggressive cleanup: ${totalCleaned} stale entries removed (${pricesToRemove.length} cache, ${emptyHistories.length} empty histories)`
            );
        }
    }
}
