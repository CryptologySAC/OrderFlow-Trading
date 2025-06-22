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

export interface HiddenOrderZone {
    id: string;
    type: "hidden_liquidity";
    priceRange: {
        min: number;
        max: number;
    };
    startTime: number;
    endTime: number;
    strength: number;
    completion: number;
    executedVolume: number;
    visibleVolume: number;
    hiddenVolume: number;
    side: "buy" | "sell";
    confidence: number;
    hiddenPercentage: number;
}

/**
 * Hidden order detection using order book depth vs execution volume analysis
 */
export class HiddenOrderDetector extends Detector {
    private config: HiddenOrderDetectorConfig;
    private anomalyDetector?: AnomalyDetector;

    // Recent hidden order events
    private detectedEvents: HiddenOrderEvent[] = [];

    constructor(
        id: string,
        config: Partial<HiddenOrderDetectorConfig>,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, logger, metricsCollector, signalLogger);
        this.config = {
            minHiddenVolume: config.minHiddenVolume ?? 10,
            minTradeSize: config.minTradeSize ?? 5,
            priceTolerance: config.priceTolerance ?? 0.0001,
            maxDepthAgeMs: config.maxDepthAgeMs ?? 1000,
            minConfidence: config.minConfidence ?? 0.8,
            zoneHeightPercentage: config.zoneHeightPercentage ?? 0.002,
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

        // Get visible liquidity at the trade price level
        const visibleVolume = this.getVisibleVolumeAtPrice(
            depthSnapshot,
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
        depthSnapshot: Map<number, PassiveLevel>,
        price: number,
        side: "buy" | "sell"
    ): number {
        // Look for exact price match first
        const exactLevel = depthSnapshot.get(price);
        if (exactLevel) {
            return side === "buy" ? exactLevel.ask : exactLevel.bid;
        }

        // Look for price within tolerance
        const tolerance = price * this.config.priceTolerance;
        for (const [levelPrice, level] of depthSnapshot) {
            if (Math.abs(levelPrice - price) <= tolerance) {
                return side === "buy" ? level.ask : level.bid;
            }
        }

        // No visible liquidity found at this price
        return 0;
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
        if (hiddenVolume >= 50) {
            confidence += 0.1;
        } else if (hiddenVolume >= 25) {
            confidence += 0.05;
        }

        // Boost confidence for larger total volumes
        if (totalVolume >= 100) {
            confidence += 0.1;
        } else if (totalVolume >= 50) {
            confidence += 0.05;
        }

        // Penalize if hidden volume is small in absolute terms
        if (hiddenVolume < 20) {
            confidence -= 0.1;
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
        if (this.detectedEvents.length > 100) {
            this.detectedEvents.shift(); // Keep last 100
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
        const hiddenOrderZone: HiddenOrderZone = {
            id: `hidden_${hiddenOrderEvent.id}`,
            type: "hidden_liquidity",
            priceRange: {
                min: trade.price - zoneHeight / 2,
                max: trade.price + zoneHeight / 2,
            },
            startTime: trade.timestamp,
            endTime: trade.timestamp, // Instant consumption
            strength: hiddenData.confidence,
            completion: 1.0, // Completed when detected
            executedVolume: trade.quantity,
            visibleVolume: hiddenData.visibleVolume,
            hiddenVolume: hiddenData.hiddenVolume,
            side,
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
