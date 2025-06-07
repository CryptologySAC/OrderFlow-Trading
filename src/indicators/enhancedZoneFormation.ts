// src/indicators/enhancedZoneFormation.ts

import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { DetectorUtils } from "./base/detectorUtils.js";

/**
 * Enhanced zone formation criteria based on institutional trading patterns
 */
export interface InstitutionalSignals {
    largeBlockRatio: number; // Ratio of trades above institutional size threshold
    icebergDetection: number; // Score for iceberg order patterns (0-1)
    volumeConsistency: number; // Consistency of volume flow over time
    priceEfficiency: number; // How well price holds during accumulation
    orderSizeDistribution: number; // Institutional vs retail order size patterns
    timeConsistency: number; // Sustained activity over time windows
}

/**
 * Market regime context for adaptive thresholds
 */
export interface MarketRegime {
    volatilityLevel: "low" | "medium" | "high";
    volumeLevel: "low" | "medium" | "high";
    trendStrength: number; // 0-1, strength of current trend
    marketPhase: "accumulation" | "distribution" | "trending" | "consolidation";
    volumeStdDev?: number;
}

/**
 * Enhanced zone candidate with institutional analysis
 */
export interface EnhancedZoneCandidate {
    // Basic metrics
    priceLevel: number;
    startTime: number;
    totalVolume: number;
    buyVolume: number;
    sellVolume: number;
    tradeCount: number;
    averageOrderSize: number;

    // Enhanced metrics
    institutionalSignals: InstitutionalSignals;
    marketRegime: MarketRegime;
    qualityScore: number;
    confidenceLevel: number;
}

/**
 * Enhanced zone formation analyzer with institutional-grade criteria
 */
export class EnhancedZoneFormation {
    private readonly institutionalSizeThreshold: number;
    private readonly icebergDetectionWindow: number;
    private readonly minInstitutionalRatio: number;

    constructor(
        institutionalSizeThreshold: number = 100, // Trades above this are "institutional"
        icebergDetectionWindow: number = 20, // Window for iceberg pattern detection
        minInstitutionalRatio: number = 0.3 // Min ratio of institutional trades
    ) {
        this.institutionalSizeThreshold = institutionalSizeThreshold;
        this.icebergDetectionWindow = icebergDetectionWindow;
        this.minInstitutionalRatio = minInstitutionalRatio;
    }

    /**
     * Analyze institutional signals in trade sequence
     */
    public analyzeInstitutionalSignals(
        trades: EnrichedTradeEvent[]
    ): InstitutionalSignals {
        if (trades.length < 5) {
            return {
                largeBlockRatio: 0,
                icebergDetection: 0,
                volumeConsistency: 0,
                priceEfficiency: 0,
                orderSizeDistribution: 0,
                timeConsistency: 0,
            };
        }

        return {
            largeBlockRatio: this.calculateLargeBlockRatio(trades),
            icebergDetection: this.detectIcebergPatterns(trades),
            volumeConsistency: this.calculateVolumeConsistency(trades),
            priceEfficiency: this.calculatePriceEfficiency(trades),
            orderSizeDistribution: this.analyzeOrderSizeDistribution(trades),
            timeConsistency: this.calculateTimeConsistency(trades),
        };
    }

    /**
     * Calculate ratio of large block trades (institutional indicator)
     */
    private calculateLargeBlockRatio(trades: EnrichedTradeEvent[]): number {
        const largeBlocks = trades.filter(
            (t) => t.quantity >= this.institutionalSizeThreshold
        );
        return largeBlocks.length / trades.length;
    }

