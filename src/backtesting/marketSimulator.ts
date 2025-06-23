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

    // Data processing
    private allDataPoints: MarketDataPoint[] = [];
    private currentIndex = 0;
    private isRunning = false;
    private startTime = 0;
    private realStartTime = 0;

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
            const dataFiles = this.getDataFiles();
            this.allDataPoints = [];

            // Process ALL data files for realistic live market simulation
            this.logger.info("Loading complete market dataset", {
                component: "MarketSimulator",
                totalFiles: dataFiles.length,
                dataDirectory: this.config.dataDirectory,
            });

            let processedFiles = 0;
            for (const file of dataFiles) {
                processedFiles++;

                if (file.includes("_trades.csv")) {
                    const trades = this.loadTradesFile(file);
                    this.allDataPoints = this.allDataPoints.concat(trades);
                    this.stats.totalTrades += trades.length;

                    this.logger.debug("Loaded trades file", {
                        component: "MarketSimulator",
                        file: file.split("/").pop(),
                        tradesLoaded: trades.length,
                        totalTrades: this.stats.totalTrades,
                        progress: `${processedFiles}/${dataFiles.length}`,
                    });
                } else if (file.includes("_depth.csv")) {
                    const depths = this.loadDepthFile(file);
                    this.allDataPoints = this.allDataPoints.concat(depths);
                    this.stats.totalDepthUpdates += depths.length;

                    this.logger.debug("Loaded depth file", {
                        component: "MarketSimulator",
                        file: file.split("/").pop(),
                        depthUpdatesLoaded: depths.length,
                        totalDepthUpdates: this.stats.totalDepthUpdates,
                        progress: `${processedFiles}/${dataFiles.length}`,
                    });
                }

                // Log progress every 10 files
                if (
                    processedFiles % 10 === 0 ||
                    processedFiles === dataFiles.length
                ) {
                    this.logger.info("Market data loading progress", {
                        component: "MarketSimulator",
                        filesProcessed: processedFiles,
                        totalFiles: dataFiles.length,
                        totalEvents: this.allDataPoints.length,
                        memoryUsage:
                            process.memoryUsage().heapUsed / 1024 / 1024,
                    });
                }
            }

            // Sort all data points by timestamp
            this.allDataPoints.sort((a, b) => a.timestamp - b.timestamp);

            if (this.allDataPoints.length === 0) {
                throw new Error("No market data found");
            }

            this.startTime = this.allDataPoints[0].timestamp;

            this.logger.info("Market data loaded successfully", {
                component: "MarketSimulator",
                totalEvents: this.allDataPoints.length,
                totalTrades: this.stats.totalTrades,
                totalDepthUpdates: this.stats.totalDepthUpdates,
                timeRange: {
                    start: new Date(this.startTime).toISOString(),
                    end: new Date(
                        this.allDataPoints[
                            this.allDataPoints.length - 1
                        ].timestamp
                    ).toISOString(),
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

        if (this.allDataPoints.length === 0) {
            throw new Error("No data loaded. Call initialize() first");
        }

        this.isRunning = true;
        this.currentIndex = 0;
        this.realStartTime = Date.now();

        this.logger.info("Starting market simulation", {
            component: "MarketSimulator",
            speedMultiplier: this.config.speedMultiplier,
            totalEvents: this.allDataPoints.length,
        });

        this.emit("simulationStarted", {
            totalEvents: this.allDataPoints.length,
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
            processedEvents: this.stats.processedEvents,
            progress:
                ((this.currentIndex / this.allDataPoints.length) * 100).toFixed(
                    2
                ) + "%",
        });

        this.emit("simulationStopped", {
            processedEvents: this.stats.processedEvents,
            totalEvents: this.allDataPoints.length,
        });
    }

    /**
     * Process the next event in the sequence
     */
    private processNextEvent(): void {
        if (!this.isRunning || this.currentIndex >= this.allDataPoints.length) {
            if (this.currentIndex >= this.allDataPoints.length) {
                this.emit("simulationCompleted", {
                    totalEvents: this.allDataPoints.length,
                    stats: this.stats,
                });
            }
            this.isRunning = false;
            return;
        }

        const event = this.allDataPoints[this.currentIndex];

        if (event.type === "trade") {
            this.processTradeEvent(event.data as TradeDataPoint);
        } else if (event.type === "depth") {
            this.processDepthEvent(event.data as DepthDataPoint);
            // Emit depth event for real order book processing
            this.emit("depthEvent", event.data as DepthDataPoint);
        }

        this.currentIndex++;
        this.stats.processedEvents++;

        // Emit progress updates every 10000 events
        if (this.stats.processedEvents % 10000 === 0) {
            const progress =
                (this.currentIndex / this.allDataPoints.length) * 100;
            this.emit("progress", {
                processed: this.stats.processedEvents,
                total: this.allDataPoints.length,
                progress: progress,
                currentTimestamp: event.timestamp,
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
    }

    /**
     * Calculate delay until next event based on timestamp and speed multiplier
     */
    private calculateNextDelay(currentTimestamp: number): number {
        if (this.currentIndex >= this.allDataPoints.length - 1) {
            return 0;
        }

        const nextTimestamp =
            this.allDataPoints[this.currentIndex + 1].timestamp;
        const realDelayMs = nextTimestamp - currentTimestamp;
        const simulatedDelayMs = realDelayMs / this.config.speedMultiplier;

        // Minimum delay to prevent overwhelming the system
        return Math.max(simulatedDelayMs, 1);
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
}
