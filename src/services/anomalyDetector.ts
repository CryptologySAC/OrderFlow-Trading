// src/services/anomalyDetector.ts

import { EventEmitter } from "events";
import type { MarketAnomaly } from "../utils/types.js";
import type { SpoofingDetector } from "../services/spoofingDetector.js";
import { Logger } from "../infrastructure/logger.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";

export interface AnomalyDetectorOptions {
    windowSize?: number;
    normalSpreadBps?: number; // basis points
    minHistory?: number;
    spoofingDetector?: SpoofingDetector;
    logger?: Logger;
    anomalyCooldownMs?: number;
    volumeImbalanceThreshold?: number;
    absorptionRatioThreshold?: number;
    icebergDetectionWindow?: number;
    orderSizeAnomalyThreshold?: number;
}

export type AnomalyType =
    | "flash_crash"
    | "liquidity_void"
    | "api_gap"
    | "extreme_volatility"
    | "spoofing"
    | "orderbook_imbalance"
    | "flow_imbalance"
    | "absorption"
    | "exhaustion"
    | "momentum_ignition"
    | "iceberg_order"
    | "order_size_anomaly"
    | "whale_activity";

export interface AnomalyEvent extends MarketAnomaly {
    type: AnomalyType;
    severity: "critical" | "high" | "medium" | "info";
    details: Record<string, unknown>;
}

interface MarketSnapshot {
    price: number;
    aggressiveVolume: number;
    aggressiveSide: "buy" | "sell";
    timestamp: number;
    spread?: number;
    passiveBidVolume: number;
    passiveAskVolume: number;
    zonePassiveBidVolume: number;
    zonePassiveAskVolume: number;
    bestBid?: number;
    bestAsk?: number;
}

interface FlowMetrics {
    buyVolume: number;
    sellVolume: number;
    netFlow: number;
    flowImbalance: number;
}

interface OrderSizeStats {
    mean: number;
    median: number;
    stdDev: number;
    p95: number;
    p99: number;
    maxSize: number;
    distribution: Map<number, number>;
    sortedSizes: number[]; // size bucket -> count
}

interface IcebergCandidate {
    price: number;
    side: "buy" | "sell";
    firstSeen: number;
    totalVolume: number;
    fillCount: number;
    lastRefill: number;
    refillPattern: number[]; // time deltas between refills
}

export class AnomalyDetector extends EventEmitter {
    private marketHistory: MarketSnapshot[] = [];
    private readonly windowSize: number;
    private readonly normalSpreadBps: number;
    private readonly minHistory: number;
    private readonly anomalyCooldownMs: number;
    private readonly volumeImbalanceThreshold: number;
    private readonly absorptionRatioThreshold: number;
    private readonly icebergDetectionWindow: number;
    private readonly orderSizeAnomalyThreshold: number;

    private cachedStats?: { stats: OrderSizeStats; timestamp: number };
    private statsCacheDuration = 5000; // 5 seconds

    private readonly spoofingDetector?: SpoofingDetector;
    private readonly logger?: Logger;

    // Properly track orderbook state
    private currentBestBid = 0;
    private currentBestAsk = 0;
    private lastDepthUpdateTime = 0;

    private getOrderSizeStats(): OrderSizeStats {
        const now = Date.now();
        if (
            this.cachedStats &&
            now - this.cachedStats.timestamp < this.statsCacheDuration
        ) {
            return this.cachedStats.stats;
        }

        const stats = this.calculateOrderSizeStats();
        this.cachedStats = { stats, timestamp: now };
        return stats;
    }

    // Flow tracking
    private recentFlowWindow: {
        volume: number;
        side: "buy" | "sell";
        time: number;
    }[] = [];
    private flowWindowMs = 30000;

    // Order size tracking
    private orderSizeHistory: { size: number; time: number; price: number }[] =
        [];
    private orderSizeWindowMs = 300000; // 5 minutes

    // Iceberg tracking
    private icebergCandidates = new Map<string, IcebergCandidate>();
    private priceVolumeHistory = new Map<
        number,
        { volume: number; count: number; lastUpdate: number }
    >();

    // Anomaly deduplication
    private lastEmitted: Record<string, { severity: string; time: number }> =
        {};
    private recentAnomalies: AnomalyEvent[] = [];

    constructor(options: AnomalyDetectorOptions = {}) {
        super();
        this.windowSize = options.windowSize ?? 1000;
        this.normalSpreadBps = options.normalSpreadBps ?? 10; // 0.1% normal spread
        this.minHistory = options.minHistory ?? 100;
        this.spoofingDetector = options.spoofingDetector;
        this.logger = options.logger;
        this.anomalyCooldownMs = options.anomalyCooldownMs ?? 10000;
        this.volumeImbalanceThreshold = options.volumeImbalanceThreshold ?? 0.7;
        this.absorptionRatioThreshold = options.absorptionRatioThreshold ?? 3.0;
        this.icebergDetectionWindow = options.icebergDetectionWindow ?? 60000; // 1 minute
        this.orderSizeAnomalyThreshold = options.orderSizeAnomalyThreshold ?? 3; // 3 std devs
    }

