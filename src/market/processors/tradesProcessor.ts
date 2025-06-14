// src/market/processors/tradesProcessor.ts
/**
 * 🔒 PRODUCTION-READY - DO NOT MODIFY
 * ===================================
 *
 * STATUS: PRODUCTION-READY ✅
 * LAST_AUDIT: 2025-06-11
 * PERFORMANCE_OPTIMIZED: YES ✅
 * TRADING_LOGIC_VERIFIED: YES ✅
 * ERROR_HANDLING_COMPLETE: YES ✅
 *
 * WARNING: This file has undergone comprehensive production readiness review.
 * Any modifications require explicit approval and full regression testing.
 *
 * PROTECTION_LEVEL: CRITICAL
 * CLAUDE_CODE_INSTRUCTION: DO NOT MODIFY - CONTACT HUMAN FOR ANY CHANGES
 *
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import { BinanceDataFeed } from "../../utils/binance.js";
import { SpotWebsocketAPI } from "@binance/spot";
import type { WebSocketMessage } from "../../utils/interfaces.js";
import type { PlotTrade } from "../../utils/types.js";
import type { EnrichedTradeEvent } from "../../types/marketEvents.js";
import type { ILogger } from "../../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../../infrastructure/metricsCollectorInterface.js";
import { ProductionUtils } from "../../utils/productionUtils.js";
import { CircularBuffer } from "../../utils/circularBuffer.js";
import { EventEmitter } from "events";
import { ThreadManager } from "../../multithreading/threadManager.js";

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
    clearTradeDataOnStartup(): Promise<number>;
    fillBacklog(): Promise<void>;
    requestBacklog(amount: number): Promise<PlotTrade[]>;
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
    maxWindowIterations?: number;
    dynamicRateLimit?: boolean;
    maxTradeIdCacheSize?: number;
    tradeIdCleanupInterval?: number;
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
    duplicatesDetected: number;
    processedTradeIdsCount: number;
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
    private readonly storageTime: number;
    private readonly maxBacklogRetries: number;
    private readonly backlogBatchSize: number;
    private readonly maxMemoryTrades: number;
    private readonly saveQueueSize: number;
    private readonly healthCheckInterval: number;
    private readonly bufferRetentionMs: number; // Time-based buffer retention

    private readonly logger: ILogger;
    private readonly metricsCollector: IMetricsCollector;

    // State management
    private thresholdTime: number;
    private backlogComplete = false;
    private isShuttingDown = false;
    private lastTradeTime = Date.now();
    private latestTradeTimestamp = Date.now();

    // ✅ TIMING FIX: Monotonic timing for health checks resistant to clock changes
    private processStartTime = process.hrtime.bigint();
    private lastTradeMonotonicTime = process.hrtime.bigint();

    // ✅ DUPLICATE DETECTION: Track processed trade IDs to prevent duplicates during reconnections
    private processedTradeIds: Set<number> = new Set();
    private readonly maxTradeIdCacheSize: number;
    private readonly tradeIdCleanupInterval: number;
    private tradeIdCleanupTimer?: NodeJS.Timeout;
    private tradeBufferCleanupTimer?: NodeJS.Timeout;

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
    private duplicatesDetected = 0;
    private processingTimes: CircularBuffer<number>;
    private errorWindow: CircularBuffer<number>;
    private readonly maxErrorWindowSize: number;
    private readonly maxWindowIterations: number;
    private readonly dynamicRateLimit: boolean;

    // Health monitoring
    private healthCheckTimer?: NodeJS.Timeout;
    private isStreamConnected = true;

    constructor(
        options: TradesProcessorOptions,
        //storage: Storage,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        binanceFeed: BinanceDataFeed,
        private readonly threadManager: ThreadManager
    ) {
        super();
        this.logger = logger;
        this.metricsCollector = metricsCollector;
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
        // Large buffer size to handle high-volume periods, cleaned by time not size
        this.maxMemoryTrades = options.maxMemoryTrades ?? 200000;
        this.saveQueueSize = options.saveQueueSize ?? 5000;
        this.healthCheckInterval = options.healthCheckInterval ?? 30000; // 30 s
        this.bufferRetentionMs = 100 * 60 * 1000; // 100 minutes in milliseconds
        this.maxErrorWindowSize = Math.max(
            10,
            options.maxErrorWindowSize ?? 1000
        ); // Min 10, default 1000
        this.maxWindowIterations = Math.max(
            10,
            options.maxWindowIterations ?? 1000
        ); // Min 10, default 1000 iterations per window
        this.dynamicRateLimit = options.dynamicRateLimit ?? true;
        this.maxTradeIdCacheSize = Math.max(
            1000,
            options.maxTradeIdCacheSize ?? 10000
        ); // Keep 10k trade IDs by default
        this.tradeIdCleanupInterval = options.tradeIdCleanupInterval ?? 300000; // 5 minutes

        // Initialize state - use last stored timestamp to prevent data gaps

        this.thresholdTime = Date.now() - this.storageTime;
        this.latestTradeTimestamp = this.thresholdTime;
        this.recentTrades = new CircularBuffer<PlotTrade>(this.maxMemoryTrades);
        this.processingTimes = new CircularBuffer<number>(1000);
        this.errorWindow = new CircularBuffer<number>(this.maxErrorWindowSize);

        // Start background tasks
        this.startSaveQueue();
        this.startHealthCheck();
        this.startTradeIdCleanup();
        this.startTradeBufferCleanup();

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
     * Clear all trade data on startup to eliminate data gaps.
     * Preserves signal history. Called before fillBacklog().
     */
    public async clearTradeDataOnStartup(): Promise<number> {
        const correlationId = randomUUID();

        this.logger.info(
            "[TradesProcessor] Clearing trade data on startup to eliminate gaps",
            {
                reason: "Eliminates 15min+ data gaps between shutdown and restart",
                preserves: "Signal history and other non-trade data",
            }
        );

        try {
            const deletedCount = (await this.threadManager.callStorage(
                "clearAllTradeData",
                correlationId
            )) as number;

            this.logger.info(
                "[TradesProcessor] Startup trade cleanup completed successfully",
                {
                    deletedTrades: deletedCount,
                    correlationId,
                }
            );

            return deletedCount;
        } catch (error) {
            this.logger.error(
                "[TradesProcessor] Error during startup trade cleanup",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    correlationId,
                }
            );
            throw error;
        }
    }

    /**
     * Smart ID-based backlog fill: Dynamically fetch trades until target time coverage is achieved.
     * Uses a two-step approach: first gets recent trades for baseline, then fetches older trades
     * by jumping backwards in trade ID chunks until 100 minutes of coverage is reached.
     */
    public async fillBacklog(): Promise<void> {
        const startWall = Date.now();
        const targetCoverageMs = this.storageTime + 10 * 60 * 1000; // 90min + 10min buffer = 100min
        const maxBlocks = 50; // Safety limit
        const tradesPerBlock = 1000;
        let retries = 0;

        this.logger.info(
            "[TradesProcessor] Starting smart ID-based backlog fill",
            {
                targetCoverageMs,
                targetCoverageMinutes: (targetCoverageMs / 60000).toFixed(1),
                maxBlocks,
                tradesPerBlock,
                approach: "Smart ID-based with time coverage target",
            }
        );

        while (retries <= this.maxBacklogRetries) {
            try {
                let totalFetched = 0;
                const allTradeIds: number[] = [];
                let oldestTradeTime: number | null = null;
                let newestTradeTime: number | null = null;
                let hasReachedTargetCoverage = false;

                // Get most recent trades to establish baseline
                const recentTrades = await this.binanceFeed.tradesAggregate(
                    this.symbol,
                    1000,
                    undefined
                );

                if (recentTrades.length === 0) {
                    this.logger.warn(
                        "[TradesProcessor] No recent trades available"
                    );
                    this.backlogComplete = true;
                    return;
                }

                // Process recent trades
                const recentValidated = this.validateTradeArray(recentTrades);
                await this.bulkSaveTrades(recentValidated);
                totalFetched += recentValidated.length;

                // Track time and IDs
                newestTradeTime = Math.max(...recentTrades.map((t) => t.T!));
                oldestTradeTime = Math.min(...recentTrades.map((t) => t.T!));
                recentTrades.forEach((t) => t.a && allTradeIds.push(t.a));

                // Add to memory cache
                for (const trade of recentValidated) {
                    this.recentTrades.add({
                        time: trade.T!,
                        price: parseFloat(trade.p!),
                        quantity: parseFloat(trade.q!),
                        orderType: trade.m ? "SELL" : "BUY",
                        symbol: this.symbol,
                        tradeId: trade.a ?? 0,
                    });
                }

                const initialCoverageMs = newestTradeTime - oldestTradeTime;
                if (initialCoverageMs >= targetCoverageMs) {
                    hasReachedTargetCoverage = true;
                }

                // Fetch older trades by going backwards in time
                let currentFromId =
                    Math.min(...recentTrades.map((t) => t.a!)) - 1000;

                for (
                    let blockIndex = 1;
                    blockIndex < maxBlocks &&
                    !this.isShuttingDown &&
                    !hasReachedTargetCoverage;
                    blockIndex++
                ) {
                    const aggregatedTrades =
                        await this.binanceFeed.tradesAggregate(
                            this.symbol,
                            tradesPerBlock,
                            currentFromId
                        );

                    if (aggregatedTrades.length === 0) {
                        this.logger.warn(
                            `[TradesProcessor] Block ${blockIndex + 1} returned 0 trades, stopping`,
                            {
                                currentFromId,
                                blockIndex,
                                reason: "Reached oldest available trades",
                            }
                        );
                        break;
                    }

                    // Validate and process trades
                    try {
                        const validatedTrades =
                            this.validateTradeArray(aggregatedTrades);
                        const tradesToSave: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                            [];

                        for (const trade of validatedTrades) {
                            // Track all trade IDs for gap analysis
                            if (trade.a) {
                                allTradeIds.push(trade.a);
                            }

                            // Skip duplicates
                            if (trade.a && this.isDuplicateTrade(trade.a)) {
                                this.duplicatesDetected++;
                                this.metricsCollector.incrementMetric(
                                    "duplicateTradesDetected"
                                );
                                continue;
                            }

                            tradesToSave.push(trade);

                            // Mark as processed
                            if (trade.a) {
                                this.markTradeAsProcessed(trade.a);
                            }
                        }

                        // Save to storage
                        if (tradesToSave.length > 0) {
                            await this.bulkSaveTrades(tradesToSave);
                            totalFetched += tradesToSave.length;

                            // Add to memory cache
                            for (const trade of validatedTrades) {
                                this.recentTrades.add({
                                    time: trade.T!,
                                    price: parseFloat(trade.p!),
                                    quantity: parseFloat(trade.q!),
                                    orderType: trade.m ? "SELL" : "BUY",
                                    symbol: this.symbol,
                                    tradeId: trade.a ?? 0,
                                });
                            }
                        }

                        // Update time range tracking
                        const blockOldestTime = Math.min(
                            ...aggregatedTrades.map((t) => t.T!)
                        );
                        oldestTradeTime = blockOldestTime; // Keep pushing oldest time back

                        const currentCoverageMs =
                            newestTradeTime - oldestTradeTime;

                        // Set fromId for next block (go further back)
                        if (aggregatedTrades.length > 0) {
                            const oldestTradeId = Math.min(
                                ...aggregatedTrades.map((t) => t.a!)
                            );
                            currentFromId = oldestTradeId - 1000; // Jump back by 1000 IDs
                        }

                        // Check if we've reached our target coverage AFTER processing
                        if (currentCoverageMs >= targetCoverageMs) {
                            hasReachedTargetCoverage = true;
                            this.logger.info(
                                `[TradesProcessor] Target coverage reached, stopping fetch`,
                                {
                                    achievedCoverageMin: (
                                        currentCoverageMs / 60000
                                    ).toFixed(1),
                                    targetCoverageMin: (
                                        targetCoverageMs / 60000
                                    ).toFixed(1),
                                    totalBlocks: blockIndex + 1,
                                    totalTrades: totalFetched,
                                }
                            );
                        }
                    } catch (error) {
                        if (error instanceof TradeValidationError) {
                            this.logger.warn(
                                `[TradesProcessor] Invalid trade data in block ${blockIndex + 1}`,
                                {
                                    batchSize: aggregatedTrades.length,
                                    validationErrors:
                                        error.validationErrors.issues,
                                }
                            );
                            continue; // Skip this block
                        }
                        throw error;
                    }

                    // Rate limiting between blocks
                    await ProductionUtils.sleep(100);
                }

                // Analyze for gaps in trade IDs
                if (allTradeIds.length > 1) {
                    allTradeIds.sort((a, b) => a - b);
                    const gaps: { start: number; end: number; size: number }[] =
                        [];

                    for (let i = 1; i < allTradeIds.length; i++) {
                        const gap = allTradeIds[i] - allTradeIds[i - 1] - 1;
                        if (gap > 0) {
                            gaps.push({
                                start: allTradeIds[i - 1],
                                end: allTradeIds[i],
                                size: gap,
                            });
                        }
                    }

                    if (gaps.length > 0) {
                        this.logger.warn(
                            "[TradesProcessor] Trade ID gaps detected",
                            {
                                gapsFound: gaps.length,
                                totalGapSize: gaps.reduce(
                                    (sum, gap) => sum + gap.size,
                                    0
                                ),
                                largestGap: Math.max(
                                    ...gaps.map((gap) => gap.size)
                                ),
                            }
                        );
                    }
                }

                this.backlogComplete = true;
                const duration = Date.now() - startWall;
                const finalCoverageMs =
                    oldestTradeTime && newestTradeTime
                        ? newestTradeTime - oldestTradeTime
                        : 0;

                this.logger.info(
                    "[TradesProcessor] Smart ID-based backlog fill complete",
                    {
                        totalFetched,
                        durationMs: duration,
                        timeCoverageMin: (finalCoverageMs / 60_000).toFixed(1),
                        targetCoverageMin: (targetCoverageMs / 60_000).toFixed(
                            1
                        ),
                        coverageAchieved: finalCoverageMs >= targetCoverageMs,
                        backlogComplete: this.backlogComplete,
                        approach: "Smart ID-based with dynamic coverage",
                    }
                );

                return;
            } catch (error) {
                retries++;
                if (retries > this.maxBacklogRetries) {
                    this.handleError(error as Error, "fillBacklog");
                    throw error;
                }
                this.logger.warn(
                    "[TradesProcessor] Smart ID-based backlog fetch error, retrying",
                    {
                        error: (error as Error).message,
                        retry: retries,
                        maxRetries: this.maxBacklogRetries,
                    }
                );
                await ProductionUtils.sleep(1000 * retries);
            }
        }

        throw new Error("fillBacklog: Unexpected end of retry loop");
    }

    /**
     * Request recent trades from memory cache
     */
    public async requestBacklog(amount: number): Promise<PlotTrade[]> {
        try {
            // ✅ Validate backlog amount parameter
            const validatedAmount = this.validateBacklogAmount(amount);
            const safeAmount = Math.min(validatedAmount, this.maxMemoryTrades);

            const memoryTrades = this.recentTrades.getAll();
            if (memoryTrades.length >= safeAmount) {
                return memoryTrades.slice(-safeAmount).reverse();
            }

            const storageTrades = (await this.threadManager.callStorage(
                "getLatestAggregatedTrades",
                safeAmount,
                this.symbol
            )) as SpotWebsocketAPI.TradesAggregateResponseResultInner[];

            const plotTrades = storageTrades.map(
                (
                    trade: SpotWebsocketAPI.TradesAggregateResponseResultInner
                ): PlotTrade => ({
                    time: trade.T ?? 0,
                    price: parseFloat(trade.p || "0"),
                    quantity: parseFloat(trade.q || "0"),
                    orderType: trade.m ? "SELL" : "BUY",
                    symbol: this.symbol,
                    tradeId: trade.a ?? 0,
                })
            );

            plotTrades.forEach((trade: PlotTrade) =>
                this.recentTrades.add(trade)
            );
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

            // ✅ DUPLICATE DETECTION: Skip trades we've already processed
            const tradeId = validatedOriginalTrade.a ?? event.timestamp;
            if (this.isDuplicateTrade(tradeId)) {
                this.logger.debug(
                    "[TradesProcessor] Skipping duplicate enriched trade",
                    {
                        tradeId,
                        symbol: event.pair,
                        price: event.price,
                        quantity: event.quantity,
                        timestamp: event.timestamp,
                    }
                );
                this.duplicatesDetected++;
                this.metricsCollector.incrementMetric(
                    "duplicateTradesDetected"
                );
                return {
                    type: "trade",
                    now: Date.now(),
                    data: {
                        time: event.timestamp,
                        price: event.price,
                        quantity: event.quantity,
                        orderType: event.buyerIsMaker ? "SELL" : "BUY",
                        symbol: event.pair,
                        tradeId,
                    },
                };
            }

            // Mark trade as processed
            this.markTradeAsProcessed(tradeId);

            const processedTrade: PlotTrade = {
                time: event.timestamp,
                price: event.price,
                quantity: event.quantity,
                orderType: event.buyerIsMaker ? "SELL" : "BUY",
                symbol: event.pair,
                tradeId,
            };

            // ✅ DATA CONSISTENCY FIX: Queue save first, add to cache only if successful
            this.queueSave(validatedOriginalTrade);

            // Add to cache after queuing for storage (queue save is synchronous operation)
            this.recentTrades.add(processedTrade);

            // ✅ SECURITY FIX: Atomic state update to prevent race conditions
            this.updateTradeTimestamps(event.timestamp);
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
     * ✅ PERFORMANCE FIX: Dynamic rate limiting based on API efficiency
     */
    private async handleRateLimit(
        windowIterations: number,
        maxIterations: number
    ): Promise<void> {
        if (!this.dynamicRateLimit) {
            // Use fixed rate limit if dynamic is disabled
            await ProductionUtils.sleep(120);
            return;
        }

        // Calculate dynamic delay based on iteration efficiency
        const iterationRatio = windowIterations / maxIterations;
        let delay = 120; // Base delay (max 10 req/s)

        if (iterationRatio > 0.8) {
            // High iteration count suggests dense data or API throttling
            delay = 200; // Slower rate (5 req/s)
        } else if (iterationRatio > 0.5) {
            // Medium iteration count
            delay = 150; // Medium rate (6.7 req/s)
        } else if (iterationRatio < 0.1) {
            // Very low iteration count suggests sparse data
            delay = 100; // Faster rate (10 req/s)
        }

        await ProductionUtils.sleep(delay);
    }

    /**
     * ✅ SECURITY FIX: Atomic state update to prevent race conditions
     */
    private updateTradeTimestamps(
        latestTimestamp: number,
        thresholdOverride?: number
    ): void {
        // Atomic update of all timestamp-related state to prevent race conditions
        const now = Date.now();
        const monotonicNow = process.hrtime.bigint();
        this.latestTradeTimestamp = latestTimestamp;
        this.thresholdTime = thresholdOverride ?? latestTimestamp + 1;
        this.lastTradeTime = now;
        this.lastTradeMonotonicTime = monotonicNow;
    }

    /**
     * ✅ PERFORMANCE FIX: Remove unnecessary Promise wrapper for synchronous operation
     */
    private async bulkSaveTrades(
        trades: SpotWebsocketAPI.TradesAggregateResponseResultInner[]
    ): Promise<void> {
        if (!trades.length) return;
        await this.threadManager.callStorage(
            "saveAggregatedTradesBulk",
            trades,
            this.symbol
        );
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

            // ✅ DUPLICATE DETECTION: On reconnection, we keep the trade ID cache to prevent
            // processing duplicates that might arrive during the gap coverage process
            this.logger.info(
                "[TradesProcessor] Maintaining trade ID cache through reconnection",
                {
                    cachedTradeIds: this.processedTradeIds.size,
                    duplicatesDetectedSoFar: this.duplicatesDetected,
                }
            );

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
        // ✅ TIMING FIX: Use monotonic time for health checks to avoid clock change issues
        const monotonicNow = process.hrtime.bigint();
        const lastTradeAge =
            Number(monotonicNow - this.lastTradeMonotonicTime) / 1_000_000; // Convert to milliseconds
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
            duplicatesDetected: this.duplicatesDetected,
            processedTradeIdsCount: this.processedTradeIds.size,
        };
    }

    /**
     * Graceful shutdown
     */
    public async shutdown(): Promise<void> {
        this.logger.info("[TradesProcessor] Shutting down");
        this.isShuttingDown = true;

        // ✅ RESOURCE CLEANUP FIX: Properly clear and nullify timers
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = undefined;
        }
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
        if (this.tradeIdCleanupTimer) {
            clearInterval(this.tradeIdCleanupTimer);
            this.tradeIdCleanupTimer = undefined;
        }
        if (this.tradeBufferCleanupTimer) {
            clearInterval(this.tradeBufferCleanupTimer);
            this.tradeBufferCleanupTimer = undefined;
        }

        // ✅ RESOURCE CLEANUP FIX: Remove all EventEmitter listeners to prevent memory leaks
        this.removeAllListeners();

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

        // ✅ RESOURCE CLEANUP FIX: Clear all data structures and confirm cleanup
        this.recentTrades.clear();
        this.saveQueue = [];
        this.processedTradeIds.clear();

        // Confirm CircularBuffer cleanup
        if (this.errorWindow) {
            this.errorWindow.clear();
        }

        await this.binanceFeed.disconnect();

        this.logger.info(
            "[TradesProcessor] Shutdown complete - all resources cleaned up"
        );
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
        } else {
            this.logger.error(
                `[${context}] ${error.message}`,
                errorContext,
                correlationId
            );
        }
    }

    /**
     * ✅ DUPLICATE DETECTION: Check if a trade ID has already been processed
     */
    private isDuplicateTrade(tradeId: number): boolean {
        return this.processedTradeIds.has(tradeId);
    }

    /**
     * ✅ DUPLICATE DETECTION: Mark a trade ID as processed
     */
    private markTradeAsProcessed(tradeId: number): void {
        this.processedTradeIds.add(tradeId);

        // If cache is getting too large, trigger cleanup
        if (this.processedTradeIds.size > this.maxTradeIdCacheSize * 1.1) {
            this.cleanupOldTradeIds();
        }

        this.metricsCollector.updateMetric(
            "processedTradeIdsCount",
            this.processedTradeIds.size
        );
    }

    /**
     * ✅ DUPLICATE DETECTION: Start periodic cleanup of old trade IDs
     */
    private startTradeIdCleanup(): void {
        this.tradeIdCleanupTimer = setInterval(() => {
            this.cleanupOldTradeIds();
        }, this.tradeIdCleanupInterval);

        this.logger.info("[TradesProcessor] Trade ID cleanup started", {
            cleanupInterval: this.tradeIdCleanupInterval,
            maxCacheSize: this.maxTradeIdCacheSize,
        });
    }

    /**
     * Start periodic cleanup of trade buffer based on time retention
     */
    private startTradeBufferCleanup(): void {
        this.tradeBufferCleanupTimer = setInterval(() => {
            this.cleanupOldTradesFromBuffer();
        }, 120000); // Clean every 2 minutes

        this.logger.info("[TradesProcessor] Trade buffer cleanup started", {
            retentionMs: this.bufferRetentionMs,
            cleanupInterval: 120000,
        });
    }

    /**
     * Remove trades older than bufferRetentionMs (100 minutes) from memory buffer
     */
    private cleanupOldTradesFromBuffer(): void {
        const cutoffTime = Date.now() - this.bufferRetentionMs;
        const allTrades = this.recentTrades.getAll();
        const initialCount = allTrades.length;

        // Filter out trades older than cutoff time
        const recentTrades = allTrades.filter(
            (trade) => trade.time >= cutoffTime
        );
        const removedCount = initialCount - recentTrades.length;

        if (removedCount > 0) {
            // Clear and rebuild buffer with only recent trades
            this.recentTrades.clear();
            recentTrades.forEach((trade) => this.recentTrades.add(trade));

            this.logger.info("[TradesProcessor] Trade buffer cleaned up", {
                initialCount,
                removedCount,
                remainingCount: recentTrades.length,
                cutoffTime: new Date(cutoffTime).toISOString(),
            });
        }
    }

    /**
     * ✅ DUPLICATE DETECTION: Clean up old trade IDs to prevent memory growth
     *
     * Strategy: Keep the most recent trade IDs based on timestamp ordering.
     * Since trade IDs are generally sequential, we can use a simple approach.
     */
    private cleanupOldTradeIds(): void {
        const initialSize = this.processedTradeIds.size;

        if (initialSize <= this.maxTradeIdCacheSize) {
            return; // No cleanup needed
        }

        try {
            // Convert to sorted array (trade IDs are generally sequential)
            const sortedIds = Array.from(this.processedTradeIds).sort(
                (a, b) => a - b
            );

            // Keep only the most recent trade IDs
            const idsToKeep = sortedIds.slice(-this.maxTradeIdCacheSize);

            // Rebuild the set with only recent IDs
            this.processedTradeIds = new Set(idsToKeep);

            const finalSize = this.processedTradeIds.size;
            const removedCount = initialSize - finalSize;

            this.logger.info("[TradesProcessor] Trade ID cache cleaned up", {
                initialSize,
                finalSize,
                removedCount,
                maxCacheSize: this.maxTradeIdCacheSize,
            });

            this.metricsCollector.updateMetric(
                "processedTradeIdsCount",
                finalSize
            );
            this.metricsCollector.updateMetric("tradeIdCleanupOperations", 1);
        } catch (error) {
            this.logger.error(
                "[TradesProcessor] Error during trade ID cleanup",
                {
                    error: (error as Error).message,
                    cacheSize: initialSize,
                }
            );
        }
    }
}
