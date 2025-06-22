// src/services/hiddenOrderDetector.ts

/**
 * HiddenOrderDetector - Invisible Liquidity Pattern Analysis
 *
 * Detects hidden orders and invisible liquidity patterns that don't appear
 * in the visible order book but are revealed through trade execution patterns.
 *
 * Key Patterns:
 * - Reserve orders that appear only when market approaches
 * - Hidden liquidity pools activated by volume thresholds
 * - Algorithmic orders that mask their presence
 * - Stealth institutional positioning
 */

import { randomUUID } from "crypto";
import { Detector } from "../indicators/base/detectorEnrichedTrade.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type { AnomalyDetector } from "./anomalyDetector.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { SignalCandidate } from "../types/signalTypes.js";

export interface HiddenOrderDetectorConfig {
    /** Minimum trade size to consider for hidden order detection */
    minTradeSize: number; // Default: 5

    /** Maximum time gap between trades to maintain continuity (ms) */
    maxTradeGapMs: number; // Default: 10000 (10 seconds)

    /** Minimum number of trades to qualify as hidden liquidity */
    minTradeSequence: number; // Default: 4

    /** Price deviation tolerance for hidden order detection */
    priceDeviationTolerance: number; // Default: 0.002 (0.2%)

    /** Volume concentration threshold for detection */
    volumeConcentrationThreshold: number; // Default: 0.7 (70%)

    /** Minimum cumulative volume for hidden order classification */
    minCumulativeVolume: number; // Default: 30

    /** Time window for tracking hidden order activity (ms) */
    trackingWindowMs: number; // Default: 180000 (3 minutes)

    /** Maximum number of active hidden order candidates */
    maxActiveCandidates: number; // Default: 15

    /** Stealth threshold for algorithmic detection */
    stealthThreshold: number; // Default: 0.8

    /** Reserve order activation distance (as price ratio) */
    reserveActivationDistance: number; // Default: 0.001 (0.1%)
}

export interface HiddenOrderEvent {
    id: string;
    type:
        | "reserve_order"
        | "stealth_liquidity"
        | "algorithmic_hidden"
        | "institutional_stealth";
    priceLevel: number;
    side: "buy" | "sell";
    totalVolume: number;
    tradeCount: number;
    averageTradeSize: number;
    firstDetected: number;
    lastActivity: number;
    stealthScore: number;
    confidence: number;
    volumeConcentration: number;
    priceStability: number;
    detectionMethod: string;
    completionStatus: "active" | "completed" | "dissolved";
}

export interface HiddenOrderZone {
    id: string;
    type: "hidden_liquidity";
    priceRange: {
        min: number;
        max: number;
    };
    startTime: number;
    endTime?: number;
    strength: number;
    completion: number;
    totalVolume: number;
    tradeCount: number;
    averageTradeSize: number;
    side: "buy" | "sell";
    stealthScore: number;
    stealthType:
        | "reserve_order"
        | "stealth_liquidity"
        | "algorithmic_hidden"
        | "institutional_stealth";
    volumeConcentration: number;
    detectionMethod: string;
}

interface HiddenOrderCandidate {
    id: string;
    priceLevel: number;
    side: "buy" | "sell";
    trades: Array<{
        size: number;
        timestamp: number;
        price: number;
    }>;
    firstDetected: number;
    lastActivity: number;
    totalVolume: number;
    isActive: boolean;
    consecutiveGaps: number;
    maxGapMs: number;
}

interface PriceLevelLiquidity {
    priceLevel: number;
    totalVolume: number;
    tradeCount: number;
    lastUpdate: number;
    volumeProfile: number[];
    isHiddenCandidate: boolean;
}

/**
 * Advanced hidden order detection using liquidity flow analysis
 */
export class HiddenOrderDetector extends Detector {
    private config: HiddenOrderDetectorConfig;
    private anomalyDetector?: AnomalyDetector;

