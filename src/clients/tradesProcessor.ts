// src/clients/tradesProcessor.ts
import { randomUUID } from "crypto";
import { z } from "zod";
import { Storage } from "../storage/storage.js";
import { BinanceDataFeed } from "../utils/binance.js";
import { SpotWebsocketAPI } from "@binance/spot";
import type { WebSocketMessage } from "../utils/interfaces.js";
import type { PlotTrade } from "../utils/types.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { WorkerLogger } from "../multithreading/workerLogger";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ProductionUtils } from "../utils/productionUtils.js";
import { CircularBuffer } from "../utils/utils.js";
import { EventEmitter } from "events";

// ✅ Zod validation schemas based on actual Binance API specification
const TradeDataSchema = z.object({
    a: z.number().int().nonnegative(), // Aggregate trade ID
    p: z.string().regex(/^\d+(\.\d+)?$/, "Invalid price format"), // Price as string
    q: z.string().regex(/^\d+(\.\d+)?$/, "Invalid quantity format"), // Quantity as string
    f: z.number().int().nonnegative().optional(), // First trade ID
    l: z.number().int().nonnegative().optional(), // Last trade ID
    T: z.number().int().positive(), // Timestamp
    m: z.boolean(), // Was the buyer the maker?
    M: z.boolean().optional(), // Was the trade the best price match?
    s: z.string().optional(), // Symbol
});

const TradeArraySchema = z.array(TradeDataSchema); // No arbitrary size limit - let system handle memory appropriately

const SymbolSchema = z
    .string()
    .regex(
        /^[A-Z0-9]{2,20}$/,
        "Symbol must be 2-20 uppercase alphanumeric characters"
    )
    .max(30, "Symbol too long"); // More flexible for various trading pairs

const BacklogAmountSchema = z.number().int().positive().min(1); // Only validate that it's a positive integer

// Validation error types
class TradeValidationError extends Error {
    constructor(
        message: string,
        public readonly validationErrors: z.ZodError
    ) {
        super(message);
        this.name = "TradeValidationError";
    }
}

export interface ITradesProcessor {
    fillBacklog(): Promise<void>;
    requestBacklog(amount: number): PlotTrade[];
    onEnrichedTrade(event: EnrichedTradeEvent): WebSocketMessage;
    getHealth(): ProcessorHealth;
    getStats(): ProcessorStats;
    shutdown(): Promise<void>;
    emit(event: string | symbol, ...args: unknown[]): boolean;
    on(event: string | symbol, listener: (...args: unknown[]) => void): this;
}

export interface TradesProcessorOptions {
    symbol?: string;
    storageTime?: number;
    maxBacklogRetries?: number;
    backlogBatchSize?: number;
    maxMemoryTrades?: number;
    saveQueueSize?: number;
    healthCheckInterval?: number;
    maxErrorWindowSize?: number;
}

interface ProcessorHealth {
    status: "healthy" | "degraded" | "unhealthy";
    lastTradeAge: number;
    saveQueueDepth: number;
    memoryUsage: number;
    errorRate: number;
    isBacklogComplete: boolean;
}

interface ProcessorStats {
    processedTrades: number;
    savedTrades: number;
    failedSaves: number;
    backlogProgress: number;
    averageProcessingTime: number;
    p99ProcessingTime: number;
}

interface SaveQueueItem {
    trade: SpotWebsocketAPI.TradesAggregateResponseResultInner;
    symbol: string;
    retries: number;
    timestamp: number;
}

export class TradesProcessor extends EventEmitter implements ITradesProcessor {
    private readonly binanceFeed: BinanceDataFeed;
    private readonly symbol: string;
    private readonly storage: Storage;
    private readonly storageTime: number;
    private readonly maxBacklogRetries: number;
    private readonly backlogBatchSize: number;
    private readonly maxMemoryTrades: number;
    private readonly saveQueueSize: number;
    private readonly healthCheckInterval: number;

    private readonly logger: WorkerLogger;
    private readonly metricsCollector: MetricsCollector;

    // State management
    private thresholdTime: number;
    private backlogComplete = false;
    private isShuttingDown = false;
    private lastTradeTime = Date.now();
    private latestTradeTimestamp = Date.now();