    /**
     * Update best bid/ask from orderbook updates
     */
    public updateBestQuotes(bestBid: number, bestAsk: number): void {
        this.currentBestBid = bestBid;
        this.currentBestAsk = bestAsk;
        this.lastDepthUpdateTime = Date.now();
    }

    /**
     * Main entry point - process enriched trades
     */
    public onEnrichedTrade(trade: EnrichedTradeEvent): void {
        const now = trade.timestamp;
        const aggressiveSide: "buy" | "sell" = trade.isMakerSell
            ? "buy"
            : "sell";

        // Track order sizes
        this.trackOrderSize(trade.quantity, trade.price, now);

        // Update price-volume history for iceberg detection
        this.updatePriceVolumeHistory(trade.price, trade.quantity, now);

        // Calculate spread if we have valid quotes
        let spread: number | undefined;
        let spreadBps: number | undefined;
        if (this.currentBestBid > 0 && this.currentBestAsk > 0) {
            spread = this.currentBestAsk - this.currentBestBid;
            spreadBps = (spread / trade.price) * 10000; // basis points
        }

        // Create market snapshot
        const snapshot: MarketSnapshot = {
            price: trade.price,
            aggressiveVolume: trade.quantity,
            aggressiveSide,
            timestamp: now,
            spread,
            passiveBidVolume: trade.passiveBidVolume,
            passiveAskVolume: trade.passiveAskVolume,
            zonePassiveBidVolume: trade.zonePassiveBidVolume ?? 0,
            zonePassiveAskVolume: trade.zonePassiveAskVolume ?? 0,
            bestBid: this.currentBestBid,
            bestAsk: this.currentBestAsk,
        };

        // Update history
        this.marketHistory.push(snapshot);
        if (this.marketHistory.length > this.windowSize) {
            this.marketHistory.shift();
        }

        // Update flow tracking
        this.recentFlowWindow.push({
            volume: trade.quantity,
            side: aggressiveSide,
            time: now,
        });
        const flowCutoff = now - this.flowWindowMs;
        this.recentFlowWindow = this.recentFlowWindow.filter(
            (f) => f.time > flowCutoff
        );

        // Run anomaly checks
        if (this.marketHistory.length >= this.minHistory) {
            this.runAnomalyChecks(snapshot, spreadBps);
            this.checkOrderSizeAnomaly(trade);
            this.checkIcebergOrders(trade);
        }

        // Check spoofing
        if (this.spoofingDetector) {
            this.checkSpoofing(trade);
        }
    }

    /**
     * Order size distribution tracking
     */
    private trackOrderSize(size: number, price: number, time: number): void {
        this.orderSizeHistory.push({ size, price, time });

        // Clean old entries
        const cutoff = time - this.orderSizeWindowMs;
        this.orderSizeHistory = this.orderSizeHistory.filter(
            (o) => o.time > cutoff
        );
    }

    private calculateOrderSizeStats(): OrderSizeStats {
        if (this.orderSizeHistory.length === 0) {
            return {
                mean: 0,
                median: 0,
                stdDev: 0,
                p95: 0,
                p99: 0,
                maxSize: 0,
                distribution: new Map(),
                sortedSizes: [],
            };
        }

        const sizes = this.orderSizeHistory
            .map((o) => o.size)
            .sort((a, b) => a - b);
        const mean = this.calculateMean(sizes);
        const stdDev = this.calculateStdDev(sizes, mean);
        const median = sizes[Math.floor(sizes.length / 2)];
        const p95 = sizes[Math.floor(sizes.length * 0.95)];
        const p99 = sizes[Math.floor(sizes.length * 0.99)];
        const maxSize = sizes[sizes.length - 1];

        // Calculate distribution buckets
        const distribution = new Map<number, number>();
        const bucketSize = stdDev / 2;
        for (const size of sizes) {
            const bucket = Math.floor(size / bucketSize) * bucketSize;
            distribution.set(bucket, (distribution.get(bucket) || 0) + 1);
        }

        return {
            mean,
            median,
            stdDev,
            p95,
            p99,
            maxSize,
            distribution,
            sortedSizes: sizes,
        };
    }

