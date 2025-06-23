// src/backtesting/marketSimulator.ts

import { EventEmitter } from "events";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type {
    EnrichedTradeEvent,
    PassiveLevel,
} from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";

export interface MarketDataPoint {
    timestamp: number;
    type: "trade" | "depth";
    data: TradeDataPoint | DepthDataPoint;
}

export interface TradeDataPoint {
    timestamp: number;
    price: number;
    quantity: number;
    side: "buy" | "sell";
    tradeId: string;
}

export interface DepthDataPoint {
    timestamp: number;
    side: "bid" | "ask";
    level: number;
    price: number;
    quantity: number;
}

export interface SimulatorConfig {
    dataDirectory: string;
    speedMultiplier: number; // 1 = real-time, 10 = 10x speed, etc.
    symbol: string;
    startDate?: string; // YYYY-MM-DD format
    endDate?: string; // YYYY-MM-DD format
}

/**
 * Market Data Simulator for Backtesting
 *
 * Replays historical trade and depth data in chronological order,
 * maintaining proper order book state and emitting enriched trade events
 * exactly as the live system does.
 */
export class MarketSimulator extends EventEmitter {
    private config: SimulatorConfig;
    private logger: ILogger;

    // Order book state tracking
    private orderBook = new Map<number, PassiveLevel>();
    private lastDepthUpdate = 0;

    // Streaming data processing - MEMORY FIX: No longer store all data points
    private currentDataPoints: MarketDataPoint[] = [];
    private dataFiles: string[] = [];
    private currentFileIndex = 0;
    private currentIndex = 0;
    private isRunning = false;
    private startTime = 0;
    private realStartTime = 0;

    // Memory management
    private readonly BATCH_SIZE = 5000; // Process in smaller batches
    private processedEventCount = 0;
    private totalEventsEstimate = 0;

    // Statistics
    private stats = {
        totalTrades: 0,
        totalDepthUpdates: 0,
        processedEvents: 0,
        priceMovements: [] as Array<{
            timestamp: number;
            price: number;
            percentChange: number;
            direction: "up" | "down";
        }>,
    };

    constructor(config: SimulatorConfig, logger: ILogger) {
        super();
        this.config = config;
        this.logger = logger;
    }