    /**
     * Detect iceberg order patterns (consistent large trades with price stability)
     */
    private detectIcebergPatterns(trades: EnrichedTradeEvent[]): number {
        if (trades.length < this.icebergDetectionWindow) return 0;

        const windows = Math.floor(trades.length / this.icebergDetectionWindow);
        let icebergWindows = 0;

        for (let w = 0; w < windows; w++) {
            const windowStart = w * this.icebergDetectionWindow;
            const windowEnd = Math.min(
                windowStart + this.icebergDetectionWindow,
                trades.length
            );
            const windowTrades = trades.slice(windowStart, windowEnd);

            // Iceberg characteristics:
            // 1. Consistent large order sizes
            // 2. Minimal price movement despite volume
            // 3. Regular timing intervals

            const avgOrderSize =
                windowTrades.reduce((sum, t) => sum + t.quantity, 0) /
                windowTrades.length;
            const priceRange =
                Math.max(...windowTrades.map((t) => t.price)) -
                Math.min(...windowTrades.map((t) => t.price));
            const avgPrice =
                windowTrades.reduce((sum, t) => sum + t.price, 0) /
                windowTrades.length;
            const priceStability = avgPrice > 0 ? 1 - priceRange / avgPrice : 0;

            // Time consistency (regular intervals suggest automated execution)
            const timeIntervals = [];
            for (let i = 1; i < windowTrades.length; i++) {
                timeIntervals.push(
                    windowTrades[i].timestamp - windowTrades[i - 1].timestamp
                );
            }
            const avgInterval =
                timeIntervals.reduce((sum, interval) => sum + interval, 0) /
                timeIntervals.length;
            const intervalStdDev = DetectorUtils.calculateStdDev(timeIntervals);
            const timeConsistency =
                avgInterval > 0
                    ? Math.max(0, 1 - intervalStdDev / avgInterval)
                    : 0;

            // Iceberg score for this window
            const icebergScore =
                (avgOrderSize >= this.institutionalSizeThreshold ? 0.4 : 0) +
                (priceStability > 0.95 ? 0.3 : priceStability * 0.3) +
                (timeConsistency > 0.7 ? 0.3 : timeConsistency * 0.3);

            if (icebergScore > 0.7) {
                icebergWindows++;
            }
        }

        return icebergWindows / windows;
    }

    /**
     * Calculate volume flow consistency (steady accumulation vs erratic)
     */
    private calculateVolumeConsistency(trades: EnrichedTradeEvent[]): number {
        const timeWindows = Math.min(10, Math.floor(trades.length / 5));
        if (timeWindows < 3) return 0;

        const volumePerWindow = [];
        const windowSize = Math.floor(trades.length / timeWindows);

        for (let i = 0; i < timeWindows; i++) {
            const start = i * windowSize;
            const end = Math.min(start + windowSize, trades.length);
            const windowTrades = trades.slice(start, end);
            const windowVolume = windowTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            volumePerWindow.push(windowVolume);
        }

        // Consistency = low standard deviation relative to mean
        const mean = DetectorUtils.calculateMean(volumePerWindow);
        const stdDev = DetectorUtils.calculateStdDev(volumePerWindow);

        return mean > 0 ? Math.max(0, 1 - stdDev / mean) : 0;
    }

    /**
     * Calculate price efficiency during accumulation (minimal impact despite volume)
     */
    private calculatePriceEfficiency(trades: EnrichedTradeEvent[]): number {
        if (trades.length < 2) return 0;

        const firstPrice = trades[0].price;
        const lastPrice = trades[trades.length - 1].price;
        const totalVolume = trades.reduce((sum, t) => sum + t.quantity, 0);

        // Price efficiency = minimal price movement relative to volume
        const priceChange = Math.abs(lastPrice - firstPrice) / firstPrice;
        const volumeNormalized = Math.min(totalVolume / 1000, 10); // Normalize to reasonable scale

        // Higher volume should correlate with higher price impact in normal conditions
        // Low correlation suggests institutional absorption/distribution
        const expectedPriceImpact = volumeNormalized * 0.001; // 0.1% per 1000 units
        const efficiency =
            expectedPriceImpact > 0
                ? Math.max(0, 1 - priceChange / expectedPriceImpact)
                : priceChange < 0.001
                  ? 1
                  : 0;

        return Math.min(1, efficiency);
    }

    /**
     * Analyze order size distribution patterns
     */
    private analyzeOrderSizeDistribution(trades: EnrichedTradeEvent[]): number {
        const orderSizes = trades.map((t) => t.quantity);
        const median = DetectorUtils.calculateMedian(orderSizes);
        const p75 = DetectorUtils.calculatePercentile(orderSizes, 75);
        const p95 = DetectorUtils.calculatePercentile(orderSizes, 95);

        // Institutional activity shows:
        // 1. Higher concentration in upper percentiles
        // 2. Significant gap between retail (median) and institutional (p95) sizes

        const retailSize = median;
        const institutionalSize = p95;
        const institutionalGap =
            institutionalSize > 0
                ? institutionalSize / Math.max(retailSize, 1)
                : 1;

        // Score based on institutional concentration
        const institutionalConcentration =
            orderSizes.filter((size) => size >= p75).length / orderSizes.length;

        return Math.min(
            1,
            (institutionalGap > 5 ? 0.5 : institutionalGap * 0.1) +
                institutionalConcentration * 0.5
        );
    }