    /**
     * Check for anomalous order sizes
     */
    private checkOrderSizeAnomaly(trade: EnrichedTradeEvent): void {
        const stats = this.calculateOrderSizeStats();
        if (stats.mean === 0) return;

        const zScore = (trade.quantity - stats.mean) / (stats.stdDev || 1);

        // Check for unusually large orders
        if (zScore > this.orderSizeAnomalyThreshold) {
            // Check if it's part of a pattern
            const recentLargeOrders = this.orderSizeHistory.filter(
                (o) => Date.now() - o.time < 60000 && o.size > stats.p95
            ).length;

            const severity =
                zScore > 5 ? "high" : recentLargeOrders > 5 ? "high" : "medium";

            this.emitAnomaly({
                type:
                    recentLargeOrders > 3
                        ? "whale_activity"
                        : "order_size_anomaly",
                detectedAt: trade.timestamp,
                severity,
                affectedPriceRange: {
                    min: trade.price * 0.999,
                    max: trade.price * 1.001,
                },
                recommendedAction: trade.isMakerSell
                    ? "watch_support"
                    : "watch_resistance",
                details: {
                    orderSize: trade.quantity,
                    zScore,
                    stats: {
                        mean: stats.mean,
                        median: stats.median,
                        p95: stats.p95,
                        p99: stats.p99,
                    },
                    recentLargeOrders,
                    percentileRank: this.calculatePercentileRank(
                        trade.quantity
                    ),
                    isWhale: trade.quantity > stats.p99,
                },
            });
        }

        // Check for unusually small orders (potential algo splitting)
        if (trade.quantity < stats.mean * 0.1 && stats.mean > 0) {
            const recentSmallOrders = this.orderSizeHistory.filter(
                (o) => Date.now() - o.time < 30000 && o.size < stats.mean * 0.1
            ).length;

            if (recentSmallOrders > 20) {
                this.emitAnomaly({
                    type: "order_size_anomaly",
                    detectedAt: trade.timestamp,
                    severity: "info",
                    affectedPriceRange: {
                        min: trade.price * 0.999,
                        max: trade.price * 1.001,
                    },
                    recommendedAction: "monitor",
                    details: {
                        anomalyType: "algo_splitting",
                        smallOrderCount: recentSmallOrders,
                        averageSmallSize: this.calculateMean(
                            this.orderSizeHistory
                                .filter((o) => o.size < stats.mean * 0.1)
                                .map((o) => o.size)
                        ),
                    },
                });
            }
        }
    }

    /**
     * Iceberg order detection
     */
    private updatePriceVolumeHistory(
        price: number,
        volume: number,
        time: number
    ): void {
        const rounded = Math.round(price * 100) / 100;
        const existing = this.priceVolumeHistory.get(rounded) || {
            volume: 0,
            count: 0,
            lastUpdate: 0,
        };

        this.priceVolumeHistory.set(rounded, {
            volume: existing.volume + volume,
            count: existing.count + 1,
            lastUpdate: time,
        });

        // Clean old entries
        for (const [p, data] of this.priceVolumeHistory.entries()) {
            if (time - data.lastUpdate > this.icebergDetectionWindow * 2) {
                this.priceVolumeHistory.delete(p);
            }
        }
    }

    private checkIcebergOrders(trade: EnrichedTradeEvent): void {
        const price = Math.round(trade.price * 100) / 100;
        const side: "buy" | "sell" = trade.isMakerSell ? "buy" : "sell";
        const key = `${price}_${side}`;
        const now = trade.timestamp;

        // Get or create candidate
        let candidate = this.icebergCandidates.get(key);

        // Check if passive liquidity keeps getting refilled at this level
        const passiveVolume =
            side === "buy" ? trade.passiveAskVolume : trade.passiveBidVolume;
        const zonePassive =
            side === "buy"
                ? trade.zonePassiveAskVolume
                : trade.zonePassiveBidVolume;

        if (!candidate) {
            // Start tracking if we see significant passive volume
            if (passiveVolume > 0 || (zonePassive && zonePassive > 0)) {
                candidate = {
                    price,
                    side,
                    firstSeen: now,
                    totalVolume: trade.quantity,
                    fillCount: 1,
                    lastRefill: now,
                    refillPattern: [],
                };
                this.icebergCandidates.set(key, candidate);
            }
            return;
        }

        // Update candidate
        const timeSinceLastFill = now - candidate.lastRefill;
        candidate.totalVolume += trade.quantity;
        candidate.fillCount++;

        // Check for refill pattern
        if (passiveVolume > 0 && timeSinceLastFill < 5000) {
            candidate.refillPattern.push(timeSinceLastFill);
            candidate.lastRefill = now;

            // Iceberg detection criteria:
            // 1. Multiple fills at same price
            // 2. Consistent refill timing
            // 3. Large total volume absorbed
            if (candidate.fillCount > 5 && candidate.refillPattern.length > 3) {
                const avgRefillTime = this.calculateMean(
                    candidate.refillPattern
                );
                const refillStdDev = this.calculateStdDev(
                    candidate.refillPattern,
                    avgRefillTime
                );

                // Consistent refill pattern suggests iceberg
                if (refillStdDev < avgRefillTime * 0.3) {
                    const stats = this.calculateOrderSizeStats();

                    this.emitAnomaly({
                        type: "iceberg_order",
                        detectedAt: now,
                        severity:
                            candidate.totalVolume > stats.mean * 20
                                ? "high"
                                : "medium",
                        affectedPriceRange: {
                            min: price - 0.01,
                            max: price + 0.01,
                        },
                        recommendedAction:
                            side === "buy" ? "avoid_selling" : "avoid_buying",
                        details: {
                            price,
                            side,
                            totalVolumeAbsorbed: candidate.totalVolume,
                            fillCount: candidate.fillCount,
                            avgRefillTime: avgRefillTime / 1000, // seconds
                            refillConsistency: 1 - refillStdDev / avgRefillTime,
                            durationMinutes:
                                (now - candidate.firstSeen) / 60000,
                            estimatedRemainingSize:
                                this.estimateIcebergSize(candidate),
                        },
                    });
                }
            }
        }

        // Clean old candidates
        if (now - candidate.lastRefill > this.icebergDetectionWindow) {
            this.icebergCandidates.delete(key);
        }
    }

