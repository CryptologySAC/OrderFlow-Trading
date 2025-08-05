// src/services/marketDataStorageService.ts

import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import {
    MarketDataCollector,
    type MarketDataCollectorConfig,
    type TradeRecord,
    type DepthSnapshot,
} from "../storage/marketDataCollector.js";
import type { AggressiveTrade } from "../types/marketEvents.js";
// import type { DepthLevel } from "../utils/interfaces.js"; // Not needed for market data storage

/**
 * Service configuration for 7-day data collection
 */
export interface DataStorageConfig {
    enabled: boolean;
    dataDirectory: string;
    format: "csv" | "jsonl" | "both";
    symbol: string;
    maxFileSize: number; // MB
    depthLevels: number; // Number of levels to store
    rotationHours: number; // File rotation frequency
    compressionEnabled: boolean;
    monitoringInterval: number; // Minutes between status logs
}

/**
 * Service that integrates market data collection with the trading system
 *
 * This service captures all trades and depth updates for backtesting purposes
 */
export class MarketDataStorageService {
    private readonly config: DataStorageConfig;
    private readonly logger: ILogger;
    private readonly metrics: IMetricsCollector;
    private readonly collector!: MarketDataCollector;

    private monitoringTimer?: NodeJS.Timeout;
    private isRunning = false;

    constructor(
        config: DataStorageConfig,
        logger: ILogger,
        metrics: IMetricsCollector
    ) {
        this.config = {
            enabled: config.enabled ?? true,
            dataDirectory: config.dataDirectory ?? "./market_data",
            format: config.format ?? "both",
            symbol: config.symbol ?? "LTCUSDT",
            maxFileSize: config.maxFileSize ?? 25,
            depthLevels: config.depthLevels ?? 20,
            rotationHours: config.rotationHours ?? 6,
            compressionEnabled: config.compressionEnabled ?? false,
            monitoringInterval: config.monitoringInterval ?? 30,
        };

        this.logger = logger;
        this.metrics = metrics;

        if (!this.config.enabled) {
            this.logger.info("Market data storage is disabled");
            return;
        }

        // Initialize the collector
        const collectorConfig: MarketDataCollectorConfig = {
            format: this.config.format,
            dataDirectory: this.config.dataDirectory,
            maxFileSize: this.config.maxFileSize,
            compressionEnabled: this.config.compressionEnabled,
            symbol: this.config.symbol,
            depthLevels: this.config.depthLevels,
            rotationHours: this.config.rotationHours,
        };

        this.collector = new MarketDataCollector(collectorConfig, logger);

        this.logger.info("Market data storage service initialized", {
            config: this.config,
        });
    }

    /**
     * Start the data collection service
     */
    public start(): void {
        if (!this.config.enabled) {
            this.logger.warn(
                "Cannot start market data storage - service is disabled"
            );
            return;
        }

        if (this.isRunning) {
            this.logger.warn("Market data storage service is already running");
            return;
        }

        this.isRunning = true;
        this.startMonitoring();

        this.logger.info("Market data storage service started", {
            dataDirectory: this.config.dataDirectory,
            format: this.config.format,
            symbol: this.config.symbol,
        });

        // Record service start in metrics
        // TODO: Add custom metrics for market data storage
        // this.metrics.incrementMetric("marketDataStorageStarts");
        // this.metrics.updateMetric("marketDataStorageEnabled", 1);
    }

    /**
     * Stop the data collection service
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        this.stopMonitoring();

        if (this.config.enabled) {
            await this.collector.cleanup();
        }

        this.logger.info("Market data storage service stopped");
        // this.metrics.updateMetric("marketDataStorageEnabled", 0);
    }

    /**
     * Store a trade from the trading system
     */
    public storeTrade(trade: AggressiveTrade): void {
        if (!this.config.enabled || !this.isRunning) {
            return;
        }

        try {
            const tradeRecord: TradeRecord = {
                timestamp: trade.timestamp,
                price: +trade.price,
                quantity: +trade.quantity,
                side: trade.buyerIsMaker ? "sell" : "buy", // buyerIsMaker means aggressive seller
                tradeId:
                    trade.tradeId ||
                    `${trade.timestamp}_${trade.price}_${trade.quantity}`,
            };

            this.collector.storeTrade(tradeRecord);

            // Update metrics
            // this.metrics.incrementMetric("marketDataTradesStored");
            // this.metrics.updateMetric(
            //     "marketDataLastTradeTimestamp",
            //     trade.timestamp
            // );
        } catch (error) {
            this.logger.error("Failed to store trade in market data service", {
                error: error instanceof Error ? error.message : String(error),
                trade: {
                    timestamp: trade.timestamp,
                    price: trade.price,
                    quantity: trade.quantity,
                    buyerIsMaker: trade.buyerIsMaker,
                },
            });

            // this.metrics.incrementMetric("marketDataStorageErrors");
        }
    }