    /**
     * Calculate time consistency (sustained activity over time)
     */
    private calculateTimeConsistency(trades: EnrichedTradeEvent[]): number {
        if (trades.length < 5) return 0;

        const duration =
            trades[trades.length - 1].timestamp - trades[0].timestamp;
        const timeWindows = Math.min(10, Math.floor(duration / 60000)); // 1-minute windows

        if (timeWindows < 3) return 0;

        const windowDuration = duration / timeWindows;
        const tradesPerWindow = [];

        for (let i = 0; i < timeWindows; i++) {
            const windowStart = trades[0].timestamp + i * windowDuration;
            const windowEnd = windowStart + windowDuration;

            const windowTrades = trades.filter(
                (t) => t.timestamp >= windowStart && t.timestamp < windowEnd
            );

            tradesPerWindow.push(windowTrades.length);
        }

        // Consistency = low variance in activity across time windows
        const mean = DetectorUtils.calculateMean(tradesPerWindow);
        const stdDev = DetectorUtils.calculateStdDev(tradesPerWindow);

        return mean > 0 ? Math.max(0, 1 - stdDev / mean) : 0;
    }

    /**
     * Enhanced scoring algorithm with institutional factors
     */
    public calculateEnhancedScore(
        buyRatio: number,
        sellRatio: number,
        priceStability: number,
        volume: number,
        duration: number,
        averageOrderSize: number,
        institutionalSignals: InstitutionalSignals,
        marketRegime: MarketRegime
    ): { score: number; confidence: number; reasons: string[] } {
        const reasons: string[] = [];
        let score = 0;
        let confidence = 0;

        // Adaptive thresholds based on market regime
        const adaptiveThresholds = this.getAdaptiveThresholds(marketRegime);

        // Enhanced buy/sell dominance scoring (non-linear)
        if (buyRatio >= adaptiveThresholds.minBuyRatio) {
            const excessBuyRatio = buyRatio - adaptiveThresholds.minBuyRatio;
            const buyScore = Math.min(
                1,
                excessBuyRatio / (1 - adaptiveThresholds.minBuyRatio)
            );
            score += buyScore * 0.3; // 30% weight
            confidence += buyScore * 0.25;
            reasons.push(
                `Strong buy dominance: ${(buyRatio * 100).toFixed(1)}%`
            );
        }

        // Institutional signals (major factor)
        const instScore =
            this.calculateInstitutionalScore(institutionalSignals);
        score += instScore * 0.25; // 25% weight
        confidence += instScore * 0.3;
        if (instScore > 0.6) {
            reasons.push("Institutional activity detected");
        }

        // Price stability (higher weight for accumulation)
        const stabilityScore = Math.pow(priceStability, 2); // Non-linear preference for high stability
        score += stabilityScore * 0.2; // 20% weight
        confidence += stabilityScore * 0.2;
        if (priceStability > 0.9) {
            reasons.push("Excellent price stability");
        }

        // Volume significance (adaptive)
        const volumeScore = Math.min(
            1,
            volume / adaptiveThresholds.significantVolume
        );
        score += volumeScore * 0.15; // 15% weight
        confidence += volumeScore * 0.15;

        // Duration with diminishing returns
        const durationScore = Math.min(
            1,
            Math.sqrt(duration / adaptiveThresholds.optimalDuration)
        );
        score += durationScore * 0.1; // 10% weight
        confidence += durationScore * 0.1;

        // Market regime bonus/penalty
        const regimeAdjustment = this.getRegimeAdjustment(marketRegime);
        score *= regimeAdjustment.scoreMultiplier;
        confidence *= regimeAdjustment.confidenceMultiplier;

        if (regimeAdjustment.scoreMultiplier > 1) {
            reasons.push("Favorable market conditions");
        }

        return {
            score: Math.min(1, score),
            confidence: Math.min(1, confidence),
            reasons,
        };
    }

    /**
     * Calculate institutional activity score
     */
    private calculateInstitutionalScore(signals: InstitutionalSignals): number {
        return (
            signals.largeBlockRatio * 0.3 +
            signals.icebergDetection * 0.25 +
            signals.volumeConsistency * 0.2 +
            signals.priceEfficiency * 0.15 +
            signals.orderSizeDistribution * 0.1
        );
    }

