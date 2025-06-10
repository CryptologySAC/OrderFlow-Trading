// src/analysis/marketContextCollector.ts

import { EventEmitter } from "events";
import { WorkerLogger } from "../multithreading/workerLogger";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import type { HybridTradeEvent } from "../types/marketEvents.js";
import type { MarketContext } from "./signalTracker.js";

export interface MarketMetrics {
    // Price metrics
    currentPrice: number;
    priceChange24h: number;
    priceChange1h: number;
    priceChange15min: number;
    priceChange5min: number;

    // Volume metrics
    volume24h: number;
    volume1h: number;
    volume15min: number;
    volume5min: number;
    currentVolumeRate: number;

    // Volatility metrics
    volatility24h: number;
    volatility1h: number;
    volatility15min: number;
    volatility5min: number;
    normalizedVolatility: number;

    // Liquidity metrics
    currentSpread: number;
    avgSpread1h: number;
    spreadVolatility: number;
    depthRatio: number;

    // Flow metrics
    buyVolume5min: number;
    sellVolume5min: number;
    volumeImbalance: number;
    tradeSize: "small" | "medium" | "large" | "institutional";
}

export interface MarketRegime {
    regime:
        | "bull_trending"
        | "bear_trending"
        | "ranging"
        | "breakout"
        | "volatile";
    confidence: number;
    duration: number; // How long in current regime
    lastChange: number; // When regime last changed
    trendStrength: number;
    volatilityLevel: "low" | "medium" | "high" | "extreme";
}

export interface SupportResistanceLevel {
    price: number;
    strength: number;
    lastTested: number;
    testCount: number;
    type: "support" | "resistance";
}

export interface MarketContextCollectorConfig {
    updateIntervalMs: number; // How often to update context (default: 30 seconds)
    priceHistorySize: number; // How many price points to keep (default: 2000)
    volumeHistorySize: number; // How many volume points to keep (default: 1000)
    supportResistanceLevels: number; // Max S/R levels to track (default: 20)
    regimeDetectionPeriods: number[]; // Periods for regime detection (default: [300, 900, 3600])
}

interface TimeSeriesData {
    timestamp: number;
    price: number;
    volume: number;
    isBuy: boolean;
}

interface VolumeWindow {
    timestamp: number;
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    tradeCount: number;
}

/**
 * MarketContextCollector captures and analyzes market state for signal context.
 * Provides real-time market metrics, regime detection, and support/resistance levels.
 */
export class MarketContextCollector extends EventEmitter {
    private readonly config: Required<MarketContextCollectorConfig>;

    // Time series data
    private readonly priceHistory: TimeSeriesData[] = [];
    private readonly volumeWindows: VolumeWindow[] = [];
    private readonly spreadHistory: Array<{
        timestamp: number;
        spread: number;
    }> = [];

    // Current market state
    private currentPrice = 0;
    private currentBidPrice = 0;
    private currentAskPrice = 0;
    private currentBidDepth = 0;
    private currentAskDepth = 0;

    // Support/Resistance tracking
    private supportResistanceLevels: SupportResistanceLevel[] = [];

    // Market regime tracking
    private currentRegime: MarketRegime = {
        regime: "ranging",
        confidence: 0.5,
        duration: 0,
        lastChange: Date.now(),
        trendStrength: 0,
        volatilityLevel: "medium",
    };

    // Update intervals
    private updateInterval?: NodeJS.Timeout;
    private regimeUpdateInterval?: NodeJS.Timeout;

    constructor(
        private readonly logger: WorkerLogger,
        private readonly metricsCollector: MetricsCollector,
        config: Partial<MarketContextCollectorConfig> = {}
    ) {
        super();

        this.config = {
            updateIntervalMs: config.updateIntervalMs ?? 30000, // 30 seconds
            priceHistorySize: config.priceHistorySize ?? 2000,
            volumeHistorySize: config.volumeHistorySize ?? 1000,
            supportResistanceLevels: config.supportResistanceLevels ?? 20,
            regimeDetectionPeriods: config.regimeDetectionPeriods ?? [
                300000, 900000, 3600000,
            ], // 5min, 15min, 1hr
            ...config,
        };

        this.logger.info("MarketContextCollector initialized", {
            component: "MarketContextCollector",
            config: this.config,
        });

        this.setupMetrics();
        this.startPeriodicUpdates();
    }