    /**
     * Store depth data from order book updates
     */
    public storeDepthSnapshot(
        bids: { price: number; quantity: number }[],
        asks: { price: number; quantity: number }[],
        timestamp?: number
    ): void {
        if (!this.config.enabled || !this.isRunning) {
            return;
        }

        try {
            const depthSnapshot: DepthSnapshot = {
                timestamp: timestamp || Date.now(),
                bids: bids
                    .slice(0, this.config.depthLevels)
                    .map((level) => [+level.price, +level.quantity]),
                asks: asks
                    .slice(0, this.config.depthLevels)
                    .map((level) => [+level.price, +level.quantity]),
            };

            this.collector.storeDepth(depthSnapshot);

            // Update metrics
            // this.metrics.incrementMetric("marketDataDepthStored");
            // this.metrics.updateMetric(
            //     "marketDataLastDepthTimestamp",
            //     depthSnapshot.timestamp
            // );
            // this.metrics.updateMetric(
            //     "marketDataDepthBidLevels",
            //     depthSnapshot.bids.length
            // );
            // this.metrics.updateMetric(
            //     "marketDataDepthAskLevels",
            //     depthSnapshot.asks.length
            // );
        } catch (error) {
            this.logger.error(
                "Failed to store depth snapshot in market data service",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    bidLevels: bids.length,
                    askLevels: asks.length,
                    timestamp: timestamp || Date.now(),
                }
            );

            // this.metrics.incrementMetric("marketDataStorageErrors");
        }
    }

    /**
     * Store simplified depth data (just best bid/ask)
     */
    public storeBestQuote(
        bestBid: number,
        bestAsk: number,
        timestamp?: number
    ): void {
        if (!this.config.enabled || !this.isRunning) {
            return;
        }

        try {
            const depthSnapshot: DepthSnapshot = {
                timestamp: timestamp || Date.now(),
                bids: [[bestBid, 0]], // We don't have quantity, so use 0
                asks: [[bestAsk, 0]],
            };

            this.collector.storeDepth(depthSnapshot);

            // this.metrics.incrementMetric("marketDataQuotesStored");
        } catch (error) {
            this.logger.error("Failed to store best quote", {
                error: error instanceof Error ? error.message : String(error),
                bestBid,
                bestAsk,
                timestamp: timestamp || Date.now(),
            });

            // this.metrics.incrementMetric("marketDataStorageErrors");
        }
    }

    /**
     * Get current storage statistics
     */
    public getStorageStats(): {
        enabled: boolean;
        isActive?: boolean;
        message?: string;
        totalTradesStored?: number;
        totalDepthStored?: number;
        currentFileSizes?: {
            tradesCsv: number;
            tradesJsonl: number;
            depthCsv: number;
            depthJsonl: number;
        };
        uptime?: number;
        lastRotation?: string;
    } {
        if (!this.config.enabled) {
            return { enabled: false, message: "Storage is disabled" };
        }

        const stats = this.collector.getStats();
        return {
            enabled: true,
            isActive: this.isRunning,
            ...stats,
        };
    }

    /**
     * Start monitoring and periodic status reporting
     */
    private startMonitoring(): void {
        if (!this.config.enabled) return;

        this.monitoringTimer = setInterval(
            () => {
                this.logStorageStatus();
            },
            this.config.monitoringInterval * 60 * 1000
        );

        // Log initial status
        setTimeout(() => this.logStorageStatus(), 5000);
    }

    /**
     * Stop monitoring
     */
    private stopMonitoring(): void {
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
            this.monitoringTimer = undefined;
        }
    }

    /**
     * Log current storage status
     */
    private logStorageStatus(): void {
        if (!this.config.enabled) return;

        try {
            const summary = this.collector.getSummary();
            this.logger.info("Market Data Storage Status", {
                summary,
                isRunning: this.isRunning,
            });

            // Update metrics with current stats
            // const stats = this.collector.getStats();
            // this.metrics.updateMetric(
            //     "marketDataTotalTrades",
            //     stats.tradeCount
            // );
            // this.metrics.updateMetric("marketDataTotalDepth", stats.depthCount);
            // this.metrics.updateMetric("marketDataFileSize", stats.fileSize);
        } catch (error) {
            this.logger.error("Error getting storage status", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Force a status log (useful for debugging)
     */
    public logStatus(): void {
        this.logStorageStatus();
    }

    /**
     * Check if service is enabled and running
     */
    public isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * Check if service is currently running
     */
    public isActive(): boolean {
        return this.isRunning && this.config.enabled;
    }

    /**
     * Get configuration
     */
    public getConfig(): DataStorageConfig {
        return { ...this.config };
    }

    /**
     * Update configuration (requires restart to take effect)
     */
    public updateConfig(newConfig: Partial<DataStorageConfig>): void {
        Object.assign(this.config, newConfig);

        this.logger.info("Market data storage configuration updated", {
            newConfig: newConfig,
        });

        if (this.isRunning) {
            this.logger.warn(
                "Configuration updated while service is running - restart required for changes to take effect"
            );
        }
    }
}
