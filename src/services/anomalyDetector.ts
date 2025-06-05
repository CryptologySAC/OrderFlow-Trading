// src/services/anomalyDetector.ts
/**********************************************************************
 * AnomalyDetector
 * Emits `"anomaly"` (and `"anomaly:{symbol}"`) EventEmitter events
 * when market anomalies are detected in orderflow and orderbook data.
 *********************************************************************/

import { EventEmitter } from "events";
import type { MarketAnomaly } from "../utils/types.js";
import type { SpoofingDetector } from "../services/spoofingDetector.js";
import { Logger } from "../infrastructure/logger.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { RollingWindow } from "../utils/rollingWindow.js";

export interface AnomalyDetectorOptions {
    /** Rolling trade window size for statistics (default: 1000 trades) */
    windowSize?: number;
    /** Baseline bid/ask spread in basis points (default: 10 = 0.1%) */
    normalSpreadBps?: number;
    /** Minimum number of trades before detection (default: 100) */
    minHistory?: number;
    /** Minimum ms between duplicate anomaly events (default: 10,000ms) */
    anomalyCooldownMs?: number;
    /** Threshold for order book/flow imbalance detection (default: 0.7) */
    volumeImbalanceThreshold?: number;
    /** Absorption ratio required for absorption anomaly (default: 3.0) */
    absorptionRatioThreshold?: number;
    /** Milliseconds to track iceberg refill patterns (default: 60,000ms) */
    icebergDetectionWindow?: number;
    /** Order size anomaly z-score threshold (default: 3) */
    orderSizeAnomalyThreshold?: number;
    /** Price increment for tick/zone rounding (default: 0.01) */
    tickSize?: number;
}

/**
 * All supported anomaly types detected and emitted by AnomalyDetector.
 */
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

/**
 * Structure of an emitted anomaly event.
 */
export interface AnomalyEvent extends MarketAnomaly {
    type: AnomalyType;
    severity: "critical" | "high" | "medium" | "info";
    details: Record<string, unknown>;
}

/**
 * Represents a snapshot of recent market state for detection/scoring.
 */
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

/**
 * Aggregate flow metrics for flow imbalance detection.
 */
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

/**
 * Represents a candidate iceberg order for detection logic.
 */
interface IcebergCandidate {
    price: number;
    side: "buy" | "sell";
    firstSeen: number;
    totalVolume: number;
    fillCount: number;
    lastRefill: number;
    refillPattern: number[]; // time deltas between refills
}

/**
 * High-level, production-grade anomaly detection engine for real-time orderflow.
 * Emits "anomaly" and "anomaly:{symbol}" events when any anomaly is detected.
 *
 * @remarks
 * Use this detector for systematic monitoring of market risk, manipulation, regime shifts, or structural failures
 * in high-frequency trading, risk engines, or orderflow research.
 */
export class AnomalyDetector extends EventEmitter {
    private marketHistory: RollingWindow<MarketSnapshot>;
    private readonly windowSize: number;
    private readonly normalSpreadBps: number;
    private readonly minHistory: number;
    private readonly anomalyCooldownMs: number;
    private readonly volumeImbalanceThreshold: number;
    private readonly absorptionRatioThreshold: number;
    private readonly icebergDetectionWindow: number;
    private readonly orderSizeAnomalyThreshold: number;
    private readonly tickSize: number;

    private cachedStats?: { stats: OrderSizeStats; timestamp: number };
    private statsCacheDuration = 5000; // 5 seconds

    private readonly spoofingDetector?: SpoofingDetector;
    private readonly logger?: Logger;
    private lastTradeSymbol = "";

    // Properly track orderbook state
    private currentBestBid = 0;
    private currentBestAsk = 0;
    private lastDepthUpdateTime: number = 0;
    private absorptionRationale: Record<string, boolean | number> = {};
    private exhaustionRationale: Record<string, boolean | number> = {};

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
    private recentFlowWindow: RollingWindow<{
        volume: number;
        side: "buy" | "sell";
        time: number;
    }>;
    private flowWindowMs = 30000;

    // Order size tracking
    private orderSizeHistory: RollingWindow<{
        size: number;
        time: number;
        price: number;
    }>;
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

    /**
     * Construct a new AnomalyDetector.
     * @param options AnomalyDetectorOptions (all fields optional)
     */
    constructor(
        options: AnomalyDetectorOptions = {},
        logger: Logger,
        spoofingDetector: SpoofingDetector
    ) {
        //TODO Metrics
        super();
        this.windowSize = options.windowSize ?? 1000;
        this.normalSpreadBps = options.normalSpreadBps ?? 10; // 0.1% normal spread
        this.minHistory = options.minHistory ?? 100;
        this.spoofingDetector = spoofingDetector;
        this.logger = logger;
        this.anomalyCooldownMs = options.anomalyCooldownMs ?? 10000;
        this.volumeImbalanceThreshold = options.volumeImbalanceThreshold ?? 0.7;
        this.absorptionRatioThreshold = options.absorptionRatioThreshold ?? 3.0;
        this.icebergDetectionWindow = options.icebergDetectionWindow ?? 60000; // 1 minute
        this.orderSizeAnomalyThreshold = options.orderSizeAnomalyThreshold ?? 3; // 3 std devs
        this.tickSize = options.tickSize ?? 0.01;

        this.marketHistory = new RollingWindow<MarketSnapshot>(
            this.windowSize,
            false
        );
        this.orderSizeHistory = new RollingWindow<{
            size: number;
            time: number;
            price: number;
        }>(Math.max(2000, Math.ceil(this.orderSizeWindowMs / 100)), false);
        this.recentFlowWindow = new RollingWindow<{
            volume: number;
            side: "buy" | "sell";
            time: number;
        }>(Math.max(500, Math.ceil(this.flowWindowMs / 100)), false);
    }