    // Hidden order tracking
    private activeCandidates = new Map<string, HiddenOrderCandidate>();
    private detectedHiddenOrders: HiddenOrderEvent[] = [];

    // Market microstructure analysis
    private priceLevelLiquidity = new Map<number, PriceLevelLiquidity>();
    private recentTrades: Array<{
        price: number;
        size: number;
        timestamp: number;
        side: "buy" | "sell";
    }> = [];

    // Volume flow tracking
    private volumeFlowAnalysis = new Map<
        string,
        {
            cumulativeVolume: number;
            tradeVelocity: number;
            priceImpact: number;
            lastUpdate: number;
        }
    >();

    constructor(
        id: string,
        config: Partial<HiddenOrderDetectorConfig>,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, logger, metricsCollector, signalLogger);
        this.config = {
            minTradeSize: config.minTradeSize ?? 5,
            maxTradeGapMs: config.maxTradeGapMs ?? 10000,
            minTradeSequence: config.minTradeSequence ?? 4,
            priceDeviationTolerance: config.priceDeviationTolerance ?? 0.002,
            volumeConcentrationThreshold:
                config.volumeConcentrationThreshold ?? 0.7,
            minCumulativeVolume: config.minCumulativeVolume ?? 30,
            trackingWindowMs: config.trackingWindowMs ?? 180000,
            maxActiveCandidates: config.maxActiveCandidates ?? 15,
            stealthThreshold: config.stealthThreshold ?? 0.8,
            reserveActivationDistance:
                config.reserveActivationDistance ?? 0.001,
        };

