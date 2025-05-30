// src/services/anomalyDetector.ts

import { EventEmitter } from "events";
import type { SpotWebsocketStreams } from "@binance/spot";
import type { MarketAnomaly } from "../utils/types.js";
import type {
    /* SpoofingEvent, */ SpoofingDetector,
} from "../services/spoofingDetector.js";
import { Logger } from "../infrastructure/logger.js";

export interface AnomalyDetectorOptions {
    windowSize?: number;
    normalSpread?: number;
    minHistory?: number;
    spoofingDetector?: SpoofingDetector;
    logger?: Logger;
    anomalyCooldownMs?: number;
}

export type AnomalyType =
    | "flash_crash"
    | "liquidity_void"
    | "api_gap"
    | "extreme_volatility"
    | "spoofing"
    | "orderbook_imbalance";

export interface AnomalyEvent extends MarketAnomaly {
    type: AnomalyType;
    severity: "critical" | "high" | "medium" | "info";
    details: Record<string, unknown>;
}

interface PricePoint {
    price: number;
    volume: number;
    time: number;
    bestBid?: number;
    bestAsk?: number;
    spread?: number;
}

export class AnomalyDetector extends EventEmitter {
    private priceHistory: PricePoint[] = [];
    private readonly windowSize: number;
    private readonly normalSpread: number;
    private readonly minHistory: number;
    private readonly anomalyCooldownMs: number;
    //private readonly spoofingDetector?: SpoofingDetector;
    private readonly logger?: Logger;

    // Track the latest best bid/ask from depth updates
    private bestBid?: number;
    private bestAsk?: number;
    private lastDepthUpdate = 0;
    private recentAnomalies: AnomalyEvent[] = [];
    private lastEmitted: Record<string, { severity: string; time: number }> =
        {};

    constructor(options: AnomalyDetectorOptions = {}) {
        super();
        this.windowSize = options.windowSize ?? 1000;
        this.normalSpread = options.normalSpread ?? 0.002; // 0.2% for crypto
        this.minHistory = options.minHistory ?? 100;
        //this.spoofingDetector = options.spoofingDetector;
        this.logger = options.logger;
        this.anomalyCooldownMs = options.anomalyCooldownMs ?? 10000; // 10s
    }

    /**
     * Call this on every Binance trade event (AggTradeResponse)
     */
    public onTrade(trade: SpotWebsocketStreams.AggTradeResponse): void {
        const price = parseFloat(trade.p ?? "0");
        const quantity = parseFloat(trade.q ?? "0");
        const timestamp = trade.T ?? Date.now();

        // Use latest known best bid/ask
        const bestBid = this.bestBid;
        const bestAsk = this.bestAsk;
        const spread = bestBid && bestAsk ? (bestAsk - bestBid) / bestBid : 0;

        // Store point
        this.priceHistory.push({
            price,
            volume: quantity,
            time: timestamp,
            bestBid,
            bestAsk,
            spread,
        });
        if (this.priceHistory.length > this.windowSize) {
            this.priceHistory.shift();
        }

        // --- Anomaly Checks ---
        if (this.priceHistory.length >= this.minHistory) {
            this.checkFlashCrash(price, timestamp);
            this.checkLiquidityVoid(price, spread, timestamp);
            this.checkApiGap(timestamp);
            this.checkExtremeVolatility(price, timestamp);
            this.checkOrderbookImbalance(timestamp, bestBid, bestAsk);
        }

        // TODO Spoofing check (if integrated)
        //if (this.spoofingDetector) {
        //    const spoof = this.spoofingDetector.wasSpoofed();
        //    if (spoof) {
        //        this.emitAnomaly({
        //            type: "spoofing",
        //            detectedAt: timestamp,
        //            severity: "high",
        //            affectedPriceRange: {
        //                min: spoof.priceStart,
        //                max: spoof.priceEnd,
        //            },
        //            recommendedAction: "pause",
        //            details: { spoof },
        //        });
        //    }
        // }
    }

    /**
     * Call this on every Binance depth update (DiffBookDepthResponse)
     */
    public onDepth(update: SpotWebsocketStreams.DiffBookDepthResponse): void {
        const bids = (update.b as [string, string][]) || [];
        const asks = (update.a as [string, string][]) || [];
        if (bids.length) {
            this.bestBid = Math.max(
                ...bids.map(([price]) => parseFloat(price))
            );
        }
        if (asks.length) {
            this.bestAsk = Math.min(
                ...asks.map(([price]) => parseFloat(price))
            );
        }
        this.lastDepthUpdate = Date.now();
    }

    // ---- Anomaly Check Methods ----

    private checkFlashCrash(currentPrice: number, now: number) {
        const prices = this.priceHistory.map((h) => h.price);
        const mean = this.calculateMean(prices);
        const stdDev = this.calculateStdDev(prices, mean);
        const zScore = Math.abs(currentPrice - mean) / (stdDev || 1);
        if (zScore > 3) {
            this.emitAnomaly({
                type: "flash_crash",
                detectedAt: now,
                severity: zScore > 5 ? "critical" : "high",
                affectedPriceRange: {
                    min: Math.min(currentPrice, mean - 3 * stdDev),
                    max: Math.max(currentPrice, mean + 3 * stdDev),
                },
                recommendedAction:
                    zScore > 5 ? "close_positions" : "reduce_size",
                details: { mean, stdDev, zScore, price: currentPrice },
            });
        }
    }

    private checkLiquidityVoid(
        currentPrice: number,
        spread: number,
        now: number
    ) {
        // Use more tolerant thresholds for spread
        if (spread > this.normalSpread * 10) {
            this.emitAnomaly({
                type: "liquidity_void",
                detectedAt: now,
                severity: spread > this.normalSpread * 50 ? "critical" : "high",
                affectedPriceRange: {
                    min: currentPrice * (1 - spread),
                    max: currentPrice * (1 + spread),
                },
                recommendedAction: "pause",
                details: { spread, price: currentPrice },
            });
        }
    }

