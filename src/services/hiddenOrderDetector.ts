// src/services/hiddenOrderDetector.ts

/**
 * HiddenOrderDetector - Market Order vs Order Book Depth Analysis
 *
 * Detects market orders that execute against liquidity that was NOT visible
 * in the order book depth. These represent true "hidden orders" where
 * executed volume exceeds what was available in the visible order book.
 *
 * Key Detection:
 * - Compare each trade volume against order book depth at execution price
 * - Identify when executed_volume > visible_liquidity
 * - The difference represents hidden liquidity consumption
 */

import { randomUUID } from "crypto";
import { Detector } from "../indicators/base/detectorEnrichedTrade.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type { AnomalyDetector } from "./anomalyDetector.js";
import type {
    EnrichedTradeEvent,
    PassiveLevel,
} from "../types/marketEvents.js";
import type { SignalCandidate } from "../types/signalTypes.js";

export interface HiddenOrderDetectorConfig {
    /** Minimum hidden volume to qualify as significant */
    minHiddenVolume: number; // Default: 10

    /** Minimum trade size to analyze for hidden orders */
    minTradeSize: number; // Default: 5

    /** Price tolerance for order book level matching */
    priceTolerance: number; // Default: 0.0001 (0.01%)

    /** Maximum age of depth snapshot to consider valid (ms) */
    maxDepthAgeMs: number; // Default: 1000 (1 second)

    /** Minimum confidence threshold for detection */
    minConfidence: number; // Default: 0.8

    /** Zone height as percentage of price */
    zoneHeightPercentage: number; // Default: 0.002 (0.2%)

    // Confidence calculation parameters (previously hardcoded)
    /** Large hidden volume threshold for confidence boost */
    largeHiddenVolumeThreshold: number; // Default: 50

    /** Medium hidden volume threshold for confidence boost */
    mediumHiddenVolumeThreshold: number; // Default: 25

    /** Large total volume threshold for confidence boost */
    largeTotalVolumeThreshold: number; // Default: 100

    /** Medium total volume threshold for confidence boost */
    mediumTotalVolumeThreshold: number; // Default: 50

    /** Small hidden volume penalty threshold */
    smallHiddenVolumeThreshold: number; // Default: 20

    /** Confidence boost for large volumes */
    largeVolumeConfidenceBoost: number; // Default: 0.1

    /** Confidence boost for medium volumes */
    mediumVolumeConfidenceBoost: number; // Default: 0.05

    /** Confidence penalty for small hidden volumes */
    smallVolumeConfidencePenalty: number; // Default: 0.1

    /** Maximum events to store in memory */
    maxStoredEvents: number; // Default: 100
}

export interface HiddenOrderEvent {
    id: string;
    tradeId: string;
    price: number;
    side: "buy" | "sell";
    executedVolume: number;
    visibleVolume: number;
    hiddenVolume: number;
    hiddenPercentage: number;
    timestamp: number;
    confidence: number;
    depthSnapshot: Map<number, PassiveLevel> | undefined;
}

/**
 * Hidden order detection using order book depth vs execution volume analysis
 */
export class HiddenOrderDetector extends Detector {
    private readonly config: HiddenOrderDetectorConfig;
    private anomalyDetector?: AnomalyDetector;

    // Recent hidden order events
    private detectedEvents: HiddenOrderEvent[] = [];