    /**
     * Update the best bid/ask quotes from orderbook.
     * Call on every depth snapshot to keep spread and passive liquidity stats in sync.
     * @param bestBid Current best bid price.
     * @param bestAsk Current best ask price.
     */
    public updateBestQuotes(bestBid: number, bestAsk: number): void {
        this.currentBestBid = bestBid;
        this.currentBestAsk = bestAsk;
        this.lastDepthUpdateTime = Date.now();
    }

    /**
     * Main entry point: process a new EnrichedTradeEvent.
     * Updates rolling windows and runs anomaly checks.
     * @param trade Enriched trade event (with aggressive and passive context)
     */
    public onEnrichedTrade(trade: EnrichedTradeEvent): void {
        try {
            // capture symbol for scoped emits
            this.lastTradeSymbol = trade.originalTrade.s ?? "";

            const now = trade.timestamp;
            // Binance aggTrade: m=true ⇒ buyerIsMaker ⇒ SELL aggression
            const aggressiveSide: "buy" | "sell" = trade.buyerIsMaker
                ? "sell"
                : "buy";

            // track size + iceberg history
            this.trackOrderSize(trade.quantity, trade.price, now);
            this.updatePriceVolumeHistory(trade.price, trade.quantity, now);

            // compute spread bps if we have valid quotes
            let spreadBps: number | undefined;
            if (this.currentBestBid && this.currentBestAsk) {
                const spread = this.currentBestAsk - this.currentBestBid;
                spreadBps = (spread / trade.price) * 10000;
            }

            // assemble snapshot
            const snapshot = {
                price: trade.price,
                aggressiveVolume: trade.quantity,
                aggressiveSide,
                timestamp: now,
                spread: spreadBps,
                passiveBidVolume: trade.passiveBidVolume,
                passiveAskVolume: trade.passiveAskVolume,
                zonePassiveBidVolume: trade.zonePassiveBidVolume ?? 0,
                zonePassiveAskVolume: trade.zonePassiveAskVolume ?? 0,
                bestBid: this.currentBestBid,
                bestAsk: this.currentBestAsk,
            };

            // push into buffers
            this.marketHistory.push(snapshot);
            this.recentFlowWindow.push({
                volume: trade.quantity,
                side: aggressiveSide,
                time: now,
            });

            // fire detectors once we have enough history
            if (this.marketHistory.count() >= this.minHistory) {
                this.runAnomalyChecks(snapshot, spreadBps);
            }
        } catch (err) {
            this.logger?.error?.("AnomalyDetector.onEnrichedTrade error", {
                err,
            });
        }
    }

    /**
     * Tracks order size for order size anomaly, iceberg, whale detection.
     * @param size Order size
     * @param price Trade price
     * @param time Timestamp (ms)
     */
    private trackOrderSize(size: number, price: number, time: number): void {
        this.orderSizeHistory.push({ size, price, time });
    }