    /**
     * Update with latest market data
     */
    public updateMarketData(trade: HybridTradeEvent): void {
        try {
            // Update current price and depth if available
            this.currentPrice = trade.price;

            // TODO Update bid/ask if available in trade data
            //if (trade.bidPrice) this.currentBidPrice = trade.bidPrice;
            //if (trade.askPrice) this.currentAskPrice = trade.askPrice;
            //if (trade.bidQty) this.currentBidDepth = trade.bidQty;
            //if (trade.askQty) this.currentAskDepth = trade.askQty;

            // Add to price history
            const timeSeriesEntry: TimeSeriesData = {
                timestamp: trade.timestamp,
                price: trade.price,
                volume: trade.quantity,
                isBuy: trade.buyerIsMaker === false, // Buyer is taker = buy order
            };

            this.priceHistory.push(timeSeriesEntry);

            // Maintain history size
            if (this.priceHistory.length > this.config.priceHistorySize) {
                this.priceHistory.shift();
            }

            // Update volume windows (aggregate by minute)
            this.updateVolumeWindow(trade);

            // Update spread history
            if (this.currentBidPrice && this.currentAskPrice) {
                const spread = this.currentAskPrice - this.currentBidPrice;
                this.spreadHistory.push({ timestamp: trade.timestamp, spread });

                // Keep last hour of spread data
                const cutoff = trade.timestamp - 3600000; // 1 hour
                while (
                    this.spreadHistory.length > 0 &&
                    this.spreadHistory[0].timestamp < cutoff
                ) {
                    this.spreadHistory.shift();
                }
            }

            // Update metrics
            this.metricsCollector.incrementCounter(
                "market_context_trades_processed_total",
                1,
                {
                    is_buy: timeSeriesEntry.isBuy ? "true" : "false",
                }
            );
        } catch (error) {
            this.logger.error("Failed to update market data", {
                component: "MarketContextCollector",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get current market context
     */
    public getCurrentMarketContext(
        price: number,
        timestamp: number
    ): MarketContext {
        try {
            const metrics = this.calculateMarketMetrics();
            const regime = this.detectMarketRegime();
            const supportResistance = this.analyzeSupportResistance(price);

            const context: MarketContext = {
                timestamp,
                price,

                // Volume context
                currentVolume: metrics.currentVolumeRate,
                avgVolume24h: metrics.volume24h / 24, // Convert to hourly average
                volumeRatio:
                    metrics.volume1h > 0
                        ? metrics.currentVolumeRate / (metrics.volume1h / 60)
                        : 1,

                // Volatility context
                recentVolatility: metrics.volatility1h,
                normalizedVolatility: metrics.normalizedVolatility,

                // Liquidity context
                bidAskSpread: metrics.currentSpread,
                bidDepth: this.currentBidDepth,
                askDepth: this.currentAskDepth,
                liquidityRatio:
                    this.currentBidDepth + this.currentAskDepth > 0
                        ? Math.min(this.currentBidDepth, this.currentAskDepth) /
                          (this.currentBidDepth + this.currentAskDepth)
                        : 0.5,

                // Trend context
                trend5min: this.getTrendDirection(metrics.priceChange5min),
                trend15min: this.getTrendDirection(metrics.priceChange15min),
                trend1hour: this.getTrendDirection(metrics.priceChange1h),
                trendAlignment: this.calculateTrendAlignment(metrics),

                // Support/Resistance context
                distanceFromSupport: supportResistance.distanceFromSupport,
                distanceFromResistance:
                    supportResistance.distanceFromResistance,
                nearKeyLevel: supportResistance.nearKeyLevel,

                // Market regime
                regime: regime.regime,
                regimeConfidence: regime.confidence,
            };

            this.emit("marketContextUpdated", context);
            return context;
        } catch (error) {
            this.logger.error("Failed to get market context", {
                component: "MarketContextCollector",
                error: error instanceof Error ? error.message : String(error),
            });

            // Return fallback context
            return this.getFallbackMarketContext(price, timestamp);
        }
    }

    /**
     * Calculate derived market metrics
     */
    public calculateMarketMetrics(): MarketMetrics {
        if (this.priceHistory.length === 0) {
            return this.getEmptyMarketMetrics();
        }

        //todo const now = Date.now();

        // Calculate price changes over different periods
        const priceChange24h = this.calculatePriceChange(86400000); // 24 hours
        const priceChange1h = this.calculatePriceChange(3600000); // 1 hour
        const priceChange15min = this.calculatePriceChange(900000); // 15 minutes
        const priceChange5min = this.calculatePriceChange(300000); // 5 minutes

        // Calculate volume metrics
        const volume24h = this.calculateVolumeInPeriod(86400000);
        const volume1h = this.calculateVolumeInPeriod(3600000);
        const volume15min = this.calculateVolumeInPeriod(900000);
        const volume5min = this.calculateVolumeInPeriod(300000);

        // Current volume rate (per minute)
        const recentVolume = this.calculateVolumeInPeriod(60000); // Last minute
        const currentVolumeRate = recentVolume;

        // Calculate volatility metrics
        const volatility24h = this.calculateVolatility(86400000);
        const volatility1h = this.calculateVolatility(3600000);
        const volatility15min = this.calculateVolatility(900000);
        const volatility5min = this.calculateVolatility(300000);

        // Normalized volatility (relative to recent average)
        const normalizedVolatility =
            volatility1h > 0 ? volatility5min / volatility1h : 1;

        // Liquidity metrics
        const currentSpread = this.currentAskPrice - this.currentBidPrice;
        const avgSpread1h = this.calculateAverageSpread(3600000);
        const spreadVolatility = this.calculateSpreadVolatility(3600000);
        const depthRatio =
            this.currentBidDepth + this.currentAskDepth > 0
                ? this.currentBidDepth /
                  (this.currentBidDepth + this.currentAskDepth)
                : 0.5;

        // Flow metrics
        const { buyVolume: buyVolume5min, sellVolume: sellVolume5min } =
            this.calculateBuySellVolume(300000);
        const volumeImbalance =
            buyVolume5min + sellVolume5min > 0
                ? (buyVolume5min - sellVolume5min) /
                  (buyVolume5min + sellVolume5min)
                : 0;

        // Trade size classification
        const avgTradeSize =
            volume5min / Math.max(this.getTradeCount(300000), 1);
        const tradeSize = this.classifyTradeSize(avgTradeSize);

        return {
            currentPrice: this.currentPrice,
            priceChange24h,
            priceChange1h,
            priceChange15min,
            priceChange5min,
            volume24h,
            volume1h,
            volume15min,
            volume5min,
            currentVolumeRate,
            volatility24h,
            volatility1h,
            volatility15min,
            volatility5min,
            normalizedVolatility,
            currentSpread,
            avgSpread1h,
            spreadVolatility,
            depthRatio,
            buyVolume5min,
            sellVolume5min,
            volumeImbalance,
            tradeSize,
        };
    }

    /**
     * Detect current market regime
     */
    public detectMarketRegime(): MarketRegime {
        try {
            if (this.priceHistory.length < 100) {
                return this.currentRegime; // Keep current regime if insufficient data
            }

            const metrics = this.calculateMarketMetrics();

            // Calculate trend strength across different timeframes
            const trends = [
                Math.abs(metrics.priceChange5min),
                Math.abs(metrics.priceChange15min),
                Math.abs(metrics.priceChange1h),
            ];
            const avgTrendStrength =
                trends.reduce((sum, t) => sum + t, 0) / trends.length;

            // Determine volatility level
            const volatilityLevel = this.classifyVolatilityLevel(
                metrics.normalizedVolatility
            );

            // Detect regime based on price action and volatility
            let newRegime: MarketRegime["regime"];
            let confidence = 0.5;

            if (avgTrendStrength > 0.01 && metrics.normalizedVolatility < 2) {
                // Strong trend, low volatility
                newRegime =
                    metrics.priceChange1h > 0
                        ? "bull_trending"
                        : "bear_trending";
                confidence = Math.min(avgTrendStrength * 50 + 0.5, 0.95);
            } else if (metrics.normalizedVolatility > 3) {
                // High volatility
                newRegime = "volatile";
                confidence = Math.min(metrics.normalizedVolatility / 5, 0.9);
            } else if (this.detectBreakoutPattern()) {
                // Breakout pattern
                newRegime = "breakout";
                confidence = 0.7;
            } else {
                // Default to ranging
                newRegime = "ranging";
                confidence = 1 - avgTrendStrength * 20; // Higher confidence for lower trend strength
            }

            // Update regime if changed
            const now = Date.now();
            if (newRegime !== this.currentRegime.regime) {
                this.currentRegime = {
                    regime: newRegime,
                    confidence,
                    duration: 0,
                    lastChange: now,
                    trendStrength: avgTrendStrength,
                    volatilityLevel,
                };

                this.logger.info("Market regime changed", {
                    component: "MarketContextCollector",
                    oldRegime: this.currentRegime.regime,
                    newRegime,
                    confidence,
                    trendStrength: avgTrendStrength,
                });

                this.emit("regimeChanged", this.currentRegime);
            } else {
                // Update existing regime
                this.currentRegime.duration =
                    now - this.currentRegime.lastChange;
                this.currentRegime.confidence = confidence;
                this.currentRegime.trendStrength = avgTrendStrength;
                this.currentRegime.volatilityLevel = volatilityLevel;
            }

            return this.currentRegime;
        } catch (error) {
            this.logger.error("Failed to detect market regime", {
                component: "MarketContextCollector",
                error: error instanceof Error ? error.message : String(error),
            });
            return this.currentRegime;
        }
    }

    // Private helper methods

    private updateVolumeWindow(trade: HybridTradeEvent): void {
        const minuteTimestamp = Math.floor(trade.timestamp / 60000) * 60000; // Round to minute

        // Find or create volume window for this minute
        let volumeWindow = this.volumeWindows.find(
            (w) => w.timestamp === minuteTimestamp
        );
        if (!volumeWindow) {
            volumeWindow = {
                timestamp: minuteTimestamp,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                tradeCount: 0,
            };
            this.volumeWindows.push(volumeWindow);

            // Maintain history size and sort by timestamp
            this.volumeWindows.sort((a, b) => a.timestamp - b.timestamp);
            if (this.volumeWindows.length > this.config.volumeHistorySize) {
                this.volumeWindows.shift();
            }
        }

        // Update volume window
        const isBuy = trade.buyerIsMaker === false;
        if (isBuy) {
            volumeWindow.buyVolume += trade.quantity;
        } else {
            volumeWindow.sellVolume += trade.quantity;
        }
        volumeWindow.totalVolume += trade.quantity;
        volumeWindow.tradeCount++;
    }

    private calculatePriceChange(periodMs: number): number {
        const cutoff = Date.now() - periodMs;
        const relevantPrices = this.priceHistory.filter(
            (p) => p.timestamp > cutoff
        );

        if (relevantPrices.length < 2) return 0;

        const firstPrice = relevantPrices[0].price;
        const lastPrice = relevantPrices[relevantPrices.length - 1].price;

        return (lastPrice - firstPrice) / firstPrice;
    }

    private calculateVolumeInPeriod(periodMs: number): number {
        const cutoff = Date.now() - periodMs;
        return this.volumeWindows
            .filter((w) => w.timestamp > cutoff)
            .reduce((sum, w) => sum + w.totalVolume, 0);
    }

    private calculateVolatility(periodMs: number): number {
        const cutoff = Date.now() - periodMs;
        const relevantPrices = this.priceHistory
            .filter((p) => p.timestamp > cutoff)
            .map((p) => p.price);

        if (relevantPrices.length < 2) return 0;

        // Calculate price returns
        const returns: number[] = [];
        for (let i = 1; i < relevantPrices.length; i++) {
            returns.push(
                (relevantPrices[i] - relevantPrices[i - 1]) /
                    relevantPrices[i - 1]
            );
        }

        // Calculate standard deviation of returns
        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            returns.length;

        return Math.sqrt(variance);
    }

    private calculateAverageSpread(periodMs: number): number {
        const cutoff = Date.now() - periodMs;
        const relevantSpreads = this.spreadHistory.filter(
            (s) => s.timestamp > cutoff
        );

        if (relevantSpreads.length === 0) return 0;

        return (
            relevantSpreads.reduce((sum, s) => sum + s.spread, 0) /
            relevantSpreads.length
        );
    }

    private calculateSpreadVolatility(periodMs: number): number {
        const cutoff = Date.now() - periodMs;
        const relevantSpreads = this.spreadHistory
            .filter((s) => s.timestamp > cutoff)
            .map((s) => s.spread);

        if (relevantSpreads.length < 2) return 0;

        const avgSpread =
            relevantSpreads.reduce((sum, s) => sum + s, 0) /
            relevantSpreads.length;
        const variance =
            relevantSpreads.reduce(
                (sum, s) => sum + Math.pow(s - avgSpread, 2),
                0
            ) / relevantSpreads.length;

        return Math.sqrt(variance);
    }

    private calculateBuySellVolume(periodMs: number): {
        buyVolume: number;
        sellVolume: number;
    } {
        const cutoff = Date.now() - periodMs;
        const relevantWindows = this.volumeWindows.filter(
            (w) => w.timestamp > cutoff
        );

        const buyVolume = relevantWindows.reduce(
            (sum, w) => sum + w.buyVolume,
            0
        );
        const sellVolume = relevantWindows.reduce(
            (sum, w) => sum + w.sellVolume,
            0
        );

        return { buyVolume, sellVolume };
    }

    private getTradeCount(periodMs: number): number {
        const cutoff = Date.now() - periodMs;
        return this.volumeWindows
            .filter((w) => w.timestamp > cutoff)
            .reduce((sum, w) => sum + w.tradeCount, 0);
    }

    private classifyTradeSize(
        avgTradeSize: number
    ): "small" | "medium" | "large" | "institutional" {
        // These thresholds would need to be calibrated based on the specific market
        if (avgTradeSize < 0.1) return "small";
        if (avgTradeSize < 1.0) return "medium";
        if (avgTradeSize < 10.0) return "large";
        return "institutional";
    }

    private getTrendDirection(priceChange: number): "up" | "down" | "sideways" {
        const threshold = 0.001; // 0.1%
        if (priceChange > threshold) return "up";
        if (priceChange < -threshold) return "down";
        return "sideways";
    }

    private calculateTrendAlignment(metrics: MarketMetrics): number {
        const trends = [
            metrics.priceChange5min,
            metrics.priceChange15min,
            metrics.priceChange1h,
        ];

        // Calculate how aligned the trends are (same direction)
        const positiveTrends = trends.filter((t) => t > 0.001).length;
        const negativeTrends = trends.filter((t) => t < -0.001).length;

        const maxAligned = Math.max(positiveTrends, negativeTrends);
        return maxAligned / trends.length;
    }

    private classifyVolatilityLevel(
        normalizedVolatility: number
    ): "low" | "medium" | "high" | "extreme" {
        if (normalizedVolatility < 0.5) return "low";
        if (normalizedVolatility < 1.5) return "medium";
        if (normalizedVolatility < 3.0) return "high";
        return "extreme";
    }

    private detectBreakoutPattern(): boolean {
        // Simple breakout detection: recent volume spike + price movement
        if (this.volumeWindows.length < 10) return false;

        const recentVolume = this.calculateVolumeInPeriod(300000); // 5 minutes
        const historicalVolume = this.calculateVolumeInPeriod(3600000) / 12; // Average 5-min volume over last hour

        const volumeSpike = recentVolume > historicalVolume * 2; // 2x volume spike
        const priceMove = Math.abs(this.calculatePriceChange(300000)) > 0.005; // 0.5% price move

        return volumeSpike && priceMove;
    }

    private analyzeSupportResistance(currentPrice: number): {
        distanceFromSupport: number;
        distanceFromResistance: number;
        nearKeyLevel: boolean;
    } {
        // Simplified S/R analysis - in production this would be more sophisticated
        const nearbyThreshold = 0.002; // 0.2%

        // Find nearest support (price level below current price)
        const supportLevels = this.supportResistanceLevels
            .filter(
                (level) =>
                    level.type === "support" && level.price < currentPrice
            )
            .sort((a, b) => b.price - a.price); // Closest first

        // Find nearest resistance (price level above current price)
        const resistanceLevels = this.supportResistanceLevels
            .filter(
                (level) =>
                    level.type === "resistance" && level.price > currentPrice
            )
            .sort((a, b) => a.price - b.price); // Closest first

        const nearestSupport = supportLevels[0];
        const nearestResistance = resistanceLevels[0];

        const distanceFromSupport = nearestSupport
            ? (currentPrice - nearestSupport.price) / currentPrice
            : 0.05; // Default 5% if no support found

        const distanceFromResistance = nearestResistance
            ? (nearestResistance.price - currentPrice) / currentPrice
            : 0.05; // Default 5% if no resistance found

        const nearKeyLevel =
            distanceFromSupport < nearbyThreshold ||
            distanceFromResistance < nearbyThreshold;

        return {
            distanceFromSupport,
            distanceFromResistance,
            nearKeyLevel,
        };
    }

    private getEmptyMarketMetrics(): MarketMetrics {
        return {
            currentPrice: this.currentPrice,
            priceChange24h: 0,
            priceChange1h: 0,
            priceChange15min: 0,
            priceChange5min: 0,
            volume24h: 0,
            volume1h: 0,
            volume15min: 0,
            volume5min: 0,
            currentVolumeRate: 0,
            volatility24h: 0,
            volatility1h: 0,
            volatility15min: 0,
            volatility5min: 0,
            normalizedVolatility: 1,
            currentSpread: 0,
            avgSpread1h: 0,
            spreadVolatility: 0,
            depthRatio: 0.5,
            buyVolume5min: 0,
            sellVolume5min: 0,
            volumeImbalance: 0,
            tradeSize: "medium",
        };
    }

    private getFallbackMarketContext(
        price: number,
        timestamp: number
    ): MarketContext {
        return {
            timestamp,
            price,
            currentVolume: 0,
            avgVolume24h: 0,
            volumeRatio: 1,
            recentVolatility: 0,
            normalizedVolatility: 1,
            bidAskSpread: 0,
            bidDepth: 0,
            askDepth: 0,
            liquidityRatio: 0.5,
            trend5min: "sideways",
            trend15min: "sideways",
            trend1hour: "sideways",
            trendAlignment: 0,
            distanceFromSupport: 0.05,
            distanceFromResistance: 0.05,
            nearKeyLevel: false,
            regime: "ranging",
            regimeConfidence: 0.5,
        };
    }

    private setupMetrics(): void {
        try {
            this.metricsCollector.createCounter(
                "market_context_trades_processed_total",
                "Total trades processed for market context",
                ["is_buy"]
            );

            this.metricsCollector.createGauge(
                "market_context_current_price",
                "Current market price"
            );

            this.metricsCollector.createGauge(
                "market_context_volatility",
                "Current market volatility"
            );

            this.metricsCollector.createGauge(
                "market_context_volume_rate",
                "Current volume rate"
            );

            this.logger.debug("MarketContextCollector metrics initialized", {
                component: "MarketContextCollector",
            });
        } catch (error) {
            this.logger.error(
                "Failed to setup MarketContextCollector metrics",
                {
                    component: "MarketContextCollector",
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    private startPeriodicUpdates(): void {
        // Update market context metrics periodically
        this.updateInterval = setInterval(() => {
            this.updateMetrics();
        }, this.config.updateIntervalMs);

        // Update market regime less frequently
        this.regimeUpdateInterval = setInterval(() => {
            this.detectMarketRegime();
        }, this.config.updateIntervalMs * 2); // 2x less frequent
    }

    private updateMetrics(): void {
        try {
            if (this.priceHistory.length > 0) {
                const metrics = this.calculateMarketMetrics();

                this.metricsCollector.setGauge(
                    "market_context_current_price",
                    metrics.currentPrice
                );
                this.metricsCollector.setGauge(
                    "market_context_volatility",
                    metrics.volatility5min
                );
                this.metricsCollector.setGauge(
                    "market_context_volume_rate",
                    metrics.currentVolumeRate
                );
            }
        } catch (error) {
            this.logger.error("Failed to update market context metrics", {
                component: "MarketContextCollector",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get current status of the market context collector
     */
    public getStatus(): {
        priceHistorySize: number;
        volumeWindowsSize: number;
        currentRegime: MarketRegime;
        lastUpdate: number;
    } {
        return {
            priceHistorySize: this.priceHistory.length,
            volumeWindowsSize: this.volumeWindows.length,
            currentRegime: this.currentRegime,
            lastUpdate:
                this.priceHistory.length > 0
                    ? this.priceHistory[this.priceHistory.length - 1].timestamp
                    : 0,
        };
    }

    /**
     * Shutdown the market context collector
     */
    public shutdown(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        if (this.regimeUpdateInterval) {
            clearInterval(this.regimeUpdateInterval);
        }

        this.logger.info("MarketContextCollector shutdown completed", {
            component: "MarketContextCollector",
        });
    }
}
