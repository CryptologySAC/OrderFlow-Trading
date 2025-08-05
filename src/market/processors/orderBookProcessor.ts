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
}

interface BinConfig {
    minPrice: number;
    maxPrice: number;
    binSize: number;
    numLevels: number;
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

        return {
            priceLevels: Array.from(binnedLevels.values()).sort(
                (a, b) => a.price - b.price
            ),
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
            if (price < config.minPrice || price > config.maxPrice) continue;

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

        // Keep all bins to maintain balanced orderbook display
        // Don't filter empty bins - this ensures consistent bid/ask level counts
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
            lastError: this.lastError,
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
}