    /**
     * Calculates distribution statistics for order size anomaly detection.
     * @returns OrderSizeStats object
     */
    private calculateOrderSizeStats(): OrderSizeStats {
        const now = Date.now();
        const sizes = this.orderSizeHistory
            .toArray()
            .filter((o) => now - o.time < this.orderSizeWindowMs)
            .map((o) => o.size);

        if (sizes.length === 0) {
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

        sizes.sort((a, b) => a - b);
        const mean = this.calculateMean(sizes);
        const stdDev = this.calculateStdDev(sizes, mean);
        const median = sizes[Math.floor(sizes.length / 2)];
        const p95 = sizes[Math.floor(sizes.length * 0.95)];
        const p99 = sizes[Math.floor(sizes.length * 0.99)];
        const maxSize = sizes[sizes.length - 1];

        // Calculate distribution buckets
        const distribution = new Map<number, number>();
        const bucketSize = stdDev === 0 ? Math.max(1, mean / 10) : stdDev / 2;
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
     * Detects order size anomaly (large/small trades).
     * @param snapshot MarketSnapshot
     */
    private checkOrderSizeAnomaly(snapshot: MarketSnapshot): void {
        const stats = this.calculateOrderSizeStats();
        if (stats.mean === 0) return;

        const tradeSize = snapshot.aggressiveVolume;
        const zScore = (tradeSize - stats.mean) / (stats.stdDev || 1);

        // Check for unusually large orders
        if (zScore > this.orderSizeAnomalyThreshold) {
            // Recent large orders cluster (last 60s, above p95)
            const now = snapshot.timestamp;
            const recentLargeOrders = this.orderSizeHistory
                .toArray()
                .filter(
                    (o) => now - o.time < 60000 && o.size > stats.p95
                ).length;

            const severity =
                zScore > 5 ? "high" : recentLargeOrders > 5 ? "high" : "medium";

            this.emitAnomaly({
                type:
                    recentLargeOrders > 3
                        ? "whale_activity"
                        : "order_size_anomaly",
                detectedAt: snapshot.timestamp,
                severity,
                affectedPriceRange: {
                    min: snapshot.price * 0.999,
                    max: snapshot.price * 1.001,
                },
                recommendedAction:
                    snapshot.aggressiveSide === "sell"
                        ? "watch_support"
                        : "watch_resistance",
                details: {
                    tradeSize,
                    zScore,
                    stats: {
                        mean: stats.mean,
                        median: stats.median,
                        p95: stats.p95,
                        p99: stats.p99,
                    },
                    recentLargeOrders,
                    percentileRank: this.calculatePercentileRank(tradeSize),
                    isWhale: tradeSize > stats.p99,
                },
            });
        }

        // Check for unusually small orders (potential algo splitting)
        if (tradeSize < stats.mean * 0.1 && stats.mean > 0) {
            const now = snapshot.timestamp;
            const recentSmallOrders = this.orderSizeHistory
                .toArray()
                .filter(
                    (o) => now - o.time < 30000 && o.size < stats.mean * 0.1
                ).length;

            if (recentSmallOrders > 20) {
                this.emitAnomaly({
                    type: "order_size_anomaly",
                    detectedAt: snapshot.timestamp,
                    severity: "info",
                    affectedPriceRange: {
                        min: snapshot.price * 0.999,
                        max: snapshot.price * 1.001,
                    },
                    recommendedAction: "monitor",
                    details: {
                        anomalyType: "algo_splitting",
                        smallOrderCount: recentSmallOrders,
                        averageSmallSize: this.calculateMean(
                            this.orderSizeHistory
                                .toArray()
                                .filter((o) => o.size < stats.mean * 0.1)
                                .map((o) => o.size)
                        ),
                    },
                });
            }
        }
    }

    /**
     * Update price/volume history for iceberg detection and pruning.
     * @param price Price
     * @param volume Volume
     * @param time Timestamp (ms)
     */
    private updatePriceVolumeHistory(
        price: number,
        volume: number,
        time: number
    ): void {
        const rounded = this.roundToTick(price);
        const prev = this.priceVolumeHistory.get(rounded) ?? {
            volume: 0,
            count: 0,
            lastUpdate: 0,
        };

        this.priceVolumeHistory.set(rounded, {
            volume: prev.volume + volume,
            count: prev.count + 1,
            lastUpdate: time,
        });

        // prune any level not updated in 2×iceberg window
        for (const [p, info] of this.priceVolumeHistory) {
            if (time - info.lastUpdate > this.icebergDetectionWindow * 2) {
                this.priceVolumeHistory.delete(p);
            }
        }
    }

    /**
     * Estimates remaining iceberg size from candidate.
     * @param candidate IcebergCandidate
     * @returns Estimated size
     */
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

    /**
     * Helper: calculates percentile rank of a value among sorted sizes.
     * @param value Value to rank
     * @returns Percentile (0-100)
     */
    private calculatePercentileRank(value: number): number {
        const stats = this.getOrderSizeStats();
        const sortedSizes = stats.sortedSizes;

        if (!sortedSizes || sortedSizes.length === 0) {
            return 50; // Default to median if no data
        }

        const index = sortedSizes.findIndex((s) => s >= value);
        return index === -1 ? 100 : (index / sortedSizes.length) * 100;
    }

    /**
     * Run all anomaly detection routines on the latest market snapshot.
     * @param snapshot Current market snapshot.
     * @param spreadBps Optional spread for liquidity checks.
     *
     * Runs all anomaly checks in a specific order on the latest market snapshot.
     *
     * Detection order:
     *  1. Flash crash         — Extreme deviation from rolling mean
     *  2. Liquidity void      — Abnormally wide spread or missing passive liquidity
     *  3. API gap             — Data/feed interruption
     *  4. Extreme volatility  — Sudden spike in rolling returns stddev
     *  5. Orderbook imbalance — Strong passive volume asymmetry (bid/ask)
     *  6. Flow imbalance      — Aggressive trade volume asymmetry
     *  7. Absorption          — Aggressive trades absorbed by passive liquidity (with little price move)
     *  8. Exhaustion          — Diminishing aggressive activity after strong move
     *  9. Momentum ignition   — Recent burst of one-sided flow
     * 10. Whale activity      — Single or clustered outlier trade(s)
     * 11. Iceberg detection   — Repeated fills at same price, consistent timing, high passive absorption
     * 12. Spoofing detection  — Passive walls that cancel without execution, detected by spoofingDetector
     * 13. Order size anomaly  — Unusually large/small trades relative to rolling window
     *
     * The order ensures that "eventful" anomalies (crash, liquidity void) are detected before
     * microstructure anomalies (absorption, iceberg, spoofing), and that all detections can
     * leverage updated rolling window stats.
     *
     * Each check emits an anomaly event if detected.
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
        this.checkWhaleActivity(snapshot);
        this.checkIceberg(snapshot);
        this.checkSpoofing(snapshot);
        this.checkOrderSizeAnomaly(snapshot);
    }

    /**
     * Helper: round price to nearest tickSize.
     * @param price
     * @returns Rounded price
     */
    private roundToTick(price: number): number {
        return Math.round(price / this.tickSize) * this.tickSize;
    }

    /**
     * Detects iceberg orders via refill pattern and passive absorption.
     * @param snapshot MarketSnapshot
     */
    private checkIceberg(snapshot: MarketSnapshot): void {
        // Use rolling order size percentiles and refill patterns at this price/side
        const price = this.roundToTick(snapshot.price);
        const side = snapshot.aggressiveSide;

        const key = `${price}_${side}`;
        const now = snapshot.timestamp;

        let candidate = this.icebergCandidates.get(key);

        const passiveVolume =
            side === "buy"
                ? snapshot.zonePassiveAskVolume
                : snapshot.zonePassiveBidVolume;

        // 1. Start tracking a new candidate if high passive volume is detected
        if (!candidate) {
            if (passiveVolume > 0) {
                candidate = {
                    price,
                    side,
                    firstSeen: now,
                    totalVolume: snapshot.aggressiveVolume,
                    fillCount: 1,
                    lastRefill: now,
                    refillPattern: [],
                };
                this.icebergCandidates.set(key, candidate);
            }
            return;
        }

        // 2. Update candidate stats
        const timeSinceLastFill = now - candidate.lastRefill;
        candidate.totalVolume += snapshot.aggressiveVolume;
        candidate.fillCount++;

        // 3. Record refill pattern (regular refills = more iceberg confidence)
        if (passiveVolume > 0 && timeSinceLastFill < 5000) {
            candidate.refillPattern.push(timeSinceLastFill);
            candidate.lastRefill = now;

            // Gather rolling order size stats for comparison
            const arr = this.orderSizeHistory
                .toArray()
                .filter((o) => now - o.time < 300_000);
            if (arr.length < 100) return; // Require adequate history
            const sizes = arr.map((o) => o.size).sort((a, b) => a - b);
            const meanOrder = this.calculateMean(sizes);
            const p99 = sizes[Math.floor(sizes.length * 0.99)];

            // Confidence factors
            const regularRefill =
                candidate.refillPattern.length > 3 &&
                this.calculateStdDev(
                    candidate.refillPattern,
                    this.calculateMean(candidate.refillPattern)
                ) <
                    this.calculateMean(candidate.refillPattern) * 0.3;

            const bigTotalAbsorbed = candidate.totalVolume > meanOrder * 12;
            const highOrderPercentile = candidate.totalVolume > p99 * 3;
            const highFillCount = candidate.fillCount > 5;

            let confidence = 0;
            if (regularRefill) confidence += 0.35;
            if (bigTotalAbsorbed) confidence += 0.3;
            if (highOrderPercentile) confidence += 0.25;
            if (highFillCount) confidence += 0.1;

            if (confidence >= 0.5) {
                this.emitAnomaly({
                    type: "iceberg_order",
                    detectedAt: now,
                    severity: confidence > 0.8 ? "high" : "medium",
                    affectedPriceRange: {
                        min: price - 0.01,
                        max: price + 0.01,
                    },
                    recommendedAction:
                        side === "buy" ? "avoid_selling" : "avoid_buying",
                    details: {
                        confidence,
                        totalVolumeAbsorbed: candidate.totalVolume,
                        fillCount: candidate.fillCount,
                        avgRefillTime: this.calculateMean(
                            candidate.refillPattern
                        ),
                        refillPattern: candidate.refillPattern,
                        regularRefill,
                        bigTotalAbsorbed,
                        highOrderPercentile,
                        highFillCount,
                        estimatedRemainingSize:
                            this.estimateIcebergSize(candidate),
                    },
                });
            }
        }

        // 4. Clean up old candidates
        if (now - candidate.lastRefill > this.icebergDetectionWindow) {
            this.icebergCandidates.delete(key);
        }
    }

    /**
     * Detects flash crash via extreme deviation from mean/stddev.
     * @param snapshot MarketSnapshot
     */
    private checkFlashCrash(snapshot: MarketSnapshot): void {
        const prices = this.marketHistory.toArray().map((h) => h.price);
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
                    confidence: Math.min(zScore / 5, 1),
                    mean,
                    stdDev,
                    zScore,
                    percentMove: ((snapshot.price - mean) / mean) * 100,
                    rationale: {
                        zScoreAbove3: zScore > 3,
                        zScoreAbove5: zScore > 5,
                    },
                },
            });
        }
    }

    /**
     * Detects liquidity void via wide spread and low passive depth.
     * @param snapshot MarketSnapshot
     * @param spreadBps Number
     */
    private checkLiquidityVoid(
        snapshot: MarketSnapshot,
        spreadBps?: number
    ): void {
        if (!spreadBps) return;

        const now = Date.now();
        const totalPassive =
            snapshot.zonePassiveBidVolume + snapshot.zonePassiveAskVolume;

        const recent = this.marketHistory
            .toArray()
            .filter((s) => now - s.timestamp < 120_000)
            .slice(-20);
        const avgPassive =
            recent.reduce(
                (sum, h) =>
                    sum + h.zonePassiveBidVolume + h.zonePassiveAskVolume,
                0
            ) / (recent.length || 1);

        const liquidityRatio = totalPassive / (avgPassive || 1);
        // Confidence: scales with how much spread exceeds normal threshold
        const confidence = Math.min(1, spreadBps / (this.normalSpreadBps * 15));

        if (spreadBps > this.normalSpreadBps * 5) {
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
                    confidence,
                    spreadBps,
                    normalSpreadBps: this.normalSpreadBps,
                    currentPassiveLiquidity: totalPassive,
                    averagePassiveLiquidity: avgPassive,
                    liquidityRatio,
                    rationale: {
                        spreadThreshold: this.normalSpreadBps * 5,
                        actualSpread: spreadBps,
                        passiveLiquidityDrop: liquidityRatio < 0.3,
                    },
                },
            });
        }
    }

    /**
     * Detects orderbook imbalance via passive volume asymmetry.
     * @param snapshot MarketSnapshot
     */
    private checkOrderbookImbalance(snapshot: MarketSnapshot): void {
        const bidVolume = snapshot.zonePassiveBidVolume;
        const askVolume = snapshot.zonePassiveAskVolume;
        const totalVolume = bidVolume + askVolume;

        if (totalVolume > 0) {
            const imbalance = (bidVolume - askVolume) / totalVolume;
            // Confidence: scales with normalized absolute imbalance
            const confidence = Math.min(1, Math.abs(imbalance) / 1.2);

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
                        confidence,
                        imbalance,
                        bidVolume,
                        askVolume,
                        direction: imbalance > 0 ? "bid_heavy" : "ask_heavy",
                        imbalancePercent: imbalance * 100,
                        rationale: {
                            threshold: this.volumeImbalanceThreshold,
                            actual: Math.abs(imbalance),
                            direction:
                                imbalance > 0 ? "bid_heavy" : "ask_heavy",
                        },
                    },
                });
            }
        }
    }

    /**
     * Detects aggressive flow imbalance in recent window.
     * @param snapshot MarketSnapshot
     */
    private checkFlowImbalance(snapshot: MarketSnapshot): void {
        const flowMetrics = this.calculateFlowMetrics();
        const confidence = Math.min(1, Math.abs(flowMetrics.flowImbalance));

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
                    confidence,
                    ...flowMetrics,
                    windowMs: this.flowWindowMs,
                    direction:
                        flowMetrics.netFlow > 0
                            ? "buy_pressure"
                            : "sell_pressure",
                    rationale: {
                        threshold: this.volumeImbalanceThreshold,
                        actual: Math.abs(flowMetrics.flowImbalance),
                        direction:
                            flowMetrics.netFlow > 0
                                ? "buy_pressure"
                                : "sell_pressure",
                    },
                },
            });
        }
    }

    /**
     * Detects absorption by comparing passive/aggressive ratio and price range.
     * @param snapshot MarketSnapshot
     */
    private checkAbsorption(snapshot: MarketSnapshot): void {
        const now = Date.now();
        const recentSnapshots = this.marketHistory
            .toArray()
            .filter((s) => now - s.timestamp < 120_000)
            .slice(-10);
        if (recentSnapshots.length < 10) return;

        const confidence = this.calculateAbsorptionConfidence(
            snapshot,
            recentSnapshots
        );
        if (confidence < 0.5) return;

        const totalAggressive = recentSnapshots.reduce(
            (sum, s) => sum + s.aggressiveVolume,
            0
        );
        const passiveVolume =
            snapshot.aggressiveSide === "buy"
                ? snapshot.zonePassiveAskVolume
                : snapshot.zonePassiveBidVolume;
        const absorptionRatio = passiveVolume / (totalAggressive || 1);

        const priceRange =
            Math.max(...recentSnapshots.map((s) => s.price)) -
            Math.min(...recentSnapshots.map((s) => s.price));
        const avgPrice = this.calculateMean(
            recentSnapshots.map((s) => s.price)
        );
        const priceRangePercent = (priceRange / (avgPrice || 1)) * 100;

        this.emitAnomaly({
            type: "absorption",
            detectedAt: snapshot.timestamp,
            severity:
                confidence > 0.8
                    ? "high"
                    : confidence > 0.65
                      ? "medium"
                      : "info",
            affectedPriceRange: {
                min: Math.min(...recentSnapshots.map((s) => s.price)),
                max: Math.max(...recentSnapshots.map((s) => s.price)),
            },
            recommendedAction:
                snapshot.aggressiveSide === "buy" ? "fade_rally" : "fade_dip",
            details: {
                confidence,
                aggressiveVolume: totalAggressive,
                passiveVolume,
                absorptionRatio,
                priceRangePercent,
                rationale: this.absorptionRationale, // set by scoring function
            },
        });
    }

    /**
     * Calculates confidence for absorption anomaly.
     * @param snapshot MarketSnapshot
     * @param recentSnapshots MarketSnapshot[]
     * @returns Confidence score [0,1]
     */
    private calculateAbsorptionConfidence(
        snapshot: MarketSnapshot,
        recentSnapshots: MarketSnapshot[]
    ): number {
        let confidence = 0;
        const rationale: Record<string, boolean | number> = {};

        // 1. Aggressive volume relative to average
        const avgAggressive = this.calculateMean(
            recentSnapshots.map((s) => s.aggressiveVolume)
        );
        const highAggressive = snapshot.aggressiveVolume > avgAggressive * 2.5;
        if (highAggressive) confidence += 0.2;
        rationale.highAggressive = highAggressive;

        // 2. Minimal price movement (tight range in last N)
        const priceRange =
            Math.max(...recentSnapshots.map((s) => s.price)) -
            Math.min(...recentSnapshots.map((s) => s.price));
        const avgPrice = this.calculateMean(
            recentSnapshots.map((s) => s.price)
        );
        const tightRange = avgPrice > 0 && priceRange / avgPrice < 0.07 / 100;
        if (tightRange) confidence += 0.2;
        rationale.tightRange = tightRange;
        rationale.priceRangePercent = (priceRange / (avgPrice || 1)) * 100;

        // 3. High passive/zone volume vs. aggressive
        const totalAggressive = recentSnapshots.reduce(
            (sum, s) => sum + s.aggressiveVolume,
            0
        );
        const passiveVolume =
            snapshot.aggressiveSide === "buy"
                ? snapshot.zonePassiveAskVolume
                : snapshot.zonePassiveBidVolume;
        const absorptionRatio = passiveVolume / (totalAggressive || 1);
        const highAbsorptionRatio =
            absorptionRatio > this.absorptionRatioThreshold;
        if (highAbsorptionRatio) confidence += 0.25;
        rationale.absorptionRatio = absorptionRatio;
        rationale.highAbsorptionRatio = highAbsorptionRatio;

        // 4. Flow imbalance supports absorption
        const flow = this.calculateFlowMetrics();
        const flowSupportsAbsorption =
            Math.abs(flow.flowImbalance) > 0.7 &&
            ((snapshot.aggressiveSide === "buy" && flow.flowImbalance < 0) ||
                (snapshot.aggressiveSide === "sell" && flow.flowImbalance > 0));
        if (flowSupportsAbsorption) confidence += 0.2;
        rationale.flowImbalance = flow.flowImbalance;
        rationale.flowSupportsAbsorption = flowSupportsAbsorption;

        // 5. Recent refills/iceberg (not implemented—placeholder)
        // Optionally, analyze iceberg/zone refill confidence

        this.absorptionRationale = rationale;
        return Math.min(1, confidence);
    }

    /**
     * Detects exhaustion by declining aggressive flow.
     * @param snapshot MarketSnapshot
     */
    private checkExhaustion(snapshot: MarketSnapshot): void {
        const now = Date.now();
        const flows = this.recentFlowWindow
            .toArray()
            .filter((f) => now - f.time < 120_000); // 2 min window

        if (flows.length < 20) return;

        const confidence = this.calculateExhaustionConfidence(snapshot, flows);
        if (confidence < 0.5) return;

        const firstHalf = flows.slice(0, 10).reduce((a, b) => a + b.volume, 0);
        const secondHalf = flows.slice(10).reduce((a, b) => a + b.volume, 0);

        this.emitAnomaly({
            type: "exhaustion",
            detectedAt: snapshot.timestamp,
            severity:
                confidence > 0.8
                    ? "high"
                    : confidence > 0.65
                      ? "medium"
                      : "info",
            affectedPriceRange: {
                min: snapshot.price * 0.998,
                max: snapshot.price * 1.002,
            },
            recommendedAction: "prepare_reversal",
            details: {
                confidence,
                firstHalfVolume: firstHalf,
                secondHalfVolume: secondHalf,
                volumeDeclinePercent:
                    firstHalf > 0
                        ? ((firstHalf - secondHalf) / firstHalf) * 100
                        : 0,
                dominantSide: this.getDominantFlowSide(),
                rationale: this.exhaustionRationale,
            },
        });
    }

    /**
     * Calculates confidence for exhaustion anomaly.
     * @param snapshot MarketSnapshot
     * @param flows Recent flow array
     * @returns Confidence score [0,1]
     */
    private calculateExhaustionConfidence(
        snapshot: MarketSnapshot,
        flows: { volume: number; side: "buy" | "sell"; time: number }[]
    ): number {
        let confidence = 0;
        const rationale: Record<string, boolean | number> = {};

        // 1. Sharp drop in recent aggressive volume
        if (flows.length < 20) return 0;
        const firstHalf = flows.slice(0, 10).reduce((a, b) => a + b.volume, 0);
        const secondHalf = flows.slice(10).reduce((a, b) => a + b.volume, 0);
        const volumeDrop = firstHalf > 0 && secondHalf / firstHalf < 0.35;
        if (volumeDrop) confidence += 0.35;
        rationale.volumeDrop = volumeDrop;
        rationale.firstHalfVolume = firstHalf;
        rationale.secondHalfVolume = secondHalf;

        // 2. Shrinking order sizes (mean of last 10 < 60% of rolling mean)
        const now = Date.now();
        const arr = this.orderSizeHistory
            .toArray()
            .filter((o) => now - o.time < 120_000);
        const avgSize = this.calculateMean(arr.map((o) => o.size));
        const last10 = arr.slice(-10).map((o) => o.size);
        const recentAvgSize = this.calculateMean(last10);
        const shrinkingOrders = recentAvgSize < avgSize * 0.6;
        if (shrinkingOrders) confidence += 0.2;
        rationale.shrinkingOrders = shrinkingOrders;
        rationale.avgSize = avgSize;
        rationale.recentAvgSize = recentAvgSize;

        // 3. Price at/after trend stall or reversal (simple: price flat after move)
        // Placeholder: optionally implement advanced price action filter

        // 4. Surge in passive resistance (optional)
        const passiveVolume =
            snapshot.aggressiveSide === "buy"
                ? snapshot.zonePassiveAskVolume
                : snapshot.zonePassiveBidVolume;
        const strongResistance = passiveVolume > avgSize * 2;
        if (strongResistance) confidence += 0.2;
        rationale.strongResistance = strongResistance;
        rationale.passiveVolume = passiveVolume;

        // 5. Flow reverses (netFlow flips sign)
        const flow = this.calculateFlowMetrics();
        const netFlowFlip =
            Math.sign(flow.netFlow) !== Math.sign(firstHalf - secondHalf) &&
            flow.netFlow !== 0;
        if (netFlowFlip) confidence += 0.15;
        rationale.netFlow = flow.netFlow;
        rationale.netFlowFlip = netFlowFlip;

        this.exhaustionRationale = rationale;
        return Math.min(1, confidence);
    }

    /**
     * Detects whale activity via outlier order sizes.
     * @param snapshot MarketSnapshot
     */
    private checkWhaleActivity(snapshot: MarketSnapshot): void {
        // Use the rolling window of order sizes to establish quantiles
        const now = Date.now();
        const arr = this.orderSizeHistory
            .toArray()
            .filter((o) => now - o.time < 300_000);
        if (arr.length < 100) return; // Require sufficient sample size

        // Get all sizes, sorted for percentile calculation
        const sizes = arr.map((o) => o.size).sort((a, b) => a - b);

        // 99th, 99.5th, and 99.9th percentile thresholds
        const p99 = sizes[Math.floor(sizes.length * 0.99)];
        const p995 = sizes[Math.floor(sizes.length * 0.995)];
        const p999 = sizes[Math.floor(sizes.length * 0.999)];

        // The candidate order size for whale detection
        const candidateSize = snapshot.aggressiveVolume;

        // Determine percentile thresholds met
        let confidence = 0;
        let whaleLevel = 0;
        if (candidateSize >= p999) {
            confidence = 1.0;
            whaleLevel = 999;
        } else if (candidateSize >= p995) {
            confidence = 0.85;
            whaleLevel = 995;
        } else if (candidateSize >= p99) {
            confidence = 0.7;
            whaleLevel = 99;
        }

        // Cluster detection: are there other whale trades in the last 30?
        const recentLarge = arr.slice(-30).filter((o) => o.size >= p99).length;
        if (recentLarge > 3 && confidence > 0.7) confidence += 0.1; // boost if whale cluster

        if (confidence < 0.7) return; // Only emit for real whales

        this.emitAnomaly({
            type: "whale_activity",
            detectedAt: snapshot.timestamp,
            severity:
                confidence > 0.95
                    ? "critical"
                    : confidence > 0.85
                      ? "high"
                      : "medium",
            affectedPriceRange: {
                min: snapshot.price * 0.997,
                max: snapshot.price * 1.003,
            },
            recommendedAction:
                snapshot.aggressiveSide === "sell"
                    ? "watch_support"
                    : "watch_resistance",
            details: {
                confidence,
                whaleLevel, // 99, 995, or 999 for diagnostic clarity
                candidateSize,
                p99,
                p995,
                p999,
                percentile: this.calculatePercentileRank(candidateSize),
                recentLargeWhales: recentLarge,
                rationale: {
                    isP999: candidateSize >= p999,
                    isP995: candidateSize >= p995,
                    isP99: candidateSize >= p99,
                    cluster: recentLarge > 3,
                },
            },
        });
    }

    /**
     * Detects momentum ignition: sudden burst of directional flow.
     * @param snapshot MarketSnapshot
     */
    private checkMomentumIgnition(snapshot: MarketSnapshot): void {
        // Sudden surge in directional flow
        const now = Date.now();
        const flows = this.recentFlowWindow
            .toArray()
            .filter((f) => now - f.time < 120_000);
        const last5 = flows.slice(-5);
        const previous15 = flows.slice(-20, -5);

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

    /**
     * Detects API/data feed gaps by trade timestamp jump.
     * @param snapshot MarketSnapshot
     */
    private checkApiGap(snapshot: MarketSnapshot): void {
        const arr = this.marketHistory.toArray();
        const len = arr.length;
        if (len < 2) return;
        const timeGap = snapshot.timestamp - arr[len - 2].timestamp;
        // Confidence: larger gaps = higher confidence (normalize 30s = 1)
        const confidence = Math.min(1, timeGap / 30000);

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
                    confidence,
                    timeGapMs: timeGap,
                    timeGapSeconds: timeGap / 1000,
                    rationale: {
                        thresholdMs: 5000,
                        actualMs: timeGap,
                        severe: timeGap > 30000,
                    },
                },
            });
        }
    }

    /**
     * Detects extreme volatility via rolling stddev of returns.
     * @param snapshot MarketSnapshot
     */
    private checkExtremeVolatility(snapshot: MarketSnapshot): void {
        const now = Date.now();
        const recentPrices = this.marketHistory
            .toArray()
            .filter((s) => now - s.timestamp < 120_000)
            .map((h) => h.price);

        const returns: number[] = [];
        for (let i = 1; i < recentPrices.length; i++) {
            returns.push(
                (recentPrices[i] - recentPrices[i - 1]) / recentPrices[i - 1]
            );
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

    /**
     * Detects spoofing via the provided spoofingDetector.
     * @param snapshot MarketSnapshot
     */
    private checkSpoofing(snapshot: MarketSnapshot): void {
        if (!this.spoofingDetector) return;

        const side: "buy" | "sell" = snapshot.aggressiveSide;
        const price = snapshot.price;
        const tradeTime = snapshot.timestamp;

        // Provide function to get aggressive volume for a price/time window, as required by detector
        const getAggressiveVolume = (
            bandPrice: number,
            from: number,
            to: number
        ): number => {
            // Use marketHistory as your trade tape
            return this.marketHistory
                .toArray()
                .filter(
                    (s) =>
                        this.roundToTick(s.price) ===
                            this.roundToTick(bandPrice) &&
                        s.timestamp >= from &&
                        s.timestamp <= to
                )
                .reduce((sum, s) => sum + s.aggressiveVolume, 0);
        };

        // Check for spoof
        const spoofed = this.spoofingDetector.wasSpoofed(
            price,
            side,
            tradeTime,
            getAggressiveVolume
        );

        if (!spoofed) return;

        // Optionally, you can add more meta/confidence data
        // If you want details of the spoofed event, you could extend your detector to return the event, but for now, stick to binary + local stats

        this.emitAnomaly({
            type: "spoofing",
            detectedAt: tradeTime,
            severity: "high", // If you want to be more dynamic, add confidence in your detector!
            affectedPriceRange: { min: price, max: price },
            recommendedAction: "pause",
            details: {
                price,
                side,
                // If you want more, patch SpoofingDetector to return maxSpoofEvent or meta
                passiveVolumeBefore:
                    snapshot.passiveBidVolume + snapshot.passiveAskVolume,
                rationale: "Detected by SpoofingDetector wall cancel logic",
            },
        });
    }

    /**
     * Helper: flow metrics in window.
     */
    private calculateFlowMetrics(): FlowMetrics {
        const now = Date.now();
        let buyVolume = 0;
        let sellVolume = 0;

        const recentFlows = this.recentFlowWindow
            .toArray()
            .filter((f) => now - f.time < this.flowWindowMs);

        for (const flow of recentFlows) {
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

    /**
     * Helper: dominant flow side in rolling window.
     */
    private getDominantFlowSide(): "buy" | "sell" | "neutral" {
        const metrics = this.calculateFlowMetrics();
        if (Math.abs(metrics.flowImbalance) < 0.1) return "neutral";
        return metrics.netFlow > 0 ? "buy" : "sell";
    }

    /**
     * Helper: dominant flow side in a flow array.
     */
    private getDominantSide(flows: { side: "buy" | "sell" }[]): "buy" | "sell" {
        const buys = flows.filter((f) => f.side === "buy").length;
        return buys > flows.length / 2 ? "buy" : "sell";
    }

    /**
     * Emit an anomaly event (global and per-symbol).
     * Deduplicates based on severity and cooldown.
     * @param anomaly AnomalyEvent to emit.
     * @fires AnomalyDetector#anomaly
     * @fires AnomalyDetector#anomaly:{symbol}
     */
    private emitAnomaly(anomaly: AnomalyEvent): void {
        const now = Date.now();
        const last = this.lastEmitted[anomaly.type];
        const ok =
            !last ||
            (anomaly.severity === "critical" && last.severity !== "critical") ||
            now - last.time > this.anomalyCooldownMs;
        if (!ok) return;

        this.lastEmitted[anomaly.type] = {
            severity: anomaly.severity,
            time: now,
        };

        // clone to avoid later mutation
        const payload: AnomalyEvent =
            typeof structuredClone === "function"
                ? structuredClone(anomaly)
                : (JSON.parse(JSON.stringify(anomaly)) as AnomalyEvent);

        // keep history
        this.recentAnomalies.push(payload);
        if (this.recentAnomalies.length > 500) this.recentAnomalies.shift();

        /**
         * Emitted when any anomaly is detected.
         * @event AnomalyDetector#anomaly
         * @type {AnomalyEvent}
         */
        this.emit("anomaly", payload);

        /**
         * Emitted when an anomaly is detected for the current symbol.
         * @event AnomalyDetector#anomaly:{symbol}
         * @type {AnomalyEvent}
         */
        if (this.lastTradeSymbol) {
            this.emit(`anomaly:${this.lastTradeSymbol}`, payload);
        }

    }

    /**
     * Helper: mean of values.
     */
    private calculateMean(values: number[]): number {
        return values.reduce((sum, val) => sum + val, 0) / (values.length || 1);
    }

    /**
     * Helper: stddev of values (requires mean).
     */
    private calculateStdDev(values: number[], mean: number): number {
        const variance =
            values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
            (values.length || 1);
        return Math.sqrt(variance);
    }

    /**
     * Returns current market health, recent anomaly stats, and recommendation.
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
            | "insufficient_data";
        metrics: {
            spreadBps?: number;
            flowImbalance?: number;
            volatility?: number;
        };
    } {
        const recentTime = Date.now() - 300000; // 5 minutes
        const recentSnapshots = this.marketHistory
            .toArray()
            .filter((s) => s.timestamp > recentTime);

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
}
