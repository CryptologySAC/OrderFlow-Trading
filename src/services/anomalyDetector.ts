// src/services/anomalyDetector.ts

import type { MarketAnomaly } from "../utils/types.js";

interface PricePoint {
    price: number;
    volume: number;
    time: number;
}

export class AnomalyDetector {
    private priceHistory: PricePoint[] = [];
    private readonly windowSize = 1000;
    private readonly normalSpread = 0.0001; // 0.01% normal spread

    /**
     * Detect market anomalies based on price, volume, and spread
     */
    public detectAnomaly(
        currentPrice: number,
        currentVolume: number,
        spread: number
    ): MarketAnomaly | null {
        // Add to history
        const now = Date.now();
        this.priceHistory.push({
            price: currentPrice,
            volume: currentVolume,
            time: now,
        });

        // Maintain window size
        if (this.priceHistory.length > this.windowSize) {
            this.priceHistory.shift();
        }

        // Need enough data for statistics
        if (this.priceHistory.length < 100) {
            return null;
        }

        // Calculate price statistics
        const prices = this.priceHistory.map((h) => h.price);
        const mean = this.calculateMean(prices);
        const stdDev = this.calculateStdDev(prices, mean);

        // Check for flash crash (3+ standard deviations)
        const zScore = Math.abs(currentPrice - mean) / stdDev;
        if (zScore > 3) {
            return this.createFlashCrashAnomaly(
                currentPrice,
                mean,
                stdDev,
                zScore
            );
        }

        // Check for liquidity void (extreme spread)
        if (spread > this.normalSpread * 10) {
            return this.createLiquidityVoidAnomaly(currentPrice, spread);
        }

        // Check for API gaps (time gaps in data)
        const latestTime = this.priceHistory[this.priceHistory.length - 1].time;
        const previousTime =
            this.priceHistory[this.priceHistory.length - 2]?.time || latestTime;
        const timeGap = latestTime - previousTime;

        if (timeGap > 5000) {
            // More than 5 seconds gap
            return this.createApiGapAnomaly(currentPrice, timeGap);
        }

        // Check for extreme volatility
        const recentPrices = prices.slice(-20); // Last 20 prices
        const recentVolatility = this.calculateVolatility(recentPrices);
        const normalVolatility = stdDev / mean; // Coefficient of variation

        if (recentVolatility > normalVolatility * 3) {
            return this.createVolatilityAnomaly(currentPrice, recentVolatility);
        }

        return null;
    }

    private calculateMean(values: number[]): number {
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    private calculateStdDev(values: number[], mean: number): number {
        const variance =
            values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
            values.length;
        return Math.sqrt(variance);
    }

    private calculateVolatility(prices: number[]): number {
        if (prices.length < 2) return 0;

        const returns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }

        const meanReturn = this.calculateMean(returns);
        return this.calculateStdDev(returns, meanReturn);
    }

    private createFlashCrashAnomaly(
        currentPrice: number,
        mean: number,
        stdDev: number,
        zScore: number
    ): MarketAnomaly {
        return {
            type: "flash_crash",
            detectedAt: Date.now(),
            severity: zScore > 5 ? "critical" : "high",
            affectedPriceRange: {
                min: Math.min(currentPrice, mean - 3 * stdDev),
                max: Math.max(currentPrice, mean + 3 * stdDev),
            },
            recommendedAction: zScore > 5 ? "close_positions" : "reduce_size",
        };
    }

    private createLiquidityVoidAnomaly(
        currentPrice: number,
        spread: number
    ): MarketAnomaly {
        return {
            type: "liquidity_void",
            detectedAt: Date.now(),
            severity: spread > this.normalSpread * 50 ? "critical" : "high",
            affectedPriceRange: {
                min: currentPrice * (1 - spread),
                max: currentPrice * (1 + spread),
            },
            recommendedAction: "pause",
        };
    }

    private createApiGapAnomaly(
        currentPrice: number,
        timeGap: number
    ): MarketAnomaly {
        return {
            type: "api_gap",
            detectedAt: Date.now(),
            severity: timeGap > 30000 ? "high" : "medium",
            affectedPriceRange: {
                min: currentPrice * 0.99,
                max: currentPrice * 1.01,
            },
            recommendedAction: timeGap > 30000 ? "pause" : "continue",
        };
    }

    private createVolatilityAnomaly(
        currentPrice: number,
        volatility: number
    ): MarketAnomaly {
        return {
            type: "extreme_volatility",
            detectedAt: Date.now(),
            severity: volatility > 0.1 ? "high" : "medium",
            affectedPriceRange: {
                min: currentPrice * (1 - volatility),
                max: currentPrice * (1 + volatility),
            },
            recommendedAction: "reduce_size",
        };
    }

    /**
     * Get current market health status
     */
    public getMarketHealth(): {
        isHealthy: boolean;
        recentAnomalies: number;
        recommendation: string;
    } {
        const recentTime = Date.now() - 300000; // Last 5 minutes
        const recentPrices = this.priceHistory.filter(
            (p) => p.time > recentTime
        );

        if (recentPrices.length < 10) {
            return {
                isHealthy: false,
                recentAnomalies: 0,
                recommendation: "Insufficient data",
            };
        }

        // Simple health check based on price stability
        const prices = recentPrices.map((p) => p.price);
        const mean = this.calculateMean(prices);
        const stdDev = this.calculateStdDev(prices, mean);
        const coefficientOfVariation = stdDev / mean;

        return {
            isHealthy: coefficientOfVariation < 0.02, // Less than 2% variation
            recentAnomalies: 0, // Would need to track this
            recommendation:
                coefficientOfVariation > 0.02
                    ? "High volatility - trade with caution"
                    : "Market conditions normal",
        };
    }
}
