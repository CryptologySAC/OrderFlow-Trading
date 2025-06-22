// src/services/icebergDetector.ts

/**
 * IcebergDetector - Institutional Order Fragmentation Analysis
 *
 * Detects large orders that are systematically broken into smaller pieces
 * to hide institutional trading activity from the market.
 *
 * Key Patterns:
 * - Consistent order sizes at same price levels
 * - Rapid refills after execution
 * - Price stability despite large volume
 * - Institutional size thresholds
 */

import { randomUUID } from "crypto";
import { Detector } from "../indicators/base/detectorEnrichedTrade.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type { AnomalyDetector } from "./anomalyDetector.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { SignalCandidate } from "../types/signalTypes.js";

export interface IcebergDetectorConfig {
    /** Minimum number of refills to qualify as iceberg */
    minRefillCount: number; // Default: 3

    /** Maximum size variation between iceberg pieces (0-1) */
    maxSizeVariation: number; // Default: 0.2 (20%)

    /** Minimum total cumulative size for iceberg detection */
    minTotalSize: number; // Default: 50

    /** Maximum time between refills in milliseconds */
    maxRefillTimeMs: number; // Default: 30000 (30 seconds)

    /** Price stability tolerance for iceberg detection */
    priceStabilityTolerance: number; // Default: 0.005 (0.5%)

    /** Minimum average piece size for institutional classification */
    institutionalSizeThreshold: number; // Default: 10

    /** Window to track iceberg activity in milliseconds */
    trackingWindowMs: number; // Default: 300000 (5 minutes)

    /** Maximum number of active icebergs to track */
    maxActiveIcebergs: number; // Default: 20
}

export interface IcebergEvent {
    id: string;
    price: number;
    side: "buy" | "sell";
    totalSize: number;
    averagePieceSize: number;
    refillCount: number;
    firstSeen: number;
    lastRefill: number;
    priceStability: number;
    /** Average time gap between refills */
    avgRefillGap: number;
    /** Temporal consistency score used in confidence calculation */
    temporalScore: number;
    confidence: number;
    institutionalScore: number;
    completionStatus: "active" | "completed" | "abandoned";
}

export interface IcebergZone {
    id: string;
    type: "iceberg";
    priceRange: {
        min: number;
        max: number;
    };
    startTime: number;
    endTime?: number;
    strength: number;
    completion: number;
    totalVolume: number;
    refillCount: number;
    averagePieceSize: number;
    side: "buy" | "sell";
    institutionalScore: number;
    priceStability: number;
    avgRefillGap: number;
    temporalScore: number;
}

interface IcebergCandidate {
    id: string;
    price: number;
    side: "buy" | "sell";
    pieces: Array<{
        size: number;
        timestamp: number;
        executedSize: number;
    }>;
    firstSeen: number;
    lastActivity: number;
    totalExecuted: number;
    isActive: boolean;
}

/**
 * Advanced iceberg order detection using multi-dimensional analysis
 */
export class IcebergDetector extends Detector {
    private config: IcebergDetectorConfig;
    private anomalyDetector?: AnomalyDetector;

    // Active iceberg tracking
    private activeCandidates = new Map<string, IcebergCandidate>();
    private completedIcebergs: IcebergEvent[] = [];

    // Price level tracking for pattern recognition
    private priceLevelActivity = new Map<
        number,
        {
            lastTradeTime: number;
            executedVolume: number;
            tradeCount: number;
            averageSize: number;
        }
    >();

    constructor(
        id: string,
        config: Partial<IcebergDetectorConfig>,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, logger, metricsCollector, signalLogger);
        this.config = {
            minRefillCount: config.minRefillCount ?? 3,
            maxSizeVariation: config.maxSizeVariation ?? 0.2,
            minTotalSize: config.minTotalSize ?? 50,
            maxRefillTimeMs: config.maxRefillTimeMs ?? 30000,
            priceStabilityTolerance: config.priceStabilityTolerance ?? 0.005,
            institutionalSizeThreshold: config.institutionalSizeThreshold ?? 10,
            trackingWindowMs: config.trackingWindowMs ?? 300000,
            maxActiveIcebergs: config.maxActiveIcebergs ?? 20,
        };