    private estimateIcebergSize(candidate: IcebergCandidate): number {
        const stats = this.getOrderSizeStats();

        const fillRate =
            (candidate.totalVolume / (Date.now() - candidate.firstSeen)) * 1000;
        const avgRefillTime =
            this.calculateMean(candidate.refillPattern) / 1000;

        const avgOrderSize = stats.mean;
        const largeOrderThreshold = stats.p95;

        // Calculate average fill size
        const avgFillSize = candidate.totalVolume / candidate.fillCount;

        // Estimate based on how this iceberg compares to typical orders
        const icebergVsTypicalRatio = avgFillSize / avgOrderSize;

        // Check if fills are "large" orders - this affects our estimate
        const hasLargeFills = avgFillSize > largeOrderThreshold;

        // Large fills suggest a more aggressive iceberg that will complete sooner
        // Small fills suggest patient accumulation/distribution
        const baseRefills = hasLargeFills
            ? icebergVsTypicalRatio > 5
                ? 8
                : 5 // Fewer refills expected
            : icebergVsTypicalRatio > 10
              ? 20 // Many small refills expected
              : icebergVsTypicalRatio > 5
                ? 15
                : 10;

        const estimatedRefillsRemaining = Math.max(
            hasLargeFills ? 2 : 3, // Minimum depends on fill size
            baseRefills - candidate.fillCount
        );

        // Adjust estimate based on fill rate consistency
        const fillRates = candidate.refillPattern.map((t, i) => {
            // Calculate fill rate for each interval
            const volumeInInterval = candidate.totalVolume / (i + 1);
            return volumeInInterval / (t / 1000);
        });

        const fillRateStdDev = this.calculateStdDev(fillRates, fillRate);
        const consistency = Math.max(0.5, 1 - fillRateStdDev / fillRate);

        // Large fills get a size multiplier
        const sizeMultiplier = hasLargeFills ? 1.5 : 1.0;

        return (
            fillRate *
            avgRefillTime *
            estimatedRefillsRemaining *
            consistency *
            sizeMultiplier
        );
    }

    private calculatePercentileRank(value: number): number {
        const stats = this.getOrderSizeStats();
        const sortedSizes = stats.sortedSizes;

        if (!sortedSizes || sortedSizes.length === 0) {
            return 50; // Default to median if no data
        }

        const index = sortedSizes.findIndex((s) => s >= value);
        return index === -1 ? 100 : (index / sortedSizes.length) * 100;
    }

    /*private calculateAbsorptionConfidence(data: any): number {
        // Calculate confidence based on multiple factors
        let confidence = 0.5; // base confidence

        // Volume significance
        const avgVolume = this.getAverageVolume();
        if (data.totalAggressiveVolume > avgVolume * 3) confidence += 0.2;

        // Price stability during absorption
        const priceStability = this.checkPriceStability(data.price, 30000);
        if (priceStability > 0.95) confidence += 0.2;

        // Flow imbalance supports absorption
        const flow = this.calculateFlowMetrics();
        if (Math.abs(flow.flowImbalance) > 0.7) confidence += 0.1;

        return Math.min(1, confidence);
    }

    /*private calculateExhaustionConfidence(data: any): number {
        let confidence = 0.5;

        // Check volume decline pattern
        const volumeDecline = this.checkVolumeDecline();
        if (volumeDecline > 0.7) confidence += 0.2;

        // Check if at important price level
        const atResistance = this.checkIfAtResistance(data.price);
        if (atResistance) confidence += 0.2;

        // Order size distribution supports exhaustion
        const stats = this.calculateOrderSizeStats();
        const recentAvgSize = this.calculateMean(
            this.orderSizeHistory.slice(-10).map((o) => o.size)
        );
        if (recentAvgSize < stats.mean * 0.5) confidence += 0.1;

        return Math.min(1, confidence);
    }
        */

