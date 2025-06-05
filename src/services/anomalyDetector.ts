// src/services/anomalyDetector.ts
/**********************************************************************
 * AnomalyDetector - Market Health Monitor
 * Focuses on systemic market health and infrastructure issues.
 * Emits `"anomaly"` and `"anomaly:{symbol}"` EventEmitter events
 * when market health anomalies are detected.
 *********************************************************************/

import { EventEmitter } from "events";
import type { MarketAnomaly } from "../utils/types.js";
import { Logger } from "../infrastructure/logger.js";
import type {
    EnrichedTradeEvent,
    HybridTradeEvent,
} from "../types/marketEvents.js";
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
    /** Price increment for tick/zone rounding (default: 0.01) */
    tickSize?: number;
}

/**
 * Market health anomaly types - focused on infrastructure and systemic issues.
 */
export type AnomalyType =
    | "flash_crash" // Infrastructure: Extreme price deviation
    | "liquidity_void" // Infrastructure: Orderbook liquidity crisis
    | "api_gap" // Infrastructure: Data feed interruption
    | "extreme_volatility" // Market Health: Sudden volatility spike
    | "orderbook_imbalance" // Market Structure: Passive volume asymmetry
    | "flow_imbalance" // Market Structure: Aggressive flow asymmetry
    | "whale_activity" // Market Structure: Large order impact
    | "coordinated_activity" // Microstructure: Coordinated execution patterns
    | "algorithmic_activity" // Microstructure: Detected algorithmic trading
    | "toxic_flow"; // Microstructure: High toxicity/informed flow

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

/**
 * Market health monitor focused on infrastructure and systemic issues.
 * Use for risk management, trading system safety, and market condition awareness.
 *
 * @remarks
 * This detector focuses on:
 * - Infrastructure failures (flash crashes, liquidity voids, API gaps)
 * - Market health metrics (extreme volatility, large orders)
 * - Market structure changes (order flow imbalances)
 *
 * It does NOT detect trading signals - use dedicated trading detectors for that.
 */
export class AnomalyDetector extends EventEmitter {
    private marketHistory: RollingWindow<MarketSnapshot>;
    private readonly windowSize: number;
    private readonly normalSpreadBps: number;
    private readonly minHistory: number;
    private readonly anomalyCooldownMs: number;
    private readonly volumeImbalanceThreshold: number;
    private readonly tickSize: number;

    private readonly logger?: Logger;
    private lastTradeSymbol = "";

    // Properly track orderbook state
    private currentBestBid = 0;
    private currentBestAsk = 0;
    private lastDepthUpdateTime: number = 0;

    // Flow tracking for market structure analysis
    private recentFlowWindow: RollingWindow<{
        volume: number;
        side: "buy" | "sell";
        time: number;
    }>;
    private flowWindowMs = 30000; // 30 seconds for flow analysis

    // Order size tracking for whale detection
    private orderSizeHistory: RollingWindow<{
        size: number;
        time: number;
        price: number;
    }>;
    private orderSizeWindowMs = 300000; // 5 minutes for size statistics

    // Anomaly deduplication and history
    private lastEmitted: Record<string, { severity: string; time: number }> =
        {};
    private recentAnomalies: AnomalyEvent[] = [];