    /**
     * Get adaptive thresholds based on market regime
     */
    private getAdaptiveThresholds(regime: MarketRegime) {
        const base = {
            minBuyRatio: 0.75,
            minSellRatio: 0.75,
            significantVolume: 500,
            optimalDuration: 600000, // 10 minutes
        };

        // Adjust based on volatility
        switch (regime.volatilityLevel) {
            case "high":
                return {
                    ...base,
                    minBuyRatio: 0.8, // Higher threshold in volatile markets
                    minSellRatio: 0.8,
                    significantVolume: 800,
                };
            case "low":
                return {
                    ...base,
                    minBuyRatio: 0.7, // Lower threshold in stable markets
                    minSellRatio: 0.7,
                    significantVolume: 300,
                };
            default:
                return base;
        }
    }

    /**
     * Get regime-based score adjustments
     */
    private getRegimeAdjustment(regime: MarketRegime) {
        let scoreMultiplier = 1.0;
        let confidenceMultiplier = 1.0;

        // Adjust based on market phase
        switch (regime.marketPhase) {
            case "accumulation":
                scoreMultiplier = 1.2; // Boost accumulation detection
                confidenceMultiplier = 1.1;
                break;
            case "distribution":
                scoreMultiplier = 0.8; // Reduce false accumulation signals
                confidenceMultiplier = 0.9;
                break;
            case "trending":
                scoreMultiplier = 0.7; // Less likely to be accumulation
                confidenceMultiplier = 0.8;
                break;
        }

        // Adjust based on volume regime
        if (regime.volumeLevel === "high") {
            scoreMultiplier *= 1.1; // Higher confidence with more data
            confidenceMultiplier *= 1.15;
        } else if (regime.volumeLevel === "low") {
            scoreMultiplier *= 0.9; // Lower confidence with sparse data
            confidenceMultiplier *= 0.85;
        }

        return { scoreMultiplier, confidenceMultiplier };
    }

    /**
     * Determine market regime from recent trading data
     */
    public analyzeMarketRegime(
        recentTrades: EnrichedTradeEvent[],
        priceHistory: number[]
    ): MarketRegime {
        if (recentTrades.length < 10 || priceHistory.length < 20) {
            return {
                volatilityLevel: "medium",
                volumeLevel: "medium",
                trendStrength: 0.5,
                marketPhase: "consolidation",
            };
        }

        // Calculate volatility
        const priceChanges = [];
        for (let i = 1; i < priceHistory.length; i++) {
            priceChanges.push(
                (priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]
            );
        }
        const volatility = DetectorUtils.calculateStdDev(priceChanges);

        // Calculate volume characteristics
        const volumes = recentTrades.map((t) => t.quantity);
        const avgVolume = DetectorUtils.calculateMean(volumes);
        const volumeStdDev = DetectorUtils.calculateStdDev(volumes);

        // Determine trend strength
        const trendStrength = this.calculateTrendStrength(priceHistory);

        return {
            volatilityLevel:
                volatility > 0.02
                    ? "high"
                    : volatility < 0.005
                      ? "low"
                      : "medium",
            volumeLevel:
                avgVolume > 100 ? "high" : avgVolume < 30 ? "low" : "medium",
            trendStrength,
            marketPhase: this.determineMarketPhase(
                trendStrength,
                volatility,
                avgVolume
            ),
            volumeStdDev: volumeStdDev,
        };
    }

    private calculateTrendStrength(prices: number[]): number {
        if (prices.length < 10) return 0.5;

        const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
        const secondHalf = prices.slice(Math.floor(prices.length / 2));

        const firstAvg = DetectorUtils.calculateMean(firstHalf);
        const secondAvg = DetectorUtils.calculateMean(secondHalf);

        const priceChange = Math.abs(secondAvg - firstAvg) / firstAvg;
        return Math.min(1, priceChange * 10); // Scale to 0-1
    }

    private determineMarketPhase(
        trendStrength: number,
        volatility: number,
        volume: number
    ): MarketRegime["marketPhase"] {
        if (trendStrength > 0.7) return "trending";
        if (volatility > 0.015 && volume > 80) return "distribution";
        if (volatility < 0.008 && volume > 60) return "accumulation";
        return "consolidation";
    }
}