        // Cleanup expired data periodically
        setInterval(() => this.cleanupExpiredData(), 60000); // Every minute
    }

    /**
     * Set the anomaly detector for event forwarding
     */
    public setAnomalyDetector(anomalyDetector: AnomalyDetector): void {
        this.anomalyDetector = anomalyDetector;
    }

    /**
     * Process trade event for hidden order detection (implements base Detector interface)
     */
    public onEnrichedTrade(trade: EnrichedTradeEvent): void {
        try {
            const now = trade.timestamp;
            const normalizedPrice = this.normalizePrice(trade.price);
            const side = trade.buyerIsMaker ? "sell" : "buy";

            // Update recent trades history
            this.updateRecentTrades(trade, side);

            // Update price level liquidity tracking
            this.updatePriceLevelLiquidity(
                normalizedPrice,
                trade.quantity,
                now
            );

            // Analyze for hidden order patterns
            this.analyzeForHiddenOrders(trade, normalizedPrice, side, now);

            // Update volume flow analysis
            this.updateVolumeFlowAnalysis(
                normalizedPrice,
                trade.quantity,
                side,
                now
            );

            // Evaluate existing candidates
            this.evaluateExistingCandidates(now);
        } catch (error) {
            this.handleError(
                error instanceof Error ? error : new Error(String(error)),
                "HiddenOrderDetector.onEnrichedTrade"
            );
        }
    }

    /**
     * Get detector status (required by base Detector class)
     */
    public getStatus(): string {
        const stats = this.getStatistics();
        return `Active: ${stats.activeCandidates} candidates, ${stats.detectedHiddenOrders} detected (avg stealth: ${(stats.avgStealthScore * 100).toFixed(1)}%)`;
    }

    /**
     * Mark signal as confirmed (required by base Detector class)
     */
    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        this.logger.info("Hidden order signal confirmed", {
            component: "HiddenOrderDetector",
            zone,
            side,
            timestamp: Date.now(),
        });
    }

    /**
     * Normalize price for consistent tracking
     */
    private normalizePrice(price: number): number {
        return Number(price.toFixed(4));
    }

    /**
     * Update recent trades history for pattern analysis
     */
    private updateRecentTrades(
        trade: EnrichedTradeEvent,
        side: "buy" | "sell"
    ): void {
        this.recentTrades.push({
            price: trade.price,
            size: trade.quantity,
            timestamp: trade.timestamp,
            side,
        });

        // Keep only recent trades within tracking window
        const cutoff = trade.timestamp - this.config.trackingWindowMs;
        this.recentTrades = this.recentTrades.filter(
            (t) => t.timestamp > cutoff
        );
    }

    /**
     * Update price level liquidity tracking
     */
    private updatePriceLevelLiquidity(
        price: number,
        size: number,
        timestamp: number
    ): void {
        const liquidity = this.priceLevelLiquidity.get(price) || {
            priceLevel: price,
            totalVolume: 0,
            tradeCount: 0,
            lastUpdate: 0,
            volumeProfile: [],
            isHiddenCandidate: false,
        };

        liquidity.totalVolume += size;
        liquidity.tradeCount++;
        liquidity.lastUpdate = timestamp;
        liquidity.volumeProfile.push(size);

        // Keep only recent volume profile
        if (liquidity.volumeProfile.length > 20) {
            liquidity.volumeProfile.shift();
        }

        this.priceLevelLiquidity.set(price, liquidity);
    }

    /**
     * Analyze trade for hidden order patterns
     */
    private analyzeForHiddenOrders(
        trade: EnrichedTradeEvent,
        normalizedPrice: number,
        side: "buy" | "sell",
        timestamp: number
    ): void {
        // Skip small trades that don't indicate institutional activity
        if (trade.quantity < this.config.minTradeSize) {
            return;
        }

        const candidateId = `${normalizedPrice}_${side}`;
        const existingCandidate = this.activeCandidates.get(candidateId);

        if (existingCandidate) {
            this.updateExistingCandidate(existingCandidate, trade, timestamp);
        } else {
            // Check if this could be the start of hidden liquidity
            if (
                this.couldBeHiddenLiquidityStart(trade, normalizedPrice, side)
            ) {
                this.createNewCandidate(
                    candidateId,
                    normalizedPrice,
                    side,
                    trade,
                    timestamp
                );
            }
        }
    }

    /**
     * Check if a trade could be the start of hidden liquidity
     */
    private couldBeHiddenLiquidityStart(
        trade: EnrichedTradeEvent,
        price: number,
        side: "buy" | "sell"
    ): boolean {
        // Look for patterns suggesting hidden orders
        const liquidity = this.priceLevelLiquidity.get(price);
        if (!liquidity) {
            return true; // First trade at this level could be hidden
        }

        // Check for sudden liquidity appearance
        const recentVolume = this.calculateRecentVolumeAtLevel(price, 30000); // 30 second window
        const volumeRatio = trade.quantity / (recentVolume || trade.quantity);

        // Look for algorithmic patterns (consistent sizing, timing)
        const algorithmicScore = this.calculateAlgorithmicScore(price, side);

        return (
            volumeRatio > 0.3 || algorithmicScore > this.config.stealthThreshold
        );
    }

    /**
     * Calculate recent volume at a specific price level
     */
    private calculateRecentVolumeAtLevel(
        price: number,
        windowMs: number
    ): number {
        const cutoff = Date.now() - windowMs;
        return this.recentTrades
            .filter(
                (t) =>
                    Math.abs(t.price - price) <
                        this.config.priceDeviationTolerance &&
                    t.timestamp > cutoff
            )
            .reduce((sum, t) => sum + t.size, 0);
    }

    /**
     * Calculate algorithmic trading score for stealth detection
     */
    private calculateAlgorithmicScore(
        price: number,
        side: "buy" | "sell"
    ): number {
        const relevantTrades = this.recentTrades.filter(
            (t) =>
                Math.abs(t.price - price) <
                    this.config.priceDeviationTolerance && t.side === side
        );

        if (relevantTrades.length < 3) {
            return 0;
        }

        // Check for size consistency (algorithmic pattern)
        const sizes = relevantTrades.map((t) => t.size);
        const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
        const sizeVariation = this.calculateVariationCoefficient(
            sizes,
            avgSize
        );

        // Check for timing consistency
        const timings = relevantTrades
            .slice(1)
            .map((t, i) => t.timestamp - relevantTrades[i].timestamp);
        const avgTiming =
            timings.reduce((sum, t) => sum + t, 0) / timings.length;
        const timingVariation = this.calculateVariationCoefficient(
            timings,
            avgTiming
        );

        // Lower variation = higher algorithmic score
        const sizeScore = Math.max(0, 1 - sizeVariation);
        const timingScore = Math.max(0, 1 - timingVariation);

        return (sizeScore + timingScore) / 2;
    }

    /**
     * Calculate variation coefficient
     */
    private calculateVariationCoefficient(
        values: number[],
        average: number
    ): number {
        if (values.length < 2 || average === 0) return 1;

        const variance =
            values.reduce((sum, v) => sum + Math.pow(v - average, 2), 0) /
            values.length;
        const stdDev = Math.sqrt(variance);

        return stdDev / average;
    }

    /**
     * Create new hidden order candidate
     */
    private createNewCandidate(
        candidateId: string,
        price: number,
        side: "buy" | "sell",
        trade: EnrichedTradeEvent,
        timestamp: number
    ): void {
        // Limit number of active candidates
        if (this.activeCandidates.size >= this.config.maxActiveCandidates) {
            const oldestId = Array.from(this.activeCandidates.keys())[0];
            this.activeCandidates.delete(oldestId);
        }

        const candidate: HiddenOrderCandidate = {
            id: candidateId,
            priceLevel: price,
            side,
            trades: [
                {
                    size: trade.quantity,
                    timestamp,
                    price: trade.price,
                },
            ],
            firstDetected: timestamp,
            lastActivity: timestamp,
            totalVolume: trade.quantity,
            isActive: true,
            consecutiveGaps: 0,
            maxGapMs: 0,
        };

        this.activeCandidates.set(candidateId, candidate);
    }

    /**
     * Update existing hidden order candidate
     */
    private updateExistingCandidate(
        candidate: HiddenOrderCandidate,
        trade: EnrichedTradeEvent,
        timestamp: number
    ): void {
        const timeSinceLastTrade = timestamp - candidate.lastActivity;

        if (timeSinceLastTrade <= this.config.maxTradeGapMs) {
            // Continue sequence
            candidate.trades.push({
                size: trade.quantity,
                timestamp,
                price: trade.price,
            });
            candidate.lastActivity = timestamp;
            candidate.totalVolume += trade.quantity;
            candidate.consecutiveGaps = 0;
        } else {
            // Gap detected - check if still viable
            candidate.consecutiveGaps++;
            candidate.maxGapMs = Math.max(
                candidate.maxGapMs,
                timeSinceLastTrade
            );

            if (candidate.consecutiveGaps > 2) {
                // Too many gaps, evaluate for completion
                this.evaluateHiddenOrderCandidate(candidate);
            }
        }
    }

    /**
     * Update volume flow analysis
     */
    private updateVolumeFlowAnalysis(
        price: number,
        size: number,
        side: "buy" | "sell",
        timestamp: number
    ): void {
        const flowId = `${price}_${side}`;
        const analysis = this.volumeFlowAnalysis.get(flowId) || {
            cumulativeVolume: 0,
            tradeVelocity: 0,
            priceImpact: 0,
            lastUpdate: 0,
        };

        const timeDelta =
            analysis.lastUpdate > 0 ? timestamp - analysis.lastUpdate : 1000;
        analysis.cumulativeVolume += size;
        analysis.tradeVelocity = size / (timeDelta / 1000); // Size per second
        analysis.lastUpdate = timestamp;

        this.volumeFlowAnalysis.set(flowId, analysis);
    }

    /**
     * Evaluate existing candidates for hidden order completion
     */
    private evaluateExistingCandidates(currentTime: number): void {
        for (const [id, candidate] of this.activeCandidates) {
            const timeSinceLastActivity = currentTime - candidate.lastActivity;

            if (timeSinceLastActivity > this.config.maxTradeGapMs * 3) {
                // Candidate has been inactive, evaluate for completion
                this.evaluateHiddenOrderCandidate(candidate);
                this.activeCandidates.delete(id);
            }
        }
    }

    /**
     * Evaluate if candidate qualifies as hidden order
     */
    private evaluateHiddenOrderCandidate(
        candidate: HiddenOrderCandidate
    ): void {
        if (
            candidate.trades.length < this.config.minTradeSequence ||
            candidate.totalVolume < this.config.minCumulativeVolume
        ) {
            return; // Doesn't meet minimum requirements
        }

        const stealthScore = this.calculateStealthScore(candidate);
        const confidence = this.calculateHiddenOrderConfidence(
            candidate,
            stealthScore
        );
        const hiddenOrderType = this.classifyHiddenOrderType(
            candidate,
            stealthScore
        );

        if (confidence >= 0.6) {
            // Minimum confidence threshold
            this.emitHiddenOrderSignal(
                candidate,
                stealthScore,
                confidence,
                hiddenOrderType
            );
        }
    }

    /**
     * Calculate stealth score for hidden order
     */
    private calculateStealthScore(candidate: HiddenOrderCandidate): number {
        const trades = candidate.trades;

        // Size consistency (lower variation = higher stealth)
        const sizes = trades.map((t) => t.size);
        const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
        const sizeConsistency =
            1 - this.calculateVariationCoefficient(sizes, avgSize);

        // Timing regularity
        const timings = trades
            .slice(1)
            .map((t, i) => t.timestamp - trades[i].timestamp);
        const avgTiming =
            timings.length > 0
                ? timings.reduce((sum, t) => sum + t, 0) / timings.length
                : 0;
        const timingConsistency =
            timings.length > 0
                ? 1 - this.calculateVariationCoefficient(timings, avgTiming)
                : 0;

        // Price stability
        const prices = trades.map((t) => t.price);
        const priceRange = Math.max(...prices) - Math.min(...prices);
        const priceStability =
            1 - Math.min(1, priceRange / candidate.priceLevel);

        // Volume concentration
        const totalRecentVolume = this.calculateRecentVolumeAtLevel(
            candidate.priceLevel,
            candidate.lastActivity - candidate.firstDetected + 30000
        );
        const volumeConcentration =
            candidate.totalVolume /
            (totalRecentVolume || candidate.totalVolume);

        return (
            sizeConsistency * 0.3 +
            timingConsistency * 0.2 +
            priceStability * 0.2 +
            Math.min(volumeConcentration, 1) * 0.3
        );
    }

    /**
     * Calculate overall hidden order confidence
     */
    private calculateHiddenOrderConfidence(
        candidate: HiddenOrderCandidate,
        stealthScore: number
    ): number {
        // Trade sequence strength
        const sequenceStrength = Math.min(candidate.trades.length / 10, 1);

        // Volume significance
        const volumeSignificance = Math.min(candidate.totalVolume / 100, 1);

        // Duration factor
        const duration = candidate.lastActivity - candidate.firstDetected;
        const durationFactor = Math.min(duration / 60000, 1); // Normalize to 1 minute

        // Gap penalty
        const gapPenalty = Math.max(0, 1 - candidate.consecutiveGaps * 0.2);

        return (
            stealthScore * 0.4 +
            sequenceStrength * 0.2 +
            volumeSignificance * 0.2 +
            durationFactor * 0.1 +
            gapPenalty * 0.1
        );
    }

    /**
     * Classify the type of hidden order
     */
    private classifyHiddenOrderType(
        candidate: HiddenOrderCandidate,
        stealthScore: number
    ): HiddenOrderEvent["type"] {
        const algorithmicScore = this.calculateAlgorithmicScore(
            candidate.priceLevel,
            candidate.side
        );
        const avgTradeSize = candidate.totalVolume / candidate.trades.length;

        if (stealthScore > 0.8 && algorithmicScore > 0.7) {
            return "algorithmic_hidden";
        } else if (avgTradeSize > 20 && candidate.totalVolume > 100) {
            return "institutional_stealth";
        } else if (candidate.trades.length > 6 && stealthScore > 0.6) {
            return "stealth_liquidity";
        } else {
            return "reserve_order";
        }
    }

    /**
     * Emit hidden order detection signal and event
     */
    private emitHiddenOrderSignal(
        candidate: HiddenOrderCandidate,
        stealthScore: number,
        confidence: number,
        hiddenOrderType: HiddenOrderEvent["type"]
    ): void {
        const avgTradeSize = candidate.totalVolume / candidate.trades.length;
        const volumeConcentration = Math.min(
            candidate.totalVolume /
                this.calculateRecentVolumeAtLevel(candidate.priceLevel, 180000),
            1
        );

        const hiddenOrderEvent: HiddenOrderEvent = {
            id: candidate.id,
            type: hiddenOrderType,
            priceLevel: candidate.priceLevel,
            side: candidate.side,
            totalVolume: candidate.totalVolume,
            tradeCount: candidate.trades.length,
            averageTradeSize: avgTradeSize,
            firstDetected: candidate.firstDetected,
            lastActivity: candidate.lastActivity,
            stealthScore,
            confidence,
            volumeConcentration,
            priceStability: 1.0, // High since all at same price level
            detectionMethod: "volume_flow_analysis",
            completionStatus: "completed",
        };

        // Store detected hidden order
        this.detectedHiddenOrders.push(hiddenOrderEvent);
        if (this.detectedHiddenOrders.length > 50) {
            this.detectedHiddenOrders.shift(); // Keep last 50
        }

        // Emit signal candidate through base detector
        const signalCandidate: SignalCandidate = {
            id: randomUUID(),
            type: "absorption", // Use existing type until hidden_order is added
            side: candidate.side,
            confidence,
            timestamp: candidate.lastActivity,
            data: {
                // Map to AbsorptionSignalData format for compatibility
                price: candidate.priceLevel,
                zone: Math.round(candidate.priceLevel * 100),
                side: candidate.side,
                aggressive: candidate.totalVolume,
                passive: candidate.totalVolume,
                refilled: true, // Hidden orders are inherently refilled
                confidence,
                metrics: {
                    hiddenOrderType,
                    stealthScore,
                    tradeCount: candidate.trades.length,
                    averageTradeSize: avgTradeSize,
                    volumeConcentration,
                    duration: candidate.lastActivity - candidate.firstDetected,
                },
                meta: {
                    hiddenOrderDetected: true,
                    hiddenOrderEvent, // Include full event data
                },
            },
        };

        this.emitSignalCandidate(signalCandidate);

        // Emit to anomaly detector
        if (this.anomalyDetector) {
            this.anomalyDetector.onSpoofingEvent(
                {
                    priceStart: candidate.priceLevel,
                    priceEnd: candidate.priceLevel,
                    side: candidate.side,
                    wallBefore: candidate.totalVolume,
                    wallAfter: 0,
                    canceled: 0,
                    executed: candidate.totalVolume,
                    timestamp: candidate.lastActivity,
                    spoofedSide: candidate.side === "buy" ? "bid" : "ask",
                    spoofType: "hidden_liquidity",
                    confidence,
                    cancelTimeMs:
                        candidate.lastActivity - candidate.firstDetected,
                    marketImpact: stealthScore,
                },
                candidate.priceLevel
            );
        }

        // Create hidden order zone for chart visualization
        const priceDeviation =
            candidate.priceLevel * this.config.priceDeviationTolerance;
        const hiddenOrderZone: HiddenOrderZone = {
            id: `hidden_${candidate.id}`,
            type: "hidden_liquidity",
            priceRange: {
                min: candidate.priceLevel - priceDeviation,
                max: candidate.priceLevel + priceDeviation,
            },
            startTime: candidate.firstDetected,
            endTime: candidate.lastActivity,
            strength: stealthScore,
            completion: 1.0, // Completed when detected
            totalVolume: candidate.totalVolume,
            tradeCount: candidate.trades.length,
            averageTradeSize: avgTradeSize,
            side: candidate.side,
            stealthScore,
            stealthType: hiddenOrderType,
            volumeConcentration,
            detectionMethod: "volume_flow_analysis",
        };

        // Emit zone update for dashboard visualization
        this.emit("zoneUpdated", {
            updateType: "zone_created",
            zone: hiddenOrderZone,
            significance:
                stealthScore > 0.8
                    ? "high"
                    : stealthScore > 0.6
                      ? "medium"
                      : "low",
        });

        // Emit internal event
        this.emit("hiddenOrderDetected", hiddenOrderEvent);

        this.logger.info("Hidden order detected", {
            component: "HiddenOrderDetector",
            operation: "emitHiddenOrderSignal",
            ...hiddenOrderEvent,
        });
    }

    /**
     * Cleanup expired data
     */
    private cleanupExpiredData(): void {
        const now = Date.now();
        const expiredThreshold = now - this.config.trackingWindowMs;

        // Clean up price level liquidity
        for (const [price, liquidity] of this.priceLevelLiquidity) {
            if (liquidity.lastUpdate < expiredThreshold) {
                this.priceLevelLiquidity.delete(price);
            }
        }

        // Clean up volume flow analysis
        for (const [flowId, analysis] of this.volumeFlowAnalysis) {
            if (analysis.lastUpdate < expiredThreshold) {
                this.volumeFlowAnalysis.delete(flowId);
            }
        }

        // Clean up recent trades (already done in updateRecentTrades)
        // Clean up old detected hidden orders
        this.detectedHiddenOrders = this.detectedHiddenOrders.filter(
            (order) => order.lastActivity > expiredThreshold
        );
    }

    /**
     * Get active hidden order candidates (for debugging/monitoring)
     */
    public getActiveCandidates(): HiddenOrderCandidate[] {
        return Array.from(this.activeCandidates.values());
    }

    /**
     * Get detected hidden orders
     */
    public getDetectedHiddenOrders(
        windowMs: number = 300000
    ): HiddenOrderEvent[] {
        const cutoff = Date.now() - windowMs;
        return this.detectedHiddenOrders.filter(
            (order) => order.lastActivity > cutoff
        );
    }

    /**
     * Get hidden order detection statistics
     */
    public getStatistics(): {
        activeCandidates: number;
        detectedHiddenOrders: number;
        avgStealthScore: number;
        avgConfidence: number;
        totalVolumeDetected: number;
        detectionsByType: Record<string, number>;
    } {
        const recentOrders = this.getDetectedHiddenOrders();
        const detectionsByType: Record<string, number> = {};

        recentOrders.forEach((order) => {
            detectionsByType[order.type] =
                (detectionsByType[order.type] || 0) + 1;
        });

        return {
            activeCandidates: this.activeCandidates.size,
            detectedHiddenOrders: recentOrders.length,
            avgStealthScore:
                recentOrders.length > 0
                    ? recentOrders.reduce((sum, o) => sum + o.stealthScore, 0) /
                      recentOrders.length
                    : 0,
            avgConfidence:
                recentOrders.length > 0
                    ? recentOrders.reduce((sum, o) => sum + o.confidence, 0) /
                      recentOrders.length
                    : 0,
            totalVolumeDetected: recentOrders.reduce(
                (sum, o) => sum + o.totalVolume,
                0
            ),
            detectionsByType,
        };
    }
}