    private runAnomalyChecks(
        snapshot: MarketSnapshot,
        spreadBps?: number
    ): void {
        this.checkFlashCrash(snapshot);
        this.checkLiquidityVoid(snapshot, spreadBps);
        this.checkApiGap(snapshot);
        this.checkExtremeVolatility(snapshot);
        this.checkOrderbookImbalance(snapshot);
        this.checkFlowImbalance(snapshot);
        this.checkAbsorption(snapshot);
        this.checkExhaustion(snapshot);
        this.checkMomentumIgnition(snapshot);
    }

    private checkFlashCrash(snapshot: MarketSnapshot): void {
        const prices = this.marketHistory.map((h) => h.price);
        const mean = this.calculateMean(prices);
        const stdDev = this.calculateStdDev(prices, mean);
        const zScore = Math.abs(snapshot.price - mean) / (stdDev || 1);

        if (zScore > 3) {
            this.emitAnomaly({
                type: "flash_crash",
                detectedAt: snapshot.timestamp,
                severity: zScore > 5 ? "critical" : "high",
                affectedPriceRange: {
                    min: Math.min(snapshot.price, mean - 3 * stdDev),
                    max: Math.max(snapshot.price, mean + 3 * stdDev),
                },
                recommendedAction:
                    zScore > 5 ? "close_positions" : "reduce_size",
                details: {
                    mean,
                    stdDev,
                    zScore,
                    price: snapshot.price,
                    percentMove: ((snapshot.price - mean) / mean) * 100,
                },
            });
        }
    }

    private checkLiquidityVoid(
        snapshot: MarketSnapshot,
        spreadBps?: number
    ): void {
        if (!spreadBps) return;

        // Check for abnormally wide spreads
        if (spreadBps > this.normalSpreadBps * 5) {
            // Also check if passive liquidity is thin
            const totalPassive =
                snapshot.zonePassiveBidVolume + snapshot.zonePassiveAskVolume;
            const avgPassive =
                this.marketHistory
                    .slice(-20)
                    .reduce(
                        (sum, h) =>
                            sum +
                            h.zonePassiveBidVolume +
                            h.zonePassiveAskVolume,
                        0
                    ) / 20;

            this.emitAnomaly({
                type: "liquidity_void",
                detectedAt: snapshot.timestamp,
                severity:
                    spreadBps > this.normalSpreadBps * 10 ? "critical" : "high",
                affectedPriceRange: {
                    min: snapshot.bestBid || snapshot.price * 0.999,
                    max: snapshot.bestAsk || snapshot.price * 1.001,
                },
                recommendedAction: "pause",
                details: {
                    spreadBps,
                    normalSpreadBps: this.normalSpreadBps,
                    currentPassiveLiquidity: totalPassive,
                    averagePassiveLiquidity: avgPassive,
                    liquidityRatio: totalPassive / (avgPassive || 1),
                },
            });
        }
    }

    private checkOrderbookImbalance(snapshot: MarketSnapshot): void {
        const bidVolume = snapshot.zonePassiveBidVolume;
        const askVolume = snapshot.zonePassiveAskVolume;
        const totalVolume = bidVolume + askVolume;

        if (totalVolume > 0) {
            const imbalance = (bidVolume - askVolume) / totalVolume;

            if (Math.abs(imbalance) > this.volumeImbalanceThreshold) {
                this.emitAnomaly({
                    type: "orderbook_imbalance",
                    detectedAt: snapshot.timestamp,
                    severity: Math.abs(imbalance) > 0.9 ? "high" : "medium",
                    affectedPriceRange: {
                        min: snapshot.price * 0.999,
                        max: snapshot.price * 1.001,
                    },
                    recommendedAction:
                        imbalance > 0 ? "consider_long" : "consider_short",
                    details: {
                        imbalance,
                        bidVolume,
                        askVolume,
                        direction: imbalance > 0 ? "bid_heavy" : "ask_heavy",
                        imbalancePercent: imbalance * 100,
                    },
                });
            }
        }
    }