    /**
     * Load all market data files and prepare for simulation
     */
    public initialize(): void {
        this.logger.info("Initializing market simulator", {
            component: "MarketSimulator",
            dataDirectory: this.config.dataDirectory,
            symbol: this.config.symbol,
        });

        try {
            this.dataFiles = this.getDataFiles();
            this.currentDataPoints = [];

            // 🔧 MEMORY FIX: Streaming approach - load files one at a time
            this.logger.info("Initializing streaming market data loader", {
                component: "MarketSimulator",
                totalFiles: this.dataFiles.length,
                dataDirectory: this.config.dataDirectory,
                memoryUsage: Math.round(
                    process.memoryUsage().heapUsed / 1024 / 1024
                ),
            });

            // Estimate total events without loading everything
            this.totalEventsEstimate = this.estimateEventsCount();

            // Load first batch of data
            this.loadNextBatch();

            if (this.currentDataPoints.length === 0) {
                throw new Error("No market data found");
            }

            this.startTime = this.currentDataPoints[0].timestamp;

            this.logger.info("Market data streaming initialized", {
                component: "MarketSimulator",
                estimatedTotalEvents: this.totalEventsEstimate,
                initialBatchSize: this.currentDataPoints.length,
                totalFiles: this.dataFiles.length,
                memoryUsage: Math.round(
                    process.memoryUsage().heapUsed / 1024 / 1024
                ),
                timeRange: {
                    start: new Date(this.startTime).toISOString(),
                },
            });
        } catch (error) {
            this.logger.error("Failed to initialize market simulator", {
                component: "MarketSimulator",
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Start market data simulation
     */
    public start(): void {
        if (this.isRunning) {
            throw new Error("Simulator is already running");
        }

        if (this.currentDataPoints.length === 0) {
            throw new Error("No data loaded. Call initialize() first");
        }

        this.isRunning = true;
        this.currentIndex = 0;
        this.realStartTime = Date.now();

        this.logger.info("Starting market simulation", {
            component: "MarketSimulator",
            speedMultiplier: this.config.speedMultiplier,
            estimatedTotalEvents: this.totalEventsEstimate,
            memoryUsage: Math.round(
                process.memoryUsage().heapUsed / 1024 / 1024
            ),
        });

        this.emit("simulationStarted", {
            totalEvents: this.totalEventsEstimate,
            startTimestamp: this.startTime,
        });

        this.processNextEvent();
    }

    /**
     * Stop market data simulation
     */
    public stop(): void {
        this.isRunning = false;
        this.logger.info("Market simulation stopped", {
            component: "MarketSimulator",
            processedEvents: this.processedEventCount,
            progress:
                (
                    (this.processedEventCount / this.totalEventsEstimate) *
                    100
                ).toFixed(2) + "%",
            memoryUsage: Math.round(
                process.memoryUsage().heapUsed / 1024 / 1024
            ),
        });

        this.emit("simulationStopped", {
            processedEvents: this.processedEventCount,
            totalEvents: this.totalEventsEstimate,
        });
    }

    /**
     * Process the next event in the sequence
     */
    private processNextEvent(): void {
        // 🔧 MEMORY FIX: Check if we need to load more data
        if (this.currentIndex >= this.currentDataPoints.length) {
            if (this.currentFileIndex >= this.dataFiles.length) {
                // All data processed
                this.emit("simulationCompleted", {
                    totalEvents: this.processedEventCount,
                    stats: this.stats,
                });
                this.isRunning = false;
                return;
            }

            // Load next batch and clean up memory
            this.loadNextBatch();
            this.currentIndex = 0;

            // Force garbage collection hint
            if (global.gc && this.processedEventCount % 50000 === 0) {
                global.gc();
            }
        }

        if (
            !this.isRunning ||
            this.currentIndex >= this.currentDataPoints.length
        ) {
            this.isRunning = false;
            return;
        }

        const event = this.currentDataPoints[this.currentIndex];

        if (event.type === "trade") {
            this.processTradeEvent(event.data as TradeDataPoint);
        } else if (event.type === "depth") {
            this.processDepthEvent(event.data as DepthDataPoint);
            // Emit depth event for real order book processing
            this.emit("depthEvent", event.data as DepthDataPoint);
        }

        this.currentIndex++;
        this.stats.processedEvents++;
        this.processedEventCount++;

        // Emit progress updates every 10000 events
        if (this.processedEventCount % 10000 === 0) {
            const progress =
                (this.processedEventCount / this.totalEventsEstimate) * 100;
            this.emit("progress", {
                processed: this.processedEventCount,
                total: this.totalEventsEstimate,
                progress: progress,
                currentTimestamp: event.timestamp,
                memoryUsage: Math.round(
                    process.memoryUsage().heapUsed / 1024 / 1024
                ),
            });
        }

        // Schedule next event with timing simulation
        const nextDelay = this.calculateNextDelay(event.timestamp);
        setTimeout(() => this.processNextEvent(), nextDelay);
    }

    /**
     * Process a trade event and emit enriched trade event
     */
    private processTradeEvent(trade: TradeDataPoint): void {
        // Create depth snapshot from current order book state
        const depthSnapshot = new Map<number, PassiveLevel>();
        for (const [price, level] of this.orderBook) {
            depthSnapshot.set(price, { ...level });
        }

        // Create enriched trade event with properly formatted originalTrade
        const mockOriginalTrade = {
            e: "aggTrade", // Event type
            E: trade.timestamp, // Event time
            s: this.config.symbol, // Symbol
            a: parseInt(trade.tradeId), // Aggregate trade ID
            p: trade.price.toString(), // Price
            q: trade.quantity.toString(), // Quantity
            f: parseInt(trade.tradeId), // First trade ID
            l: parseInt(trade.tradeId), // Last trade ID
            T: trade.timestamp, // Trade time
            m: trade.side === "sell", // Is buyer maker
            M: true, // Ignore - always true for agg trades
        };

        const enrichedTrade: EnrichedTradeEvent = {
            price: trade.price,
            quantity: trade.quantity,
            timestamp: trade.timestamp,
            buyerIsMaker: trade.side === "sell", // If side is sell, buyer is maker
            tradeId: trade.tradeId,
            pair: this.config.symbol,
            originalTrade:
                mockOriginalTrade as unknown as import("@binance/spot").SpotWebsocketStreams.AggTradeResponse, // Cast to match interface

            // Calculate passive volumes from order book
            passiveBidVolume: this.getPassiveVolume(trade.price, "bid"),
            passiveAskVolume: this.getPassiveVolume(trade.price, "ask"),
            zonePassiveBidVolume: this.getZonePassiveVolume(trade.price, "bid"),
            zonePassiveAskVolume: this.getZonePassiveVolume(trade.price, "ask"),

            depthSnapshot,
            bestBid: this.getBestBid(),
            bestAsk: this.getBestAsk(),
        };

        // Track price movements for performance analysis
        this.trackPriceMovement(trade.price, trade.timestamp);

        // Emit the enriched trade event
        this.emit("enrichedTrade", enrichedTrade);
    }

    /**
     * Process a depth event and update order book state
     */
    private processDepthEvent(depth: DepthDataPoint): void {
        const level = this.orderBook.get(depth.price) || {
            price: depth.price,
            bid: 0,
            ask: 0,
            timestamp: depth.timestamp,
        };

        if (depth.side === "bid") {
            level.bid = depth.quantity;
        } else {
            level.ask = depth.quantity;
        }

        level.timestamp = depth.timestamp;

        if (level.bid === 0 && level.ask === 0) {
            this.orderBook.delete(depth.price);
        } else {
            this.orderBook.set(depth.price, level);
        }

        this.lastDepthUpdate = depth.timestamp;

        // 🔧 MEMORY FIX: Prune order book periodically to prevent memory bloat
        if (this.orderBook.size > 10000) {
            this.pruneOrderBook();
        }
    }

    /**
     * Calculate delay until next event based on timestamp and speed multiplier
     */
    private calculateNextDelay(currentTimestamp: number): number {
        if (this.currentIndex >= this.currentDataPoints.length - 1) {
            return 0;
        }

        const nextTimestamp =
            this.currentDataPoints[this.currentIndex + 1].timestamp;
        const realDelayMs = nextTimestamp - currentTimestamp;
        const simulatedDelayMs = realDelayMs / this.config.speedMultiplier;

        // Minimum delay to prevent overwhelming the system
        return Math.max(simulatedDelayMs, 1);
    }

    /**
     * 🔧 MEMORY FIX: Estimate total events without loading all data
     */
    private estimateEventsCount(): number {
        // Rough estimate: 12,000 trades per hour-file
        const tradeFiles = this.dataFiles.filter((f) =>
            f.includes("_trades.csv")
        ).length;
        const depthFiles = this.dataFiles.filter((f) =>
            f.includes("_depth.csv")
        ).length;

        // Conservative estimates based on typical market data
        return tradeFiles * 12000 + depthFiles * 8000;
    }

    /**
     * 🔧 MEMORY FIX: Load next batch of data and clean up previous batch
     */
    private loadNextBatch(): void {
        // Clean up previous batch
        this.currentDataPoints = [];

        if (this.currentFileIndex >= this.dataFiles.length) {
            return;
        }

        const batchStart = this.currentFileIndex;
        const batchEnd = Math.min(
            this.currentFileIndex + 2,
            this.dataFiles.length
        ); // Process 2 files at a time

        this.logger.debug("Loading next data batch", {
            component: "MarketSimulator",
            batchStart,
            batchEnd,
            totalFiles: this.dataFiles.length,
            memoryUsageBefore: Math.round(
                process.memoryUsage().heapUsed / 1024 / 1024
            ),
        });

        // Load next batch of files
        for (let i = batchStart; i < batchEnd; i++) {
            const file = this.dataFiles[i];

            if (file.includes("_trades.csv")) {
                const trades = this.loadTradesFile(file);
                this.currentDataPoints = this.currentDataPoints.concat(trades);
                this.stats.totalTrades += trades.length;
            } else if (file.includes("_depth.csv")) {
                const depths = this.loadDepthFile(file);
                this.currentDataPoints = this.currentDataPoints.concat(depths);
                this.stats.totalDepthUpdates += depths.length;
            }
        }

        // Sort current batch by timestamp
        this.currentDataPoints.sort((a, b) => a.timestamp - b.timestamp);

        this.currentFileIndex = batchEnd;

        this.logger.debug("Batch loaded successfully", {
            component: "MarketSimulator",
            batchSize: this.currentDataPoints.length,
            filesProcessed: this.currentFileIndex,
            totalFiles: this.dataFiles.length,
            memoryUsageAfter: Math.round(
                process.memoryUsage().heapUsed / 1024 / 1024
            ),
        });
    }

    /**
     * Get list of data files to process
     */
    private getDataFiles(): string[] {
        const files = readdirSync(this.config.dataDirectory)
            .filter(
                (file) =>
                    file.includes(this.config.symbol) &&
                    (file.endsWith("_trades.csv") ||
                        file.endsWith("_depth.csv"))
            )
            .map((file) => join(this.config.dataDirectory, file))
            .sort(); // Ensure chronological order

        if (this.config.startDate || this.config.endDate) {
            return files.filter((file) => this.isFileInDateRange(file));
        }

        return files;
    }

    /**
     * Check if file is within specified date range
     */
    private isFileInDateRange(filePath: string): boolean {
        const filename = filePath.split("/").pop() || "";
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);

        if (!dateMatch) return true;

        const fileDate = dateMatch[1];

        if (this.config.startDate && fileDate < this.config.startDate) {
            return false;
        }

        if (this.config.endDate && fileDate > this.config.endDate) {
            return false;
        }

        return true;
    }

    /**
     * Load trades from CSV file
     */
    private loadTradesFile(filePath: string): MarketDataPoint[] {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n").slice(1); // Skip header
        const trades: MarketDataPoint[] = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const [timestamp, price, quantity, side, tradeId] = line.split(",");

            trades.push({
                timestamp: parseInt(timestamp),
                type: "trade",
                data: {
                    timestamp: parseInt(timestamp),
                    price: parseFloat(price),
                    quantity: parseFloat(quantity),
                    side: side as "buy" | "sell",
                    tradeId: tradeId.trim(),
                },
            });
        }

        return trades;
    }

    /**
     * Load depth data from CSV file
     */
    private loadDepthFile(filePath: string): MarketDataPoint[] {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n").slice(1); // Skip header
        const depths: MarketDataPoint[] = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const [timestamp, side, level, price, quantity] = line.split(",");

            depths.push({
                timestamp: parseInt(timestamp),
                type: "depth",
                data: {
                    timestamp: parseInt(timestamp),
                    side: side as "bid" | "ask",
                    level: parseInt(level),
                    price: parseFloat(price),
                    quantity: parseFloat(quantity),
                },
            });
        }

        return depths;
    }

    /**
     * Get passive volume at specific price level
     */
    private getPassiveVolume(price: number, side: "bid" | "ask"): number {
        const level = this.orderBook.get(price);
        if (!level) return 0;
        return side === "bid" ? level.bid : level.ask;
    }

    /**
     * Get passive volume in zone around price
     */
    private getZonePassiveVolume(price: number, side: "bid" | "ask"): number {
        const tolerance = price * 0.001; // 0.1% zone
        let total = 0;

        for (const [levelPrice, level] of this.orderBook) {
            if (Math.abs(levelPrice - price) <= tolerance) {
                total += side === "bid" ? level.bid : level.ask;
            }
        }

        return total;
    }

    /**
     * Get best bid price
     */
    private getBestBid(): number {
        let bestBid = 0;
        for (const [price, level] of this.orderBook) {
            if (level.bid > 0 && price > bestBid) {
                bestBid = price;
            }
        }
        return bestBid;
    }

    /**
     * Get best ask price
     */
    private getBestAsk(): number {
        let bestAsk = Infinity;
        for (const [price, level] of this.orderBook) {
            if (level.ask > 0 && price < bestAsk) {
                bestAsk = price;
            }
        }
        return bestAsk === Infinity ? 0 : bestAsk;
    }

    /**
     * Track price movements for performance analysis
     * 🔧 MEMORY FIX: Limit price movements array size
     */
    private trackPriceMovement(price: number, timestamp: number): void {
        if (this.stats.priceMovements.length === 0) {
            this.stats.priceMovements.push({
                timestamp,
                price,
                percentChange: 0,
                direction: "up",
            });
            return;
        }

        const lastMovement =
            this.stats.priceMovements[this.stats.priceMovements.length - 1];
        const percentChange =
            ((price - lastMovement.price) / lastMovement.price) * 100;

        if (Math.abs(percentChange) >= 0.7) {
            this.stats.priceMovements.push({
                timestamp,
                price,
                percentChange,
                direction: percentChange > 0 ? "up" : "down",
            });

            // 🔧 MEMORY FIX: Limit array size to prevent memory accumulation
            if (this.stats.priceMovements.length > 1000) {
                this.stats.priceMovements =
                    this.stats.priceMovements.slice(-500); // Keep last 500
            }

            // Emit significant price movement
            this.emit("priceMovement", {
                timestamp,
                price,
                percentChange,
                direction: percentChange > 0 ? "up" : "down",
                fromPrice: lastMovement.price,
            });
        }
    }

    /**
     * Get simulation statistics
     */
    public getStats(): typeof this.stats {
        return { ...this.stats };
    }

    /**
     * Get significant price movements (>=0.7%)
     */
    public getPriceMovements(): Array<{
        timestamp: number;
        price: number;
        percentChange: number;
        direction: "up" | "down";
    }> {
        return [...this.stats.priceMovements];
    }

    /**
     * 🔧 MEMORY FIX: Prune order book to prevent memory bloat
     */
    private pruneOrderBook(): void {
        // Remove levels with zero volume and old timestamps
        const cutoff = this.lastDepthUpdate - 300000; // 5 minutes old
        const pricesToRemove: number[] = [];

        for (const [price, level] of this.orderBook) {
            if (
                (level.bid === 0 && level.ask === 0) ||
                level.timestamp < cutoff
            ) {
                pricesToRemove.push(price);
            }
        }

        for (const price of pricesToRemove) {
            this.orderBook.delete(price);
        }

        this.logger.debug("Order book pruned", {
            component: "MarketSimulator",
            removedLevels: pricesToRemove.length,
            remainingLevels: this.orderBook.size,
            memoryUsage: Math.round(
                process.memoryUsage().heapUsed / 1024 / 1024
            ),
        });
    }

    /**
     * 🔧 MEMORY FIX: Cleanup resources and force garbage collection
     */
    public cleanup(): void {
        this.stop();
        this.currentDataPoints = [];
        this.orderBook.clear();
        this.stats.priceMovements = [];

        this.logger.info("MarketSimulator cleanup completed", {
            component: "MarketSimulator",
            memoryUsage: Math.round(
                process.memoryUsage().heapUsed / 1024 / 1024
            ),
        });

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
    }
}