    // Memory cache for recent trades
    private recentTrades: CircularBuffer<PlotTrade>;

    // Async save queue
    private saveQueue: SaveQueueItem[] = [];
    private saveTimer?: NodeJS.Timeout;
    private isSaving = false;

    // Performance tracking
    private processedCount = 0;
    private savedCount = 0;
    private failedSaves = 0;
    private processingTimes: CircularBuffer<number>;
    private errorWindow: CircularBuffer<number>;
    private readonly maxErrorWindowSize: number;

    // Health monitoring
    private healthCheckTimer?: NodeJS.Timeout;
    private isStreamConnected = true;

    constructor(
        options: TradesProcessorOptions,
        storage: Storage,
        logger: WorkerLogger,
        metricsCollector: MetricsCollector,
        binanceFeed: BinanceDataFeed
    ) {
        super();
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.storage = storage;
        this.binanceFeed = binanceFeed;

        // Configuration - validate symbol parameter
        const rawSymbol = options.symbol ?? "LTCUSDT";
        try {
            this.symbol = SymbolSchema.parse(rawSymbol);
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new TradeValidationError(
                    "Invalid symbol in constructor options",
                    error
                );
            }
            throw error;
        }
        this.storageTime = options.storageTime ?? 1000 * 60 * 90; // 90 minutes
        this.maxBacklogRetries = options.maxBacklogRetries ?? 3;
        this.backlogBatchSize = Math.min(
            Math.max(100, options.backlogBatchSize ?? 1000),
            1000
        ); // Binance max
        this.maxMemoryTrades = options.maxMemoryTrades ?? 50000;
        this.saveQueueSize = options.saveQueueSize ?? 5000;
        this.healthCheckInterval = options.healthCheckInterval ?? 30000; // 30 s
        this.maxErrorWindowSize = Math.max(
            10,
            options.maxErrorWindowSize ?? 1000
        ); // Min 10, default 1000

        // Initialize state - use last stored timestamp to prevent data gaps
        const lastStoredTimestamp: number | null =
            this.storage.getLastTradeTimestamp(this.symbol);
        this.thresholdTime =
            lastStoredTimestamp !== null
                ? lastStoredTimestamp + 1
                : Date.now() - this.storageTime;
        this.latestTradeTimestamp = this.thresholdTime;
        this.recentTrades = new CircularBuffer<PlotTrade>(this.maxMemoryTrades);
        this.processingTimes = new CircularBuffer<number>(1000);
        this.errorWindow = new CircularBuffer<number>(this.maxErrorWindowSize);

        // Start background tasks
        this.startSaveQueue();
        this.startHealthCheck();
        this.startGapMonitoring();

        // Listen for stream connection events
        this.setupStreamEventHandlers();