    private checkFlowImbalance(snapshot: MarketSnapshot): void {
        const flowMetrics = this.calculateFlowMetrics();

        if (
            Math.abs(flowMetrics.flowImbalance) > this.volumeImbalanceThreshold
        ) {
            this.emitAnomaly({
                type: "flow_imbalance",
                detectedAt: snapshot.timestamp,
                severity:
                    Math.abs(flowMetrics.flowImbalance) > 0.85
                        ? "high"
                        : "medium",
                affectedPriceRange: {
                    min: snapshot.price * 0.998,
                    max: snapshot.price * 1.002,
                },
                recommendedAction:
                    flowMetrics.netFlow > 0
                        ? "momentum_long"
                        : "momentum_short",
                details: {
                    ...flowMetrics,
                    windowMs: this.flowWindowMs,
                    direction:
                        flowMetrics.netFlow > 0
                            ? "buy_pressure"
                            : "sell_pressure",
                },
            });
        }
    }

    private checkAbsorption(snapshot: MarketSnapshot): void {
        // Absorption: high aggressive volume but price doesn't move
        const recentSnapshots = this.marketHistory.slice(-10);
        if (recentSnapshots.length < 10) return;

        const totalAggressive = recentSnapshots.reduce(
            (sum, s) => sum + s.aggressiveVolume,
            0
        );
        const priceRange =
            Math.max(...recentSnapshots.map((s) => s.price)) -
            Math.min(...recentSnapshots.map((s) => s.price));
        const avgPrice = this.calculateMean(
            recentSnapshots.map((s) => s.price)
        );
        const priceRangePercent = (priceRange / avgPrice) * 100;

        // High volume but tiny price movement
        if (priceRangePercent < 0.05 && totalAggressive > 0) {
            const passiveVolume =
                snapshot.aggressiveSide === "buy"
                    ? snapshot.zonePassiveAskVolume
                    : snapshot.zonePassiveBidVolume;

            const absorptionRatio = passiveVolume / totalAggressive;

            if (absorptionRatio > this.absorptionRatioThreshold) {
                this.emitAnomaly({
                    type: "absorption",
                    detectedAt: snapshot.timestamp,
                    severity: absorptionRatio > 5 ? "high" : "medium",
                    affectedPriceRange: {
                        min: Math.min(...recentSnapshots.map((s) => s.price)),
                        max: Math.max(...recentSnapshots.map((s) => s.price)),
                    },
                    recommendedAction:
                        snapshot.aggressiveSide === "buy"
                            ? "fade_rally"
                            : "fade_dip",
                    details: {
                        aggressiveVolume: totalAggressive,
                        passiveVolume,
                        absorptionRatio,
                        priceRangePercent,
                        absorbingSide:
                            snapshot.aggressiveSide === "buy"
                                ? "sellers"
                                : "buyers",
                    },
                });
            }
        }
    }

    private checkExhaustion(snapshot: MarketSnapshot): void {
        // Exhaustion: aggressive volume drying up after a move
        const recentFlow = this.recentFlowWindow.slice(-20);
        if (recentFlow.length < 20) return;

        const firstHalf = recentFlow.slice(0, 10);
        const secondHalf = recentFlow.slice(10);

        const firstVolume = firstHalf.reduce((sum, f) => sum + f.volume, 0);
        const secondVolume = secondHalf.reduce((sum, f) => sum + f.volume, 0);

        if (firstVolume > 0 && secondVolume / firstVolume < 0.3) {
            // Volume dried up by 70%+
            this.emitAnomaly({
                type: "exhaustion",
                detectedAt: snapshot.timestamp,
                severity: secondVolume / firstVolume < 0.1 ? "high" : "medium",
                affectedPriceRange: {
                    min: snapshot.price * 0.998,
                    max: snapshot.price * 1.002,
                },
                recommendedAction: "prepare_reversal",
                details: {
                    firstHalfVolume: firstVolume,
                    secondHalfVolume: secondVolume,
                    volumeDeclinePercent:
                        ((firstVolume - secondVolume) / firstVolume) * 100,
                    dominantSide: this.getDominantFlowSide(),
                },
            });
        }
    }

    private checkMomentumIgnition(snapshot: MarketSnapshot): void {
        // Sudden surge in directional flow
        const last5 = this.recentFlowWindow.slice(-5);
        const previous15 = this.recentFlowWindow.slice(-20, -5);

        if (last5.length < 5 || previous15.length < 15) return;

        const recentVolume = last5.reduce((sum, f) => sum + f.volume, 0);
        const prevAvgVolume =
            previous15.reduce((sum, f) => sum + f.volume, 0) / 3; // per 5 trades

        if (recentVolume > prevAvgVolume * 4) {
            // 4x surge in volume
            const recentSide = this.getDominantSide(last5);

            this.emitAnomaly({
                type: "momentum_ignition",
                detectedAt: snapshot.timestamp,
                severity: recentVolume > prevAvgVolume * 6 ? "high" : "medium",
                affectedPriceRange: {
                    min: snapshot.price,
                    max:
                        snapshot.price * (recentSide === "buy" ? 1.005 : 0.995),
                },
                recommendedAction: `join_${recentSide}_momentum`,
                details: {
                    surgeMultiple: recentVolume / prevAvgVolume,
                    recentVolume,
                    normalVolume: prevAvgVolume,
                    direction: recentSide,
                },
            });
        }
    }