    /**
     * Construct a new AnomalyDetector for market health monitoring.
     * @param options AnomalyDetectorOptions (all fields optional)
     * @param logger Logger instance
     */
    constructor(options: AnomalyDetectorOptions = {}, logger: Logger) {
        super();
        this.windowSize = options.windowSize ?? 1000;
        this.normalSpreadBps = options.normalSpreadBps ?? 10; // 0.1% normal spread
        this.minHistory = options.minHistory ?? 100;
        this.logger = logger;
        this.anomalyCooldownMs = options.anomalyCooldownMs ?? 10000;
        this.volumeImbalanceThreshold = options.volumeImbalanceThreshold ?? 0.7;
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

        this.logger?.info?.(
            "AnomalyDetector initialized for market health monitoring",
            {
                component: "AnomalyDetector",
                windowSize: this.windowSize,
                normalSpreadBps: this.normalSpreadBps,
                minHistory: this.minHistory,
            }
        );
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
     * Main entry point: process a new trade event (enriched or hybrid).
     * Updates rolling windows and runs market health checks.
     * @param trade Enriched or hybrid trade event (with aggressive and passive context)
     */
    public onEnrichedTrade(trade: EnrichedTradeEvent | HybridTradeEvent): void {
        try {
            // Capture symbol for scoped emits
            this.lastTradeSymbol = trade.originalTrade.s ?? "";
            const now = trade.timestamp;

            // Binance aggTrade: m=true ⇒ buyerIsMaker ⇒ SELL aggression
            const aggressiveSide: "buy" | "sell" = trade.buyerIsMaker
                ? "sell"
                : "buy";

            // Track order size for whale detection
            this.orderSizeHistory.push({
                size: trade.quantity,
                price: trade.price,
                time: now,
            });

            // Compute spread if we have valid quotes
            let spreadBps: number | undefined;
            if (this.currentBestBid && this.currentBestAsk) {
                const spread = this.currentBestAsk - this.currentBestBid;
                spreadBps = (spread / trade.price) * 10000;
            }

            // Assemble market snapshot
            const snapshot: MarketSnapshot = {
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

            // Update rolling windows
            this.marketHistory.push(snapshot);
            this.recentFlowWindow.push({
                volume: trade.quantity,
                side: aggressiveSide,
                time: now,
            });

            // Run market health checks once we have sufficient history
            if (this.marketHistory.count() >= this.minHistory) {
                this.runMarketHealthChecks(snapshot, spreadBps);
            }

            // Additional microstructure analysis if this is a HybridTradeEvent
            if (
                "hasIndividualData" in trade &&
                trade.hasIndividualData &&
                trade.microstructure
            ) {
                this.checkMicrostructureAnomalies(trade);
            }
        } catch (err) {
            this.logger?.error?.("AnomalyDetector.onEnrichedTrade error", {
                component: "AnomalyDetector",
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Run market health checks on the latest snapshot.
     *
     * Health check order (most critical first):
     * 1. Flash crash - Extreme price deviation (infrastructure)
     * 2. Liquidity void - Orderbook liquidity crisis (infrastructure)
     * 3. API gap - Data feed interruption (infrastructure)
     * 4. Extreme volatility - Sudden volatility spike (market health)
     * 5. Whale activity - Large orders affecting market structure
     * 6. Orderbook imbalance - Passive volume asymmetry (market structure)
     * 7. Flow imbalance - Aggressive flow asymmetry (market structure)
     */
    private runMarketHealthChecks(
        snapshot: MarketSnapshot,
        spreadBps?: number
    ): void {
        // Infrastructure issues (most critical)
        this.checkFlashCrash(snapshot);
        this.checkLiquidityVoid(snapshot, spreadBps);
        this.checkApiGap(snapshot);

        // Market health issues
        this.checkExtremeVolatility(snapshot);
        this.checkWhaleActivity(snapshot);

        // Market structure issues (informational)
        this.checkOrderbookImbalance(snapshot);
        this.checkFlowImbalance(snapshot);
    }

    /**
     * Detects flash crash via extreme deviation from rolling mean.
     * Critical infrastructure issue requiring immediate attention.
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
                recommendedAction: zScore > 5 ? "close_positions" : "pause",
                details: {
                    confidence: Math.min(zScore / 5, 1),
                    mean,
                    stdDev,
                    zScore,
                    percentMove: ((snapshot.price - mean) / mean) * 100,
                    rationale:
                        "Extreme price deviation from rolling mean detected",
                },
            });
        }
    }

    /**
     * Detects liquidity void via wide spread and low passive depth.
     * Critical infrastructure issue affecting market functionality.
     */
    private checkLiquidityVoid(
        snapshot: MarketSnapshot,
        spreadBps?: number
    ): void {
        if (!spreadBps) return;

        const now = Date.now();
        const totalPassive =
            snapshot.zonePassiveBidVolume + snapshot.zonePassiveAskVolume;

        // Calculate average passive liquidity over recent period
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
        const confidence = Math.min(1, spreadBps / (this.normalSpreadBps * 15));

        // Wide spread indicates liquidity crisis
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
                    rationale:
                        "Abnormally wide spread indicating liquidity crisis",
                },
            });
        }
    }

    /**
     * Detects API/data feed gaps by trade timestamp jump.
     * Infrastructure issue affecting data reliability.
     */
    private checkApiGap(snapshot: MarketSnapshot): void {
        const arr = this.marketHistory.toArray();
        const len = arr.length;
        if (len < 2) return;

        const timeGap = snapshot.timestamp - arr[len - 2].timestamp;
        const confidence = Math.min(1, timeGap / 30000);

        if (timeGap > 5000) {
            // 5 second gap
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
                    rationale: "Data feed interruption detected",
                },
            });
        }
    }

    /**
     * Detects extreme volatility via rolling stddev of returns.
     * Market health issue indicating unstable conditions.
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
                    rationale: "Sudden volatility spike detected",
                },
            });
        }
    }

    /**
     * Detects whale activity via outlier order sizes.
     * Market structure issue indicating large player activity.
     */
    private checkWhaleActivity(snapshot: MarketSnapshot): void {
        const now = Date.now();
        const recentSizes = this.orderSizeHistory
            .toArray()
            .filter((o) => now - o.time < this.orderSizeWindowMs)
            .map((o) => o.size);

        if (recentSizes.length < 100) return; // Need sufficient sample

        recentSizes.sort((a, b) => a - b);
        const p99 = recentSizes[Math.floor(recentSizes.length * 0.99)];
        const p995 = recentSizes[Math.floor(recentSizes.length * 0.995)];
        const candidateSize = snapshot.aggressiveVolume;

        let confidence = 0;
        let whaleLevel = 0;

        if (candidateSize >= p995) {
            confidence = 0.9;
            whaleLevel = 995;
        } else if (candidateSize >= p99) {
            confidence = 0.7;
            whaleLevel = 99;
        }

        // Check for whale clustering
        const recentLarge = this.orderSizeHistory
            .toArray()
            .filter((o) => now - o.time < 60000 && o.size >= p99).length;

        if (recentLarge > 3) confidence += 0.1; // Boost for clustering

        if (confidence >= 0.7) {
            this.emitAnomaly({
                type: "whale_activity",
                detectedAt: snapshot.timestamp,
                severity: confidence > 0.85 ? "high" : "medium",
                affectedPriceRange: {
                    min: snapshot.price * 0.997,
                    max: snapshot.price * 1.003,
                },
                recommendedAction: "monitor",
                details: {
                    confidence,
                    whaleLevel,
                    orderSize: candidateSize,
                    p99,
                    p995,
                    recentLargeOrders: recentLarge,
                    rationale:
                        "Large order detected affecting market structure",
                },
            });
        }
    }

    /**
     * Detects orderbook imbalance via passive volume asymmetry.
     * Market structure issue providing context on liquidity distribution.
     */
    private checkOrderbookImbalance(snapshot: MarketSnapshot): void {
        const bidVolume = snapshot.zonePassiveBidVolume;
        const askVolume = snapshot.zonePassiveAskVolume;
        const totalVolume = bidVolume + askVolume;

        if (totalVolume > 0) {
            const imbalance = (bidVolume - askVolume) / totalVolume;
            const confidence = Math.min(1, Math.abs(imbalance) / 1.2);

            if (Math.abs(imbalance) > this.volumeImbalanceThreshold) {
                this.emitAnomaly({
                    type: "orderbook_imbalance",
                    detectedAt: snapshot.timestamp,
                    severity: Math.abs(imbalance) > 0.9 ? "medium" : "info",
                    affectedPriceRange: {
                        min: snapshot.price * 0.999,
                        max: snapshot.price * 1.001,
                    },
                    recommendedAction: "monitor",
                    details: {
                        confidence,
                        imbalance,
                        bidVolume,
                        askVolume,
                        direction: imbalance > 0 ? "bid_heavy" : "ask_heavy",
                        rationale:
                            "Significant passive volume imbalance detected",
                    },
                });
            }
        }
    }

    /**
     * Detects aggressive flow imbalance in recent window.
     * Market structure issue indicating directional pressure.
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
                        ? "medium"
                        : "info",
                affectedPriceRange: {
                    min: snapshot.price * 0.998,
                    max: snapshot.price * 1.002,
                },
                recommendedAction: "monitor",
                details: {
                    confidence,
                    ...flowMetrics,
                    windowMs: this.flowWindowMs,
                    direction:
                        flowMetrics.netFlow > 0
                            ? "buy_pressure"
                            : "sell_pressure",
                    rationale: "Significant aggressive flow imbalance detected",
                },
            });
        }
    }

    /**
     * Calculate flow metrics for the recent window.
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
     * Emit an anomaly event with deduplication.
     * @param anomaly AnomalyEvent to emit.
     */
    private emitAnomaly(anomaly: AnomalyEvent): void {
        const now = Date.now();

        // Create a more specific key for algorithmic activity to allow different algo types
        const cooldownKey =
            anomaly.type === "algorithmic_activity" &&
            typeof anomaly.details === "object" &&
            anomaly.details !== null &&
            "algoType" in anomaly.details
                ? `${anomaly.type}_${(anomaly.details as { algoType: string }).algoType}`
                : anomaly.type;

        const last = this.lastEmitted[cooldownKey];

        // Allow critical anomalies through immediately, others respect cooldown
        const shouldEmit =
            !last ||
            (anomaly.severity === "critical" && last.severity !== "critical") ||
            now - last.time > this.anomalyCooldownMs;

        if (!shouldEmit) return;

        this.lastEmitted[cooldownKey] = {
            severity: anomaly.severity,
            time: now,
        };

        // Clone to avoid mutation
        const payload: AnomalyEvent = JSON.parse(
            JSON.stringify(anomaly)
        ) as AnomalyEvent;

        // Keep history for market health reporting
        this.recentAnomalies.push(payload);
        if (this.recentAnomalies.length > 500) {
            this.recentAnomalies.shift();
        }

        this.logger?.info?.("Market health anomaly detected", {
            component: "AnomalyDetector",
            type: anomaly.type,
            severity: anomaly.severity,
            recommendedAction: anomaly.recommendedAction,
        });

        // Emit events
        this.emit("anomaly", payload);
        if (this.lastTradeSymbol) {
            this.emit(`anomaly:${this.lastTradeSymbol}`, payload);
        }
    }

    /**
     * Helper: calculate mean of values.
     */
    private calculateMean(values: number[]): number {
        return values.reduce((sum, val) => sum + val, 0) / (values.length || 1);
    }

    /**
     * Helper: calculate standard deviation of values.
     */
    private calculateStdDev(values: number[], mean: number): number {
        const variance =
            values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
            (values.length || 1);
        return Math.sqrt(variance);
    }

    /**
     * Check for microstructure anomalies in HybridTradeEvent with individual trades data.
     * Analyzes coordination, algorithmic patterns, and flow toxicity.
     */
    private checkMicrostructureAnomalies(trade: HybridTradeEvent): void {
        if (!trade.microstructure) {
            return;
        }

        const microstructure = trade.microstructure;

        // Check for coordinated activity (potential wash trading or coordination)
        if (
            microstructure.timingPattern === "coordinated" ||
            microstructure.coordinationIndicators.length > 0
        ) {
            const coordinationStrength =
                microstructure.coordinationIndicators.length > 0
                    ? Math.max(
                          ...microstructure.coordinationIndicators.map(
                              (c) => c.strength
                          )
                      )
                    : 0.5;

            this.emitAnomaly({
                type: "coordinated_activity",
                severity: coordinationStrength > 0.8 ? "high" : "medium",
                details: {
                    coordinationScore:
                        microstructure.coordinationIndicators.length,
                    timingPattern: microstructure.timingPattern,
                    coordinationIndicators:
                        microstructure.coordinationIndicators,
                    fragmentationScore: microstructure.fragmentationScore,
                    tradeCount: trade.individualTrades?.length || 0,
                    fetchReason: trade.fetchReason,
                    price: trade.price,
                    quantity: trade.quantity,
                },
                detectedAt: trade.timestamp,
                affectedPriceRange: { min: trade.price, max: trade.price },
                recommendedAction:
                    coordinationStrength > 0.8
                        ? "close_positions"
                        : "reduce_size",
            });
        }

        // Check for algorithmic activity detection
        if (microstructure.suspectedAlgoType !== "unknown") {
            const isHighRiskAlgo =
                microstructure.suspectedAlgoType === "arbitrage" ||
                microstructure.suspectedAlgoType === "splitting";

            this.emitAnomaly({
                type: "algorithmic_activity",
                severity: isHighRiskAlgo ? "medium" : "info",
                details: {
                    algoType: microstructure.suspectedAlgoType,
                    confidence: microstructure.fragmentationScore,
                    executionEfficiency: microstructure.executionEfficiency,
                    sizingPattern: microstructure.sizingPattern,
                    timingPattern: microstructure.timingPattern,
                    tradeCount: trade.individualTrades?.length || 0,
                    fetchReason: trade.fetchReason,
                    price: trade.price,
                    quantity: trade.quantity,
                },
                detectedAt: trade.timestamp,
                affectedPriceRange: { min: trade.price, max: trade.price },
                recommendedAction: isHighRiskAlgo ? "reduce_size" : "continue",
            });
        }

        // Check for toxic flow (highly informed trading)
        if (microstructure.toxicityScore > 0.8) {
            const severity =
                microstructure.toxicityScore > 0.95
                    ? "high"
                    : microstructure.toxicityScore > 0.85
                      ? "medium"
                      : "info";

            this.emitAnomaly({
                type: "toxic_flow",
                severity,
                details: {
                    toxicityScore: microstructure.toxicityScore,
                    directionalPersistence:
                        microstructure.directionalPersistence,
                    executionEfficiency: microstructure.executionEfficiency,
                    fragmentationScore: microstructure.fragmentationScore,
                    avgTradeSize: microstructure.avgTradeSize,
                    tradeComplexity: trade.tradeComplexity,
                    fetchReason: trade.fetchReason,
                    suspectedAlgoType: microstructure.suspectedAlgoType,
                    price: trade.price,
                    quantity: trade.quantity,
                },
                detectedAt: trade.timestamp,
                affectedPriceRange: { min: trade.price, max: trade.price },
                recommendedAction:
                    severity === "high"
                        ? "close_positions"
                        : severity === "medium"
                          ? "reduce_size"
                          : "continue",
            });
        }

        // Check for highly fragmented orders (potential order splitting to avoid detection)
        if (
            microstructure.fragmentationScore > 0.8 &&
            trade.tradeComplexity === "highly_fragmented" &&
            microstructure.executionEfficiency < 0.3
        ) {
            this.emitAnomaly({
                type: "algorithmic_activity",
                severity: "medium",
                details: {
                    algoType: "order_fragmentation",
                    fragmentationScore: microstructure.fragmentationScore,
                    executionEfficiency: microstructure.executionEfficiency,
                    tradeCount: trade.individualTrades?.length || 0,
                    avgTradeSize: microstructure.avgTradeSize,
                    tradeSizeVariance: microstructure.tradeSizeVariance,
                    sizingPattern: microstructure.sizingPattern,
                    fetchReason: trade.fetchReason,
                    price: trade.price,
                    quantity: trade.quantity,
                },
                detectedAt: trade.timestamp,
                affectedPriceRange: { min: trade.price, max: trade.price },
                recommendedAction: "reduce_size",
            });
        }
    }

    /**
     * Returns comprehensive market health assessment.
     * Use this for trading system safety and risk management decisions.
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
        criticalIssues: string[];
        recentAnomalyTypes: string[];
        metrics: {
            spreadBps?: number;
            flowImbalance?: number;
            volatility?: number;
            lastUpdateAge: number;
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
                criticalIssues: ["Insufficient market data"],
                recentAnomalyTypes: [],
                metrics: {
                    lastUpdateAge:
                        Date.now() -
                        (this.marketHistory.toArray().slice(-1)[0]?.timestamp ||
                            0),
                },
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

        // Analyze recent anomalies
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

        // Identify critical issues
        const criticalIssues: string[] = [];
        const recentAnomalyTypes = [...new Set(recentAnoms.map((a) => a.type))];

        recentAnoms.forEach((a) => {
            if (a.severity === "critical") {
                criticalIssues.push(`${a.type}: ${a.recommendedAction}`);
            }
        });

        // Determine overall health
        const hasInfrastructureIssues = recentAnomalyTypes.some((type) =>
            ["flash_crash", "liquidity_void", "api_gap"].includes(type)
        );

        const isHealthy =
            !hasInfrastructureIssues &&
            volatility < 0.002 &&
            (!highestSeverity || highestSeverity === "info") &&
            (currentSpreadBps ? currentSpreadBps < 50 : true);

        // Determine recommendation
        let recommendation:
            | "pause"
            | "reduce_size"
            | "close_positions"
            | "continue";
        if (criticalIssues.length > 0 || highestSeverity === "critical") {
            recommendation = "close_positions";
        } else if (hasInfrastructureIssues || highestSeverity === "high") {
            recommendation = "pause";
        } else if (highestSeverity === "medium" || volatility > 0.002) {
            recommendation = "reduce_size";
        } else {
            recommendation = "continue";
        }

        return {
            isHealthy,
            recentAnomalies: recentAnoms.length,
            highestSeverity,
            recommendation,
            criticalIssues,
            recentAnomalyTypes,
            metrics: {
                spreadBps: currentSpreadBps,
                flowImbalance: flowMetrics.flowImbalance,
                volatility,
                lastUpdateAge: Math.max(
                    Date.now() -
                        (recentSnapshots[recentSnapshots.length - 1]?.timestamp ||
                            0),
                    0
                ),
            },
        };
    }

    /**
     * Get recent anomaly history for analysis.
     */
    public getRecentAnomalies(windowMs: number = 300000): AnomalyEvent[] {
        const cutoff = Date.now() - windowMs;
        return this.recentAnomalies.filter((a) => a.detectedAt > cutoff);
    }

    /**
     * Clear anomaly history (useful for testing or reset scenarios).
     */
    public clearAnomalyHistory(): void {
        this.recentAnomalies = [];
        this.lastEmitted = {};
        this.logger?.info?.("Anomaly history cleared", {
            component: "AnomalyDetector",
        });
    }
}