    private checkApiGap(now: number) {
        const len = this.priceHistory.length;
        const latestTime = this.priceHistory[len - 1].time;
        const prevTime = this.priceHistory[len - 2]?.time ?? latestTime;
        const timeGap = latestTime - prevTime;
        if (timeGap > 5000) {
            this.emitAnomaly({
                type: "api_gap",
                detectedAt: now,
                severity: timeGap > 30000 ? "high" : "medium",
                affectedPriceRange: {
                    min: this.priceHistory[len - 1].price * 0.99,
                    max: this.priceHistory[len - 1].price * 1.01,
                },
                recommendedAction: timeGap > 30000 ? "pause" : "continue",
                details: { timeGap },
            });
        }
    }

    private checkExtremeVolatility(currentPrice: number, now: number) {
        const prices = this.priceHistory.map((h) => h.price);
        const mean = this.calculateMean(prices);
        const stdDev = this.calculateStdDev(prices, mean);
        const recentPrices = prices.slice(-20);
        const recentVolatility = this.calculateVolatility(recentPrices);
        const normalVolatility = stdDev / (mean || 1);

        if (recentVolatility > normalVolatility * 3) {
            this.emitAnomaly({
                type: "extreme_volatility",
                detectedAt: now,
                severity: recentVolatility > 0.1 ? "high" : "medium",
                affectedPriceRange: {
                    min: currentPrice * (1 - recentVolatility),
                    max: currentPrice * (1 + recentVolatility),
                },
                recommendedAction: "reduce_size",
                details: {
                    recentVolatility,
                    normalVolatility,
                    price: currentPrice,
                },
            });
        }
    }

    private checkOrderbookImbalance(
        now: number,
        bestBid?: number,
        bestAsk?: number
    ) {
        if (typeof bestBid !== "number" || typeof bestAsk !== "number") return;
        // If spread is extremely wide compared to normal
        const spread = (bestAsk - bestBid) / (bestBid || 1);
        if (spread > 0.01) {
            // 1% for severe imbalance
            this.emitAnomaly({
                type: "orderbook_imbalance",
                detectedAt: now,
                severity: "high",
                affectedPriceRange: { min: bestBid, max: bestAsk },
                recommendedAction: "pause",
                details: { bestBid, bestAsk, spread },
            });
        }
    }

    /**
     * Emit anomaly events, but deduplicate per-type, per-severity, with cooldown.
     */
    private emitAnomaly(anomaly: AnomalyEvent) {
        const now = Date.now();
        const last = this.lastEmitted[anomaly.type];
        const cooldown = this.anomalyCooldownMs;

        const shouldEmit =
            !last ||
            (anomaly.severity === "critical" && last.severity !== "critical") ||
            now - last.time > cooldown;

        if (shouldEmit) {
            this.lastEmitted[anomaly.type] = {
                severity: anomaly.severity,
                time: now,
            };
            this.recentAnomalies.push(anomaly);
            if (this.recentAnomalies.length > 500) this.recentAnomalies.shift();
            this.emit("anomaly", anomaly);
            this.logger?.warn?.("Market anomaly detected:", { event: anomaly });
        }
    }

    private calculateMean(values: number[]): number {
        return values.reduce((sum, val) => sum + val, 0) / (values.length || 1);
    }

    private calculateStdDev(values: number[], mean: number): number {
        const variance =
            values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
            (values.length || 1);
        return Math.sqrt(variance);
    }

    private calculateVolatility(prices: number[]): number {
        if (prices.length < 2) return 0;
        const returns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / (prices[i - 1] || 1));
        }
        const meanReturn = this.calculateMean(returns);
        return this.calculateStdDev(returns, meanReturn);
    }

    /**
     * Market health summary for dashboards.
     */
    public getMarketHealth(): {
        isHealthy: boolean;
        recentAnomalies: number;
        highestSeverity: "critical" | "high" | "medium" | "info" | null;
        recommendation:
            | "pause"
            | "reduce_size"
            | "close_positions"
            | "continue"
            | "insufficient_data"
            | "caution";
    } {
        const recentTime = Date.now() - 300000;
        const recentPrices = this.priceHistory.filter(
            (p) => p.time > recentTime
        );
        if (recentPrices.length < 10) {
            return {
                isHealthy: false,
                recentAnomalies: 0,
                highestSeverity: null,
                recommendation: "insufficient_data",
            };
        }
        const prices = recentPrices.map((p) => p.price);
        const mean = this.calculateMean(prices);
        const stdDev = this.calculateStdDev(prices, mean);
        const coefficientOfVariation = stdDev / (mean || 1);

        // Filter recent anomalies by time
        const recentAnoms = this.recentAnomalies.filter(
            (a) => a.detectedAt > recentTime
        );
        const severityOrder = ["critical", "high", "medium", "info"] as const;
        let highestSeverity: (typeof severityOrder)[number] | null = null;
        for (const sev of severityOrder) {
            if (recentAnoms.some((a) => a.severity === sev)) {
                highestSeverity = sev;
                break;
            }
        }

        return {
            isHealthy:
                coefficientOfVariation < 0.02 &&
                (!highestSeverity || highestSeverity === "info"),
            recentAnomalies: recentAnoms.length,
            highestSeverity,
            recommendation:
                coefficientOfVariation > 0.02
                    ? "caution"
                    : highestSeverity === "critical"
                      ? "pause"
                      : highestSeverity === "high"
                        ? "reduce_size"
                        : highestSeverity === "medium"
                          ? "reduce_size"
                          : "continue",
        };
    }
}