    private checkApiGap(snapshot: MarketSnapshot): void {
        const len = this.marketHistory.length;
        if (len < 2) return;

        const timeGap =
            snapshot.timestamp - this.marketHistory[len - 2].timestamp;

        if (timeGap > 5000) {
            this.emitAnomaly({
                type: "api_gap",
                detectedAt: snapshot.timestamp,
                severity: timeGap > 30000 ? "high" : "medium",
                affectedPriceRange: {
                    min: snapshot.price * 0.99,
                    max: snapshot.price * 1.01,
                },
                recommendedAction: timeGap > 30000 ? "pause" : "continue",
                details: {
                    timeGapMs: timeGap,
                    timeGapSeconds: timeGap / 1000,
                },
            });
        }
    }

    private checkExtremeVolatility(snapshot: MarketSnapshot): void {
        const prices = this.marketHistory.map((h) => h.price);
        const returns: number[] = [];

        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }

        const recentReturns = returns.slice(-20);
        const allReturnsStdDev = this.calculateStdDev(
            returns,
            this.calculateMean(returns)
        );
        const recentStdDev = this.calculateStdDev(
            recentReturns,
            this.calculateMean(recentReturns)
        );

        if (recentStdDev > allReturnsStdDev * 2.5) {
            this.emitAnomaly({
                type: "extreme_volatility",
                detectedAt: snapshot.timestamp,
                severity:
                    recentStdDev > allReturnsStdDev * 4 ? "high" : "medium",
                affectedPriceRange: {
                    min: snapshot.price * (1 - recentStdDev * 2),
                    max: snapshot.price * (1 + recentStdDev * 2),
                },
                recommendedAction: "reduce_size",
                details: {
                    recentVolatility: recentStdDev,
                    normalVolatility: allReturnsStdDev,
                    volatilityRatio: recentStdDev / allReturnsStdDev,
                    annualizedVolatility:
                        recentStdDev * Math.sqrt(365 * 24 * 60 * 60), // Assumes second data
                },
            });
        }
    }

    private checkSpoofing(trade: EnrichedTradeEvent): void {
        if (!this.spoofingDetector) return;

        const side: "buy" | "sell" = trade.isMakerSell ? "buy" : "sell";

        const getAggressiveVolume = (
            bandPrice: number,
            from: number,
            to: number
        ): number => {
            return this.marketHistory
                .filter(
                    (s) =>
                        s.price === bandPrice &&
                        s.timestamp >= from &&
                        s.timestamp <= to
                )
                .reduce((sum, s) => sum + s.aggressiveVolume, 0);
        };

        const spoofed = this.spoofingDetector.wasSpoofed(
            trade.price,
            side,
            trade.timestamp,
            getAggressiveVolume
        );

        if (spoofed) {
            this.emitAnomaly({
                type: "spoofing",
                detectedAt: trade.timestamp,
                severity: "high",
                affectedPriceRange: { min: trade.price, max: trade.price },
                recommendedAction: "pause",
                details: {
                    price: trade.price,
                    side,
                    passiveVolumeBefore:
                        trade.passiveBidVolume + trade.passiveAskVolume,
                },
            });
        }
    }

    // Helper methods
    private calculateFlowMetrics(): FlowMetrics {
        let buyVolume = 0;
        let sellVolume = 0;

        for (const flow of this.recentFlowWindow) {
            if (flow.side === "buy") {
                buyVolume += flow.volume;
            } else {
                sellVolume += flow.volume;
            }
        }

        const totalVolume = buyVolume + sellVolume;
        const netFlow = buyVolume - sellVolume;
        const flowImbalance = totalVolume > 0 ? netFlow / totalVolume : 0;

        return { buyVolume, sellVolume, netFlow, flowImbalance };
    }

    private getDominantFlowSide(): "buy" | "sell" | "neutral" {
        const metrics = this.calculateFlowMetrics();
        if (Math.abs(metrics.flowImbalance) < 0.1) return "neutral";
        return metrics.netFlow > 0 ? "buy" : "sell";
    }

    private getDominantSide(flows: { side: "buy" | "sell" }[]): "buy" | "sell" {
        const buys = flows.filter((f) => f.side === "buy").length;
        return buys > flows.length / 2 ? "buy" : "sell";
    }

    private emitAnomaly(anomaly: AnomalyEvent): void {
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
            this.logger?.warn?.("Market anomaly detected:", { anomaly });
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

    public getMarketHealth(): {
        isHealthy: boolean;
        recentAnomalies: number;
        highestSeverity: "critical" | "high" | "medium" | "info" | null;
        recommendation:
            | "pause"
            | "reduce_size"
            | "close_positions"
            | "continue"
            | "insufficient_data";
        metrics: {
            spreadBps?: number;
            flowImbalance?: number;
            volatility?: number;
        };
    } {
        const recentTime = Date.now() - 300000; // 5 minutes
        const recentSnapshots = this.marketHistory.filter(
            (s) => s.timestamp > recentTime
        );

        if (recentSnapshots.length < 10) {
            return {
                isHealthy: false,
                recentAnomalies: 0,
                highestSeverity: null,
                recommendation: "insufficient_data",
                metrics: {},
            };
        }

        // Calculate current metrics
        const prices = recentSnapshots.map((s) => s.price);
        const returns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }
        const volatility = this.calculateStdDev(
            returns,
            this.calculateMean(returns)
        );

        const flowMetrics = this.calculateFlowMetrics();
        const currentSpreadBps =
            this.currentBestAsk > 0 && this.currentBestBid > 0
                ? ((this.currentBestAsk - this.currentBestBid) /
                      prices[prices.length - 1]) *
                  10000
                : undefined;

        // Check recent anomalies
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

        // Determine health and recommendation
        const isHealthy =
            volatility < 0.001 &&
            (!highestSeverity || highestSeverity === "info") &&
            (currentSpreadBps ? currentSpreadBps < 50 : true);

        let recommendation:
            | "pause"
            | "reduce_size"
            | "close_positions"
            | "continue";
        if (highestSeverity === "critical") {
            recommendation = "close_positions";
        } else if (highestSeverity === "high" || volatility > 0.002) {
            recommendation = "reduce_size";
        } else if (highestSeverity === "medium") {
            recommendation = "reduce_size";
        } else {
            recommendation = "continue";
        }

        return {
            isHealthy,
            recentAnomalies: recentAnoms.length,
            highestSeverity,
            recommendation,
            metrics: {
                spreadBps: currentSpreadBps,
                flowImbalance: flowMetrics.flowImbalance,
                volatility,
            },
        };
    }

    private checkPriceStability(price: number, windowMs: number): number {
        const cutoff = Date.now() - windowMs;
        const recent = this.marketHistory.filter((s) => s.timestamp > cutoff);
        if (recent.length === 0) return 0;

        const prices = recent.map((s) => s.price);
        const mean = this.calculateMean(prices);
        const stdDev = this.calculateStdDev(prices, mean);

        return 1 - stdDev / mean;
    }

    private checkVolumeDecline(): number {
        const recent = this.recentFlowWindow.slice(-20);
        if (recent.length < 20) return 0;

        const firstHalf = recent
            .slice(0, 10)
            .reduce((sum, f) => sum + f.volume, 0);
        const secondHalf = recent
            .slice(10)
            .reduce((sum, f) => sum + f.volume, 0);

        return firstHalf > 0 ? 1 - secondHalf / firstHalf : 0;
    }

    private checkIfAtResistance(price: number): boolean {
        // Check if price is at a high volume node from history
        const priceHistory = this.priceVolumeHistory.get(
            Math.round(price * 100) / 100
        );
        if (!priceHistory) return false;

        const avgVolume = this.getAverageVolumeAtPrice();
        return priceHistory.volume > avgVolume * 2;
    }

    private getAverageVolume(): number {
        if (this.marketHistory.length === 0) return 0;
        return this.calculateMean(
            this.marketHistory.map((s) => s.aggressiveVolume)
        );
    }

    private getAverageVolumeAtPrice(): number {
        let total = 0;
        let count = 0;
        for (const data of this.priceVolumeHistory.values()) {
            total += data.volume;
            count++;
        }
        return count > 0 ? total / count : 0;
    }

    private getAverageTradeSize(): number {
        return this.calculateMean(this.orderSizeHistory.map((o) => o.size));
    }

    private getCurrentSpreadBps(): number | undefined {
        if (this.currentBestBid > 0 && this.currentBestAsk > 0) {
            const mid = (this.currentBestBid + this.currentBestAsk) / 2;
            return ((this.currentBestAsk - this.currentBestBid) / mid) * 10000;
        }
        return undefined;
    }

    private calculateRecentVolatility(): number {
        const prices = this.marketHistory.slice(-30).map((s) => s.price);
        if (prices.length < 2) return 0;

        const returns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }

        return this.calculateStdDev(returns, this.calculateMean(returns));
    }
}