    constructor(
        id: string,
        config: Partial<HiddenOrderDetectorConfig>,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger: ISignalLogger
    ) {
        super(id, logger, metricsCollector, signalLogger);
        this.config = {
            minHiddenVolume: config.minHiddenVolume ?? 10,
            minTradeSize: config.minTradeSize ?? 5,
            priceTolerance: config.priceTolerance ?? 0.0001,
            maxDepthAgeMs: config.maxDepthAgeMs ?? 1000,
            minConfidence: config.minConfidence ?? 0.8,
            zoneHeightPercentage: config.zoneHeightPercentage ?? 0.002,

            // Confidence calculation parameters
            largeHiddenVolumeThreshold: config.largeHiddenVolumeThreshold ?? 50,
            mediumHiddenVolumeThreshold:
                config.mediumHiddenVolumeThreshold ?? 25,
            largeTotalVolumeThreshold: config.largeTotalVolumeThreshold ?? 100,
            mediumTotalVolumeThreshold: config.mediumTotalVolumeThreshold ?? 50,
            smallHiddenVolumeThreshold: config.smallHiddenVolumeThreshold ?? 20,
            largeVolumeConfidenceBoost:
                config.largeVolumeConfidenceBoost ?? 0.1,
            mediumVolumeConfidenceBoost:
                config.mediumVolumeConfidenceBoost ?? 0.05,
            smallVolumeConfidencePenalty:
                config.smallVolumeConfidencePenalty ?? 0.1,
            maxStoredEvents: config.maxStoredEvents ?? 100,
        };

        // Cleanup old events periodically
        setInterval(() => this.cleanupOldEvents(), 60000); // Every minute
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
            // Only analyze trades that meet minimum size threshold
            if (trade.quantity < this.config.minTradeSize) {
                return;
            }

            // Must have depth snapshot to analyze
            if (!trade.depthSnapshot) {
                return;
            }

            // Check depth snapshot age if a nearby level exists
            const levelTimestamp = this.getClosestDepthLevelTimestamp(
                trade.depthSnapshot,
                trade.price
            );
            if (levelTimestamp !== undefined) {
                const depthAge = trade.timestamp - levelTimestamp;
                if (depthAge > this.config.maxDepthAgeMs) {
                    return;
                }
            }

            // Analyze for hidden order
            const hiddenOrderData = this.analyzeTradeForHiddenOrder(trade);
            if (hiddenOrderData) {
                this.emitHiddenOrderSignal(trade, hiddenOrderData);
            }
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
        return `Detected: ${stats.totalHiddenOrders} hidden orders (avg hidden: ${stats.avgHiddenVolume.toFixed(1)})`;
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
     * Analyze trade for hidden order pattern
     */
    private analyzeTradeForHiddenOrder(trade: EnrichedTradeEvent): {
        visibleVolume: number;
        hiddenVolume: number;
        confidence: number;
    } | null {
        const depthSnapshot = trade.depthSnapshot!;
        const side = trade.buyerIsMaker ? "sell" : "buy";

        // Convert depth snapshot to price-sorted array for efficient lookup
        const depthLevels = this.convertSnapshotToArray(depthSnapshot);

        // Get visible liquidity at the trade price level using binary search
        const visibleVolume = this.getVisibleVolumeAtPrice(
            depthLevels,
            trade.price,
            side
        );

        // Calculate hidden volume
        const hiddenVolume = trade.quantity - visibleVolume;

        // Must have significant hidden volume
        if (hiddenVolume < this.config.minHiddenVolume) {
            return null;
        }

        // Calculate confidence based on hidden percentage and size
        const hiddenPercentage = hiddenVolume / trade.quantity;
        const confidence = this.calculateConfidence(
            hiddenVolume,
            hiddenPercentage,
            trade.quantity
        );

        // Must meet minimum confidence threshold
        if (confidence < this.config.minConfidence) {
            return null;
        }

        return {
            visibleVolume: Math.max(0, visibleVolume),
            hiddenVolume,
            confidence,
        };
    }

    /**
     * Get visible volume at specific price level
     */
    private getVisibleVolumeAtPrice(
        depthLevels: PassiveLevel[],
        price: number,
        side: "buy" | "sell"
    ): number {
        // Binary search for closest level
        let left = 0;
        let right = depthLevels.length > 0 ? depthLevels.length - 1 : 0;
        const tolerance = price * this.config.priceTolerance;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const level =
                depthLevels[mid] !== undefined ? depthLevels[mid] : null;

            if (level && level.price === price) {
                return side === "buy" ? level.ask : level.bid;
            }

            if (level && level.price < price) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        // Check nearest neighbors within tolerance
        const candidates: PassiveLevel[] = [];
        if (left < depthLevels.length) {
            candidates.push(depthLevels[left]!);
        }
        if (right >= 0) {
            candidates.push(depthLevels[right]!);
        }

        let bestVolume = 0;
        let bestDiff = Infinity;
        for (const candidate of candidates) {
            const diff = Math.abs(candidate.price - price);
            if (diff <= tolerance && diff < bestDiff) {
                bestDiff = diff;
                bestVolume = side === "buy" ? candidate.ask : candidate.bid;
            }
        }

        return bestVolume;
    }

    /**
     * Convert a depth snapshot Map to a price-sorted array
     */
    private convertSnapshotToArray(
        depthSnapshot: Map<number, PassiveLevel>
    ): PassiveLevel[] {
        const levels = Array.from(depthSnapshot.values());
        levels.sort((a, b) => a.price - b.price);
        return levels;
    }

    /**
     * Get timestamp of the closest depth level within price tolerance
     */
    private getClosestDepthLevelTimestamp(
        depthSnapshot: Map<number, PassiveLevel>,
        price: number
    ): number | undefined {
        const exactLevel = depthSnapshot.get(price);
        if (exactLevel) {
            return exactLevel.timestamp;
        }

        const tolerance = price * this.config.priceTolerance;
        let nearest: PassiveLevel | undefined;
        let minDiff = tolerance;
        for (const [levelPrice, level] of depthSnapshot) {
            const diff = Math.abs(levelPrice - price);
            if (diff <= tolerance && diff < minDiff) {
                nearest = level;
                minDiff = diff;
            }
        }

        return nearest?.timestamp;
    }

    /**
     * Determine stealth type based on hidden volume characteristics
     */
    private determineStealthType(
        hiddenVolume: number,
        totalVolume: number
    ):
        | "reserve_order"
        | "stealth_liquidity"
        | "algorithmic_hidden"
        | "institutional_stealth" {
        const hiddenPercentage = hiddenVolume / totalVolume;

        if (totalVolume >= 100) {
            // Large orders suggest institutional activity
            return "institutional_stealth";
        } else if (hiddenPercentage >= 0.8) {
            // Mostly hidden suggests algorithmic stealth
            return "algorithmic_hidden";
        } else if (hiddenPercentage >= 0.5) {
            // Significant hidden portion suggests stealth liquidity
            return "stealth_liquidity";
        } else {
            // Smaller hidden portion suggests reserve order
            return "reserve_order";
        }
    }

    /**
     * Calculate confidence score for hidden order detection
     */
    private calculateConfidence(
        hiddenVolume: number,
        hiddenPercentage: number,
        totalVolume: number
    ): number {
        // Base confidence on hidden percentage
        let confidence = hiddenPercentage;

        // Boost confidence for larger hidden volumes
        if (hiddenVolume >= this.config.largeHiddenVolumeThreshold) {
            confidence += this.config.largeVolumeConfidenceBoost;
        } else if (hiddenVolume >= this.config.mediumHiddenVolumeThreshold) {
            confidence += this.config.mediumVolumeConfidenceBoost;
        }

        // Boost confidence for larger total volumes
        if (totalVolume >= this.config.largeTotalVolumeThreshold) {
            confidence += this.config.largeVolumeConfidenceBoost;
        } else if (totalVolume >= this.config.mediumTotalVolumeThreshold) {
            confidence += this.config.mediumVolumeConfidenceBoost;
        }

        // Penalize if hidden volume is small in absolute terms
        if (hiddenVolume < this.config.smallHiddenVolumeThreshold) {
            confidence -= this.config.smallVolumeConfidencePenalty;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Emit hidden order detection signal and event
     */
    private emitHiddenOrderSignal(
        trade: EnrichedTradeEvent,
        hiddenData: {
            visibleVolume: number;
            hiddenVolume: number;
            confidence: number;
        }
    ): void {
        const side = trade.buyerIsMaker ? "sell" : "buy";
        const hiddenPercentage = hiddenData.hiddenVolume / trade.quantity;

        const hiddenOrderEvent: HiddenOrderEvent = {
            id: randomUUID(),
            tradeId: trade.tradeId,
            price: trade.price,
            side,
            executedVolume: trade.quantity,
            visibleVolume: hiddenData.visibleVolume,
            hiddenVolume: hiddenData.hiddenVolume,
            hiddenPercentage,
            timestamp: trade.timestamp,
            confidence: hiddenData.confidence,
            depthSnapshot: trade.depthSnapshot,
        };

        // Store detected event
        this.detectedEvents.push(hiddenOrderEvent);
        if (this.detectedEvents.length > this.config.maxStoredEvents) {
            this.detectedEvents.shift(); // Keep last maxStoredEvents
        }

        // Emit signal candidate through base detector
        const signalCandidate: SignalCandidate = {
            id: randomUUID(),
            type: "absorption", // Use existing type for compatibility
            side,
            confidence: hiddenData.confidence,
            timestamp: trade.timestamp,
            data: {
                price: trade.price,
                zone: Math.round(trade.price * 100),
                side,
                aggressive: trade.quantity,
                passive: hiddenData.visibleVolume,
                refilled: false, // Hidden orders don't refill
                confidence: hiddenData.confidence,
                metrics: {
                    hiddenVolume: hiddenData.hiddenVolume,
                    visibleVolume: hiddenData.visibleVolume,
                    hiddenPercentage,
                    executedVolume: trade.quantity,
                },
                meta: {
                    hiddenOrderDetected: true,
                    hiddenOrderEvent,
                },
            },
        };

        this.emitSignalCandidate(signalCandidate);

        // Emit to anomaly detector
        if (this.anomalyDetector) {
            this.anomalyDetector.onSpoofingEvent(
                {
                    priceStart: trade.price,
                    priceEnd: trade.price,
                    side,
                    wallBefore: hiddenData.hiddenVolume, // The hidden volume
                    wallAfter: 0,
                    canceled: 0,
                    executed: trade.quantity,
                    timestamp: trade.timestamp,
                    spoofedSide: side === "buy" ? "ask" : "bid",
                    spoofType: "hidden_liquidity",
                    confidence: hiddenData.confidence,
                    cancelTimeMs: 0, // Instant
                    marketImpact: hiddenPercentage,
                },
                trade.price
            );
        }

        // Create hidden order zone for chart visualization
        const zoneHeight = trade.price * this.config.zoneHeightPercentage;
        const hiddenOrderZone = {
            id: `hidden_${hiddenOrderEvent.id}`,
            type: "hidden_liquidity" as const,
            priceRange: {
                min: trade.price - zoneHeight / 2,
                max: trade.price + zoneHeight / 2,
            },
            startTime: trade.timestamp,
            endTime: trade.timestamp, // Instant consumption
            strength: hiddenData.confidence,
            completion: 1.0, // Completed when detected
            totalVolume: trade.quantity,
            tradeCount: 1, // Single trade event
            averageTradeSize: trade.quantity,
            side,
            stealthScore: hiddenData.confidence,
            stealthType: this.determineStealthType(
                hiddenData.hiddenVolume,
                trade.quantity
            ),
            volumeConcentration: hiddenData.hiddenVolume / trade.quantity,
            // Additional properties for compatibility
            executedVolume: trade.quantity,
            visibleVolume: hiddenData.visibleVolume,
            hiddenVolume: hiddenData.hiddenVolume,
            confidence: hiddenData.confidence,
            hiddenPercentage,
        };

        // Emit zone update for dashboard visualization
        this.emit("zoneUpdated", {
            updateType: "zone_created",
            zone: hiddenOrderZone,
            significance:
                hiddenData.confidence > 0.9
                    ? "high"
                    : hiddenData.confidence > 0.8
                      ? "medium"
                      : "low",
        });

        // Emit internal event
        this.emit("hiddenOrderDetected", hiddenOrderEvent);

        this.logger.info("Hidden order detected", {
            component: "HiddenOrderDetector",
            operation: "emitHiddenOrderSignal",
            tradeId: trade.tradeId,
            price: trade.price,
            side,
            executedVolume: trade.quantity,
            visibleVolume: hiddenData.visibleVolume,
            hiddenVolume: hiddenData.hiddenVolume,
            hiddenPercentage: hiddenPercentage.toFixed(3),
            confidence: hiddenData.confidence.toFixed(3),
        });
    }

    /**
     * Cleanup old events
     */
    private cleanupOldEvents(): void {
        const cutoff = Date.now() - 300000; // 5 minutes
        this.detectedEvents = this.detectedEvents.filter(
            (event) => event.timestamp > cutoff
        );
    }

    /**
     * Get detected hidden order events
     */
    public getDetectedHiddenOrders(
        windowMs: number = 300000
    ): HiddenOrderEvent[] {
        const cutoff = Date.now() - windowMs;
        return this.detectedEvents.filter((event) => event.timestamp > cutoff);
    }

    /**
     * Get hidden order detection statistics
     */
    public getStatistics(): {
        totalHiddenOrders: number;
        avgHiddenVolume: number;
        avgHiddenPercentage: number;
        avgConfidence: number;
        totalHiddenVolumeDetected: number;
        detectionsByConfidence: {
            high: number; // > 0.9
            medium: number; // 0.8-0.9
            low: number; // < 0.8
        };
    } {
        const recentEvents = this.getDetectedHiddenOrders();

        const stats = {
            totalHiddenOrders: recentEvents.length,
            avgHiddenVolume: 0,
            avgHiddenPercentage: 0,
            avgConfidence: 0,
            totalHiddenVolumeDetected: 0,
            detectionsByConfidence: {
                high: 0,
                medium: 0,
                low: 0,
            },
        };

        if (recentEvents.length > 0) {
            stats.avgHiddenVolume =
                recentEvents.reduce((sum, e) => sum + e.hiddenVolume, 0) /
                recentEvents.length;
            stats.avgHiddenPercentage =
                recentEvents.reduce((sum, e) => sum + e.hiddenPercentage, 0) /
                recentEvents.length;
            stats.avgConfidence =
                recentEvents.reduce((sum, e) => sum + e.confidence, 0) /
                recentEvents.length;
            stats.totalHiddenVolumeDetected = recentEvents.reduce(
                (sum, e) => sum + e.hiddenVolume,
                0
            );

            recentEvents.forEach((event) => {
                if (event.confidence > 0.9) {
                    stats.detectionsByConfidence.high++;
                } else if (event.confidence > 0.8) {
                    stats.detectionsByConfidence.medium++;
                } else {
                    stats.detectionsByConfidence.low++;
                }
            });
        }

        return stats;
    }
}