        this.logger.info("[TradesProcessor] Initialized", {
            symbol: this.symbol,
            storageTime: this.storageTime,
            maxMemoryTrades: this.maxMemoryTrades,
        });
    }

    // ✅ Validation helper methods
    /**
     * Validate and sanitize external trade data using Zod schemas
     */
    private validateTradeData(
        trade: unknown
    ): SpotWebsocketAPI.TradesAggregateResponseResultInner {
        try {
            const validatedTrade = TradeDataSchema.parse(trade);
            return {
                a: validatedTrade.a, // Aggregate trade ID
                p: validatedTrade.p, // Price (keep as string)
                q: validatedTrade.q, // Quantity (keep as string)
                f: validatedTrade.f, // First trade ID
                l: validatedTrade.l, // Last trade ID
                T: validatedTrade.T, // Timestamp
                m: validatedTrade.m, // Was buyer the maker
                M: validatedTrade.M, // Best price match
                s: validatedTrade.s, // Symbol
            } as SpotWebsocketAPI.TradesAggregateResponseResultInner;
        } catch (error) {
            if (error instanceof z.ZodError) {
                this.metricsCollector.incrementMetric("tradesErrors");
                throw new TradeValidationError(
                    "Invalid trade data received from external API",
                    error
                );
            }
            throw error;
        }
    }

    /**
     * Validate and sanitize trade array with size limits
     */
    private validateTradeArray(
        trades: unknown[]
    ): SpotWebsocketAPI.TradesAggregateResponseResultInner[] {
        try {
            const result = TradeArraySchema.parse(trades);
            return result.map(
                (trade) =>
                    ({
                        a: trade.a, // Aggregate trade ID
                        p: trade.p, // Price (keep as string)
                        q: trade.q, // Quantity (keep as string)
                        f: trade.f, // First trade ID
                        l: trade.l, // Last trade ID
                        T: trade.T, // Timestamp
                        m: trade.m, // Was buyer the maker
                        M: trade.M, // Best price match
                        s: trade.s, // Symbol
                    }) as SpotWebsocketAPI.TradesAggregateResponseResultInner
            );
        } catch (error) {
            if (error instanceof z.ZodError) {
                this.metricsCollector.incrementMetric("tradesErrors");
                throw new TradeValidationError(
                    "Invalid trade array received from external API",
                    error
                );
            }
            throw error;
        }
    }

    /**
     * Validate symbol parameter
     */
    private validateSymbol(symbol: string): string {
        try {
            return SymbolSchema.parse(symbol);
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new TradeValidationError("Invalid symbol format", error);
            }
            throw error;
        }
    }

    /**
     * Validate backlog amount parameter
     */
    private validateBacklogAmount(amount: number): number {
        try {
            return BacklogAmountSchema.parse(amount);
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new TradeValidationError("Invalid backlog amount", error);
            }
            throw error;
        }
    }

    /**
     * Reload the last 90 minutes of trade data from Binance
     */
    public async fillBacklog(): Promise<void> {
        const startWall = Date.now();
        const targetTime = Date.now();
        const backlogStartTime = targetTime - this.storageTime;
        const batchWindowMs = 60_000; // 1 minute logical window
        let totalFetched = 0;
        let retries = 0;

        // Restart from window start
        this.thresholdTime = backlogStartTime;
        this.backlogComplete = false;

        this.logger.info("[TradesProcessor] Starting 90-minute data reload", {
            from: new Date(backlogStartTime).toISOString(),
            to: new Date(targetTime).toISOString(),
            durationMinutes: (this.storageTime / 60_000).toFixed(2),
        });

        try {
            while (this.thresholdTime < targetTime && !this.isShuttingDown) {
                const windowEnd = Math.min(
                    this.thresholdTime + batchWindowMs - 1,
                    targetTime
                );
                let windowProgressed = false;

                // Loop inside the window until we exhaust all trades (API returns < limit)
                while (!windowProgressed && !this.isShuttingDown) {
                    const aggregatedTrades =
                        await this.binanceFeed.fetchAggTradesByTime(
                            this.symbol,
                            this.thresholdTime,
                            windowEnd,
                            this.backlogBatchSize
                        );

                    if (aggregatedTrades.length === 0) {
                        // No trades in this slice; exit inner loop
                        windowProgressed = true;
                        break;
                    }

                    let maxTimestamp = this.thresholdTime;
                    const tradesToSave: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                        [];

                    // ✅ Validate entire trade array first to prevent malformed data injection
                    try {
                        const validatedTrades =
                            this.validateTradeArray(aggregatedTrades);

                        for (const trade of validatedTrades) {
                            maxTimestamp = Math.max(maxTimestamp, trade.T!);
                            tradesToSave.push(trade);

                            // Add to memory cache with validated data
                            this.recentTrades.add({
                                time: trade.T!,
                                price: parseFloat(trade.p!),
                                quantity: parseFloat(trade.q!),
                                orderType: trade.m ? "SELL" : "BUY",
                                symbol: this.symbol,
                                tradeId: trade.a ?? 0,
                            });
                        }
                    } catch (error) {
                        if (error instanceof TradeValidationError) {
                            this.logger.warn(
                                "[TradesProcessor] Invalid trade data in batch",
                                {
                                    batchSize: aggregatedTrades.length,
                                    validationErrors:
                                        error.validationErrors.issues,
                                    context: "fillBacklog",
                                }
                            );
                            // Skip this entire batch to prevent processing malformed data
                            continue;
                        }
                        throw error; // Re-throw non-validation errors
                    }

                    if (tradesToSave.length) {
                        await this.bulkSaveTrades(tradesToSave);
                        totalFetched += tradesToSave.length;
                    }

                    // If we got a full batch, there may be more trades in the same window
                    if (aggregatedTrades.length === this.backlogBatchSize) {
                        this.thresholdTime = maxTimestamp + 1;
                        continue; // keep pulling inside the same minute
                    }

                    // Otherwise the window is exhausted
                    windowProgressed = true;
                    this.thresholdTime = windowEnd + 1;
                    this.latestTradeTimestamp = maxTimestamp;
                }

                // Simple fixed-sleep rate-limit (max 10 req/s rule)
                await ProductionUtils.sleep(120);

                // Retry handling (outer loop)
                retries = 0;
            }

            this.backlogComplete = this.thresholdTime >= targetTime - 1000;
            const duration = Date.now() - startWall;

            this.logger.info("[TradesProcessor] Backlog fill complete", {
                totalFetched,
                durationMs: duration,
                durationMin: (duration / 60_000).toFixed(2),
                backlogComplete: this.backlogComplete,
            });
        } catch (error) {
            retries++;
            if (retries >= this.maxBacklogRetries) {
                this.handleError(error as Error, "fillBacklog");
                throw error;
            }
            this.logger.warn(
                "[TradesProcessor] Backlog fetch error, retrying outer loop",
                { error: (error as Error).message, retry: retries }
            );
        }
    }

    /**
     * Request recent trades from memory cache
     */
    public requestBacklog(amount: number): PlotTrade[] {
        try {
            // ✅ Validate backlog amount parameter
            const validatedAmount = this.validateBacklogAmount(amount);
            const safeAmount = Math.min(validatedAmount, this.maxMemoryTrades);

            const memoryTrades = this.recentTrades.getAll();
            if (memoryTrades.length >= safeAmount) {
                return memoryTrades.slice(-safeAmount).reverse();
            }

            const storageTrades = this.storage.getLatestAggregatedTrades(
                safeAmount,
                this.symbol
            );

            const plotTrades = storageTrades.map(
                (trade): PlotTrade => ({
                    time: trade.T ?? 0,
                    price: parseFloat(trade.p || "0"),
                    quantity: parseFloat(trade.q || "0"),
                    orderType: trade.m ? "SELL" : "BUY",
                    symbol: this.symbol,
                    tradeId: trade.a ?? 0,
                })
            );

            plotTrades.forEach((trade) => this.recentTrades.add(trade));
            return plotTrades.reverse();
        } catch (error) {
            this.handleError(error as Error, "requestBacklog");
            return [];
        }
    }

    /**
     * Process enriched trade with async save
     */
    public onEnrichedTrade(event: EnrichedTradeEvent): WebSocketMessage {
        const startTime = Date.now();

        try {
            if (!event.originalTrade) {
                throw new Error("EnrichedTradeEvent missing originalTrade");
            }

            // ✅ Validate originalTrade before processing to prevent malformed data
            const validatedOriginalTrade = this.validateTradeData(
                event.originalTrade
            );

            const processedTrade: PlotTrade = {
                time: event.timestamp,
                price: event.price,
                quantity: event.quantity,
                orderType: event.buyerIsMaker ? "SELL" : "BUY",
                symbol: event.pair,
                tradeId: validatedOriginalTrade.a ?? event.timestamp,
            };

            this.recentTrades.add(processedTrade);
            this.queueSave(validatedOriginalTrade);

            this.latestTradeTimestamp = event.timestamp;
            this.thresholdTime = event.timestamp + 1;

            this.lastTradeTime = Date.now();
            this.processedCount++;
            const processingTime = Date.now() - startTime;
            this.processingTimes.add(processingTime);

            this.metricsCollector.updateMetric(
                "tradesProcessingTime",
                processingTime
            );
            this.metricsCollector.incrementMetric("tradesProcessed");

            return {
                type: "trade",
                now: Date.now(),
                data: processedTrade,
            };
        } catch (error) {
            this.handleError(error as Error, "onEnrichedTrade");

            // ✅ Return specific error codes for validation failures
            const errorCode =
                error instanceof TradeValidationError
                    ? "TRADE_VALIDATION_ERROR"
                    : "TRADE_PROCESSING_ERROR";

            return {
                type: "error",
                now: Date.now(),
                data: {
                    message: (error as Error).message,
                    code: errorCode,
                },
            };
        }
    }

    /**
     * Queue trade for async save
     */
    private queueSave(
        trade: SpotWebsocketAPI.TradesAggregateResponseResultInner
    ): void {
        if (this.saveQueue.length >= this.saveQueueSize) {
            this.logger.warn(
                "[TradesProcessor] Save queue full, dropping oldest"
            );
            this.saveQueue.shift();
            this.metricsCollector.incrementMetric("tradesSaveDropped");
        }

        this.saveQueue.push({
            trade,
            symbol: this.symbol,
            retries: 0,
            timestamp: Date.now(),
        });
    }

    /**
     * Background save processor
     */
    private startSaveQueue(): void {
        this.saveTimer = setInterval(() => {
            void (async () => {
                if (
                    this.isSaving ||
                    this.isShuttingDown ||
                    this.saveQueue.length === 0
                ) {
                    return;
                }

                this.isSaving = true;
                const batchSize = Math.min(100, this.saveQueue.length);
                const batch = this.saveQueue.splice(0, batchSize);

                try {
                    const trades = batch.map((item) => item.trade);
                    await this.bulkSaveTrades(trades);
                    this.savedCount += batch.length;
                } catch (error) {
                    this.logger.error("[TradesProcessor] Bulk save failed", {
                        error,
                    });

                    batch.forEach((item) => {
                        item.retries++;
                        if (item.retries < 3) {
                            this.saveQueue.push(item);
                        } else {
                            this.failedSaves++;
                            this.logger.error(
                                "[TradesProcessor] Trade save permanently failed",
                                { tradeId: item.trade.a }
                            );
                        }
                    });
                } finally {
                    this.isSaving = false;
                }
            })();
        }, 1000);
    }

    /**
     * Bulk save trades
     */
    private async bulkSaveTrades(
        trades: SpotWebsocketAPI.TradesAggregateResponseResultInner[]
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.storage.saveAggregatedTradesBulk(trades, this.symbol);
                resolve();
            } catch (error) {
                if (error instanceof Error) {
                    reject(error);
                } else {
                    reject(
                        new Error(
                            typeof error === "string"
                                ? error
                                : JSON.stringify(error)
                        )
                    );
                }
            }
        });
    }

    /**
     * Health monitoring
     */
    private startHealthCheck(): void {
        this.healthCheckTimer = setInterval(() => {
            const health = this.getHealth();

            if (health.status === "unhealthy") {
                this.logger.error(
                    "[TradesProcessor] Unhealthy state detected",
                    { health }
                );
                this.emit("unhealthy", health);
            }

            // ✅ SECURITY FIX: CircularBuffer automatically manages size, no manual cleanup needed
            // Error window is now bounded and self-managing
        }, this.healthCheckInterval);
    }

    /**
     * Start continuous gap monitoring - REMOVED
     */
    private startGapMonitoring(): void {
        this.logger.info(
            "[TradesProcessor] Gap monitoring removed - using 90-minute reload strategy"
        );
    }

    /**
     * Reload 90 minutes of trade data
     */
    private async reloadTradeData(): Promise<void> {
        if (this.isShuttingDown) return;

        try {
            this.logger.info(
                "[TradesProcessor] Starting 90-minute data reload"
            );
            await this.fillBacklog();
            this.logger.info(
                "[TradesProcessor] Data reload completed successfully"
            );
        } catch (error) {
            this.logger.error("[TradesProcessor] Error during data reload", {
                error: (error as Error).message,
            });
        }
    }

    /**
     * Setup stream event handlers
     */
    private setupStreamEventHandlers(): void {
        this.on("stream_disconnected", (data: { reason: string }) => {
            this.logger.warn("[TradesProcessor] Stream disconnected", data);
            this.isStreamConnected = false;
        });

        this.on("stream_connected", () => {
            this.logger.info("[TradesProcessor] Stream reconnected");
            this.isStreamConnected = true;
            this.lastTradeTime = Date.now();

            void this.reloadTradeData().catch((error) => {
                this.logger.error(
                    "[TradesProcessor] Error during reconnection data reload",
                    { error: (error as Error).message }
                );
            });
        });
    }

    /**
     * Get health status
     */
    public getHealth(): ProcessorHealth {
        const now = Date.now();
        const lastTradeAge = now - this.lastTradeTime;
        const memoryUsage = this.recentTrades.length * 100;
        // ✅ SECURITY FIX: Calculate error rate from recent errors in 60-second window
        const cutoff = now - 60_000;
        const recentErrors = this.errorWindow
            .getAll()
            .filter((timestamp) => timestamp > cutoff);
        const errorRate = recentErrors.length;

        let status: "healthy" | "degraded" | "unhealthy" = "healthy";

        const tradeTimeoutThreshold = this.isStreamConnected ? 60_000 : 300_000;
        const degradedThreshold = this.isStreamConnected ? 30_000 : 180_000;

        if (
            lastTradeAge > tradeTimeoutThreshold ||
            errorRate > 10 ||
            this.saveQueue.length > this.saveQueueSize * 0.9
        ) {
            status = "unhealthy";
        } else if (
            lastTradeAge > degradedThreshold ||
            errorRate > 5 ||
            this.saveQueue.length > this.saveQueueSize * 0.5
        ) {
            status = "degraded";
        }

        return {
            status,
            lastTradeAge,
            saveQueueDepth: this.saveQueue.length,
            memoryUsage,
            errorRate,
            isBacklogComplete: this.backlogComplete,
        };
    }

    /**
     * Get statistics
     */
    public getStats(): ProcessorStats {
        const times = this.processingTimes.getAll();
        const avgTime =
            times.length > 0
                ? times.reduce((a, b) => a + b, 0) / times.length
                : 0;

        const p99Time =
            times.length > 0
                ? times.sort((a, b) => a - b)[Math.floor(times.length * 0.99)]
                : 0;

        const backlogProgress = this.backlogComplete
            ? 100
            : ((this.thresholdTime - (Date.now() - this.storageTime)) /
                  this.storageTime) *
              100;

        return {
            processedTrades: this.processedCount,
            savedTrades: this.savedCount,
            failedSaves: this.failedSaves,
            backlogProgress,
            averageProcessingTime: avgTime,
            p99ProcessingTime: p99Time,
        };
    }

    /**
     * Graceful shutdown
     */
    public async shutdown(): Promise<void> {
        this.logger.info("[TradesProcessor] Shutting down");
        this.isShuttingDown = true;

        if (this.saveTimer) clearInterval(this.saveTimer);
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);

        if (this.saveQueue.length) {
            this.logger.info(
                "[TradesProcessor] Processing remaining save queue",
                { remaining: this.saveQueue.length }
            );
            try {
                const trades = this.saveQueue.map((item) => item.trade);
                await this.bulkSaveTrades(trades);
            } catch (error) {
                this.logger.error("[TradesProcessor] Final save failed", {
                    error,
                });
            }
        }

        this.recentTrades.clear();
        this.saveQueue = [];

        await this.binanceFeed.disconnect();

        this.logger.info("[TradesProcessor] Shutdown complete");
    }

    /**
     * Error handling with enhanced validation error support
     */
    private handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        // ✅ SECURITY FIX: Use bounded CircularBuffer to prevent memory exhaustion
        this.errorWindow.add(Date.now());
        this.metricsCollector.incrementMetric("tradesErrors");

        const errorContext = {
            context,
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            correlationId: correlationId || randomUUID(),
        };

        // ✅ Enhanced handling for validation errors
        if (error instanceof TradeValidationError) {
            (errorContext as Record<string, unknown>)["validationErrors"] =
                error.validationErrors.issues;
            this.logger.warn(
                `[${context}] Data validation failed: ${error.message}`,
                errorContext,
                correlationId
            );
            // Don't increment general error count for validation issues
            this.metricsCollector.incrementMetric("tradesErrors");
        } else {
            this.logger.error(
                `[${context}] ${error.message}`,
                errorContext,
                correlationId
            );
        }
    }

    /**
     * Sleep utility placeholder – use ProductionUtils.sleep
     */
}