        // Cleanup expired candidates periodically
        setInterval(() => this.cleanupExpiredCandidates(), 60000); // Every minute
    }

    /**
     * Set the anomaly detector for event forwarding
     */
    public setAnomalyDetector(anomalyDetector: AnomalyDetector): void {
        this.anomalyDetector = anomalyDetector;
    }

    /**
     * Process trade event for iceberg detection (implements base Detector interface)
     */
    public onEnrichedTrade(trade: EnrichedTradeEvent): void {
        try {
            const now = trade.timestamp;
            const normalizedPrice = this.normalizePrice(trade.price);
            const side = trade.buyerIsMaker ? "sell" : "buy";

            // Update price level activity
            this.updatePriceLevelActivity(normalizedPrice, trade.quantity, now);

            // Check for potential iceberg patterns
            this.analyzeForIcebergPatterns(trade, normalizedPrice, side, now);

            // Update existing candidates
            this.updateExistingCandidates();
        } catch (error) {
            this.handleError(
                error instanceof Error ? error : new Error(String(error)),
                "IcebergDetector.onEnrichedTrade"
            );
        }
    }

    /**
     * Get detector status (required by base Detector class)
     */
    public getStatus(): string {
        const stats = this.getStatistics();
        return `Active: ${stats.activeCandidates} candidates, ${stats.completedIcebergs} completed (avg confidence: ${(stats.avgConfidence * 100).toFixed(1)}%)`;
    }

    /**
     * Mark signal as confirmed (required by base Detector class)
     */
    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        // For iceberg detection, we don't use zone-based cooldowns
        // but we can log the confirmation
        this.logger.info("Iceberg signal confirmed", {
            component: "IcebergDetector",
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
     * Update price level activity tracking
     */
    private updatePriceLevelActivity(
        price: number,
        size: number,
        timestamp: number
    ): void {
        const activity = this.priceLevelActivity.get(price) || {
            lastTradeTime: 0,
            executedVolume: 0,
            tradeCount: 0,
            averageSize: 0,
        };

        activity.lastTradeTime = timestamp;
        activity.executedVolume += size;
        activity.tradeCount++;
        activity.averageSize = activity.executedVolume / activity.tradeCount;

        this.priceLevelActivity.set(price, activity);
    }

    /**
     * Analyze trade for potential iceberg patterns
     */
    private analyzeForIcebergPatterns(
        trade: EnrichedTradeEvent,
        normalizedPrice: number,
        side: "buy" | "sell",
        timestamp: number
    ): void {
        // Look for consistent piece sizes at the same price level
        const candidateId = `${normalizedPrice}_${side}`;
        const existingCandidate = this.activeCandidates.get(candidateId);

        if (existingCandidate) {
            // Update existing candidate
            const timeSinceLastPiece =
                timestamp - existingCandidate.lastActivity;

            if (timeSinceLastPiece <= this.config.maxRefillTimeMs) {
                // This could be a refill
                existingCandidate.pieces.push({
                    size: trade.quantity,
                    timestamp,
                    executedSize: trade.quantity,
                });
                existingCandidate.lastActivity = timestamp;
                existingCandidate.totalExecuted += trade.quantity;

                // Check if this qualifies as an iceberg
                this.evaluateIcebergCandidate(existingCandidate);
            } else {
                // Gap too large, abandon this candidate
                this.abandonCandidate(candidateId);
            }
        } else {
            // Check if this could be the start of an iceberg
            if (this.couldBeIcebergStart(trade, normalizedPrice)) {
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
     * Check if a trade could be the start of an iceberg
     */
    private couldBeIcebergStart(
        trade: EnrichedTradeEvent,
        price: number
    ): boolean {
        // Must be above minimum institutional size
        if (trade.quantity < this.config.institutionalSizeThreshold) {
            return false;
        }

        // Check for consistent activity at this price level
        const activity = this.priceLevelActivity.get(price);
        if (!activity) {
            return true; // First trade at this level
        }

        // Look for patterns that suggest fragmented orders
        const sizeRatio = trade.quantity / activity.averageSize;
        return sizeRatio >= 0.5 && sizeRatio <= 2.0; // Similar to average size
    }

    /**
     * Create new iceberg candidate
     */
    private createNewCandidate(
        candidateId: string,
        price: number,
        _side: "buy" | "sell",
        trade: EnrichedTradeEvent,
        timestamp: number
    ): void {
        // Limit number of active candidates
        if (this.activeCandidates.size >= this.config.maxActiveIcebergs) {
            // Remove oldest candidate
            const oldestId = Array.from(this.activeCandidates.keys())[0];
            this.activeCandidates.delete(oldestId);
        }

        const candidate: IcebergCandidate = {
            id: candidateId,
            price,
            side: _side,
            pieces: [
                {
                    size: trade.quantity,
                    timestamp,
                    executedSize: trade.quantity,
                },
            ],
            firstSeen: timestamp,
            lastActivity: timestamp,
            totalExecuted: trade.quantity,
            isActive: true,
        };

        this.activeCandidates.set(candidateId, candidate);
    }

    /**
     * Update existing candidates with new trade data
     */
    private updateExistingCandidates(): void {
        // This method can be used for cross-validation and pattern strengthening
        // For now, the main logic is in analyzeForIcebergPatterns
    }

    /**
     * Evaluate if a candidate qualifies as an iceberg
     */
    private evaluateIcebergCandidate(candidate: IcebergCandidate): void {
        const pieces = candidate.pieces;

        if (pieces.length < this.config.minRefillCount) {
            return; // Not enough pieces yet
        }

        // Calculate size consistency
        const sizes = pieces.map((p) => p.size);
        const avgSize =
            sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
        const sizeVariation = this.calculateSizeVariation(sizes, avgSize);

        // Calculate temporal consistency between refills
        const timeGaps = this.calculateTimeGaps(pieces);
        const temporalScore = this.calculateTemporalScore(timeGaps);
        const avgRefillGap =
            timeGaps.length > 0
                ? timeGaps.reduce((sum, g) => sum + g, 0) / timeGaps.length
                : 0;

        // Calculate price stability (all pieces should be at same price)
        const priceStability = 1.0; // Perfect stability since all at same price level

        // Calculate institutional score
        const institutionalScore = this.calculateInstitutionalScore(
            candidate,
            avgSize
        );

        // Calculate overall confidence
        const confidence = this.calculateIcebergConfidence(
            sizeVariation,
            priceStability,
            institutionalScore,
            pieces.length,
            candidate.totalExecuted,
            temporalScore
        );

        // Check if this qualifies as an iceberg
        if (this.qualifiesAsIceberg(candidate, sizeVariation, confidence)) {
            this.emitIcebergSignal(
                candidate,
                avgSize,
                sizeVariation,
                confidence,
                institutionalScore,
                avgRefillGap,
                temporalScore
            );
            this.activeCandidates.delete(candidate.id);
        }
    }

    /**
     * Calculate size variation coefficient
     */
    private calculateSizeVariation(sizes: number[], avgSize: number): number {
        if (sizes.length < 2) return 0;

        const variance =
            sizes.reduce((sum, size) => sum + Math.pow(size - avgSize, 2), 0) /
            sizes.length;
        const stdDev = Math.sqrt(variance);
        return avgSize > 0 ? stdDev / avgSize : 1;
    }

    /**
     * Calculate time gaps between pieces
     */
    private calculateTimeGaps(pieces: Array<{ timestamp: number }>): number[] {
        const gaps: number[] = [];
        for (let i = 1; i < pieces.length; i++) {
            gaps.push(pieces[i].timestamp - pieces[i - 1].timestamp);
        }
        return gaps;
    }

    /**
     * Calculate temporal consistency score from refill gaps
     */
    private calculateTemporalScore(gaps: number[]): number {
        if (gaps.length === 0) return 1;

        const avgGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
        const variation = this.calculateSizeVariation(gaps, avgGap);

        const avgScore = Math.max(0, 1 - avgGap / this.config.maxRefillTimeMs);
        const variationScore = Math.max(0, 1 - variation);

        return avgScore * 0.7 + variationScore * 0.3;
    }

    /**
     * Calculate institutional trading score
     */
    private calculateInstitutionalScore(
        candidate: IcebergCandidate,
        avgSize: number
    ): number {
        let score = 0;

        // Size-based scoring
        if (avgSize >= this.config.institutionalSizeThreshold * 2) {
            score += 0.4;
        } else if (avgSize >= this.config.institutionalSizeThreshold) {
            score += 0.2;
        }

        // Consistency-based scoring
        if (candidate.pieces.length >= 5) {
            score += 0.3;
        } else if (candidate.pieces.length >= 3) {
            score += 0.2;
        }

        // Duration-based scoring
        const duration = candidate.lastActivity - candidate.firstSeen;
        if (duration >= 60000) {
            // 1 minute+
            score += 0.3;
        } else if (duration >= 30000) {
            // 30 seconds+
            score += 0.2;
        }

        return Math.min(score, 1.0);
    }

    /**
     * Calculate overall iceberg confidence
     */
    private calculateIcebergConfidence(
        sizeVariation: number,
        priceStability: number,
        institutionalScore: number,
        pieceCount: number,
        totalSize: number,
        temporalScore: number
    ): number {
        // Size consistency component (lower variation = higher confidence)
        const sizeConsistency = Math.max(
            0,
            1 - sizeVariation / this.config.maxSizeVariation
        );

        // Piece count component
        const pieceCountScore = Math.min(pieceCount / 10, 1); // Normalize to 10 pieces

        // Total size component
        const sizeScore = Math.min(
            totalSize / (this.config.minTotalSize * 3),
            1
        );

        // Weighted average
        return (
            sizeConsistency * 0.35 +
            priceStability * 0.2 +
            institutionalScore * 0.2 +
            pieceCountScore * 0.1 +
            sizeScore * 0.1 +
            temporalScore * 0.05
        );
    }

    /**
     * Check if candidate qualifies as iceberg
     */
    private qualifiesAsIceberg(
        candidate: IcebergCandidate,
        sizeVariation: number,
        confidence: number
    ): boolean {
        return (
            candidate.pieces.length >= this.config.minRefillCount &&
            candidate.totalExecuted >= this.config.minTotalSize &&
            sizeVariation <= this.config.maxSizeVariation &&
            confidence >= 0.6 // Minimum confidence threshold
        );
    }

    /**
     * Emit iceberg detection signal and event
     */
    private emitIcebergSignal(
        candidate: IcebergCandidate,
        avgSize: number,
        sizeVariation: number,
        confidence: number,
        institutionalScore: number,
        avgRefillGap: number,
        temporalScore: number
    ): void {
        const icebergEvent: IcebergEvent = {
            id: candidate.id,
            price: candidate.price,
            side: candidate.side,
            totalSize: candidate.totalExecuted,
            averagePieceSize: avgSize,
            refillCount: candidate.pieces.length,
            firstSeen: candidate.firstSeen,
            lastRefill: candidate.lastActivity,
            priceStability: 1.0, // Perfect since all at same price
            avgRefillGap,
            temporalScore,
            confidence,
            institutionalScore,
            completionStatus: "completed",
        };

        // Store completed iceberg
        this.completedIcebergs.push(icebergEvent);
        if (this.completedIcebergs.length > 100) {
            this.completedIcebergs.shift(); // Keep last 100
        }

        // Emit signal candidate through base detector
        const signalCandidate: SignalCandidate = {
            id: randomUUID(),
            type: "absorption", // Use existing type until iceberg is added
            side: candidate.side,
            confidence,
            timestamp: candidate.lastActivity,
            data: {
                // Map to AbsorptionSignalData format for compatibility
                price: candidate.price,
                zone: Math.round(candidate.price * 100), // Create zone from price
                side: candidate.side,
                aggressive: candidate.totalExecuted,
                passive: candidate.totalExecuted,
                refilled: true, // Iceberg orders are inherently refilled
                confidence,
                metrics: {
                    averagePieceSize: avgSize,
                    refillCount: candidate.pieces.length,
                    institutionalScore,
                    priceStability: 1.0,
                    sizeVariation,
                    duration: candidate.lastActivity - candidate.firstSeen,
                    avgRefillGap,
                    temporalScore,
                },
                meta: {
                    icebergDetected: true,
                    icebergEvent, // Include full event data
                },
            },
        };

        this.emitSignalCandidate(signalCandidate);

        // Emit to anomaly detector
        if (this.anomalyDetector) {
            this.anomalyDetector.onSpoofingEvent(
                {
                    priceStart: candidate.price,
                    priceEnd: candidate.price,
                    side: candidate.side,
                    wallBefore: candidate.totalExecuted,
                    wallAfter: 0,
                    canceled: 0,
                    executed: candidate.totalExecuted,
                    timestamp: candidate.lastActivity,
                    spoofedSide: candidate.side === "buy" ? "bid" : "ask",
                    spoofType: "iceberg_manipulation",
                    confidence,
                    cancelTimeMs: candidate.lastActivity - candidate.firstSeen,
                    marketImpact: institutionalScore,
                },
                candidate.price
            );
        }

        // Create iceberg zone for chart visualization
        const priceDeviation =
            candidate.price * this.config.priceStabilityTolerance;
        const icebergZone: IcebergZone = {
            id: `iceberg_${candidate.id}`,
            type: "iceberg",
            priceRange: {
                min: candidate.price - priceDeviation,
                max: candidate.price + priceDeviation,
            },
            startTime: candidate.firstSeen,
            endTime: candidate.lastActivity,
            strength: confidence,
            completion: 1.0, // Completed when detected
            totalVolume: candidate.totalExecuted,
            refillCount: candidate.pieces.length,
            averagePieceSize: avgSize,
            side: candidate.side,
            institutionalScore,
            priceStability: 1.0,
            avgRefillGap,
            temporalScore,
        };

        // Emit zone update for dashboard visualization
        this.emit("zoneUpdated", {
            updateType: "zone_created",
            zone: icebergZone,
            significance:
                confidence > 0.8 ? "high" : confidence > 0.6 ? "medium" : "low",
        });

        // Emit internal event for backward compatibility
        this.emit("icebergDetected", icebergEvent);

        this.logger.info("Iceberg order detected", {
            component: "IcebergDetector",
            operation: "emitIcebergSignal",
            ...icebergEvent,
        });
    }

    /**
     * Abandon a candidate that no longer shows iceberg patterns
     */
    private abandonCandidate(candidateId: string): void {
        this.activeCandidates.delete(candidateId);
    }

    /**
     * Cleanup expired candidates
     */
    private cleanupExpiredCandidates(): void {
        const now = Date.now();
        const expiredIds: string[] = [];

        for (const [id, candidate] of this.activeCandidates) {
            if (now - candidate.lastActivity > this.config.trackingWindowMs) {
                expiredIds.push(id);
            }
        }

        expiredIds.forEach((id) => {
            this.activeCandidates.delete(id);
        });

        // Clean up price level activity
        for (const [price, activity] of this.priceLevelActivity) {
            if (now - activity.lastTradeTime > this.config.trackingWindowMs) {
                this.priceLevelActivity.delete(price);
            }
        }
    }

    /**
     * Get active iceberg candidates (for debugging/monitoring)
     */
    public getActiveCandidates(): IcebergCandidate[] {
        return Array.from(this.activeCandidates.values());
    }

    /**
     * Get completed icebergs
     */
    public getCompletedIcebergs(windowMs: number = 300000): IcebergEvent[] {
        const cutoff = Date.now() - windowMs;
        return this.completedIcebergs.filter(
            (iceberg) => iceberg.lastRefill > cutoff
        );
    }

    /**
     * Get iceberg detection statistics
     */
    public getStatistics(): {
        activeCandidates: number;
        completedIcebergs: number;
        avgConfidence: number;
        avgInstitutionalScore: number;
        totalVolumeDetected: number;
    } {
        const recentIcebergs = this.getCompletedIcebergs();

        return {
            activeCandidates: this.activeCandidates.size,
            completedIcebergs: recentIcebergs.length,
            avgConfidence:
                recentIcebergs.length > 0
                    ? recentIcebergs.reduce((sum, i) => sum + i.confidence, 0) /
                      recentIcebergs.length
                    : 0,
            avgInstitutionalScore:
                recentIcebergs.length > 0
                    ? recentIcebergs.reduce(
                          (sum, i) => sum + i.institutionalScore,
                          0
                      ) / recentIcebergs.length
                    : 0,
            totalVolumeDetected: recentIcebergs.reduce(
                (sum, i) => sum + i.totalSize,
                0
            ),
        };
    }
}
