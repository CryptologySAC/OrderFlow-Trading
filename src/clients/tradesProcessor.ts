// src/clients/tradesProcessor.ts
import { randomUUID } from "crypto";
import { Storage } from "../storage/storage.js";
import { BinanceDataFeed } from "../utils/binance.js";
import { SpotWebsocketAPI } from "@binance/spot";
import type { WebSocketMessage } from "../utils/interfaces.js";
import type { PlotTrade } from "../utils/types.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { CircularBuffer } from "../utils/utils.js";
import { EventEmitter } from "events";

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
    private readonly binanceFeed = new BinanceDataFeed();
    private readonly symbol: string;
    private readonly storage: Storage;
    private readonly storageTime: number;
    private readonly maxBacklogRetries: number;
    private readonly backlogBatchSize: number;
    private readonly maxMemoryTrades: number;
    private readonly saveQueueSize: number;
    private readonly healthCheckInterval: number;

    //private aggTradeTemp: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =[];

    private readonly logger: Logger;
    private readonly metricsCollector: MetricsCollector;

    // State management
    private thresholdTime: number;
    private backlogComplete = false;
    private isShuttingDown = false;
    private lastTradeTime = Date.now();

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
    private errorWindow: number[] = [];

    // Health monitoring
    private healthCheckTimer?: NodeJS.Timeout;
    private isStreamConnected = true;

    constructor(
        options: TradesProcessorOptions,
        storage: Storage,
        logger: Logger,
        metricsCollector: MetricsCollector
    ) {
        super();
        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.storage = storage;

        // Configuration
        this.symbol = options.symbol ?? "LTCUSDT";
        this.storageTime = options.storageTime ?? 1000 * 60 * 90; // 90 minutes
        this.maxBacklogRetries = options.maxBacklogRetries ?? 3;
        this.backlogBatchSize = options.backlogBatchSize ?? 1000;
        this.maxMemoryTrades = options.maxMemoryTrades ?? 10000;
        this.saveQueueSize = options.saveQueueSize ?? 5000;
        this.healthCheckInterval = options.healthCheckInterval ?? 30000; // 30s

        // Initialize state
        this.thresholdTime = Date.now() - this.storageTime;
        this.recentTrades = new CircularBuffer<PlotTrade>(this.maxMemoryTrades);
        this.processingTimes = new CircularBuffer<number>(1000);

        // Start background tasks
        this.startSaveQueue();
        this.startHealthCheck();

        // Listen for stream connection events
        this.setupStreamEventHandlers();

        this.logger.info("[TradesProcessor] Initialized", {
            symbol: this.symbol,
            storageTime: this.storageTime,
            maxMemoryTrades: this.maxMemoryTrades,
        });
    }

    /**
     * Preload the backlog of aggregated trades into storage
     */
    public async fillBacklog(): Promise<void> {
        const startTime = Date.now();
        const targetTime = Date.now();
        let totalFetched = 0;
        let consecutiveEmptyBatches = 0;
        let retries = 0;

        this.logger.info("[TradesProcessor] Starting backlog fill", {
            from: new Date(this.thresholdTime).toISOString(),
            to: new Date(targetTime).toISOString(),
            hours: ((targetTime - this.thresholdTime) / 3600000).toFixed(2),
        });

        try {
            while (this.thresholdTime < targetTime && !this.isShuttingDown) {
                if (consecutiveEmptyBatches >= 3) {
                    this.logger.warn(
                        "[TradesProcessor] Too many empty batches, stopping backlog"
                    );
                    break;
                }

                try {
                    const aggregatedTrades =
                        await this.binanceFeed.fetchAggTradesByTime(
                            this.symbol,
                            this.thresholdTime
                        );

                    if (aggregatedTrades.length === 0) {
                        consecutiveEmptyBatches++;
                        this.logger.warn(
                            "[TradesProcessor] Empty batch received",
                            {
                                thresholdTime: this.thresholdTime,
                                consecutiveEmpty: consecutiveEmptyBatches,
                            }
                        );

                        // Move forward to avoid infinite loop
                        this.thresholdTime += 60000; // Skip 1 minute
                        continue;
                    }

                    consecutiveEmptyBatches = 0;
                    let batchProcessed = 0;
                    let maxTimestamp = this.thresholdTime;

                    // Process trades in batch
                    const tradesToSave: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                        [];

                    for (const trade of aggregatedTrades) {
                        if (!trade.T || !trade.p || !trade.q) {
                            this.logger.warn(
                                "[TradesProcessor] Invalid trade in backlog",
                                { trade }
                            );
                            continue;
                        }

                        if (trade.T > this.thresholdTime) {
                            maxTimestamp = Math.max(maxTimestamp, trade.T);
                            tradesToSave.push(trade);

                            // Also add to memory cache
                            const plotTrade: PlotTrade = {
                                time: trade.T,
                                price: parseFloat(trade.p),
                                quantity: parseFloat(trade.q),
                                orderType: trade.m ? "SELL" : "BUY",
                                symbol: this.symbol,
                                tradeId: trade.a ?? 0,
                            };
                            this.recentTrades.add(plotTrade);
                            batchProcessed++;
                        }
                    }

                    // Bulk save
                    if (tradesToSave.length > 0) {
                        await this.bulkSaveTrades(tradesToSave);
                        totalFetched += tradesToSave.length;
                    }

                    // Update threshold
                    this.thresholdTime = maxTimestamp + 1;

                    // Progress reporting
                    const progress =
                        ((this.thresholdTime -
                            (Date.now() - this.storageTime)) /
                            this.storageTime) *
                        100;
                    this.emit("backlog_progress", {
                        progress,
                        totalFetched,
                        currentTime: new Date(this.thresholdTime).toISOString(),
                    });

                    this.logger.info(
                        "[TradesProcessor] Backlog batch processed",
                        {
                            processed: batchProcessed,
                            total: totalFetched,
                            progress: `${progress.toFixed(2)}%`,
                        }
                    );

                    // Rate limiting
                    await this.sleep(100);
                } catch (error) {
                    retries++;
                    if (retries >= this.maxBacklogRetries) {
                        throw new Error(
                            `Max retries exceeded: ${error as Error}`
                        );
                    }

                    this.logger.warn(
                        "[TradesProcessor] Backlog fetch error, retrying",
                        {
                            error: (error as Error).message,
                            retry: retries,
                        }
                    );

                    await this.sleep(Math.pow(2, retries) * 1000);
                }
            }

            this.backlogComplete = true;
            const duration = Date.now() - startTime;

            this.logger.info("[TradesProcessor] Backlog fill complete", {
                totalFetched,
                durationMs: duration,
                durationMin: (duration / 60000).toFixed(2),
            });
        } catch (error) {
            this.handleError(error as Error, "fillBacklog");
            throw error;
        }
    }

    /**
     * Request recent trades from memory cache
     */
    public requestBacklog(amount: number): PlotTrade[] {
        try {
            // Validate amount
            const safeAmount = Math.min(
                Math.max(1, amount),
                this.maxMemoryTrades
            );

            // First try memory cache
            const memoryTrades = this.recentTrades.getAll();
            if (memoryTrades.length >= safeAmount) {
                return memoryTrades.slice(-safeAmount).reverse();
            }

            // Fall back to storage if needed
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

            // Update memory cache
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

            // Create plot trade
            const processedTrade: PlotTrade = {
                time: event.timestamp,
                price: event.price,
                quantity: event.quantity,
                orderType: event.buyerIsMaker ? "SELL" : "BUY",
                symbol: event.pair,
                tradeId: event.originalTrade.a ?? event.timestamp,
            };

            // Add to memory cache
            this.recentTrades.add(processedTrade);

            // Queue for async save
            this.queueSave(event.originalTrade);

            // Update metrics
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
            return {
                type: "error",
                now: Date.now(),
                data: {
                    message: (error as Error).message,
                    code: "TRADE_PROCESSING_ERROR",
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

                    // Re-queue failed items with retry count
                    batch.forEach((item) => {
                        item.retries++;
                        if (item.retries < 3) {
                            this.saveQueue.push(item);
                        } else {
                            this.failedSaves++;
                            this.logger.error(
                                "[TradesProcessor] Trade save permanently failed",
                                {
                                    tradeId: item.trade.a,
                                }
                            );
                        }
                    });
                } finally {
                    this.isSaving = false;
                }
            })();
        }, 1000); // Process every second
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

            // Cleanup old errors
            const cutoff = Date.now() - 60000;
            this.errorWindow = this.errorWindow.filter((t) => t > cutoff);
        }, this.healthCheckInterval);
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
            this.lastTradeTime = Date.now(); // Reset trade timeout
        });
    }

    /**
     * Get health status
     */
    public getHealth(): ProcessorHealth {
        const now = Date.now();
        const lastTradeAge = now - this.lastTradeTime;
        const memoryUsage = this.recentTrades.length * 100; // Rough estimate
        const errorRate = this.errorWindow.length;

        let status: "healthy" | "degraded" | "unhealthy" = "healthy";

        // Adjust health thresholds based on stream connection status
        const tradeTimeoutThreshold = this.isStreamConnected ? 60000 : 300000; // 5 minutes if stream is disconnected
        const degradedThreshold = this.isStreamConnected ? 30000 : 180000; // 3 minutes if stream is disconnected

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

        // Stop timers
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
        }
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }

        // Process remaining save queue
        if (this.saveQueue.length > 0) {
            this.logger.info(
                "[TradesProcessor] Processing remaining save queue",
                {
                    remaining: this.saveQueue.length,
                }
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

        // Clear memory
        this.recentTrades.clear();
        this.saveQueue = [];

        // Disconnect feed
        await this.binanceFeed.disconnect();

        this.logger.info("[TradesProcessor] Shutdown complete");
    }

    /**
     * Error handling
     */
    private handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.errorWindow.push(Date.now());
        this.metricsCollector.incrementMetric("tradesErrors");

        const errorContext = {
            context,
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            correlationId: correlationId || randomUUID(),
        };

        this.logger.error(
            `[${context}] ${error.message}`,
            errorContext,
            correlationId
        );
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
